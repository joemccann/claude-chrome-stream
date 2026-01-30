/**
 * MCPServer - Model Context Protocol server for Claude Code integration
 * Exposes browser streaming capabilities as MCP tools
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ChromeStreamController, ChromeStreamConfig } from './ChromeStreamController.js';
import { BrowserAction } from './types.js';

// Zod schemas for tool inputs
const CoordinateSchema = z.tuple([z.number(), z.number()]);

const ActionSchemas = {
  screenshot: z.object({
    action: z.literal('screenshot'),
  }),
  left_click: z.object({
    action: z.literal('left_click'),
    coordinate: CoordinateSchema,
    text: z.enum(['shift', 'ctrl', 'alt', 'super', 'meta']).optional(),
  }),
  right_click: z.object({
    action: z.literal('right_click'),
    coordinate: CoordinateSchema,
    text: z.enum(['shift', 'ctrl', 'alt', 'super', 'meta']).optional(),
  }),
  middle_click: z.object({
    action: z.literal('middle_click'),
    coordinate: CoordinateSchema,
  }),
  double_click: z.object({
    action: z.literal('double_click'),
    coordinate: CoordinateSchema,
  }),
  triple_click: z.object({
    action: z.literal('triple_click'),
    coordinate: CoordinateSchema,
  }),
  mouse_move: z.object({
    action: z.literal('mouse_move'),
    coordinate: CoordinateSchema,
  }),
  left_mouse_down: z.object({
    action: z.literal('left_mouse_down'),
    coordinate: CoordinateSchema,
  }),
  left_mouse_up: z.object({
    action: z.literal('left_mouse_up'),
    coordinate: CoordinateSchema,
  }),
  left_click_drag: z.object({
    action: z.literal('left_click_drag'),
    startCoordinate: CoordinateSchema,
    endCoordinate: CoordinateSchema,
  }),
  type: z.object({
    action: z.literal('type'),
    text: z.string(),
  }),
  key: z.object({
    action: z.literal('key'),
    text: z.string(),
  }),
  scroll: z.object({
    action: z.literal('scroll'),
    coordinate: CoordinateSchema,
    scroll_direction: z.enum(['up', 'down', 'left', 'right']),
    scroll_amount: z.number(),
    text: z.enum(['shift', 'ctrl', 'alt', 'super', 'meta']).optional(),
  }),
  hold_key: z.object({
    action: z.literal('hold_key'),
    key: z.string(),
    duration: z.number(),
  }),
  wait: z.object({
    action: z.literal('wait'),
    duration: z.number(),
  }),
  navigate: z.object({
    action: z.literal('navigate'),
    url: z.string().url(),
  }),
};

// Combined action schema
const BrowserActionSchema = z.discriminatedUnion('action', [
  ActionSchemas.screenshot,
  ActionSchemas.left_click,
  ActionSchemas.right_click,
  ActionSchemas.middle_click,
  ActionSchemas.double_click,
  ActionSchemas.triple_click,
  ActionSchemas.mouse_move,
  ActionSchemas.left_mouse_down,
  ActionSchemas.left_mouse_up,
  ActionSchemas.left_click_drag,
  ActionSchemas.type,
  ActionSchemas.key,
  ActionSchemas.scroll,
  ActionSchemas.hold_key,
  ActionSchemas.wait,
  ActionSchemas.navigate,
]);

export class MCPServer {
  private server: Server;
  private controller: ChromeStreamController | null = null;
  private config: ChromeStreamConfig;

  constructor(config: Partial<ChromeStreamConfig> = {}) {
    this.config = {
      viewportWidth: config.viewportWidth || 1280,
      viewportHeight: config.viewportHeight || 800,
      quality: config.quality || 80,
      everyNthFrame: config.everyNthFrame || 1,
      deltaThreshold: config.deltaThreshold || 2,
      keepAliveMs: config.keepAliveMs || 2000,
      maxBufferSize: config.maxBufferSize || 10,
      headless: config.headless ?? false,
      devtools: config.devtools ?? false,
      chromePath: config.chromePath,
      userDataDir: config.userDataDir,
    };

    this.server = new Server(
      {
        name: 'claude-chrome-stream',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'browser_start',
            description: 'Start a browser session with optional URL. Returns the initial screenshot.',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'Initial URL to navigate to',
                },
                headless: {
                  type: 'boolean',
                  description: 'Run browser in headless mode',
                  default: false,
                },
              },
            },
          },
          {
            name: 'browser_action',
            description: 'Perform an action in the browser. Compatible with Computer Use tool schema.',
            inputSchema: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: [
                    'screenshot',
                    'left_click',
                    'right_click',
                    'middle_click',
                    'double_click',
                    'triple_click',
                    'mouse_move',
                    'left_mouse_down',
                    'left_mouse_up',
                    'left_click_drag',
                    'type',
                    'key',
                    'scroll',
                    'hold_key',
                    'wait',
                    'navigate',
                  ],
                  description: 'The action to perform',
                },
                coordinate: {
                  type: 'array',
                  items: { type: 'number' },
                  minItems: 2,
                  maxItems: 2,
                  description: 'Coordinates [x, y] for click/scroll actions',
                },
                startCoordinate: {
                  type: 'array',
                  items: { type: 'number' },
                  minItems: 2,
                  maxItems: 2,
                  description: 'Start coordinates for drag action',
                },
                endCoordinate: {
                  type: 'array',
                  items: { type: 'number' },
                  minItems: 2,
                  maxItems: 2,
                  description: 'End coordinates for drag action',
                },
                text: {
                  type: 'string',
                  description: 'Text to type or key to press, or modifier key for clicks',
                },
                scroll_direction: {
                  type: 'string',
                  enum: ['up', 'down', 'left', 'right'],
                  description: 'Direction to scroll',
                },
                scroll_amount: {
                  type: 'number',
                  description: 'Amount to scroll (in units)',
                },
                key: {
                  type: 'string',
                  description: 'Key to hold for hold_key action',
                },
                duration: {
                  type: 'number',
                  description: 'Duration in seconds for wait or hold_key',
                },
                url: {
                  type: 'string',
                  description: 'URL for navigate action',
                },
              },
              required: ['action'],
            },
          },
          {
            name: 'browser_stop',
            description: 'Stop the browser session and cleanup resources.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'browser_status',
            description: 'Get current browser session status and statistics.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'browser_start':
            return await this.handleBrowserStart(args as { url?: string; headless?: boolean });

          case 'browser_action':
            return await this.handleBrowserAction(args as Record<string, unknown>);

          case 'browser_stop':
            return await this.handleBrowserStop();

          case 'browser_status':
            return await this.handleBrowserStatus();

          default:
            return {
              content: [
                {
                  type: 'text',
                  text: `Unknown tool: ${name}`,
                },
              ],
              isError: true,
            };
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async handleBrowserStart(args: { url?: string; headless?: boolean }): Promise<{
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    isError?: boolean;
  }> {
    if (this.controller) {
      return {
        content: [
          {
            type: 'text',
            text: 'Browser session already active. Use browser_stop first to start a new session.',
          },
        ],
        isError: true,
      };
    }

    const config = {
      ...this.config,
      headless: args.headless ?? this.config.headless,
    };

    this.controller = new ChromeStreamController(config);

    try {
      const frame = await this.controller.start(args.url);

      return {
        content: [
          {
            type: 'text',
            text: `Browser started. Viewport: ${config.viewportWidth}x${config.viewportHeight}. URL: ${args.url || 'about:blank'}`,
          },
          {
            type: 'image',
            data: frame.data,
            mimeType: 'image/jpeg',
          },
        ],
      };
    } catch (error) {
      this.controller = null;
      throw error;
    }
  }

  private async handleBrowserAction(args: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    isError?: boolean;
  }> {
    if (!this.controller) {
      return {
        content: [
          {
            type: 'text',
            text: 'No active browser session. Use browser_start first.',
          },
        ],
        isError: true,
      };
    }

    // Validate and parse action
    const parseResult = BrowserActionSchema.safeParse(args);
    if (!parseResult.success) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid action: ${parseResult.error.message}`,
          },
        ],
        isError: true,
      };
    }

    const action = parseResult.data as BrowserAction;
    const result = await this.controller.executeAction(action);

    if (!result.result.success) {
      return {
        content: [
          {
            type: 'text',
            text: `Action failed: ${result.result.error}`,
          },
        ],
        isError: true,
      };
    }

    // Build response with screenshot
    const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [
      {
        type: 'text',
        text: `Action "${action.action}" completed. Frame: ${result.result.frameId}. Visual change: ${result.causedChange ? 'Yes' : 'No'}`,
      },
    ];

    // Include screenshot for visual actions
    if (result.afterFrame) {
      content.push({
        type: 'image',
        data: result.afterFrame.data,
        mimeType: 'image/jpeg',
      });
    } else if (result.result.screenshot) {
      content.push({
        type: 'image',
        data: result.result.screenshot,
        mimeType: 'image/jpeg',
      });
    }

    return { content };
  }

  private async handleBrowserStop(): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    if (!this.controller) {
      return {
        content: [
          {
            type: 'text',
            text: 'No active browser session.',
          },
        ],
      };
    }

    await this.controller.stop();
    this.controller = null;

    return {
      content: [
        {
          type: 'text',
          text: 'Browser session stopped.',
        },
      ],
    };
  }

  private async handleBrowserStatus(): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    if (!this.controller) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ active: false }, null, 2),
          },
        ],
      };
    }

    const status = this.controller.getStatus();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(status, null, 2),
        },
      ],
    };
  }

  /**
   * Start the MCP server
   */
  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Claude Chrome Stream MCP server running on stdio');
  }

  /**
   * Cleanup on shutdown
   */
  async shutdown(): Promise<void> {
    if (this.controller) {
      await this.controller.stop();
    }
    await this.server.close();
  }
}

export default MCPServer;
