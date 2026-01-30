/**
 * Claude Chrome Stream - Main Entry Point
 * High-performance Chrome automation with real-time CDP streaming
 */

// Core exports
export { BrowserManager } from './BrowserManager.js';
export { StreamProcessor } from './StreamProcessor.js';
export { InputController } from './InputController.js';
export { FrameBuffer } from './FrameBuffer.js';
export type { FrameActionResult, FrameBufferConfig } from './FrameBuffer.js';

// Integration exports
export { SonnetBridge } from './SonnetBridge.js';
export type { SonnetBridgeConfig } from './SonnetBridge.js';
export { ChromeStreamController } from './ChromeStreamController.js';
export type { ChromeStreamConfig, ControllerStatus } from './ChromeStreamController.js';
export { MCPServer } from './MCPServer.js';

// Type exports
export * from './types.js';

// Convenience factory function
import { ChromeStreamController, ChromeStreamConfig } from './ChromeStreamController.js';
import { SonnetBridge, SonnetBridgeConfig } from './SonnetBridge.js';
import { ScreencastFrame, BrowserAction } from './types.js';

/**
 * Create a fully configured Chrome Stream instance with Sonnet integration
 */
export async function createChromeStream(config: {
  browser?: Partial<ChromeStreamConfig>;
  sonnet?: Partial<SonnetBridgeConfig>;
  initialUrl?: string;
}): Promise<{
  controller: ChromeStreamController;
  sonnet: SonnetBridge;
  execute: (action: BrowserAction) => Promise<ScreencastFrame>;
  ask: (prompt: string) => Promise<{ text?: string; actions?: BrowserAction[] }>;
  stop: () => Promise<void>;
}> {
  const controller = new ChromeStreamController(config.browser);

  // Start browser
  await controller.start(config.initialUrl);

  // Get viewport from config
  const browserConfig = controller.getStatus().session;
  const viewport = browserConfig?.viewport || { width: 1280, height: 800 };

  // Initialize Sonnet bridge
  const sonnet = new SonnetBridge({
    ...config.sonnet,
    displayWidth: viewport.width,
    displayHeight: viewport.height,
  });

  // Helper to execute action and return resulting frame
  async function execute(action: BrowserAction): Promise<ScreencastFrame> {
    const result = await controller.executeAction(action);
    return result.afterFrame || result.beforeFrame;
  }

  // Helper to send frame to Sonnet and get response
  async function ask(prompt: string): Promise<{ text?: string; actions?: BrowserAction[] }> {
    const frame = controller.getLatestFrame();
    if (!frame) {
      throw new Error('No frame available');
    }

    const sessionState = await controller.getSessionState();
    const response = await sonnet.processFrame(frame, prompt, sessionState);

    return {
      text: response.text,
      actions: response.toolCalls?.map(tc => tc.input),
    };
  }

  // Cleanup function
  async function stop(): Promise<void> {
    await controller.stop();
  }

  return {
    controller,
    sonnet,
    execute,
    ask,
    stop,
  };
}

/**
 * Run autonomous browser agent loop
 */
export async function runAutonomousAgent(config: {
  browser?: Partial<ChromeStreamConfig>;
  sonnet?: Partial<SonnetBridgeConfig>;
  initialUrl: string;
  task: string;
  maxSteps?: number;
  onStep?: (step: {
    stepNumber: number;
    frame: ScreencastFrame;
    response: { text?: string; actions?: BrowserAction[] };
  }) => void;
}): Promise<{
  success: boolean;
  steps: number;
  finalFrame: ScreencastFrame | null;
  conversation: unknown[];
}> {
  const maxSteps = config.maxSteps || 50;
  const { controller, sonnet, stop } = await createChromeStream({
    browser: config.browser,
    sonnet: config.sonnet,
    initialUrl: config.initialUrl,
  });

  let steps = 0;
  let finalFrame: ScreencastFrame | null = null;
  let browserError: Error | null = null;

  // Handle browser errors gracefully
  controller.on('error', (event) => {
    const data = event.data as { message?: string } | undefined;
    console.error(`[Agent] Browser error: ${data?.message || 'Unknown error'}`);
    browserError = new Error(data?.message || 'Browser error');
  });

  try {
    // Initial task prompt
    let prompt = config.task;

    while (steps < maxSteps) {
      // Check for browser errors
      if (browserError) {
        console.error('[Agent] Stopping due to browser error');
        break;
      }

      steps++;

      // Get current frame
      const frame = controller.getLatestFrame();
      if (!frame) {
        await controller.waitForFrame(5000);
        continue;
      }

      // Send to Sonnet
      const sessionState = await controller.getSessionState();
      const response = await sonnet.processFrame(frame, prompt, sessionState);

      // Notify callback
      config.onStep?.({
        stepNumber: steps,
        frame,
        response: {
          text: response.text,
          actions: response.toolCalls?.map(tc => tc.input),
        },
      });

      // Check if done
      if (response.stopReason === 'end_turn' && !response.toolCalls) {
        finalFrame = frame;
        return {
          success: true,
          steps,
          finalFrame,
          conversation: sonnet.getConversationHistory(),
        };
      }

      // Execute tool calls - handle nested tool calls from responses
      let currentResponse = response;
      let shouldBreakOuter = false;

      while (currentResponse.toolCalls && currentResponse.toolCalls.length > 0) {
        let shouldBreak = false;
        let nextResponse: typeof currentResponse | null = null;

        for (let i = 0; i < currentResponse.toolCalls.length; i++) {
          const toolCall = currentResponse.toolCalls[i];
          const isLastToolCall = i === currentResponse.toolCalls.length - 1;

          // Check for browser error before each action
          if (browserError) {
            // Add error result to history only (no API call) for remaining tool calls
            sonnet.addToolResultToHistory(
              toolCall.id,
              `Action failed: Browser disconnected`,
              true
            );
            shouldBreak = true;
            continue;
          }

          try {
            const result = await controller.executeAction(toolCall.input);

            // Add result to conversation - only the last one should call the API
            if (isLastToolCall) {
              if (result.afterFrame) {
                nextResponse = await sonnet.addScreenshotResult(toolCall.id, result.afterFrame);
              } else {
                nextResponse = await sonnet.addToolResult(
                  toolCall.id,
                  `Action ${toolCall.input.action} completed`,
                  !result.result.success
                );
              }
            } else {
              // For non-last tool calls, just add to history
              if (result.afterFrame) {
                sonnet.addToolResultToHistory(toolCall.id, [{
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: result.afterFrame.data,
                  },
                }], false);
              } else {
                sonnet.addToolResultToHistory(
                  toolCall.id,
                  `Action ${toolCall.input.action} completed`,
                  !result.result.success
                );
              }
            }
          } catch (err) {
            // Action failed - add error result to history only and break
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            sonnet.addToolResultToHistory(
              toolCall.id,
              `Action ${toolCall.input.action} failed: ${errorMessage}`,
              true
            );
            shouldBreak = true;
          }
        }

        // Break the main loop if we had errors
        if (shouldBreak) {
          console.error('[Agent] Stopping due to action failure');
          shouldBreakOuter = true;
          break;
        }

        // Check if the response indicates we're done
        if (nextResponse) {
          // Check if done
          if (nextResponse.stopReason === 'end_turn' && !nextResponse.toolCalls) {
            finalFrame = controller.getLatestFrame();
            return {
              success: true,
              steps,
              finalFrame,
              conversation: sonnet.getConversationHistory(),
            };
          }
          currentResponse = nextResponse;
        } else {
          break;
        }
      }

      // Break outer loop if we had errors
      if (shouldBreakOuter) {
        break;
      }

      // Continue conversation
      prompt = 'Continue with the task based on the current state.';
    }

    // Max steps reached
    finalFrame = controller.getLatestFrame();
    return {
      success: false,
      steps,
      finalFrame,
      conversation: sonnet.getConversationHistory(),
    };
  } finally {
    await stop();
  }
}
