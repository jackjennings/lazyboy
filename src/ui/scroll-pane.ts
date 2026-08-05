import { dim } from "@std/fmt/colors";
import {
  type Component,
  type Focusable,
  matchesKey,
  type TUI,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { compositeSideBySide } from "./toc.ts";

export class ScrollPane implements Component, Focusable {
  private getLinesFn: (width: number) => string[];
  private onInvalidateFn?: () => void;
  private pinnedSidebar?: (sidebarWidth: number) => string[];
  private pinnedSidebarWidth?: (totalWidth: number) => number;
  private sidebarSep: string;
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
    pinnedSidebar?: (sidebarWidth: number) => string[];
    pinnedSidebarWidth?: (totalWidth: number) => number;
    sidebarSep?: string;
  }) {
    this.getLinesFn = options.getLines;
    this.tui = options.tui;
    this.title = options.title;
    this.getHeight = options.getHeight;
    this.onInvalidateFn = options.onInvalidate;
    this.pinnedSidebar = options.pinnedSidebar;
    this.pinnedSidebarWidth = options.pinnedSidebarWidth;
    this.sidebarSep = options.sidebarSep ?? "";
  }

  private activeSidebarWidth(totalWidth: number): number {
    return this.pinnedSidebarWidth?.(totalWidth) ?? 0;
  }

  private effectiveContentWidth(totalWidth: number): number {
    const sw = this.activeSidebarWidth(totalWidth);
    if (sw === 0) return totalWidth;
    return totalWidth - sw - this.sidebarSep.length;
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
    const cw = this.effectiveContentWidth(width);
    const height = this.getHeight();
    const lines = this.expandLines(cw);
    this.scrollOffset = Math.max(0, lines.length - height);
  }

  isAtEnd(width: number): boolean {
    const cw = this.effectiveContentWidth(width);
    const lines = this.expandLines(cw);
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
    const cw = this.effectiveContentWidth(width);
    if (matchesKey(data, "space") || matchesKey(data, "f")) {
      const height = this.getHeight();
      const lines = this.expandLines(cw);
      const maxOffset = Math.max(0, lines.length - height);
      this.scrollOffset = Math.min(this.scrollOffset + height, maxOffset);
    }
    if (matchesKey(data, "b")) {
      const height = this.getHeight();
      this.scrollOffset = Math.max(0, this.scrollOffset - height);
    }
    if (matchesKey(data, "down")) {
      const height = this.getHeight();
      const lines = this.expandLines(cw);
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
    const sw = this.activeSidebarWidth(width);
    const cw = this.effectiveContentWidth(width);
    const lines = this.expandLines(cw);
    const height = this.getHeight();
    const sliced = lines.slice(this.scrollOffset, this.scrollOffset + height);
    if (sw > 0 && this.pinnedSidebar) {
      const tocLines = this.pinnedSidebar(sw);
      return [
        this.header(width),
        ...compositeSideBySide(sliced, cw, tocLines, this.sidebarSep),
      ];
    }
    return [this.header(width), ...sliced];
  }
}
