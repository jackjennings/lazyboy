import { assertEquals } from "@std/assert";
import { stripAnsiCode } from "@std/fmt/colors";
import type { TUI } from "@earendil-works/pi-tui";
import { ScrollPane } from "./scroll-pane.ts";

function makeTui(rows = 24, columns = 80): TUI {
  return { terminal: { rows, columns } } as unknown as TUI;
}

Deno.test("ScrollPane: render includes title in header", () => {
  const pane = new ScrollPane(
    (_w) => ["line a"],
    makeTui(),
    "Status",
    () => 10,
  );
  assertEquals(stripAnsiCode(pane.render(80)[0]).includes("Status"), true);
});

Deno.test("ScrollPane: render returns 1 header + getHeight content lines", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane((_w) => content, makeTui(), "T", () => 5);
  assertEquals(pane.render(80).length, 6);
});

Deno.test("ScrollPane: initial scroll offset is 0", () => {
  const pane = new ScrollPane(
    (_w) => ["alpha", "beta"],
    makeTui(),
    "T",
    () => 10,
  );
  assertEquals(pane.render(80).some((l) => l.includes("alpha")), true);
});

Deno.test("ScrollPane: space advances scroll by one page", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane((_w) => content, makeTui(), "T", () => 5);
  pane.handleInput(" ");
  const lines = pane.render(80);
  assertEquals(lines.some((l) => l.includes("line 5")), true);
  assertEquals(lines.some((l) => l.includes("line 0")), false);
});

Deno.test("ScrollPane: f advances scroll by one page", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane((_w) => content, makeTui(), "T", () => 5);
  pane.handleInput("f");
  assertEquals(pane.render(80).some((l) => l.includes("line 5")), true);
});

Deno.test("ScrollPane: b retreats scroll by one page", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane((_w) => content, makeTui(), "T", () => 5);
  pane.handleInput(" ");
  pane.handleInput("b");
  assertEquals(pane.render(80).some((l) => l.includes("line 0")), true);
});

Deno.test("ScrollPane: handleInput is no-op when focused is false", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane((_w) => content, makeTui(), "T", () => 5);
  pane.focused = false;
  pane.handleInput(" ");
  assertEquals(pane.render(80).some((l) => l.includes("line 0")), true);
  assertEquals(pane.render(80).some((l) => l.includes("line 5")), false);
});

Deno.test("ScrollPane: setContent replaces getLines and resets scroll to 0", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane((_w) => content, makeTui(), "T", () => 5);
  pane.handleInput(" ");
  pane.setContent((_w) => ["fresh"]);
  assertEquals(pane.render(80).some((l) => l.includes("fresh")), true);
  assertEquals(pane.scrollOffset, 0);
});

Deno.test("ScrollPane: scrollToEnd shows last line", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane((_w) => content, makeTui(24, 80), "T", () => 5);
  pane.scrollToEnd();
  assertEquals(pane.render(80).some((l) => l.includes("line 19")), true);
});

Deno.test("ScrollPane: isAtEnd returns true after scrollToEnd", () => {
  const content = Array.from({ length: 10 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane((_w) => content, makeTui(24, 80), "T", () => 5);
  pane.scrollToEnd();
  assertEquals(pane.isAtEnd(80), true);
});

Deno.test("ScrollPane: isAtEnd returns false at top with scrollable content", () => {
  const content = Array.from({ length: 10 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane((_w) => content, makeTui(24, 80), "T", () => 5);
  assertEquals(pane.isAtEnd(80), false);
});

Deno.test("ScrollPane: getLines receives the render width", () => {
  let capturedWidth = 0;
  const pane = new ScrollPane(
    (w) => {
      capturedWidth = w;
      return ["line"];
    },
    makeTui(),
    "T",
    () => 10,
  );
  pane.render(120);
  assertEquals(capturedWidth, 120);
});

Deno.test("ScrollPane: onInvalidate callback is called by invalidate()", () => {
  let called = false;
  const pane = new ScrollPane(
    (_w) => ["line"],
    makeTui(),
    "T",
    () => 10,
    () => {
      called = true;
    },
  );
  pane.invalidate();
  assertEquals(called, true);
});
