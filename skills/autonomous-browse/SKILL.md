---
name: autonomous-browse
description: Run an autonomous browser agent to complete a task on a website
allowed-tools: Bash
argument-hint: "<url> <task>"
---

# Autonomous Browser Agent

Run an autonomous browser agent that uses Claude Sonnet to complete tasks on websites.

## Usage

The arguments should be: `<url> <task description>`

Example:
```
/claude-chrome-stream:autonomous-browse https://github.com "Find the trending repositories page and list the top 5 projects"
```

## Execution

Parse the arguments to extract URL and task:

```bash
cd ${pluginDir} && npm run dev -- run --url "$1" --task "$2" --max-steps 30
```

## How It Works

1. **Browser Launch**: Opens Chrome with the specified URL
2. **Visual Streaming**: Captures frames via CDP screencast with intelligent delta detection
3. **Sonnet Analysis**: Sends frames to Claude Sonnet for visual understanding
4. **Action Execution**: Executes tool calls (click, type, scroll, etc.) from Sonnet
5. **Frame Synchronization**: Waits for stable frame after each action before continuing
6. **Task Completion**: Continues until Sonnet indicates task is complete or max steps reached

## Features

- **Real-time visual feedback**: Efficient frame streaming with 2% change threshold
- **Hybrid synchronization**: Combines lock-step (stable frame waiting) with optimistic (frame IDs)
- **Error recovery**: Automatic reconnection on session detachment
- **Context management**: Maintains conversation history for multi-step tasks

## Requirements

- Anthropic API key set in `ANTHROPIC_API_KEY` environment variable or config file
- Node.js 18+
- Chrome/Chromium installed
