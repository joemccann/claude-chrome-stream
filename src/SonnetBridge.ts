/**
 * SonnetBridge - Anthropic Claude API integration
 * Handles conversation management and tool call processing
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  AnthropicConfig,
  DEFAULT_ANTHROPIC_CONFIG,
  ScreencastFrame,
  SessionState,
  BrowserAction,
  ConversationMessage,
  SonnetResponse,
  ToolCall,
  MessageContent,
  TextContent,
  ImageContent,
  ToolResultContent,
} from './types.js';

// Computer Use tool definition
const COMPUTER_TOOL = {
  type: 'computer_20250124' as const,
  name: 'computer',
  display_width_px: 1280,
  display_height_px: 800,
};

export interface SonnetBridgeConfig extends AnthropicConfig {
  /** Viewport width for tool definition */
  displayWidth: number;
  /** Viewport height for tool definition */
  displayHeight: number;
  /** Enable beta features */
  enableBeta: boolean;
}

export class SonnetBridge {
  private client: Anthropic;
  private config: SonnetBridgeConfig;
  private conversationHistory: ConversationMessage[] = [];
  private systemPrompt: string;

  constructor(config: Partial<SonnetBridgeConfig>) {
    const fullConfig: SonnetBridgeConfig = {
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY || '',
      model: config.model || DEFAULT_ANTHROPIC_CONFIG.model!,
      maxTokens: config.maxTokens || DEFAULT_ANTHROPIC_CONFIG.maxTokens!,
      systemPrompt: config.systemPrompt,
      displayWidth: config.displayWidth || 1280,
      displayHeight: config.displayHeight || 800,
      enableBeta: config.enableBeta ?? true,
    };

    if (!fullConfig.apiKey) {
      throw new Error('Anthropic API key required. Set ANTHROPIC_API_KEY env var or pass apiKey in config.');
    }

    this.config = fullConfig;
    this.client = new Anthropic({
      apiKey: fullConfig.apiKey,
    });

    this.systemPrompt = fullConfig.systemPrompt || this.getDefaultSystemPrompt();
  }

  private getDefaultSystemPrompt(): string {
    return `You are an AI assistant with the ability to control a web browser. You can see screenshots of the browser and perform actions like clicking, typing, and scrolling.

When interacting with the browser:
1. Analyze the current screenshot carefully before taking action
2. Use precise coordinates based on what you see in the image
3. Wait for page loads and animations to complete before acting
4. If an action doesn't produce the expected result, try an alternative approach
5. Report what you observe and explain your reasoning

Available actions through the computer tool:
- screenshot: Capture current screen
- left_click, right_click, middle_click, double_click, triple_click: Mouse clicks at coordinates
- mouse_move: Move cursor to coordinates
- type: Type text
- key: Press keyboard keys (e.g., "Return", "ctrl+s")
- scroll: Scroll in a direction at coordinates
- left_click_drag: Drag from one point to another
- wait: Pause execution

Always reference the frame you're acting on and explain your actions.`;
  }

  /**
   * Send a frame and prompt to Sonnet, get response with potential tool calls
   */
  async processFrame(
    frame: ScreencastFrame,
    userPrompt: string,
    sessionState: SessionState
  ): Promise<SonnetResponse> {
    // Build message with image
    const imageContent: ImageContent = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: frame.data,
      },
    };

    const textContent: TextContent = {
      type: 'text',
      text: this.buildContextualPrompt(userPrompt, frame, sessionState),
    };

    // Add to conversation history
    this.conversationHistory.push({
      role: 'user',
      content: [imageContent, textContent],
    });

    // Prepare messages for API
    const messages = this.conversationHistory.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));

    try {
      const createParams = {
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: this.systemPrompt,
        tools: [
          {
            type: COMPUTER_TOOL.type,
            name: COMPUTER_TOOL.name,
            display_width_px: this.config.displayWidth,
            display_height_px: this.config.displayHeight,
          },
        ],
        messages: messages as unknown as Anthropic.Messages.MessageParam[],
      };

      // Use beta API for computer-use feature, cast through unknown to handle SDK type strictness
      const response = this.config.enableBeta
        ? await this.client.beta.messages.create({
            ...createParams,
            betas: ['computer-use-2025-01-24'],
          } as unknown as Parameters<typeof this.client.beta.messages.create>[0])
        : await this.client.messages.create(createParams as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming);

      // Cast response to Message type for parsing
      const messageResponse = response as Anthropic.Messages.Message;

      // Parse response
      const result = this.parseResponse(messageResponse);

      // Add assistant response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: messageResponse.content as MessageContent[],
      });

      return result;
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new Error(`Anthropic API error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Add tool result to conversation and continue
   */
  async addToolResult(
    toolUseId: string,
    result: string | MessageContent[],
    isError: boolean = false
  ): Promise<SonnetResponse> {
    const toolResult: ToolResultContent = {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: result,
      is_error: isError,
    };

    this.conversationHistory.push({
      role: 'user',
      content: [toolResult],
    });

    // Continue conversation
    const messages = this.conversationHistory.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));

    const createParams = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      system: this.systemPrompt,
      tools: [
        {
          type: COMPUTER_TOOL.type,
          name: COMPUTER_TOOL.name,
          display_width_px: this.config.displayWidth,
          display_height_px: this.config.displayHeight,
        },
      ],
      messages: messages as unknown as Anthropic.Messages.MessageParam[],
    };

    // Use beta API for computer-use feature, cast through unknown to handle SDK type strictness
    const response = this.config.enableBeta
      ? await this.client.beta.messages.create({
          ...createParams,
          betas: ['computer-use-2025-01-24'],
        } as unknown as Parameters<typeof this.client.beta.messages.create>[0])
      : await this.client.messages.create(createParams as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming);

    // Cast response to Message type for parsing
    const messageResponse = response as Anthropic.Messages.Message;

    const parsedResult = this.parseResponse(messageResponse);

    this.conversationHistory.push({
      role: 'assistant',
      content: messageResponse.content as MessageContent[],
    });

    return parsedResult;
  }

  /**
   * Add screenshot result after tool execution
   */
  async addScreenshotResult(
    toolUseId: string,
    frame: ScreencastFrame
  ): Promise<SonnetResponse> {
    const imageContent: ImageContent = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: frame.data,
      },
    };

    return this.addToolResult(toolUseId, [imageContent], false);
  }

  /**
   * Parse Anthropic response into our format
   */
  private parseResponse(response: Anthropic.Messages.Message): SonnetResponse {
    const toolCalls: ToolCall[] = [];
    let text: string | undefined;

    for (const block of response.content) {
      if (block.type === 'text') {
        text = (text || '') + block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as BrowserAction,
        });
      }
    }

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: response.stop_reason as SonnetResponse['stopReason'],
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  /**
   * Build contextual prompt with frame and session info
   */
  private buildContextualPrompt(
    userPrompt: string,
    frame: ScreencastFrame,
    sessionState: SessionState
  ): string {
    const context = [
      `Current URL: ${sessionState.url}`,
      `Viewport: ${sessionState.viewport.width}x${sessionState.viewport.height}`,
      `Frame ID: ${frame.frameId}`,
      `Visual change detected: ${frame.hasChange ? 'Yes' : 'No'} (${frame.deltaPercent.toFixed(1)}%)`,
    ];

    return `${userPrompt}

---
Context:
${context.join('\n')}`;
  }

  /**
   * Reset conversation history
   */
  resetConversation(): void {
    this.conversationHistory = [];
  }

  /**
   * Get current conversation history
   */
  getConversationHistory(): ConversationMessage[] {
    return [...this.conversationHistory];
  }

  /**
   * Get conversation length (for context management)
   */
  getConversationLength(): number {
    return this.conversationHistory.length;
  }

  /**
   * Trim conversation history to manage context window
   */
  trimConversation(keepLast: number = 10): void {
    if (this.conversationHistory.length > keepLast) {
      // Keep at least first message (initial context) and last N messages
      const first = this.conversationHistory[0];
      const last = this.conversationHistory.slice(-keepLast);
      this.conversationHistory = [first, ...last];
    }
  }

  /**
   * Update system prompt
   */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * Get current configuration
   */
  getConfig(): SonnetBridgeConfig {
    return { ...this.config };
  }
}

export default SonnetBridge;
