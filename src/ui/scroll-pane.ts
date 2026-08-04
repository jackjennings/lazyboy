import { dim } from "@std/fmt/colors";
import {
  type Component,
  type Focusable,
  matchesKey,
  type TUI,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export class ScrollPane implements Component, Focusable {
  private getLinesFn: (width: number) => string[];
  private onInvalidateFn?: () => void;
  scrollOffset = 0;
  focused = true;
  private tui: TUI;
  private title: string;
  private getHeight: () => number;

  constructor(options: {
    getLines: (width: number) => string[];
    tui: TUI;
    title: string;
    getHeight: () => number;
    onInvalidate?: () => void;
  }) {
    this.getLinesFn = options.getLines;
    this.tui = options.tui;
    this.title = options.title;
    this.getHeight = options.getHeight;
    this.onInvalidateFn = options.onInvalidate;
  }

  private expandLines(width: number): string[] {
    const raw = this.getLinesFn(width).flatMap((line) =>
      line.split(/\r\n|\n|\r/)
    );
    if (width <= 0) return raw;
    return raw.flatMap((segment) => wrapTextWithAnsi(segment, width));
  }

  setContent(getLines: (width: number) => string[]): void {
    this.getLinesFn = getLines;
    this.scrollOffset = 0;
  }

  scrollToEnd(): void {
    const width = this.tui.terminal.columns;
    const height = this.getHeight();
    const lines = this.expandLines(width);
    this.scrollOffset = Math.max(0, lines.length - height);
  }

  isAtEnd(width: number): boolean {
    const lines = this.expandLines(width);
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
      const lines = this.expandLines(width);
      const maxOffset = Math.max(0, lines.length - height);
      this.scrollOffset = Math.min(this.scrollOffset + height, maxOffset);
    }
    if (matchesKey(data, "b")) {
      const height = this.getHeight();
      this.scrollOffset = Math.max(0, this.scrollOffset - height);
    }
    if (matchesKey(data, "down")) {
      const height = this.getHeight();
      const lines = this.expandLines(width);
      const maxOffset = Math.max(0, lines.length - height);
      this.scrollOffset = Math.min(this.scrollOffset + 1, maxOffset);
    }
    if (matchesKey(data, "up")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
    }
  }

  invalidate(): void {
    this.onInvalidateFn?.();
  }

  render(width: number): string[] {
    const lines = this.expandLines(width);
    const height = this.getHeight();
    const content = lines.slice(this.scrollOffset, this.scrollOffset + height);
    return [this.header(width), ...content];
  }
}
