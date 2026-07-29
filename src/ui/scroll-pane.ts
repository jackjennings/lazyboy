import { dim } from "@std/fmt/colors";
import {
  type Component,
  type Focusable,
  matchesKey,
  type TUI,
} from "@earendil-works/pi-tui";

export class ScrollPane implements Component, Focusable {
  private getLinesFn: (width: number) => string[];
  private onInvalidateFn?: () => void;
  scrollOffset = 0;
  focused = true;
  private tui: TUI;
  private title: string;
  private getHeight: () => number;

  constructor(
    getLines: (width: number) => string[],
    tui: TUI,
    title: string,
    getHeight: () => number,
    onInvalidate?: () => void,
  ) {
    this.getLinesFn = getLines;
    this.tui = tui;
    this.title = title;
    this.getHeight = getHeight;
    this.onInvalidateFn = onInvalidate;
  }

  setContent(getLines: (width: number) => string[]): void {
    this.getLinesFn = getLines;
    this.scrollOffset = 0;
  }

  scrollToEnd(): void {
    const width = this.tui.terminal.columns;
    const height = this.getHeight();
    const lines = this.getLinesFn(width);
    this.scrollOffset = Math.max(0, lines.length - height);
  }

  isAtEnd(width: number): boolean {
    const lines = this.getLinesFn(width);
    const height = this.getHeight();
    return this.scrollOffset >= Math.max(0, lines.length - height);
  }

  private header(width: number): string {
    const label = ` ${this.title} `;
    const remaining = Math.max(0, width - label.length);
    const left = Math.floor(remaining / 2);
    const right = remaining - left;
    return dim("─".repeat(left) + label + "─".repeat(right));
  }

  handleInput(data: string): void {
    if (!this.focused) return;
    const width = this.tui.terminal.columns;
    if (matchesKey(data, "space") || matchesKey(data, "f")) {
      const height = this.getHeight();
      const lines = this.getLinesFn(width);
      const maxOffset = Math.max(0, lines.length - height);
      this.scrollOffset = Math.min(this.scrollOffset + height, maxOffset);
    }
    if (matchesKey(data, "b")) {
      const height = this.getHeight();
      this.scrollOffset = Math.max(0, this.scrollOffset - height);
    }
  }

  invalidate(): void {
    this.onInvalidateFn?.();
  }

  render(width: number): string[] {
    const lines = this.getLinesFn(width);
    const height = this.getHeight();
    const content = lines.slice(this.scrollOffset, this.scrollOffset + height);
    return [this.header(width), ...content];
  }
}
