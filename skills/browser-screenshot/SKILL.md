---
name: browser-screenshot
description: Take a screenshot of a webpage using the streaming browser
allowed-tools: Bash
argument-hint: "<url>"
---

# Browser Screenshot

Take a high-quality screenshot of a webpage using the streaming browser infrastructure.

## Usage

```bash
cd ${pluginDir} && npm run dev -- screenshot --url "$ARGUMENTS" --output ./screenshots --headless
```

## Features

- **Intelligent wait**: Waits for stable frame (no visual changes for 500ms) before capture
- **JPEG output**: Optimized for quality and file size
- **Configurable viewport**: 1280x800 default, configurable via config file

## Output

Screenshots are saved as `screenshot_<timestamp>.jpg` in the specified output directory.
