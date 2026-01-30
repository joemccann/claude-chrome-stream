---
name: stream-browser
description: Start a streaming browser session with real-time visual feedback
allowed-tools: Bash
argument-hint: "[url]"
---

# Streaming Browser Session

Start a high-performance browser session with real-time CDP streaming.

## Usage

Start a streaming browser session:
```bash
cd ${pluginDir} && npm run dev -- interactive --url "$ARGUMENTS"
```

The streaming browser provides:
- **Real-time visual feedback** via CDP screencast
- **Intelligent frame filtering** - only sends frames when visual changes occur (>2% delta) or after 2-second keep-alive
- **Full Computer Use compatibility** - all actions match Claude's Computer Use tool schema

## Available Actions

Once the browser is running, you can execute actions in JSON format:

### Navigation
```json
{"action": "navigate", "url": "https://example.com"}
```

### Mouse Actions
```json
{"action": "left_click", "coordinate": [500, 300]}
{"action": "right_click", "coordinate": [500, 300]}
{"action": "double_click", "coordinate": [500, 300]}
{"action": "triple_click", "coordinate": [500, 300]}
{"action": "mouse_move", "coordinate": [500, 300]}
{"action": "left_click_drag", "startCoordinate": [100, 100], "endCoordinate": [200, 200]}
```

### Keyboard Actions
```json
{"action": "type", "text": "Hello, world!"}
{"action": "key", "text": "Return"}
{"action": "key", "text": "ctrl+s"}
```

### Scrolling
```json
{"action": "scroll", "coordinate": [500, 400], "scroll_direction": "down", "scroll_amount": 3}
```

### Waiting
```json
{"action": "wait", "duration": 2}
```

## Status Commands

- `status` - Show browser and streaming status
- `frame` - Show current frame information
- `quit` or `exit` - Close browser and exit
