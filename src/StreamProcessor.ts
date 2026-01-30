/**
 * StreamProcessor - CDP Screencast management with visual delta detection
 * Implements intelligent frame sampling using pixelmatch
 */

import { CDPSession } from 'puppeteer';
import { EventEmitter } from 'events';
import sharp from 'sharp';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import {
  StreamConfig,
  ScreencastFrame,
  FrameMetadata,
  FrameComparisonResult,
  FrameCallback,
} from './types.js';

interface CDPScreencastFrameEvent {
  data: string;
  metadata: {
    offsetTop: number;
    pageScaleFactor: number;
    deviceWidth: number;
    deviceHeight: number;
    scrollOffsetX: number;
    scrollOffsetY: number;
    timestamp: number;
  };
  sessionId: number;
}

export class StreamProcessor extends EventEmitter {
  private cdpSession: CDPSession | null = null;
  private config: StreamConfig;
  private isStreaming = false;
  private frameId = 0;
  private lastFrameData: Buffer | null = null;
  private lastFrameTime = 0;
  private lastSentFrameTime = 0;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private pendingFrame: ScreencastFrame | null = null;
  private frameCallbacks: Set<FrameCallback> = new Set();

  // Performance tracking
  private frameCount = 0;
  private droppedFrameCount = 0;
  private totalDeltaTime = 0;

  constructor(config: StreamConfig) {
    super();
    this.config = config;
  }

  /**
   * Initialize stream processor with CDP session
   */
  initialize(cdpSession: CDPSession): void {
    this.cdpSession = cdpSession;
    this.setupCDPListeners();
  }

  /**
   * Start screencast streaming
   */
  async start(): Promise<void> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }

    if (this.isStreaming) {
      return;
    }

    try {
      await this.cdpSession.send('Page.startScreencast', {
        format: 'jpeg',
        quality: this.config.quality,
        everyNthFrame: this.config.everyNthFrame,
        maxWidth: this.config.viewportWidth,
        maxHeight: this.config.viewportHeight,
      });

      this.isStreaming = true;
      this.startKeepAlive();
      this.emit('streaming_started');
    } catch (error) {
      this.emit('error', {
        type: 'error',
        timestamp: Date.now(),
        data: {
          message: `Failed to start screencast: ${error instanceof Error ? error.message : 'Unknown error'}`,
          recoverable: true,
        },
      });
      throw error;
    }
  }

  /**
   * Stop screencast streaming
   */
  async stop(): Promise<void> {
    if (!this.cdpSession || !this.isStreaming) {
      return;
    }

    this.stopKeepAlive();

    try {
      await this.cdpSession.send('Page.stopScreencast');
    } catch {
      // Ignore errors during stop
    }

    this.isStreaming = false;
    this.emit('streaming_stopped');
  }

  /**
   * Register callback for processed frames
   */
  onFrame(callback: FrameCallback): () => void {
    this.frameCallbacks.add(callback);
    return () => this.frameCallbacks.delete(callback);
  }

  /**
   * Get current streaming status
   */
  isActive(): boolean {
    return this.isStreaming;
  }

  /**
   * Get current frame ID
   */
  getCurrentFrameId(): number {
    return this.frameId;
  }

  /**
   * Get pending frame (last processed frame awaiting action)
   */
  getPendingFrame(): ScreencastFrame | null {
    return this.pendingFrame;
  }

  /**
   * Clear pending frame after action is taken
   */
  clearPendingFrame(): void {
    this.pendingFrame = null;
  }

  /**
   * Force capture current frame (for screenshot action)
   */
  async captureFrame(): Promise<ScreencastFrame | null> {
    if (!this.cdpSession) {
      return null;
    }

    try {
      const result = await this.cdpSession.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: this.config.quality,
      });

      const frame = await this.createFrame(result.data, {
        offsetTop: 0,
        pageScaleFactor: 1,
        deviceWidth: this.config.viewportWidth,
        deviceHeight: this.config.viewportHeight,
        scrollOffsetX: 0,
        scrollOffsetY: 0,
        timestamp: Date.now(),
      }, true);

      return frame;
    } catch (error) {
      this.emit('error', {
        type: 'error',
        timestamp: Date.now(),
        data: {
          message: `Screenshot capture failed: ${error instanceof Error ? error.message : 'Unknown'}`,
          recoverable: true,
        },
      });
      return null;
    }
  }

  /**
   * Get streaming statistics
   */
  getStats(): {
    frameCount: number;
    droppedFrameCount: number;
    avgDeltaTime: number;
    currentFrameId: number;
  } {
    return {
      frameCount: this.frameCount,
      droppedFrameCount: this.droppedFrameCount,
      avgDeltaTime: this.frameCount > 0 ? this.totalDeltaTime / this.frameCount : 0,
      currentFrameId: this.frameId,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<StreamConfig>): void {
    if (updates.deltaThreshold !== undefined) {
      this.config.deltaThreshold = updates.deltaThreshold;
    }
    if (updates.keepAliveMs !== undefined) {
      this.config.keepAliveMs = updates.keepAliveMs;
      if (this.isStreaming) {
        this.stopKeepAlive();
        this.startKeepAlive();
      }
    }
  }

  private setupCDPListeners(): void {
    if (!this.cdpSession) return;

    this.cdpSession.on('Page.screencastFrame', async (event: CDPScreencastFrameEvent) => {
      await this.handleScreencastFrame(event);
    });
  }

  private async handleScreencastFrame(event: CDPScreencastFrameEvent): Promise<void> {
    if (!this.cdpSession) return;

    // Acknowledge frame to CDP
    try {
      await this.cdpSession.send('Page.screencastFrameAck', {
        sessionId: event.sessionId,
      });
    } catch {
      // Ignore ack errors
    }

    this.frameCount++;
    const now = Date.now();
    const timeSinceLastFrame = now - this.lastFrameTime;
    this.lastFrameTime = now;

    // Create frame object
    const frame = await this.createFrame(event.data, event.metadata);

    // Check if we should forward this frame
    const timeSinceLastSent = now - this.lastSentFrameTime;
    const shouldSend = frame.hasChange || timeSinceLastSent >= this.config.keepAliveMs;

    if (shouldSend) {
      this.lastSentFrameTime = now;
      this.totalDeltaTime += timeSinceLastFrame;
      this.pendingFrame = frame;
      this.emitFrame(frame);
    } else {
      this.droppedFrameCount++;
    }
  }

  private async createFrame(
    base64Data: string,
    metadata: CDPScreencastFrameEvent['metadata'],
    forceChange = false
  ): Promise<ScreencastFrame> {
    this.frameId++;

    // Convert to buffer for comparison
    const buffer = Buffer.from(base64Data, 'base64');

    // Perform visual delta comparison
    let comparison: FrameComparisonResult;
    if (forceChange || !this.lastFrameData) {
      comparison = { hasChange: true, deltaPercent: 100, diffPixelCount: 0, totalPixels: 0 };
    } else {
      comparison = await this.compareFrames(this.lastFrameData, buffer);
    }

    // Update last frame buffer
    this.lastFrameData = buffer;

    const frameMetadata: FrameMetadata = {
      deviceScaleFactor: 1,
      pageScaleFactor: metadata.pageScaleFactor,
      offsetTop: metadata.offsetTop,
      offsetLeft: 0,
      scrollOffsetX: metadata.scrollOffsetX,
      scrollOffsetY: metadata.scrollOffsetY,
    };

    return {
      frameId: this.frameId,
      timestamp: Date.now(),
      data: base64Data,
      metadata: frameMetadata,
      hasChange: comparison.hasChange,
      deltaPercent: comparison.deltaPercent,
    };
  }

  /**
   * Compare two frames using pixelmatch
   */
  private async compareFrames(
    prevBuffer: Buffer,
    currBuffer: Buffer
  ): Promise<FrameComparisonResult> {
    try {
      // Convert JPEGs to raw RGBA using sharp
      const [prevRaw, currRaw] = await Promise.all([
        sharp(prevBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
        sharp(currBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      ]);

      // Ensure dimensions match
      if (
        prevRaw.info.width !== currRaw.info.width ||
        prevRaw.info.height !== currRaw.info.height
      ) {
        // Dimension mismatch - consider as changed
        return {
          hasChange: true,
          deltaPercent: 100,
          diffPixelCount: 0,
          totalPixels: 0,
        };
      }

      const { width, height } = prevRaw.info;
      const totalPixels = width * height;

      // Create output diff buffer (we don't actually need the diff image)
      const diffBuffer = Buffer.alloc(width * height * 4);

      // Run pixelmatch
      const diffPixelCount = pixelmatch(
        prevRaw.data,
        currRaw.data,
        diffBuffer,
        width,
        height,
        {
          threshold: 0.1, // Color difference threshold
          includeAA: false, // Ignore anti-aliasing differences
        }
      );

      const deltaPercent = (diffPixelCount / totalPixels) * 100;
      const hasChange = deltaPercent >= this.config.deltaThreshold;

      return {
        hasChange,
        deltaPercent,
        diffPixelCount,
        totalPixels,
      };
    } catch (error) {
      // On comparison error, assume change
      console.error('Frame comparison error:', error);
      return {
        hasChange: true,
        deltaPercent: 100,
        diffPixelCount: 0,
        totalPixels: 0,
      };
    }
  }

  private emitFrame(frame: ScreencastFrame): void {
    // Emit to EventEmitter listeners
    this.emit('frame', {
      type: 'frame',
      timestamp: frame.timestamp,
      data: frame,
    });

    // Call registered callbacks
    for (const callback of this.frameCallbacks) {
      try {
        callback(frame);
      } catch (error) {
        console.error('Frame callback error:', error);
      }
    }
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      const timeSinceLastSent = Date.now() - this.lastSentFrameTime;
      if (timeSinceLastSent >= this.config.keepAliveMs && this.lastFrameData) {
        // Force emit last frame as keep-alive
        this.captureFrame().then(frame => {
          if (frame) {
            this.lastSentFrameTime = Date.now();
            this.pendingFrame = frame;
            this.emitFrame(frame);
          }
        }).catch(() => {
          // Ignore keep-alive capture errors
        });
      }
    }, this.config.keepAliveMs / 2);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }
}

export default StreamProcessor;
