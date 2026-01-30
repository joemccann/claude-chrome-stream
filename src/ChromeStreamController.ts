/**
 * ChromeStreamController - Main orchestrator for browser streaming
 * Integrates BrowserManager, StreamProcessor, InputController, and FrameBuffer
 */

import { EventEmitter } from 'events';
import BrowserManager from './BrowserManager.js';
import StreamProcessor from './StreamProcessor.js';
import InputController from './InputController.js';
import FrameBuffer, { FrameActionResult } from './FrameBuffer.js';
import {
  StreamConfig,
  DEFAULT_CONFIG,
  ScreencastFrame,
  BrowserAction,
  SessionState,
  StreamEvent,
} from './types.js';

export interface ChromeStreamConfig extends StreamConfig {
  /** Auto-start streaming on launch */
  autoStream?: boolean;
  /** Initial URL to navigate to */
  initialUrl?: string;
}

export interface ControllerStatus {
  active: boolean;
  streaming: boolean;
  session: SessionState | null;
  streamStats: {
    frameCount: number;
    droppedFrameCount: number;
    avgDeltaTime: number;
    currentFrameId: number;
  } | null;
  bufferStats: {
    frameCount: number;
    pendingActions: number;
    oldestFrameAge: number;
    newestFrameAge: number;
  } | null;
}

export class ChromeStreamController extends EventEmitter {
  private browserManager: BrowserManager;
  private streamProcessor: StreamProcessor | null = null;
  private inputController: InputController | null = null;
  private frameBuffer: FrameBuffer;
  private config: ChromeStreamConfig;
  private isStarted = false;

  constructor(config: Partial<ChromeStreamConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.browserManager = new BrowserManager(this.config);
    this.frameBuffer = new FrameBuffer({
      maxSize: this.config.maxBufferSize,
    });

    this.setupEventForwarding();
  }

  /**
   * Start the browser and streaming
   * @param url Optional initial URL to navigate to
   * @returns Initial frame after startup
   */
  async start(url?: string): Promise<ScreencastFrame> {
    if (this.isStarted) {
      throw new Error('Controller already started');
    }

    try {
      // Launch browser
      await this.browserManager.launch();

      // Initialize stream processor with CDP session
      const cdpSession = this.browserManager.getCDPSession();
      this.streamProcessor = new StreamProcessor(this.config);
      this.streamProcessor.initialize(cdpSession);

      // Initialize input controller
      const page = this.browserManager.getPage();
      this.inputController = new InputController(
        page,
        cdpSession,
        this.config.viewportWidth,
        this.config.viewportHeight
      );

      // Setup frame forwarding
      this.streamProcessor.onFrame((frame) => {
        this.frameBuffer.addFrame(frame);
        this.inputController?.setCurrentFrameId(frame.frameId);
        this.emit('frame', frame);
      });

      // Start streaming
      await this.streamProcessor.start();

      // Navigate if URL provided
      const targetUrl = url || this.config.initialUrl;
      if (targetUrl) {
        await this.browserManager.navigate(targetUrl);
      }

      this.isStarted = true;

      // Wait for initial frame
      const initialFrame = await this.frameBuffer.waitForNextFrame(5000);
      return initialFrame;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  /**
   * Execute a browser action with frame synchronization
   */
  async executeAction(action: BrowserAction): Promise<FrameActionResult> {
    if (!this.isStarted || !this.inputController) {
      throw new Error('Controller not started');
    }

    // Special handling for navigate action
    if (action.action === 'navigate') {
      await this.browserManager.navigate(action.url);
      const frame = await this.frameBuffer.waitForStableFrame(500, 5000);
      return {
        action,
        result: {
          success: true,
          frameId: frame.frameId,
          timestamp: Date.now(),
          action,
        },
        beforeFrame: this.frameBuffer.getLatestFrame()!,
        afterFrame: frame,
        causedChange: true,
        latencyMs: 0,
      };
    }

    // Use frame buffer for synchronized action execution
    return this.frameBuffer.registerAction(action, async () => {
      return this.inputController!.execute(action);
    });
  }

  /**
   * Execute multiple actions in sequence
   */
  async executeActions(actions: BrowserAction[]): Promise<FrameActionResult[]> {
    const results: FrameActionResult[] = [];
    for (const action of actions) {
      results.push(await this.executeAction(action));
    }
    return results;
  }

  /**
   * Get the latest frame
   */
  getLatestFrame(): ScreencastFrame | null {
    return this.frameBuffer.getLatestFrame();
  }

  /**
   * Wait for next frame
   */
  async waitForFrame(timeout?: number): Promise<ScreencastFrame> {
    return this.frameBuffer.waitForNextFrame(timeout);
  }

  /**
   * Wait for stable frame (no changes for duration)
   */
  async waitForStableFrame(durationMs?: number, timeout?: number): Promise<ScreencastFrame> {
    return this.frameBuffer.waitForStableFrame(durationMs, timeout);
  }

  /**
   * Capture screenshot on demand
   */
  async captureScreenshot(): Promise<ScreencastFrame | null> {
    if (!this.streamProcessor) {
      return null;
    }
    return this.streamProcessor.captureFrame();
  }

  /**
   * Navigate to URL
   */
  async navigate(url: string): Promise<void> {
    await this.browserManager.navigate(url);
  }

  /**
   * Get current session state
   */
  async getSessionState(): Promise<SessionState> {
    const state = this.browserManager.getSessionState();
    state.title = await this.browserManager.getTitle();
    state.streaming = this.streamProcessor?.isActive() || false;
    state.currentFrameId = this.frameBuffer.getLatestFrame()?.frameId || 0;
    return state;
  }

  /**
   * Get controller status
   */
  getStatus(): ControllerStatus {
    return {
      active: this.isStarted,
      streaming: this.streamProcessor?.isActive() || false,
      session: this.browserManager.isActive() ? this.browserManager.getSessionState() : null,
      streamStats: this.streamProcessor?.getStats() || null,
      bufferStats: this.frameBuffer.getStats(),
    };
  }

  /**
   * Update configuration (limited to safe updates)
   */
  updateConfig(updates: Partial<StreamConfig>): void {
    this.browserManager.updateConfig(updates);
    this.streamProcessor?.updateConfig(updates);
  }

  /**
   * Pause streaming (keeps browser open)
   */
  async pauseStreaming(): Promise<void> {
    await this.streamProcessor?.stop();
  }

  /**
   * Resume streaming
   */
  async resumeStreaming(): Promise<void> {
    await this.streamProcessor?.start();
  }

  /**
   * Stop browser and cleanup
   */
  async stop(): Promise<void> {
    this.isStarted = false;

    if (this.streamProcessor) {
      await this.streamProcessor.stop();
      this.streamProcessor = null;
    }

    this.inputController = null;

    await this.browserManager.close();

    this.frameBuffer.clear();
  }

  /**
   * Attempt recovery from errors
   */
  async recover(): Promise<boolean> {
    const currentUrl = (await this.getSessionState()).url;
    await this.stop();

    try {
      await this.start(currentUrl);
      return true;
    } catch {
      return false;
    }
  }

  private setupEventForwarding(): void {
    // Forward browser manager events
    this.browserManager.on('connected', (state) => this.emit('connected', state));
    this.browserManager.on('disconnected', (event) => this.emit('disconnected', event));
    this.browserManager.on('navigation', (event) => this.emit('navigation', event));
    this.browserManager.on('error', (event) => this.handleError(event));
  }

  private handleError(event: StreamEvent): void {
    // Only emit 'error' if there are listeners, otherwise Node.js will throw
    if (this.listenerCount('error') > 0) {
      this.emit('error', event);
    } else {
      // Log to stderr if no error handler is attached
      const data = event.data as { message?: string; recoverable?: boolean } | undefined;
      console.error(`[ChromeStreamController] Error: ${data?.message || 'Unknown error'}`);
    }

    // Auto-recovery for recoverable errors
    if ('data' in event && typeof event.data === 'object' && event.data !== null) {
      const data = event.data as { recoverable?: boolean };
      if (data.recoverable) {
        this.recover().then((recovered) => {
          if (recovered) {
            this.emit('recovered');
          } else {
            this.emit('recovery_failed');
          }
        }).catch((err) => {
          console.error('[ChromeStreamController] Recovery failed:', err);
        });
      }
    }
  }
}

export default ChromeStreamController;
