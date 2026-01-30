#!/usr/bin/env node
/**
 * Claude Chrome Stream MCP Server Entry Point
 * Standalone MCP server for Claude Code integration
 */

import { MCPServer } from './MCPServer.js';
import * as fs from 'fs';
import * as path from 'path';

interface MCPConfig {
  viewportWidth?: number;
  viewportHeight?: number;
  quality?: number;
  headless?: boolean;
  chromePath?: string;
  userDataDir?: string;
}

function loadConfig(): MCPConfig {
  const configPaths = [
    path.join(process.cwd(), 'claude-chrome-stream.json'),
    path.join(process.cwd(), '.claude-chrome-stream.json'),
    path.join(process.env.HOME || '', '.config', 'claude-chrome-stream', 'config.json'),
  ];

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content);
        return config.mcp || config;
      }
    } catch {
      // Continue to next config path
    }
  }

  return {};
}

async function main(): Promise<void> {
  const config = loadConfig();

  const server = new MCPServer({
    viewportWidth: config.viewportWidth || 1280,
    viewportHeight: config.viewportHeight || 800,
    quality: config.quality || 80,
    headless: config.headless ?? false,
    chromePath: config.chromePath,
    userDataDir: config.userDataDir,
  });

  // Handle shutdown signals
  const shutdown = async (): Promise<void> => {
    console.error('Shutting down MCP server...');
    await server.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    shutdown();
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    shutdown();
  });

  // Start server
  await server.run();
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
