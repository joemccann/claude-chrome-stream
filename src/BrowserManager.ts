/**
 * BrowserManager - Chrome/Puppeteer lifecycle management
 * Handles browser initialization, CDP session management, and cleanup
 */

import puppeteer, {
  Browser,
  Page,
  CDPSession,
  type PuppeteerLaunchOptions,
} from 'puppeteer';
import { EventEmitter } from 'events';
import {
  StreamConfig,
  DEFAULT_CONFIG,
  SessionState,
  ErrorEvent,
} from './types.js';

export class BrowserManager extends EventEmitter {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private cdpSession: CDPSession | null = null;
  private config: StreamConfig;
  private sessionId: string;
  private isConnected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 3;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<StreamConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionId = this.generateSessionId();
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Launch Chrome browser with configured settings
   */
  async launch(): Promise<void> {
    if (this.browser) {
      throw new Error('Browser already launched');
    }

    const launchOptions: PuppeteerLaunchOptions = {
      headless: this.config.headless,
      devtools: this.config.devtools,
      // Increase protocol timeout to handle long API calls (5 minutes)
      protocolTimeout: 300000,
      args: [
        `--window-size=${this.config.viewportWidth},${this.config.viewportHeight}`,
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-ipc-flooding-protection',
        // Prevent browser from being killed when idle
        '--disable-hang-monitor',
        '--disable-component-update',
        // macOS arm64 optimizations
        '--enable-features=Metal',
        '--use-angle=metal',
        // Performance optimizations
        '--disable-extensions',
        '--disable-sync',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-infobars',
      ],
      defaultViewport: {
        width: this.config.viewportWidth,
        height: this.config.viewportHeight,
        deviceScaleFactor: 1,
      },
    };

    if (this.config.chromePath) {
      launchOptions.executablePath = this.config.chromePath;
    }

    if (this.config.userDataDir) {
      launchOptions.userDataDir = this.config.userDataDir;
    }

    try {
      this.browser = await puppeteer.launch(launchOptions);
      this.setupBrowserListeners();

      // Get or create page
      const pages = await this.browser.pages();
      this.page = pages[0] || (await this.browser.newPage());

      // Set viewport explicitly
      await this.page.setViewport({
        width: this.config.viewportWidth,
        height: this.config.viewportHeight,
        deviceScaleFactor: 1,
      });

      // Create CDP session
      this.cdpSession = await this.page.createCDPSession();
      this.setupCDPListeners();

      this.isConnected = true;
      this.reconnectAttempts = 0;

      // Start heartbeat to keep CDP session alive during long operations
      this.startHeartbeat();

      this.emit('connected', this.getSessionState());
    } catch (error) {
      this.emitError('Failed to launch browser', error, false);
      throw error;
    }
  }

  /**
   * Navigate to a URL
   */
  async navigate(url: string): Promise<void> {
    this.ensurePage();

    try {
      await this.page!.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      this.emit('navigation', {
        type: 'navigation',
        timestamp: Date.now(),
        data: {
          url: this.page!.url(),
          frameId: 0,
        },
      });
    } catch (error) {
      this.emitError('Navigation failed', error, true);
      throw error;
    }
  }

  /**
   * Get CDP session for direct protocol access
   */
  getCDPSession(): CDPSession {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }
    return this.cdpSession;
  }

  /**
   * Get Puppeteer page for high-level operations
   */
  getPage(): Page {
    this.ensurePage();
    return this.page!;
  }

  /**
   * Get current session state
   */
  getSessionState(): SessionState {
    return {
      sessionId: this.sessionId,
      url: this.page?.url() || '',
      title: '', // Title is async, set separately
      connected: this.isConnected,
      streaming: false, // StreamProcessor manages this
      currentFrameId: 0,
      viewport: {
        width: this.config.viewportWidth,
        height: this.config.viewportHeight,
      },
      lastActivity: Date.now(),
    };
  }

  /**
   * Get current page title (async)
   */
  async getTitle(): Promise<string> {
    if (!this.page) return '';
    try {
      return await this.page.title();
    } catch {
      return '';
    }
  }

  /**
   * Get configuration
   */
  getConfig(): StreamConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (limited - some require browser restart)
   */
  updateConfig(updates: Partial<StreamConfig>): void {
    // Only allow safe updates
    const safeUpdates: Partial<StreamConfig> = {};
    if (updates.quality !== undefined) safeUpdates.quality = updates.quality;
    if (updates.everyNthFrame !== undefined) safeUpdates.everyNthFrame = updates.everyNthFrame;
    if (updates.deltaThreshold !== undefined) safeUpdates.deltaThreshold = updates.deltaThreshold;
    if (updates.keepAliveMs !== undefined) safeUpdates.keepAliveMs = updates.keepAliveMs;
    if (updates.maxBufferSize !== undefined) safeUpdates.maxBufferSize = updates.maxBufferSize;

    this.config = { ...this.config, ...safeUpdates };
  }

  /**
   * Check if browser is connected
   */
  isActive(): boolean {
    return this.isConnected && this.browser !== null && this.page !== null;
  }

  /**
   * Close browser and cleanup
   */
  async close(): Promise<void> {
    this.isConnected = false;
    this.stopHeartbeat();

    if (this.cdpSession) {
      try {
        await this.cdpSession.detach();
      } catch {
        // Ignore detach errors during cleanup
      }
      this.cdpSession = null;
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Ignore close errors during cleanup
      }
      this.browser = null;
    }

    this.page = null;

    this.emit('disconnected', {
      type: 'disconnected',
      timestamp: Date.now(),
      data: { sessionId: this.sessionId },
    });
  }

  /**
   * Attempt to recover from session detachment
   */
  async recover(): Promise<boolean> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emitError('Max reconnection attempts exceeded', null, false);
      return false;
    }

    this.reconnectAttempts++;
    const currentUrl = this.page?.url() || 'about:blank';

    try {
      await this.close();
      await this.launch();

      if (currentUrl && currentUrl !== 'about:blank') {
        await this.navigate(currentUrl);
      }

      return true;
    } catch (error) {
      this.emitError('Recovery failed', error, false);
      return false;
    }
  }

  private setupBrowserListeners(): void {
    if (!this.browser) return;

    this.browser.on('disconnected', () => {
      this.isConnected = false;
      this.emitError('Browser disconnected', null, true);
    });
  }

  private setupCDPListeners(): void {
    if (!this.cdpSession) return;

    this.cdpSession.on('sessiondetached', () => {
      this.emitError('Session detached', null, true);
    });

    // Listen for target events
    this.cdpSession.on('Target.targetDestroyed', () => {
      this.emitError('Target closed', null, true);
    });
  }

  private ensurePage(): void {
    if (!this.page) {
      throw new Error('Page not initialized');
    }
    if (!this.isConnected) {
      throw new Error('Browser not connected');
    }
  }

  private emitError(message: string, error: unknown, recoverable: boolean): void {
    const event: ErrorEvent = {
      type: recoverable ? 'error' : 'session_detached',
      timestamp: Date.now(),
      data: {
        message: error instanceof Error ? `${message}: ${error.message}` : message,
        code: error instanceof Error ? error.name : undefined,
        recoverable,
      },
    };
    this.emit('error', event);
  }

  /**
   * Start heartbeat to keep CDP session alive during long operations
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    // Ping CDP every 10 seconds to keep connection alive
    this.heartbeatTimer = setInterval(async () => {
      if (this.cdpSession && this.isConnected) {
        try {
          // Simple CDP ping - get browser version (lightweight operation)
          await this.cdpSession.send('Browser.getVersion');
        } catch {
          // Heartbeat failed - session may be dead
        }
      }
    }, 10000);
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

export default BrowserManager;
