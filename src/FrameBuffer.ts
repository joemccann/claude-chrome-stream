/**
 * FrameBuffer - Frame synchronization and management
 * Ensures Claude acts on current frames and handles frame-action correlation
 */

import { EventEmitter } from 'events';
import {
  ScreencastFrame,
  ActionResult,
  BrowserAction,
} from './types.js';

interface PendingAction {
  action: BrowserAction;
  frameId: number;
  timestamp: number;
  resolve: (result: FrameActionResult) => void;
  reject: (error: Error) => void;
}

export interface FrameActionResult {
  /** The action that was executed */
  action: BrowserAction;
  /** Result of the action */
  result: ActionResult;
  /** Frame before action (the one Claude saw) */
  beforeFrame: ScreencastFrame;
  /** Frame after action (result state) */
  afterFrame: ScreencastFrame | null;
  /** Whether the action caused visual change */
  causedChange: boolean;
  /** Time from action request to completion */
  latencyMs: number;
}

export interface FrameBufferConfig {
  /** Maximum frames to keep in buffer */
  maxSize: number;
  /** Time to wait for stable frame after action (ms) */
  stabilityWaitMs: number;
  /** Maximum time to wait for post-action frame (ms) */
  maxWaitMs: number;
  /** Minimum visual change to consider frame "stable" */
  stabilityThreshold: number;
}

const DEFAULT_CONFIG: FrameBufferConfig = {
  maxSize: 10,
  stabilityWaitMs: 200,
  maxWaitMs: 2000,
  stabilityThreshold: 0.5,
};

export class FrameBuffer extends EventEmitter {
  private frames: ScreencastFrame[] = [];
  private config: FrameBufferConfig;
  private pendingActions: PendingAction[] = [];

  constructor(config: Partial<FrameBufferConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add a new frame to the buffer
   */
  addFrame(frame: ScreencastFrame): void {
    this.frames.push(frame);

    // Trim buffer if needed
    while (this.frames.length > this.config.maxSize) {
      this.frames.shift();
    }

    // Emit for listeners
    this.emit('frame_added', frame);

    // Check pending actions for post-action frame
    this.checkPendingActions(frame);
  }

  /**
   * Get the latest frame
   */
  getLatestFrame(): ScreencastFrame | null {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1] : null;
  }

  /**
   * Get a specific frame by ID
   */
  getFrame(frameId: number): ScreencastFrame | null {
    return this.frames.find(f => f.frameId === frameId) || null;
  }

  /**
   * Get all buffered frames
   */
  getAllFrames(): ScreencastFrame[] {
    return [...this.frames];
  }

  /**
   * Get frames since a specific frame ID
   */
  getFramesSince(frameId: number): ScreencastFrame[] {
    const index = this.frames.findIndex(f => f.frameId === frameId);
    if (index === -1) return [];
    return this.frames.slice(index + 1);
  }

  /**
   * Register an action and wait for result with post-action frame
   * This is the hybrid synchronization approach:
   * - Lock-step: Waits for stable frame after action
   * - Optimistic: Associates frameId with action for correlation
   */
  async registerAction(
    action: BrowserAction,
    executeAction: () => Promise<ActionResult>
  ): Promise<FrameActionResult> {
    const beforeFrame = this.getLatestFrame();
    if (!beforeFrame) {
      throw new Error('No frame available for action');
    }

    const startTime = Date.now();

    return new Promise(async (resolve, reject) => {
      // Execute the action
      let result: ActionResult;
      try {
        result = await executeAction();
      } catch (error) {
        reject(error);
        return;
      }

      if (!result.success) {
        resolve({
          action,
          result,
          beforeFrame,
          afterFrame: null,
          causedChange: false,
          latencyMs: Date.now() - startTime,
        });
        return;
      }

      // For non-visual actions, resolve immediately
      if (action.action === 'wait' || action.action === 'screenshot') {
        resolve({
          action,
          result,
          beforeFrame,
          afterFrame: beforeFrame,
          causedChange: false,
          latencyMs: Date.now() - startTime,
        });
        return;
      }

      // Register pending action to wait for stable frame
      const pendingAction: PendingAction = {
        action,
        frameId: beforeFrame.frameId,
        timestamp: startTime,
        resolve: (frameResult) => {
          resolve(frameResult);
        },
        reject,
      };

      this.pendingActions.push(pendingAction);

      // Set timeout for max wait
      setTimeout(() => {
        const index = this.pendingActions.indexOf(pendingAction);
        if (index !== -1) {
          this.pendingActions.splice(index, 1);
          const latestFrame = this.getLatestFrame();
          resolve({
            action,
            result,
            beforeFrame,
            afterFrame: latestFrame,
            causedChange: latestFrame ? latestFrame.frameId !== beforeFrame.frameId : false,
            latencyMs: Date.now() - startTime,
          });
        }
      }, this.config.maxWaitMs);
    });
  }

  /**
   * Check if any pending actions can be resolved with new frame
   */
  private checkPendingActions(frame: ScreencastFrame): void {
    const toResolve: PendingAction[] = [];

    for (const pending of this.pendingActions) {
      // Frame came after action was initiated
      if (frame.frameId > pending.frameId) {
        // Check if frame is "stable" (low delta from previous)
        const timeSinceAction = Date.now() - pending.timestamp;

        if (
          frame.deltaPercent <= this.config.stabilityThreshold ||
          timeSinceAction >= this.config.stabilityWaitMs
        ) {
          toResolve.push(pending);
        }
      }
    }

    // Resolve stable actions
    for (const pending of toResolve) {
      const index = this.pendingActions.indexOf(pending);
      if (index !== -1) {
        this.pendingActions.splice(index, 1);

        const beforeFrame = this.getFrame(pending.frameId);
        pending.resolve({
          action: pending.action,
          result: {
            success: true,
            frameId: frame.frameId,
            timestamp: Date.now(),
            action: pending.action,
          },
          beforeFrame: beforeFrame!,
          afterFrame: frame,
          causedChange: frame.hasChange,
          latencyMs: Date.now() - pending.timestamp,
        });
      }
    }
  }

  /**
   * Check if an action would be acting on a stale frame
   */
  isFrameStale(frameId: number, maxAgeMs: number = 1000): boolean {
    const frame = this.getFrame(frameId);
    if (!frame) return true;

    const age = Date.now() - frame.timestamp;
    return age > maxAgeMs;
  }

  /**
   * Wait for next frame (useful after navigation)
   */
  async waitForNextFrame(timeout: number = 5000): Promise<ScreencastFrame> {
    return new Promise((resolve, reject) => {
      const currentFrameId = this.getLatestFrame()?.frameId || 0;

      const timeoutId = setTimeout(() => {
        this.off('frame_added', handler);
        reject(new Error('Timeout waiting for next frame'));
      }, timeout);

      const handler = (frame: ScreencastFrame) => {
        if (frame.frameId > currentFrameId) {
          clearTimeout(timeoutId);
          this.off('frame_added', handler);
          resolve(frame);
        }
      };

      this.on('frame_added', handler);
    });
  }

  /**
   * Wait for stable frame (no significant changes for duration)
   */
  async waitForStableFrame(
    durationMs: number = 500,
    timeout: number = 5000
  ): Promise<ScreencastFrame> {
    return new Promise((resolve, reject) => {
      let lastChangeTime = Date.now();
      let lastFrame = this.getLatestFrame();

      const timeoutId = setTimeout(() => {
        this.off('frame_added', handler);
        if (lastFrame) {
          resolve(lastFrame);
        } else {
          reject(new Error('Timeout waiting for stable frame'));
        }
      }, timeout);

      const handler = (frame: ScreencastFrame) => {
        lastFrame = frame;

        if (frame.hasChange && frame.deltaPercent > this.config.stabilityThreshold) {
          lastChangeTime = Date.now();
        } else {
          // Check if stable for long enough
          if (Date.now() - lastChangeTime >= durationMs) {
            clearTimeout(timeoutId);
            this.off('frame_added', handler);
            resolve(frame);
          }
        }
      };

      this.on('frame_added', handler);
    });
  }

  /**
   * Clear all buffered frames
   */
  clear(): void {
    this.frames = [];
    this.pendingActions = [];
  }

  /**
   * Get buffer statistics
   */
  getStats(): {
    frameCount: number;
    pendingActions: number;
    oldestFrameAge: number;
    newestFrameAge: number;
  } {
    const now = Date.now();
    return {
      frameCount: this.frames.length,
      pendingActions: this.pendingActions.length,
      oldestFrameAge: this.frames.length > 0 ? now - this.frames[0].timestamp : 0,
      newestFrameAge: this.frames.length > 0 ? now - this.frames[this.frames.length - 1].timestamp : 0,
    };
  }
}

export default FrameBuffer;
