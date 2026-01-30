/**
 * Type definitions for Claude Chrome Stream
 * Compatible with Claude Computer Use tool schema
 */

// =============================================================================
// Configuration Types
// =============================================================================

export interface StreamConfig {
  /** Viewport width in pixels */
  viewportWidth: number;
  /** Viewport height in pixels */
  viewportHeight: number;
  /** JPEG quality for screencast (0-100) */
  quality: number;
  /** Capture every Nth frame (1 = all frames) */
  everyNthFrame: number;
  /** Visual delta threshold percentage (0-100) for change detection */
  deltaThreshold: number;
  /** Keep-alive interval in ms - send frame even if no change */
  keepAliveMs: number;
  /** Maximum frames to buffer */
  maxBufferSize: number;
  /** Chrome executable path (optional, auto-detected if not set) */
  chromePath?: string;
  /** Chrome user data directory (optional) */
  userDataDir?: string;
  /** Run in headless mode */
  headless: boolean;
  /** Enable DevTools */
  devtools: boolean;
}

export const DEFAULT_CONFIG: StreamConfig = {
  viewportWidth: 1280,
  viewportHeight: 800,
  quality: 80,
  everyNthFrame: 1,
  deltaThreshold: 2, // 2% change threshold
  keepAliveMs: 2000, // 2 second keep-alive
  maxBufferSize: 10,
  headless: false,
  devtools: false,
};

export interface AnthropicConfig {
  /** Anthropic API key */
  apiKey: string;
  /** Model to use */
  model: string;
  /** Maximum tokens for response */
  maxTokens: number;
  /** System prompt */
  systemPrompt?: string;
}

export const DEFAULT_ANTHROPIC_CONFIG: Partial<AnthropicConfig> = {
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4096,
};

// =============================================================================
// Frame Types
// =============================================================================

export interface ScreencastFrame {
  /** Monotonic frame ID for synchronization */
  frameId: number;
  /** Timestamp when frame was captured */
  timestamp: number;
  /** Base64 encoded JPEG data */
  data: string;
  /** Frame metadata from CDP */
  metadata: FrameMetadata;
  /** Whether this frame has significant visual change */
  hasChange: boolean;
  /** Percentage of pixels changed from previous frame */
  deltaPercent: number;
}

export interface FrameMetadata {
  /** Device scale factor */
  deviceScaleFactor: number;
  /** Page scale factor */
  pageScaleFactor: number;
  /** Viewport offset X */
  offsetTop: number;
  /** Viewport offset Y */
  offsetLeft: number;
  /** Scroll position X */
  scrollOffsetX: number;
  /** Scroll position Y */
  scrollOffsetY: number;
}

export interface FrameComparisonResult {
  /** Whether frames are different */
  hasChange: boolean;
  /** Percentage of pixels that differ (0-100) */
  deltaPercent: number;
  /** Number of differing pixels */
  diffPixelCount: number;
  /** Total pixels compared */
  totalPixels: number;
}

// =============================================================================
// Action Types (Computer Use Tool Compatible)
// =============================================================================

export type ActionType =
  | 'screenshot'
  | 'left_click'
  | 'right_click'
  | 'middle_click'
  | 'double_click'
  | 'triple_click'
  | 'left_click_drag'
  | 'left_mouse_down'
  | 'left_mouse_up'
  | 'mouse_move'
  | 'type'
  | 'key'
  | 'scroll'
  | 'hold_key'
  | 'wait'
  | 'navigate'
  | 'zoom';

export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

export type ModifierKey = 'shift' | 'ctrl' | 'alt' | 'super' | 'meta';

/** Coordinate tuple [x, y] */
export type Coordinate = [number, number];

/** Region tuple [x1, y1, x2, y2] for zoom */
export type Region = [number, number, number, number];

// Base action interface
interface BaseAction {
  /** Reference to frame ID this action is based on */
  frameId?: number;
}

export interface ScreenshotAction extends BaseAction {
  action: 'screenshot';
}

export interface ClickAction extends BaseAction {
  action: 'left_click' | 'right_click' | 'middle_click' | 'double_click' | 'triple_click';
  coordinate: Coordinate;
  /** Optional modifier key */
  text?: ModifierKey;
}

export interface MouseMoveAction extends BaseAction {
  action: 'mouse_move';
  coordinate: Coordinate;
}

export interface MouseDownAction extends BaseAction {
  action: 'left_mouse_down';
  coordinate: Coordinate;
}

export interface MouseUpAction extends BaseAction {
  action: 'left_mouse_up';
  coordinate: Coordinate;
}

export interface DragAction extends BaseAction {
  action: 'left_click_drag';
  startCoordinate: Coordinate;
  endCoordinate: Coordinate;
}

export interface TypeAction extends BaseAction {
  action: 'type';
  text: string;
}

export interface KeyAction extends BaseAction {
  action: 'key';
  text: string; // e.g., "ctrl+s", "Return", "Tab"
}

export interface ScrollAction extends BaseAction {
  action: 'scroll';
  coordinate: Coordinate;
  scroll_direction: ScrollDirection;
  scroll_amount: number;
  /** Optional modifier key (e.g., shift for horizontal scroll) */
  text?: ModifierKey;
}

export interface HoldKeyAction extends BaseAction {
  action: 'hold_key';
  key: string;
  duration: number; // seconds
}

export interface WaitAction extends BaseAction {
  action: 'wait';
  duration: number; // seconds
}

export interface NavigateAction extends BaseAction {
  action: 'navigate';
  url: string;
}

export interface ZoomAction extends BaseAction {
  action: 'zoom';
  region: Region;
}

export type BrowserAction =
  | ScreenshotAction
  | ClickAction
  | MouseMoveAction
  | MouseDownAction
  | MouseUpAction
  | DragAction
  | TypeAction
  | KeyAction
  | ScrollAction
  | HoldKeyAction
  | WaitAction
  | NavigateAction
  | ZoomAction;

// =============================================================================
// Action Result Types
// =============================================================================

export interface ActionResult {
  /** Whether action succeeded */
  success: boolean;
  /** Frame ID after action completed */
  frameId: number;
  /** Optional error message */
  error?: string;
  /** Optional screenshot data (for screenshot action) */
  screenshot?: string;
  /** Timestamp when action completed */
  timestamp: number;
  /** Action that was executed */
  action: BrowserAction;
}

// =============================================================================
// Session Types
// =============================================================================

export interface SessionState {
  /** Unique session ID */
  sessionId: string;
  /** Current URL */
  url: string;
  /** Current page title */
  title: string;
  /** Is browser connected */
  connected: boolean;
  /** Is screencast active */
  streaming: boolean;
  /** Current frame ID */
  currentFrameId: number;
  /** Viewport dimensions */
  viewport: {
    width: number;
    height: number;
  };
  /** Timestamp of last activity */
  lastActivity: number;
}

// =============================================================================
// Event Types
// =============================================================================

export type StreamEventType =
  | 'frame'
  | 'action_complete'
  | 'navigation'
  | 'error'
  | 'session_detached'
  | 'target_closed'
  | 'connected'
  | 'disconnected';

export interface StreamEvent {
  type: StreamEventType;
  timestamp: number;
  data: unknown;
}

export interface FrameEvent extends StreamEvent {
  type: 'frame';
  data: ScreencastFrame;
}

export interface ActionCompleteEvent extends StreamEvent {
  type: 'action_complete';
  data: ActionResult;
}

export interface NavigationEvent extends StreamEvent {
  type: 'navigation';
  data: {
    url: string;
    frameId: number;
  };
}

export interface ErrorEvent extends StreamEvent {
  type: 'error' | 'session_detached' | 'target_closed';
  data: {
    message: string;
    code?: string;
    recoverable: boolean;
  };
}

// =============================================================================
// Sonnet Integration Types
// =============================================================================

export interface SonnetRequest {
  /** User prompt / task description */
  prompt: string;
  /** Current frame to analyze */
  frame: ScreencastFrame;
  /** Conversation history */
  conversationHistory?: ConversationMessage[];
  /** Session state context */
  sessionState: SessionState;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string | MessageContent[];
}

export type MessageContent =
  | TextContent
  | ImageContent
  | ToolUseContent
  | ToolResultContent;

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
  };
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: BrowserAction;
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string | MessageContent[];
  is_error?: boolean;
}

export interface SonnetResponse {
  /** Text response from Sonnet */
  text?: string;
  /** Tool calls to execute */
  toolCalls?: ToolCall[];
  /** Stop reason */
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  /** Usage statistics */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: BrowserAction;
}

// =============================================================================
// MCP Types
// =============================================================================

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// =============================================================================
// Callback Types
// =============================================================================

export type FrameCallback = (frame: ScreencastFrame) => void | Promise<void>;
export type EventCallback = (event: StreamEvent) => void | Promise<void>;
export type ActionCallback = (result: ActionResult) => void | Promise<void>;
