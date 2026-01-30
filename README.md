# Claude Chrome Stream

High-performance Chrome automation plugin for Claude Code with real-time CDP streaming. Replaces the standard "screenshot-upload-act" loop with continuous visual streaming for fluid, low-latency web interaction.

## Features

- **Real-time Streaming**: Uses Chrome DevTools Protocol (CDP) `Page.startScreencast` for continuous frame capture
- **Intelligent Sampling**: Visual delta detection using `pixelmatch` - only forwards frames with >2% change or 2-second keep-alive
- **Computer Use Compatible**: Full action set matching Claude's Computer Use tool schema
- **Hybrid Frame Synchronization**: Combines lock-step (stable frame waiting) with optimistic (frame ID correlation)
- **MCP Integration**: Exposes browser capabilities as MCP tools for seamless Claude Code integration
- **Sonnet Bridge**: Direct integration with Anthropic API for autonomous agent loops
- **macOS Optimized**: Metal rendering and arm64 optimizations

## Installation

### As Claude Code Plugin

```bash
# Clone the repository
git clone https://github.com/joemccann/claude-chrome-stream.git

# Install dependencies
cd claude-chrome-stream
npm install

# Build
npm run build

# Use with Claude Code
claude --plugin-dir ./claude-chrome-stream
```

### Standalone

```bash
npm install -g claude-chrome-stream

# Or run directly
npx claude-chrome-stream
```

## Usage

### MCP Server (Claude Code Integration)

Start the MCP server for Claude Code:

```bash
claude-chrome-stream mcp
```

Or add to your Claude Code MCP configuration.

### Interactive Mode

```bash
claude-chrome-stream interactive --url https://example.com
```

### Autonomous Agent

```bash
claude-chrome-stream run \
  --url https://github.com \
  --task "Find the trending repositories" \
  --max-steps 30
```

### Screenshot

```bash
claude-chrome-stream screenshot --url https://example.com --output ./screenshots
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Claude Chrome Stream                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────┐    ┌──────────────────┐    ┌─────────────┐ │
│  │  BrowserManager │───▶│ StreamProcessor  │───▶│ FrameBuffer │ │
│  │  (Puppeteer/CDP)│    │ (Delta Detection)│    │ (Sync)      │ │
│  └────────┬────────┘    └──────────────────┘    └──────┬──────┘ │
│           │                                            │         │
│           ▼                                            ▼         │
│  ┌─────────────────┐                          ┌─────────────────┐│
│  │ InputController │◀─────────────────────────│  SonnetBridge   ││
│  │ (Actions)       │                          │  (Anthropic API)││
│  └─────────────────┘                          └─────────────────┘│
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                      MCPServer                               │ │
│  │              (Claude Code Integration)                       │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Components

- **BrowserManager**: Chrome/Puppeteer lifecycle, CDP session management, error recovery
- **StreamProcessor**: CDP screencast capture, visual delta detection with pixelmatch
- **InputController**: Full action set (click, type, scroll, drag, keys, navigation)
- **FrameBuffer**: Frame synchronization, hybrid lock-step/optimistic approach
- **SonnetBridge**: Anthropic API integration, conversation management
- **MCPServer**: MCP protocol implementation for Claude Code

## Configuration

Create a config file at one of these locations:
- `./claude-chrome-stream.json`
- `~/.config/claude-chrome-stream/config.json`
- `~/.claude/settings.json` (with `chromeStream` key)

```json
{
  "viewportWidth": 1280,
  "viewportHeight": 800,
  "quality": 80,
  "deltaThreshold": 2,
  "keepAliveMs": 2000,
  "headless": false,
  "model": "claude-sonnet-4-20250514"
}
```

Set your Anthropic API key:
```bash
export ANTHROPIC_API_KEY=your-key-here
```

## MCP Tools

When running as an MCP server, the following tools are available:

### `browser_start`
Start a browser session with optional URL.

```json
{
  "url": "https://example.com",
  "headless": false
}
```

### `browser_action`
Perform browser actions (Computer Use compatible):

```json
{
  "action": "left_click",
  "coordinate": [500, 300]
}
```

Supported actions:
- `screenshot` - Capture current screen
- `left_click`, `right_click`, `middle_click`, `double_click`, `triple_click` - Mouse clicks
- `mouse_move` - Move cursor
- `left_mouse_down`, `left_mouse_up` - Mouse button control
- `left_click_drag` - Click and drag
- `type` - Type text
- `key` - Press key or key combination
- `scroll` - Scroll in direction
- `hold_key` - Hold key for duration
- `wait` - Pause execution
- `navigate` - Navigate to URL

### `browser_stop`
Stop the browser session.

### `browser_status`
Get session status and statistics.

## Programmatic API

```typescript
import { createChromeStream, runAutonomousAgent } from 'claude-chrome-stream';

// Simple usage
const { controller, sonnet, execute, ask, stop } = await createChromeStream({
  browser: { viewportWidth: 1280, viewportHeight: 800 },
  sonnet: { apiKey: 'your-key' },
  initialUrl: 'https://example.com',
});

// Execute action
const frame = await execute({ action: 'left_click', coordinate: [500, 300] });

// Ask Claude about the page
const response = await ask('What do you see on this page?');

// Cleanup
await stop();
```

```typescript
// Autonomous agent
const result = await runAutonomousAgent({
  initialUrl: 'https://github.com',
  task: 'Find the trending repositories',
  maxSteps: 30,
  onStep: (step) => {
    console.log(`Step ${step.stepNumber}:`, step.response.text);
  },
});
```

## Frame Synchronization

The hybrid synchronization approach ensures Claude acts on current visual state:

1. **Before Action**: Record current frame ID
2. **Execute Action**: Run click/type/scroll via InputController
3. **Wait for Stable Frame**: Monitor incoming frames until:
   - Delta drops below stability threshold (0.5%), OR
   - Stability wait time (200ms) elapsed
4. **Return Result**: Provide before/after frames with change detection

This prevents clicking on "stale" frames from previous states.

## Performance

- **Frame Filtering**: Only ~10-20% of frames forwarded (rest filtered by delta detection)
- **No File I/O**: All frame data in memory buffers
- **Parallel Processing**: Sharp for image conversion, pixelmatch for comparison
- **macOS Metal**: GPU-accelerated rendering via Chrome Metal flags

## Error Handling

- **Session Detached**: Automatic recovery with browser restart
- **Target Closed**: Graceful cleanup and reconnection
- **Network Errors**: Exponential backoff retry for CDP operations
- **Frame Timeout**: Configurable timeouts with fallback behavior

## Development

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Build
npm run build

# Type check
npm run typecheck
```

## License

MIT
