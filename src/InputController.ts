/**
 * InputController - Bidirectional input injection
 * Handles all browser actions compatible with Computer Use tool schema
 */

import { Page, CDPSession, KeyInput } from 'puppeteer';
import {
  BrowserAction,
  ActionResult,
  Coordinate,
  ModifierKey,
  ScrollDirection,
} from './types.js';

// Key mappings for special keys
const KEY_MAPPINGS: Record<string, KeyInput> = {
  'return': 'Enter',
  'enter': 'Enter',
  'tab': 'Tab',
  'escape': 'Escape',
  'esc': 'Escape',
  'backspace': 'Backspace',
  'delete': 'Delete',
  'space': 'Space',
  'up': 'ArrowUp',
  'down': 'ArrowDown',
  'left': 'ArrowLeft',
  'right': 'ArrowRight',
  'home': 'Home',
  'end': 'End',
  'pageup': 'PageUp',
  'pagedown': 'PageDown',
  'f1': 'F1',
  'f2': 'F2',
  'f3': 'F3',
  'f4': 'F4',
  'f5': 'F5',
  'f6': 'F6',
  'f7': 'F7',
  'f8': 'F8',
  'f9': 'F9',
  'f10': 'F10',
  'f11': 'F11',
  'f12': 'F12',
  // Modifier keys
  'ctrl': 'Control',
  'control': 'Control',
  'alt': 'Alt',
  'option': 'Alt',
  'shift': 'Shift',
  'meta': 'Meta',
  'super': 'Meta',
  'cmd': 'Meta',
  'command': 'Meta',
  'win': 'Meta',
  'windows': 'Meta',
};

// Modifier key to Puppeteer modifier
const MODIFIER_TO_KEY: Record<ModifierKey, KeyInput> = {
  'shift': 'Shift',
  'ctrl': 'Control',
  'alt': 'Alt',
  'super': 'Meta',
  'meta': 'Meta',
};

export class InputController {
  private page: Page;
  private cdpSession: CDPSession;
  private actionQueue: Array<{
    action: BrowserAction;
    resolve: (result: ActionResult) => void;
    reject: (error: Error) => void;
  }> = [];
  private isProcessing = false;
  private currentFrameId = 0;

  constructor(
    page: Page,
    cdpSession: CDPSession,
    _viewportWidth: number,
    _viewportHeight: number
  ) {
    this.page = page;
    this.cdpSession = cdpSession;
  }

  /**
   * Update current frame ID for action results
   */
  setCurrentFrameId(frameId: number): void {
    this.currentFrameId = frameId;
  }

  /**
   * Execute a browser action
   */
  async execute(action: BrowserAction): Promise<ActionResult> {
    return new Promise((resolve, reject) => {
      this.actionQueue.push({ action, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Execute multiple actions in sequence
   */
  async executeSequence(actions: BrowserAction[]): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    for (const action of actions) {
      results.push(await this.execute(action));
    }
    return results;
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.actionQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.actionQueue.length > 0) {
      const item = this.actionQueue.shift()!;
      try {
        const result = await this.executeAction(item.action);
        item.resolve(result);
      } catch (error) {
        item.resolve({
          success: false,
          frameId: this.currentFrameId,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
          action: item.action,
        });
      }
    }

    this.isProcessing = false;
  }

  private async executeAction(action: BrowserAction): Promise<ActionResult> {
    try {
      let screenshot: string | undefined;

      switch (action.action) {
        case 'screenshot':
          screenshot = await this.takeScreenshot();
          break;

        case 'left_click':
        case 'right_click':
        case 'middle_click':
        case 'double_click':
        case 'triple_click':
          await this.handleClick(action);
          break;

        case 'mouse_move':
          await this.handleMouseMove(action.coordinate);
          break;

        case 'left_mouse_down':
          await this.handleMouseDown(action.coordinate);
          break;

        case 'left_mouse_up':
          await this.handleMouseUp(action.coordinate);
          break;

        case 'left_click_drag':
          await this.handleDrag(action.startCoordinate, action.endCoordinate);
          break;

        case 'type':
          await this.handleType(action.text);
          break;

        case 'key':
          await this.handleKey(action.text);
          break;

        case 'scroll':
          await this.handleScroll(
            action.coordinate,
            action.scroll_direction,
            action.scroll_amount,
            action.text
          );
          break;

        case 'hold_key':
          await this.handleHoldKey(action.key, action.duration);
          break;

        case 'wait':
          await this.handleWait(action.duration);
          break;

        case 'navigate':
          await this.handleNavigate(action.url);
          break;

        case 'zoom':
          // Zoom is handled at the StreamProcessor level
          // Here we just acknowledge it
          break;

        default:
          throw new Error(`Unknown action: ${(action as BrowserAction).action}`);
      }

      return {
        success: true,
        frameId: this.currentFrameId,
        timestamp: Date.now(),
        action,
        screenshot,
      };
    } catch (error) {
      return {
        success: false,
        frameId: this.currentFrameId,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
        action,
      };
    }
  }

  private async takeScreenshot(): Promise<string> {
    console.error('[InputController] Taking screenshot...');
    const buffer = await this.page.screenshot({
      type: 'jpeg',
      quality: 80,
      encoding: 'base64',
    });
    console.error('[InputController] Screenshot complete');
    return buffer as string;
  }

  private async handleClick(
    action: {
      action: 'left_click' | 'right_click' | 'middle_click' | 'double_click' | 'triple_click';
      coordinate: Coordinate;
      text?: ModifierKey;
    }
  ): Promise<void> {
    const [x, y] = this.scaleCoordinate(action.coordinate);
    const button = this.getMouseButton(action.action);
    const clickCount = this.getClickCount(action.action);

    // Handle modifier key if present
    if (action.text) {
      const modifierKey = MODIFIER_TO_KEY[action.text];
      await this.page.keyboard.down(modifierKey);
    }

    try {
      await this.page.mouse.click(x, y, {
        button,
        clickCount,
        delay: clickCount > 1 ? 50 : 0,
      });
    } finally {
      if (action.text) {
        const modifierKey = MODIFIER_TO_KEY[action.text];
        await this.page.keyboard.up(modifierKey);
      }
    }
  }

  private getMouseButton(
    action: 'left_click' | 'right_click' | 'middle_click' | 'double_click' | 'triple_click'
  ): 'left' | 'right' | 'middle' {
    switch (action) {
      case 'right_click':
        return 'right';
      case 'middle_click':
        return 'middle';
      default:
        return 'left';
    }
  }

  private getClickCount(
    action: 'left_click' | 'right_click' | 'middle_click' | 'double_click' | 'triple_click'
  ): number {
    switch (action) {
      case 'double_click':
        return 2;
      case 'triple_click':
        return 3;
      default:
        return 1;
    }
  }

  private async handleMouseMove(coordinate: Coordinate): Promise<void> {
    const [x, y] = this.scaleCoordinate(coordinate);
    await this.page.mouse.move(x, y);
  }

  private async handleMouseDown(coordinate: Coordinate): Promise<void> {
    const [x, y] = this.scaleCoordinate(coordinate);
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
  }

  private async handleMouseUp(coordinate: Coordinate): Promise<void> {
    const [x, y] = this.scaleCoordinate(coordinate);
    await this.page.mouse.move(x, y);
    await this.page.mouse.up();
  }

  private async handleDrag(
    startCoordinate: Coordinate,
    endCoordinate: Coordinate
  ): Promise<void> {
    const [startX, startY] = this.scaleCoordinate(startCoordinate);
    const [endX, endY] = this.scaleCoordinate(endCoordinate);

    await this.page.mouse.move(startX, startY);
    await this.page.mouse.down();

    // Smooth drag with intermediate steps
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const x = startX + ((endX - startX) * i) / steps;
      const y = startY + ((endY - startY) * i) / steps;
      await this.page.mouse.move(x, y);
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    await this.page.mouse.up();
  }

  private async handleType(text: string): Promise<void> {
    await this.page.keyboard.type(text, { delay: 10 });
  }

  private async handleKey(text: string): Promise<void> {
    // Parse key combinations like "ctrl+s", "cmd+shift+p"
    const parts = text.toLowerCase().split('+').map(p => p.trim());
    const modifiers: KeyInput[] = [];
    let mainKey: KeyInput | null = null;

    for (const part of parts) {
      const mappedKey = KEY_MAPPINGS[part];
      if (mappedKey) {
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(mappedKey)) {
          modifiers.push(mappedKey);
        } else {
          mainKey = mappedKey;
        }
      } else {
        // Single character or unmapped key
        mainKey = part as KeyInput;
      }
    }

    // Press modifiers
    for (const mod of modifiers) {
      await this.page.keyboard.down(mod);
    }

    // Press main key
    if (mainKey) {
      await this.page.keyboard.press(mainKey);
    }

    // Release modifiers in reverse order
    for (const mod of modifiers.reverse()) {
      await this.page.keyboard.up(mod);
    }
  }

  private async handleScroll(
    coordinate: Coordinate,
    direction: ScrollDirection,
    amount: number,
    modifier?: ModifierKey
  ): Promise<void> {
    const [x, y] = this.scaleCoordinate(coordinate);

    // Move to position first
    await this.page.mouse.move(x, y);

    // Calculate scroll deltas
    const pixelsPerUnit = 100; // Standard scroll amount per unit
    let deltaX = 0;
    let deltaY = 0;

    // Handle modifier for horizontal scroll
    const isHorizontal = modifier === 'shift';

    switch (direction) {
      case 'up':
        deltaY = isHorizontal ? 0 : -amount * pixelsPerUnit;
        deltaX = isHorizontal ? -amount * pixelsPerUnit : 0;
        break;
      case 'down':
        deltaY = isHorizontal ? 0 : amount * pixelsPerUnit;
        deltaX = isHorizontal ? amount * pixelsPerUnit : 0;
        break;
      case 'left':
        deltaX = -amount * pixelsPerUnit;
        break;
      case 'right':
        deltaX = amount * pixelsPerUnit;
        break;
    }

    // Use CDP for smooth scrolling
    await this.cdpSession.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX,
      deltaY,
    });

    // Wait for scroll to complete
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  private async handleHoldKey(key: string, durationSeconds: number): Promise<void> {
    const mappedKey = KEY_MAPPINGS[key.toLowerCase()] || (key as KeyInput);

    await this.page.keyboard.down(mappedKey);
    await new Promise(resolve => setTimeout(resolve, durationSeconds * 1000));
    await this.page.keyboard.up(mappedKey);
  }

  private async handleWait(durationSeconds: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, durationSeconds * 1000));
  }

  private async handleNavigate(url: string): Promise<void> {
    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
  }

  /**
   * Scale coordinates based on viewport vs screencast resolution
   * Currently 1:1 as per requirements, but method exists for future flexibility
   */
  private scaleCoordinate(coordinate: Coordinate): [number, number] {
    // Direct mapping - screencast resolution matches viewport
    return [coordinate[0], coordinate[1]];
  }

}

export default InputController;
