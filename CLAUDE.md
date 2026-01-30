# CLAUDE.md - Project Context for Claude Code

This file provides context for Claude Code when working in this repository.

## Project Overview

**Claude Chrome Stream** is a high-performance Chrome automation plugin for Claude Code that replaces the standard screenshot-upload-act loop with continuous real-time streaming via Chrome DevTools Protocol (CDP).

### Core Value Proposition

Traditional browser automation with AI:
```
Screenshot → Upload → API Call → Response → Action → Repeat (slow, discrete)
```

Claude Chrome Stream:
```
Continuous Stream → Intelligent Filtering → Persistent Session → Fast Actions (fluid, low-latency)
```

---

## Architecture Summary

```
ChromeStreamController (orchestrator)
├── BrowserManager      → Chrome lifecycle, Puppeteer, CDP sessions
├── StreamProcessor     → CDP screencast, pixelmatch delta detection
├── InputController     → All browser actions (click, type, scroll, etc.)
├── FrameBuffer         → Frame storage & synchronization
├── SonnetBridge        → Anthropic API integration
└── MCPServer           → MCP protocol for Claude Code
```

### Key Design Decisions

1. **Visual Delta Detection**: Only forward frames with >2% pixel change (configurable)
2. **Hybrid Frame Synchronization**:
   - Lock-step: Wait for stable frame after action
   - Optimistic: Correlate actions with frame IDs
3. **Computer Use Compatibility**: All actions match Claude's Computer Use tool schema
4. **Memory-Only Processing**: No disk I/O during streaming - all buffers

---

## File Structure

```
src/
├── types.ts                    # All TypeScript types and interfaces
├── BrowserManager.ts           # Chrome/Puppeteer lifecycle management
├── StreamProcessor.ts          # CDP screencast + pixelmatch
├── InputController.ts          # Browser action execution
├── FrameBuffer.ts              # Frame storage and sync logic
├── SonnetBridge.ts             # Anthropic API client wrapper
├── MCPServer.ts                # MCP protocol server
├── ChromeStreamController.ts   # Main orchestrator class
├── index.ts                    # Library exports + factory functions
├── cli.ts                      # CLI entry point
└── mcp-server.ts               # Standalone MCP server entry

skills/                         # Claude Code skills
├── stream-browser/             # Interactive browser skill
├── autonomous-browse/          # Autonomous agent skill
└── browser-screenshot/         # Screenshot utility skill

.claude-plugin/plugin.json      # Claude Code plugin manifest
.mcp.json                       # MCP server configuration
```

---

## Development Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript → dist/
npm run dev          # Run with tsx (development)
npm run typecheck    # Type-check without emit
npm run clean        # Remove dist/
npm run mcp          # Start MCP server
```

---

## Key Types Reference

### ScreencastFrame
```typescript
interface ScreencastFrame {
  frameId: number;           // Monotonic ID for sync
  timestamp: number;         // Capture time
  data: string;              // Base64 JPEG
  metadata: FrameMetadata;   // Scroll, scale info
  hasChange: boolean;        // Delta > threshold?
  deltaPercent: number;      // % pixels changed
}
```

### BrowserAction (Computer Use Compatible)
```typescript
type BrowserAction =
  | { action: 'screenshot' }
  | { action: 'left_click' | 'right_click' | 'double_click' | 'triple_click'; coordinate: [number, number]; text?: ModifierKey }
  | { action: 'mouse_move'; coordinate: [number, number] }
  | { action: 'left_click_drag'; startCoordinate: [number, number]; endCoordinate: [number, number] }
  | { action: 'type'; text: string }
  | { action: 'key'; text: string }  // e.g., "Return", "ctrl+s"
  | { action: 'scroll'; coordinate: [number, number]; scroll_direction: 'up'|'down'|'left'|'right'; scroll_amount: number }
  | { action: 'wait'; duration: number }
  | { action: 'navigate'; url: string };
```

### FrameActionResult
```typescript
interface FrameActionResult {
  action: BrowserAction;
  result: ActionResult;
  beforeFrame: ScreencastFrame;   // What Claude saw
  afterFrame: ScreencastFrame;    // Result state
  causedChange: boolean;
  latencyMs: number;
}
```

---

## Common Tasks

### Adding a New Action Type

1. Add type to `src/types.ts`:
   ```typescript
   export interface NewAction extends BaseAction {
     action: 'new_action';
     param: string;
   }
   ```

2. Add to union type:
   ```typescript
   export type BrowserAction = ... | NewAction;
   ```

3. Implement in `src/InputController.ts`:
   ```typescript
   case 'new_action':
     await this.handleNewAction(action.param);
     break;
   ```

4. Add schema in `src/MCPServer.ts` for MCP exposure

### Modifying Delta Detection

Edit `src/StreamProcessor.ts`:
```typescript
private async compareFrames(prev: Buffer, curr: Buffer): Promise<FrameComparisonResult> {
  // pixelmatch configuration here
  const diffPixelCount = pixelmatch(prevData, currData, diff, width, height, {
    threshold: 0.1,      // Color sensitivity
    includeAA: false,    // Anti-aliasing
  });
}
```

### Adjusting Frame Synchronization

Edit `src/FrameBuffer.ts`:
```typescript
const DEFAULT_CONFIG: FrameBufferConfig = {
  maxSize: 10,              // Buffer size
  stabilityWaitMs: 200,     // Wait after action
  maxWaitMs: 2000,          // Max wait
  stabilityThreshold: 0.5,  // % for "stable"
};
```

---

## Testing Patterns

### Manual Testing

```bash
# Interactive mode
npm run dev -- interactive --url https://example.com

# In the REPL:
> {"action": "navigate", "url": "https://github.com"}
> {"action": "left_click", "coordinate": [500, 300]}
> status
> frame
> quit
```

### Testing MCP Server

```bash
# Start server
npm run mcp

# In another terminal, use Claude Code with the plugin
claude --plugin-dir .
```

### Testing Autonomous Agent

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run dev -- run --url https://example.com --task "Click the first link" --max-steps 5
```

---

## Error Handling Patterns

### CDP Session Recovery

The `BrowserManager` emits recoverable errors:
```typescript
controller.on('error', (event) => {
  if (event.data.recoverable) {
    // Auto-retry happens internally
  } else {
    // Manual intervention needed
    await controller.recover();
  }
});
```

### Common CDP Errors

| Error | Cause | Recovery |
|-------|-------|----------|
| Session detached | Tab closed, navigation timeout | Auto-recovery |
| Target closed | Browser crashed | Requires restart |
| Protocol error | Invalid CDP command | Check action params |

---

## Performance Considerations

### CPU Optimization
- `everyNthFrame: 2-3` reduces processing load
- `quality: 60-70` reduces image size
- `deltaThreshold: 5` reduces false positives

### Memory Optimization
- `maxBufferSize: 5` limits frame storage
- Frames are garbage collected after leaving buffer

### Latency Optimization
- `keepAliveMs: 500` for faster keep-alive
- `stabilityWaitMs: 100` for quicker action completion

---

## Integration Points

### Claude Code Plugin

The plugin is defined in `.claude-plugin/plugin.json` and exposes:
- Skills via `skills/` directory
- MCP server via `.mcp.json`

### MCP Tools Exposed

| Tool | Description |
|------|-------------|
| `browser_start` | Launch browser with optional URL |
| `browser_action` | Execute any browser action |
| `browser_stop` | Close browser session |
| `browser_status` | Get streaming statistics |

### Anthropic API

The `SonnetBridge` uses:
- Model: `claude-sonnet-4-20250514` (configurable)
- Beta: `computer-use-2025-01-24`
- Tool: `computer_20250124`

---

## Debugging Tips

### Enable Verbose Logging

```bash
DEBUG=claude-chrome-stream:* npm run dev -- interactive --url https://example.com
```

### Inspect Frame Data

```typescript
controller.on('frame', (frame) => {
  console.log(`Frame #${frame.frameId}`);
  console.log(`  Delta: ${frame.deltaPercent.toFixed(2)}%`);
  console.log(`  Changed: ${frame.hasChange}`);
  console.log(`  Size: ${frame.data.length} bytes`);
});
```

### Check Stream Statistics

```typescript
const stats = controller.getStatus();
console.log('Stream stats:', stats.streamStats);
console.log('Buffer stats:', stats.bufferStats);
```

---

## Code Style Guidelines

- **TypeScript Strict Mode**: All code must pass strict type checking
- **ES Modules**: Use `.js` extensions in imports (for Node ESM)
- **Async/Await**: Prefer over raw Promises
- **Error Handling**: Always wrap CDP operations in try/catch
- **Event Emitters**: Use typed events where possible

### Import Pattern

```typescript
// Correct (ESM with .js extension)
import { BrowserManager } from './BrowserManager.js';
import type { ScreencastFrame } from './types.js';

// Incorrect
import { BrowserManager } from './BrowserManager';  // Missing .js
```

---

## Common Gotchas

1. **Frame IDs are monotonic** - Never assume gaps or specific values
2. **Base64 data includes no prefix** - It's raw base64, not `data:image/jpeg;base64,...`
3. **Coordinates are viewport-relative** - Not screen-relative
4. **Key names are case-sensitive** - `Return` not `return` for Puppeteer
5. **CDP session can detach silently** - Always check `isActive()` before operations

---

## Related Documentation

- [Puppeteer API](https://pptr.dev/api)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [Anthropic Computer Use](https://docs.anthropic.com/en/docs/agents-and-tools/computer-use)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [pixelmatch](https://github.com/mapbox/pixelmatch)

---

## Quick Reference: Action Examples

```json
// Navigation
{"action": "navigate", "url": "https://example.com"}

// Clicks
{"action": "left_click", "coordinate": [500, 300]}
{"action": "double_click", "coordinate": [500, 300]}
{"action": "right_click", "coordinate": [500, 300]}

// With modifier
{"action": "left_click", "coordinate": [500, 300], "text": "shift"}

// Typing
{"action": "type", "text": "Hello, World!"}
{"action": "key", "text": "Return"}
{"action": "key", "text": "ctrl+a"}

// Scrolling
{"action": "scroll", "coordinate": [640, 400], "scroll_direction": "down", "scroll_amount": 3}

// Drag
{"action": "left_click_drag", "startCoordinate": [100, 100], "endCoordinate": [300, 300]}

// Wait
{"action": "wait", "duration": 2}
```
