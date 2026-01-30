#!/usr/bin/env node
/**
 * Claude Chrome Stream CLI
 * Command-line interface for browser automation
 */

import { createChromeStream, runAutonomousAgent } from './index.js';
import { MCPServer } from './MCPServer.js';
import { ChromeStreamController } from './ChromeStreamController.js';
import { BrowserAction } from './types.js';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

interface CLIConfig {
  apiKey?: string;
  viewportWidth: number;
  viewportHeight: number;
  quality: number;
  headless: boolean;
  model: string;
}

function loadConfig(): Partial<CLIConfig> {
  const configPaths = [
    path.join(process.cwd(), 'claude-chrome-stream.json'),
    path.join(process.cwd(), '.claude-chrome-stream.json'),
    path.join(process.env.HOME || '', '.config', 'claude-chrome-stream', 'config.json'),
    path.join(process.env.HOME || '', '.claude', 'settings.json'),
  ];

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content);

        // Handle Claude settings.json format
        if (config.chromeStream) {
          return config.chromeStream;
        }
        if (config.anthropicApiKey) {
          return { apiKey: config.anthropicApiKey, ...config };
        }
        return config;
      }
    } catch {
      // Continue to next config path
    }
  }

  return {};
}

function parseArgs(args: string[]): {
  command: string;
  url?: string;
  task?: string;
  headless?: boolean;
  outputDir?: string;
  maxSteps?: number;
} {
  const result: ReturnType<typeof parseArgs> = { command: 'help' };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === 'mcp') {
      result.command = 'mcp';
    } else if (arg === 'interactive' || arg === '-i') {
      result.command = 'interactive';
    } else if (arg === 'run') {
      result.command = 'run';
    } else if (arg === 'screenshot') {
      result.command = 'screenshot';
    } else if (arg === '--url' || arg === '-u') {
      result.url = args[++i];
    } else if (arg === '--task' || arg === '-t') {
      result.task = args[++i];
    } else if (arg === '--headless') {
      result.headless = true;
    } else if (arg === '--output' || arg === '-o') {
      result.outputDir = args[++i];
    } else if (arg === '--max-steps') {
      result.maxSteps = parseInt(args[++i], 10);
    } else if (arg === '--help' || arg === '-h') {
      result.command = 'help';
    } else if (!result.url && arg.startsWith('http')) {
      result.url = arg;
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
Claude Chrome Stream CLI

USAGE:
  claude-chrome-stream <command> [options]

COMMANDS:
  mcp           Start as MCP server (for Claude Code integration)
  interactive   Start interactive browser session
  run           Run autonomous agent with task
  screenshot    Take a screenshot of a URL
  help          Show this help message

OPTIONS:
  --url, -u <url>       URL to navigate to
  --task, -t <task>     Task description for autonomous agent
  --headless            Run browser in headless mode
  --output, -o <dir>    Output directory for screenshots
  --max-steps <n>       Maximum steps for autonomous agent (default: 50)
  --help, -h            Show help

EXAMPLES:
  # Start MCP server for Claude Code
  claude-chrome-stream mcp

  # Interactive session
  claude-chrome-stream interactive --url https://example.com

  # Run autonomous task
  claude-chrome-stream run --url https://github.com --task "Find the trending repositories"

  # Take screenshot
  claude-chrome-stream screenshot --url https://example.com --output ./screenshots

CONFIGURATION:
  Create a config file at one of these locations:
  - ./claude-chrome-stream.json
  - ~/.config/claude-chrome-stream/config.json
  - ~/.claude/settings.json (with chromeStream key)

  Or set ANTHROPIC_API_KEY environment variable.
`);
}

async function runInteractive(url?: string, headless = false): Promise<void> {
  const config = loadConfig();

  console.log('Starting interactive browser session...');

  const controller = new ChromeStreamController({
    headless,
    viewportWidth: config.viewportWidth || 1280,
    viewportHeight: config.viewportHeight || 800,
  });

  try {
    const frame = await controller.start(url || 'about:blank');
    console.log(`Browser started. Frame ID: ${frame.frameId}`);
    console.log('Type actions in JSON format, or "quit" to exit.');
    console.log('Example: {"action": "navigate", "url": "https://example.com"}');
    console.log('Example: {"action": "left_click", "coordinate": [500, 300]}');
    console.log('Example: {"action": "type", "text": "hello world"}');
    console.log('');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const prompt = (): void => {
      rl.question('> ', async (input) => {
        if (input.toLowerCase() === 'quit' || input.toLowerCase() === 'exit') {
          await controller.stop();
          rl.close();
          return;
        }

        if (input.toLowerCase() === 'status') {
          console.log(JSON.stringify(controller.getStatus(), null, 2));
          prompt();
          return;
        }

        if (input.toLowerCase() === 'frame') {
          const currentFrame = controller.getLatestFrame();
          if (currentFrame) {
            console.log(`Frame ID: ${currentFrame.frameId}`);
            console.log(`Delta: ${currentFrame.deltaPercent.toFixed(2)}%`);
            console.log(`Has change: ${currentFrame.hasChange}`);
          } else {
            console.log('No frame available');
          }
          prompt();
          return;
        }

        try {
          const action = JSON.parse(input) as BrowserAction;
          const result = await controller.executeAction(action);
          console.log(`Action completed. Success: ${result.result.success}`);
          console.log(`Frame: ${result.result.frameId}, Change: ${result.causedChange}`);
        } catch (error) {
          console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        prompt();
      });
    };

    prompt();
  } catch (error) {
    console.error('Failed to start browser:', error);
    process.exit(1);
  }
}

async function runAutonomous(
  url: string,
  task: string,
  maxSteps: number,
  headless: boolean
): Promise<void> {
  const config = loadConfig();

  if (!config.apiKey && !process.env.ANTHROPIC_API_KEY) {
    console.error('Error: Anthropic API key required.');
    console.error('Set ANTHROPIC_API_KEY environment variable or add to config file.');
    process.exit(1);
  }

  console.log(`Starting autonomous agent...`);
  console.log(`URL: ${url}`);
  console.log(`Task: ${task}`);
  console.log(`Max steps: ${maxSteps}`);
  console.log('');

  try {
    const result = await runAutonomousAgent({
      browser: {
        headless,
        viewportWidth: config.viewportWidth || 1280,
        viewportHeight: config.viewportHeight || 800,
      },
      sonnet: {
        apiKey: config.apiKey,
        model: config.model || 'claude-sonnet-4-20250514',
      },
      initialUrl: url,
      task,
      maxSteps,
      onStep: (step) => {
        console.log(`\n--- Step ${step.stepNumber} ---`);
        if (step.response.text) {
          console.log(`Response: ${step.response.text.substring(0, 200)}...`);
        }
        if (step.response.actions) {
          console.log(`Actions: ${step.response.actions.map(a => a.action).join(', ')}`);
        }
      },
    });

    console.log('\n=== Agent Complete ===');
    console.log(`Success: ${result.success}`);
    console.log(`Total steps: ${result.steps}`);
  } catch (error) {
    console.error('Agent failed:', error);
    process.exit(1);
  }
}

async function takeScreenshot(url: string, outputDir: string, headless = true): Promise<void> {
  const config = loadConfig();

  console.log(`Taking screenshot of ${url}...`);

  const controller = new ChromeStreamController({
    headless,
    viewportWidth: config.viewportWidth || 1280,
    viewportHeight: config.viewportHeight || 800,
  });

  try {
    await controller.start(url);

    // Wait for stable frame
    const frame = await controller.waitForStableFrame(500, 10000);

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Save screenshot
    const filename = `screenshot_${Date.now()}.jpg`;
    const filepath = path.join(outputDir, filename);
    const buffer = Buffer.from(frame.data, 'base64');
    fs.writeFileSync(filepath, buffer);

    console.log(`Screenshot saved: ${filepath}`);
  } finally {
    await controller.stop();
  }
}

async function runMCPServer(): Promise<void> {
  const config = loadConfig();

  const server = new MCPServer({
    viewportWidth: config.viewportWidth || 1280,
    viewportHeight: config.viewportHeight || 800,
    quality: config.quality || 80,
    headless: config.headless ?? false,
  });

  // Handle shutdown
  process.on('SIGINT', async () => {
    await server.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.shutdown();
    process.exit(0);
  });

  await server.run();
}

// Main entry point
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case 'mcp':
      await runMCPServer();
      break;

    case 'interactive':
      await runInteractive(args.url, args.headless);
      break;

    case 'run':
      if (!args.url) {
        console.error('Error: --url required for run command');
        process.exit(1);
      }
      if (!args.task) {
        console.error('Error: --task required for run command');
        process.exit(1);
      }
      await runAutonomous(args.url, args.task, args.maxSteps || 50, args.headless || false);
      break;

    case 'screenshot':
      if (!args.url) {
        console.error('Error: --url required for screenshot command');
        process.exit(1);
      }
      await takeScreenshot(args.url, args.outputDir || '.', args.headless ?? true);
      break;

    case 'help':
    default:
      printHelp();
      break;
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
