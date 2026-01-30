# Claude Chrome Stream

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue)](https://github.com/joemccann/claude-chrome-stream)

**High-performance Chrome automation plugin for Claude Code with real-time CDP streaming.**

Replaces the standard "screenshot → upload → analyze → act" loop with continuous visual streaming, enabling fluid, low-latency web interaction. Built specifically for Claude's Computer Use capabilities.

---

## Table of Contents

- [Why Claude Chrome Stream?](#why-claude-chrome-stream)
- [Features](#features)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Usage](#usage)
  - [As Claude Code Plugin](#as-claude-code-plugin)
  - [CLI Commands](#cli-commands)
  - [Programmatic API](#programmatic-api)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [MCP Tools Reference](#mcp-tools-reference)
- [Action Reference](#action-reference)
- [Frame Synchronization](#frame-synchronization)
- [Performance Tuning](#performance-tuning)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [API Reference](#api-reference)
- [Contributing](#contributing)
- [License](#license)

---

## Why Claude Chrome Stream?

Traditional browser automation with AI follows a slow, discrete loop:

```
[Screenshot] → [Upload to API] → [Wait for Response] → [Execute Action] → [Repeat]
```

Each cycle introduces latency from image encoding, network transfer, and cold API calls. **Claude Chrome Stream** fundamentally changes this by:

1. **Continuous Streaming**: CDP screencast provides real-time frame delivery
2. **Intelligent Filtering**: Only transmit frames when visual changes occur (>2% delta)
3. **Frame-Action Correlation**: Every action references a specific frame ID, preventing "stale click" issues
4. **Persistent Sessions**: Maintain conversation context across interactions

The result: **3-5x faster interaction cycles** with more reliable visual-action synchronization.

---

## Features

### Core Capabilities

| Feature | Description |
|---------|-------------|
| **Real-time Streaming** | CDP `Page.startScreencast` for continuous frame capture at configurable FPS |
| **Visual Delta Detection** | `pixelmatch`-based change detection with configurable threshold (default 2%) |
| **Keep-alive Frames** | Automatic frame transmission every 2 seconds even without visual changes |
| **Computer Use Compatible** | Full action set matching Claude's Computer Use tool schema |
| **Hybrid Synchronization** | Combines lock-step (stable frame waiting) with optimistic (frame ID correlation) |
| **MCP Integration** | Native Model Context Protocol server for Claude Code |
| **Sonnet Bridge** | Direct Anthropic API integration for autonomous agent loops |
| **Auto-Recovery** | Graceful handling of session detachment and target closure |

### Platform Optimizations

- **macOS arm64**: Metal rendering, GPU acceleration via Chrome flags
- **Linux**: Xvfb-compatible for headless server environments
- **Memory Efficient**: All frame data in buffers, no disk I/O during operation

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/joemccann/claude-chrome-stream.git
cd claude-chrome-stream
npm install && npm run build

# Set your API key
export ANTHROPIC_API_KEY=your-key-here

# Run autonomous task
npx claude-chrome-stream run \
  --url "https://news.ycombinator.com" \
  --task "Find and summarize the top 3 stories"
```

---

## Installation

### Prerequisites

- **Node.js** 18.0.0 or higher
- **Chrome/Chromium** browser installed
- **Anthropic API key** (for autonomous features)

### As Claude Code Plugin

```bash
# Clone the repository
git clone https://github.com/joemccann/claude-chrome-stream.git
cd claude-chrome-stream

# Install dependencies
npm install

# Build TypeScript
npm run build

# Launch Claude Code with the plugin
claude --plugin-dir /path/to/claude-chrome-stream
```

### Global Installation

```bash
# Install globally
npm install -g claude-chrome-stream

# Or use npx directly
npx claude-chrome-stream --help
```

### As a Dependency

```bash
npm install claude-chrome-stream
```

```typescript
import { createChromeStream } from 'claude-chrome-stream';
```

---

## Usage

### As Claude Code Plugin

Once installed as a plugin, you gain access to these skills:

```bash
# Start Claude Code with the plugin
claude --plugin-dir ./claude-chrome-stream

# Available skills:
/claude-chrome-stream:stream-browser https://example.com
/claude-chrome-stream:autonomous-browse https://github.com "Find trending repos"
/claude-chrome-stream:browser-screenshot https://example.com
```

The plugin also registers an MCP server, making these tools available:
- `browser_start` - Launch browser session
- `browser_action` - Execute browser actions
- `browser_stop` - Close browser session
- `browser_status` - Get session statistics

### CLI Commands

#### Interactive Mode

Start an interactive browser session with JSON action input:

```bash
claude-chrome-stream interactive --url https://example.com

# Commands available in interactive mode:
> {"action": "navigate", "url": "https://github.com"}
> {"action": "left_click", "coordinate": [500, 300]}
> {"action": "type", "text": "hello world"}
> {"action": "key", "text": "Return"}
> {"action": "scroll", "coordinate": [640, 400], "scroll_direction": "down", "scroll_amount": 3}
> status   # Show session status
> frame    # Show current frame info
> quit     # Exit session
```

#### Autonomous Agent

Run an AI-powered browser agent to complete tasks:

```bash
claude-chrome-stream run \
  --url "https://github.com/trending" \
  --task "List the top 5 trending repositories with their descriptions" \
  --max-steps 20

# With headless mode for CI/CD
claude-chrome-stream run \
  --url "https://example.com/login" \
  --task "Log in with username 'test' and password 'demo'" \
  --headless \
  --max-steps 10
```

#### Screenshot Capture

Take a screenshot after waiting for page stability:

```bash
claude-chrome-stream screenshot \
  --url "https://example.com" \
  --output ./screenshots \
  --headless
```

#### MCP Server Mode

Run as a standalone MCP server for external integrations:

```bash
claude-chrome-stream mcp
```

### Programmatic API

#### Basic Usage

```typescript
import { createChromeStream } from 'claude-chrome-stream';

async function main() {
  // Create and start a browser session
  const { controller, sonnet, execute, ask, stop } = await createChromeStream({
    browser: {
      viewportWidth: 1280,
      viewportHeight: 800,
      headless: false,
    },
    sonnet: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-sonnet-4-20250514',
    },
    initialUrl: 'https://example.com',
  });

  try {
    // Execute a click action
    const frameAfterClick = await execute({
      action: 'left_click',
      coordinate: [640, 400],
    });
    console.log('Clicked, new frame:', frameAfterClick.frameId);

    // Type some text
    await execute({ action: 'type', text: 'Hello, world!' });

    // Ask Claude about the page
    const response = await ask('What is the main heading on this page?');
    console.log('Claude says:', response.text);

    // Execute Claude's suggested actions
    if (response.actions) {
      for (const action of response.actions) {
        await execute(action);
      }
    }
  } finally {
    await stop();
  }
}
```

#### Autonomous Agent

```typescript
import { runAutonomousAgent } from 'claude-chrome-stream';

const result = await runAutonomousAgent({
  browser: {
    viewportWidth: 1440,
    viewportHeight: 900,
    headless: true,
  },
  sonnet: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  initialUrl: 'https://news.ycombinator.com',
  task: 'Find the top story and tell me what it is about',
  maxSteps: 30,
  onStep: ({ stepNumber, frame, response }) => {
    console.log(`\n--- Step ${stepNumber} ---`);
    console.log(`Frame ID: ${frame.frameId}`);
    console.log(`Response: ${response.text?.substring(0, 100)}...`);
    if (response.actions) {
      console.log(`Actions: ${response.actions.map(a => a.action).join(', ')}`);
    }
  },
});

console.log('\n=== Agent Complete ===');
console.log(`Success: ${result.success}`);
console.log(`Total steps: ${result.steps}`);
```

#### Low-Level Controller Access

```typescript
import { ChromeStreamController } from 'claude-chrome-stream';

const controller = new ChromeStreamController({
  viewportWidth: 1280,
  viewportHeight: 800,
  quality: 85,
  deltaThreshold: 1.5, // More sensitive change detection
  keepAliveMs: 1000,   // More frequent keep-alive
});

// Event listeners
controller.on('frame', (frame) => {
  console.log(`Frame ${frame.frameId}: ${frame.deltaPercent.toFixed(1)}% change`);
});

controller.on('error', (event) => {
  console.error('Error:', event.data.message);
});

controller.on('navigation', (event) => {
  console.log('Navigated to:', event.data.url);
});

// Start and use
await controller.start('https://example.com');

const result = await controller.executeAction({
  action: 'left_click',
  coordinate: [500, 300],
});

console.log('Action result:', {
  success: result.result.success,
  causedChange: result.causedChange,
  latencyMs: result.latencyMs,
});

// Wait for stable frame (no visual changes)
const stableFrame = await controller.waitForStableFrame(500, 5000);

await controller.stop();
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Claude Chrome Stream                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │                    ChromeStreamController                        │    │
│   │                    (Main Orchestrator)                           │    │
│   └─────────────────────────────────────────────────────────────────┘    │
│              │                    │                    │                  │
│              ▼                    ▼                    ▼                  │
│   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐      │
│   │  BrowserManager  │  │ StreamProcessor  │  │   FrameBuffer    │      │
│   │                  │  │                  │  │                  │      │
│   │  • Puppeteer     │  │  • CDP Screencast│  │  • Frame Storage │      │
│   │  • CDP Session   │  │  • pixelmatch    │  │  • Sync Logic    │      │
│   │  • Lifecycle     │  │  • Delta Filter  │  │  • Action Queue  │      │
│   │  • Recovery      │  │  • Keep-alive    │  │  • Stability     │      │
│   └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘      │
│            │                     │                     │                  │
│            │         ┌───────────┴───────────┐         │                  │
│            │         ▼                       ▼         │                  │
│            │   ┌──────────────────────────────────┐    │                  │
│            │   │       InputController            │    │                  │
│            │   │                                  │    │                  │
│            │   │  • Click (left/right/middle)    │    │                  │
│            │   │  • Double/Triple click          │    │                  │
│            │   │  • Type, Key, Key combos        │    │                  │
│            │   │  • Scroll, Drag                 │    │                  │
│            │   │  • Mouse move, down, up         │    │                  │
│            │   │  • Navigate, Wait               │    │                  │
│            │   └──────────────────────────────────┘    │                  │
│            │                     │                     │                  │
│            └─────────────────────┼─────────────────────┘                  │
│                                  │                                        │
│   ┌──────────────────────────────┴───────────────────────────────────┐   │
│   │                                                                   │   │
│   │   ┌─────────────────────┐        ┌─────────────────────────┐    │   │
│   │   │    SonnetBridge     │        │       MCPServer         │    │   │
│   │   │                     │        │                         │    │   │
│   │   │  • Anthropic API    │        │  • browser_start        │    │   │
│   │   │  • Conversation     │        │  • browser_action       │    │   │
│   │   │  • Tool Calls       │        │  • browser_stop         │    │   │
│   │   │  • Context Mgmt     │        │  • browser_status       │    │   │
│   │   └─────────────────────┘        └─────────────────────────┘    │   │
│   │                                                                   │   │
│   └───────────────────────────────────────────────────────────────────┘   │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component Details

| Component | File | Responsibility |
|-----------|------|----------------|
| **BrowserManager** | `BrowserManager.ts` | Chrome lifecycle, Puppeteer, CDP session, error recovery |
| **StreamProcessor** | `StreamProcessor.ts` | CDP screencast, frame capture, pixelmatch delta detection |
| **InputController** | `InputController.ts` | All browser actions, coordinate scaling, key mapping |
| **FrameBuffer** | `FrameBuffer.ts` | Frame storage, synchronization, stability detection |
| **SonnetBridge** | `SonnetBridge.ts` | Anthropic API, conversation history, tool call handling |
| **MCPServer** | `MCPServer.ts` | MCP protocol, tool definitions, Claude Code integration |
| **ChromeStreamController** | `ChromeStreamController.ts` | Orchestrates all components |

---

## Configuration

### Setting Up Your API Key

An Anthropic API key is required for the `run` command. Configure it using one of these methods:

#### Option 1: Add to `~/.claude/settings.json` (Recommended)

Add `anthropicApiKey` as a **top-level key** in your existing settings file:

```json
{
  "permissions": {
    "allow": ["..."]
  },
  "anthropicApiKey": "sk-ant-...",
  "chromeStream": {
    "viewportWidth": 1280,
    "viewportHeight": 800
  }
}
```

> **Note:** Merge these keys with your existing settings. Only `anthropicApiKey` is required. The `chromeStream` object is optional and allows you to customize browser defaults.

#### Option 2: Environment Variable

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### Chrome Stream Options

Add the optional `chromeStream` object to `~/.claude/settings.json` to customize defaults:

```json
{
  "anthropicApiKey": "sk-ant-...",
  "chromeStream": {
    "viewportWidth": 1280,
    "viewportHeight": 800,
    "quality": 80,
    "everyNthFrame": 1,
    "deltaThreshold": 2,
    "keepAliveMs": 2000,
    "maxBufferSize": 10,
    "headless": false,
    "devtools": false,
    "chromePath": "/path/to/chrome",
    "userDataDir": "/path/to/user-data",
    "model": "claude-sonnet-4-20250514"
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `viewportWidth` | number | 1280 | Browser viewport width in pixels |
| `viewportHeight` | number | 800 | Browser viewport height in pixels |
| `quality` | number | 80 | JPEG quality (1-100) for screencast frames |
| `everyNthFrame` | number | 1 | Capture every Nth frame (1 = all frames) |
| `deltaThreshold` | number | 2 | Minimum % of changed pixels to trigger frame send |
| `keepAliveMs` | number | 2000 | Send frame every N ms even without changes |
| `maxBufferSize` | number | 10 | Maximum frames to keep in buffer |
| `headless` | boolean | false | Run Chrome in headless mode |
| `devtools` | boolean | false | Open Chrome DevTools on launch |
| `chromePath` | string | auto | Path to Chrome executable |
| `userDataDir` | string | temp | Chrome user data directory |
| `model` | string | claude-sonnet-4-20250514 | Anthropic model for autonomous mode |
| `maxTokens` | number | 4096 | Max tokens for Anthropic responses |

### Environment Variables

```bash
# Required for autonomous features
export ANTHROPIC_API_KEY=sk-ant-...

# Optional: Custom Chrome path
export CHROME_PATH=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
```

---

## MCP Tools Reference

When running as an MCP server, the following tools are exposed:

### `browser_start`

Start a new browser session.

**Input Schema:**
```json
{
  "url": "https://example.com",
  "headless": false
}
```

**Response:** Screenshot of initial page state.

### `browser_action`

Execute a browser action. See [Action Reference](#action-reference) for all supported actions.

**Input Schema:**
```json
{
  "action": "left_click",
  "coordinate": [500, 300]
}
```

**Response:** Screenshot after action completion with metadata.

### `browser_stop`

Stop the current browser session and release resources.

**Input Schema:** None required.

### `browser_status`

Get current session status and statistics.

**Response:**
```json
{
  "active": true,
  "streaming": true,
  "session": {
    "sessionId": "session_1234567890_abc",
    "url": "https://example.com",
    "viewport": { "width": 1280, "height": 800 }
  },
  "streamStats": {
    "frameCount": 150,
    "droppedFrameCount": 120,
    "avgDeltaTime": 45,
    "currentFrameId": 150
  },
  "bufferStats": {
    "frameCount": 10,
    "pendingActions": 0
  }
}
```

---

## Action Reference

All actions are compatible with Claude's Computer Use tool schema.

### Navigation

```json
{"action": "navigate", "url": "https://example.com"}
```

### Mouse Actions

```json
// Single clicks
{"action": "left_click", "coordinate": [500, 300]}
{"action": "right_click", "coordinate": [500, 300]}
{"action": "middle_click", "coordinate": [500, 300]}

// Multiple clicks
{"action": "double_click", "coordinate": [500, 300]}
{"action": "triple_click", "coordinate": [500, 300]}

// With modifier keys
{"action": "left_click", "coordinate": [500, 300], "text": "shift"}
{"action": "left_click", "coordinate": [500, 300], "text": "ctrl"}
{"action": "left_click", "coordinate": [500, 300], "text": "super"}

// Mouse movement
{"action": "mouse_move", "coordinate": [500, 300]}

// Fine-grained control
{"action": "left_mouse_down", "coordinate": [500, 300]}
{"action": "left_mouse_up", "coordinate": [500, 300]}

// Drag operation
{"action": "left_click_drag", "startCoordinate": [100, 100], "endCoordinate": [300, 300]}
```

### Keyboard Actions

```json
// Type text
{"action": "type", "text": "Hello, world!"}

// Press single key
{"action": "key", "text": "Return"}
{"action": "key", "text": "Tab"}
{"action": "key", "text": "Escape"}
{"action": "key", "text": "Backspace"}

// Key combinations
{"action": "key", "text": "ctrl+a"}
{"action": "key", "text": "ctrl+c"}
{"action": "key", "text": "ctrl+v"}
{"action": "key", "text": "cmd+shift+p"}

// Hold key for duration (seconds)
{"action": "hold_key", "key": "shift", "duration": 2}
```

### Scrolling

```json
// Vertical scroll
{"action": "scroll", "coordinate": [640, 400], "scroll_direction": "down", "scroll_amount": 3}
{"action": "scroll", "coordinate": [640, 400], "scroll_direction": "up", "scroll_amount": 5}

// Horizontal scroll (with shift modifier)
{"action": "scroll", "coordinate": [640, 400], "scroll_direction": "down", "scroll_amount": 3, "text": "shift"}

// Direct horizontal
{"action": "scroll", "coordinate": [640, 400], "scroll_direction": "left", "scroll_amount": 2}
{"action": "scroll", "coordinate": [640, 400], "scroll_direction": "right", "scroll_amount": 2}
```

### Utility Actions

```json
// Wait/pause (seconds)
{"action": "wait", "duration": 2}

// Screenshot
{"action": "screenshot"}
```

### Key Name Reference

| Key | Names |
|-----|-------|
| Enter | `Return`, `Enter`, `return`, `enter` |
| Tab | `Tab`, `tab` |
| Escape | `Escape`, `Esc`, `escape`, `esc` |
| Backspace | `Backspace`, `backspace` |
| Delete | `Delete`, `delete` |
| Space | `Space`, `space` |
| Arrows | `up`, `down`, `left`, `right`, `ArrowUp`, etc. |
| Modifiers | `ctrl`, `alt`, `shift`, `meta`, `super`, `cmd`, `command` |
| Function | `F1` through `F12` |

---

## Frame Synchronization

The hybrid synchronization system prevents acting on stale visual state:

### The Problem

Without synchronization, Claude might click based on a frame that no longer represents current page state (e.g., after a navigation or animation).

### The Solution

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frame-Action Synchronization                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. BEFORE ACTION                                                │
│     ├── Record current frame ID (e.g., #42)                     │
│     └── Store frame reference                                    │
│                                                                  │
│  2. EXECUTE ACTION                                               │
│     ├── Perform click/type/scroll via InputController           │
│     └── Action references frame #42                              │
│                                                                  │
│  3. WAIT FOR STABLE FRAME                                        │
│     ├── Monitor incoming frames                                  │
│     ├── Check: deltaPercent < 0.5%?                             │
│     │   └── Yes → Frame is stable                                │
│     └── OR: 200ms elapsed since action?                          │
│         └── Yes → Accept current frame                           │
│                                                                  │
│  4. RETURN RESULT                                                │
│     ├── beforeFrame: Frame #42 (what Claude saw)                │
│     ├── afterFrame: Frame #47 (result state)                    │
│     ├── causedChange: true/false                                 │
│     └── latencyMs: time from action to stable frame             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Configuration

```typescript
const frameBuffer = new FrameBuffer({
  maxSize: 10,              // Keep last 10 frames
  stabilityWaitMs: 200,     // Wait up to 200ms for stability
  maxWaitMs: 2000,          // Maximum wait time
  stabilityThreshold: 0.5,  // 0.5% change = stable
});
```

---

## Performance Tuning

### Reducing Bandwidth

```json
{
  "quality": 60,
  "deltaThreshold": 5,
  "everyNthFrame": 2
}
```

### Faster Response

```json
{
  "quality": 90,
  "deltaThreshold": 1,
  "keepAliveMs": 500
}
```

### CI/CD / Headless

```json
{
  "headless": true,
  "viewportWidth": 1024,
  "viewportHeight": 768,
  "quality": 70
}
```

### Memory Optimization

```json
{
  "maxBufferSize": 5,
  "quality": 70
}
```

---

## Troubleshooting

### Common Issues

#### "Browser not connected"

```bash
# Check if Chrome is installed
which google-chrome || which chromium

# Specify Chrome path explicitly
export CHROME_PATH=/path/to/chrome
```

#### "Session detached" errors

These are usually recoverable. The controller will auto-retry. If persistent:

```typescript
controller.on('error', async (event) => {
  if (!event.data.recoverable) {
    await controller.recover();
  }
});
```

#### High CPU usage

Reduce frame processing load:

```json
{
  "everyNthFrame": 3,
  "quality": 60,
  "deltaThreshold": 5
}
```

#### Frames not updating

Check if the page has animations or dynamic content:

```json
{
  "deltaThreshold": 0.5,
  "keepAliveMs": 500
}
```

#### "Anthropic API key required"

Configure your API key using one of these methods:

```bash
# Option 1: Add to ~/.claude/settings.json
# Add "anthropicApiKey": "sk-ant-..." as a top-level key

# Option 2: Set environment variable
export ANTHROPIC_API_KEY=sk-ant-...
```

### Debug Mode

Enable verbose logging:

```bash
DEBUG=claude-chrome-stream:* claude-chrome-stream interactive --url https://example.com
```

### Headless Issues on Linux

```bash
# Install required dependencies
sudo apt-get install -y xvfb libgbm-dev

# Run with xvfb
xvfb-run --auto-servernum claude-chrome-stream run --url https://example.com --task "Test" --headless
```

---

## Development

### Setup

```bash
# Clone
git clone https://github.com/joemccann/claude-chrome-stream.git
cd claude-chrome-stream

# Install dependencies
npm install

# Build
npm run build

# Development mode (with hot reload)
npm run dev
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run dev` | Run with tsx (development mode) |
| `npm run typecheck` | Type-check without emitting |
| `npm run clean` | Remove dist directory |
| `npm run mcp` | Start MCP server |
| `npm start` | Run compiled code |

### Project Structure

```
claude-chrome-stream/
├── .claude-plugin/
│   └── plugin.json          # Claude Code plugin manifest
├── .mcp.json                 # MCP server configuration
├── skills/
│   ├── stream-browser/       # Interactive browser skill
│   ├── autonomous-browse/    # Autonomous agent skill
│   └── browser-screenshot/   # Screenshot skill
├── src/
│   ├── types.ts              # TypeScript type definitions
│   ├── BrowserManager.ts     # Chrome/Puppeteer lifecycle
│   ├── StreamProcessor.ts    # CDP screencast + delta detection
│   ├── InputController.ts    # Browser action handling
│   ├── FrameBuffer.ts        # Frame synchronization
│   ├── SonnetBridge.ts       # Anthropic API integration
│   ├── MCPServer.ts          # MCP protocol server
│   ├── ChromeStreamController.ts  # Main orchestrator
│   ├── index.ts              # Library exports
│   ├── cli.ts                # CLI entry point
│   └── mcp-server.ts         # MCP server entry point
├── package.json
├── tsconfig.json
└── README.md
```

---

## API Reference

### ChromeStreamController

```typescript
class ChromeStreamController extends EventEmitter {
  constructor(config?: Partial<ChromeStreamConfig>);

  // Lifecycle
  start(url?: string): Promise<ScreencastFrame>;
  stop(): Promise<void>;
  recover(): Promise<boolean>;

  // Actions
  executeAction(action: BrowserAction): Promise<FrameActionResult>;
  executeActions(actions: BrowserAction[]): Promise<FrameActionResult[]>;
  navigate(url: string): Promise<void>;

  // Frames
  getLatestFrame(): ScreencastFrame | null;
  waitForFrame(timeout?: number): Promise<ScreencastFrame>;
  waitForStableFrame(durationMs?: number, timeout?: number): Promise<ScreencastFrame>;
  captureScreenshot(): Promise<ScreencastFrame | null>;

  // Status
  getStatus(): ControllerStatus;
  getSessionState(): Promise<SessionState>;

  // Events: 'frame', 'connected', 'disconnected', 'navigation', 'error', 'recovered'
}
```

### SonnetBridge

```typescript
class SonnetBridge {
  constructor(config: Partial<SonnetBridgeConfig>);

  processFrame(
    frame: ScreencastFrame,
    userPrompt: string,
    sessionState: SessionState
  ): Promise<SonnetResponse>;

  addToolResult(
    toolUseId: string,
    result: string | MessageContent[],
    isError?: boolean
  ): Promise<SonnetResponse>;

  addScreenshotResult(
    toolUseId: string,
    frame: ScreencastFrame
  ): Promise<SonnetResponse>;

  resetConversation(): void;
  getConversationHistory(): ConversationMessage[];
  trimConversation(keepLast?: number): void;
}
```

### Types

```typescript
interface ScreencastFrame {
  frameId: number;
  timestamp: number;
  data: string;  // Base64 JPEG
  metadata: FrameMetadata;
  hasChange: boolean;
  deltaPercent: number;
}

interface FrameActionResult {
  action: BrowserAction;
  result: ActionResult;
  beforeFrame: ScreencastFrame;
  afterFrame: ScreencastFrame | null;
  causedChange: boolean;
  latencyMs: number;
}

type BrowserAction =
  | ScreenshotAction
  | ClickAction
  | MouseMoveAction
  | DragAction
  | TypeAction
  | KeyAction
  | ScrollAction
  | WaitAction
  | NavigateAction;
```

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Maintain Computer Use tool compatibility for all actions
- Keep frame synchronization logic in FrameBuffer
- Add tests for new features
- Update documentation for API changes

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [Puppeteer](https://pptr.dev/) - Chrome automation
- [pixelmatch](https://github.com/mapbox/pixelmatch) - Visual comparison
- [sharp](https://sharp.pixelplumbing.com/) - Image processing
- [Anthropic](https://www.anthropic.com/) - Claude AI
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP SDK
