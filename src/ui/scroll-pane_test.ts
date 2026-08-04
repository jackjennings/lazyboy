import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import { stripAnsiCode } from "@std/fmt/colors";
import type { TUI } from "@earendil-works/pi-tui";
import { ScrollPane } from "./scroll-pane.ts";

function makeTui(rows = 24, columns = 80): TUI {
  return { terminal: { rows, columns } } as unknown as TUI;
}

Deno.test("ScrollPane: render includes title in header", () => {
  const pane = new ScrollPane({
    getLines: (_w) => ["line a"],
    tui: makeTui(),
    title: "Status",
    getHeight: () => 10,
  });
  assertStringIncludes(stripAnsiCode(pane.render(80)[0]), "Status");
});

Deno.test("ScrollPane: render returns 1 header + getHeight content lines", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane({
    getLines: (_w) => content,
    tui: makeTui(),
    title: "T",
    getHeight: () => 5,
  });
  assertEquals(pane.render(80).length, 6);
});

Deno.test("ScrollPane: initial scroll offset is 0", () => {
  const pane = new ScrollPane({
    getLines: (_w) => ["alpha", "beta"],
    tui: makeTui(),
    title: "T",
    getHeight: () => 10,
  });
  assert(pane.render(80).some((l) => l.includes("alpha")));
});

Deno.test("ScrollPane: space advances scroll by one page", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane({
    getLines: (_w) => content,
    tui: makeTui(),
    title: "T",
    getHeight: () => 5,
  });
  pane.handleInput(" ");
  const lines = pane.render(80);
  assert(lines.some((l) => l.includes("line 5")));
  assertFalse(lines.some((l) => l.includes("line 0")));
});

Deno.test("ScrollPane: f advances scroll by one page", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane({
    getLines: (_w) => content,
    tui: makeTui(),
    title: "T",
    getHeight: () => 5,
  });
  pane.handleInput("f");
  assert(pane.render(80).some((l) => l.includes("line 5")));
});

Deno.test("ScrollPane: b retreats scroll by one page", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane({
    getLines: (_w) => content,
    tui: makeTui(),
    title: "T",
    getHeight: () => 5,
  });
  pane.handleInput(" ");
  pane.handleInput("b");
  assert(pane.render(80).some((l) => l.includes("line 0")));
});

Deno.test("ScrollPane: handleInput is no-op when focused is false", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane({
    getLines: (_w) => content,
    tui: makeTui(),
    title: "T",
    getHeight: () => 5,
  });
  pane.focused = false;
  pane.handleInput(" ");
  assert(pane.render(80).some((l) => l.includes("line 0")));
  assertFalse(pane.render(80).some((l) => l.includes("line 5")));
});

Deno.test("ScrollPane: setContent replaces getLines and resets scroll to 0", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane({
    getLines: (_w) => content,
    tui: makeTui(),
    title: "T",
    getHeight: () => 5,
  });
  pane.handleInput(" ");
  pane.setContent((_w) => ["fresh"]);
  assert(pane.render(80).some((l) => l.includes("fresh")));
  assertEquals(pane.scrollOffset, 0);
});

Deno.test("ScrollPane: scrollToEnd shows last line", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane({
    getLines: (_w) => content,
    tui: makeTui(24, 80),
    title: "T",
    getHeight: () => 5,
  });
  pane.scrollToEnd();
  assert(pane.render(80).some((l) => l.includes("line 19")));
});

Deno.test("ScrollPane: isAtEnd returns true after scrollToEnd", () => {
  const content = Array.from({ length: 10 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane({
    getLines: (_w) => content,
    tui: makeTui(24, 80),
    title: "T",
    getHeight: () => 5,
  });
  pane.scrollToEnd();
  assert(pane.isAtEnd(80));
});

Deno.test("ScrollPane: isAtEnd returns false at top with scrollable content", () => {
  const content = Array.from({ length: 10 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane({
    getLines: (_w) => content,
    tui: makeTui(24, 80),
    title: "T",
    getHeight: () => 5,
  });
  assertFalse(pane.isAtEnd(80));
});

Deno.test("ScrollPane: getLines receives the render width", () => {
  let capturedWidth = 0;
  const pane = new ScrollPane({
    getLines: (w) => {
      capturedWidth = w;
      return ["line"];
    },
    tui: makeTui(),
    title: "T",
    getHeight: () => 10,
  });
  pane.render(120);
  assertEquals(capturedWidth, 120);
});

Deno.test("ScrollPane: onInvalidate callback is called by invalidate()", () => {
  let called = false;
  const pane = new ScrollPane({
    getLines: (_w) => ["line"],
    tui: makeTui(),
    title: "T",
    getHeight: () => 10,
    onInvalidate: () => {
      called = true;
    },
  });
  pane.invalidate();
  assert(called);
});

Deno.test("ScrollPane: render expands \\n in string into separate rows", () => {
  const pane = new ScrollPane({
    getLines: (_w) => ["first\nsecond"],
    tui: makeTui(),
    title: "T",
    getHeight: () => 10,
  });
  const rendered = pane.render(80);
  assert(rendered.some((l) => l === "first"));
  assert(rendered.some((l) => l === "second"));
});

Deno.test("ScrollPane: render expands \\r\\n in string into separate rows", () => {
  const pane = new ScrollPane({
    getLines: (_w) => ["part1\r\npart2"],
    tui: makeTui(),
    title: "T",
    getHeight: () => 10,
  });
  const rendered = pane.render(80);
  assert(rendered.some((l) => l === "part1"));
  assert(rendered.some((l) => l === "part2"));
});

Deno.test("ScrollPane: scrollToEnd accounts for multiline strings", () => {
  const pane = new ScrollPane({
    getLines: (_w) => ["a\nb\nc\nd\ne\nf"],
    tui: makeTui(24, 80),
    title: "T",
    getHeight: () => 3,
  });
  pane.scrollToEnd();
  const rendered = pane.render(80);
  assert(rendered.some((l) => l === "f"));
});

Deno.test("ScrollPane: isAtEnd accounts for expanded lines from multiline strings", () => {
  const pane = new ScrollPane({
    getLines: (_w) => ["a\nb\nc\nd\ne"],
    tui: makeTui(24, 80),
    title: "T",
    getHeight: () => 3,
  });
  assertFalse(pane.isAtEnd(80));
  pane.scrollToEnd();
  assert(pane.isAtEnd(80));
});

Deno.test("ScrollPane: arrow down advances scroll by one line", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane({
    getLines: (_w) => content,
    tui: makeTui(),
    title: "T",
    getHeight: () => 5,
  });
  pane.handleInput("\x1b[B");
  assertEquals(pane.scrollOffset, 1);
});

Deno.test("ScrollPane: arrow up retreats scroll by one line", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane({
    getLines: (_w) => content,
    tui: makeTui(),
    title: "T",
    getHeight: () => 5,
  });
  pane.handleInput("\x1b[B");
  pane.handleInput("\x1b[A");
  assertEquals(pane.scrollOffset, 0);
});

Deno.test("ScrollPane: arrow down at bottom is no-op", () => {
  const content = Array.from({ length: 7 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane({
    getLines: (_w) => content,
    tui: makeTui(),
    title: "T",
    getHeight: () => 5,
  });
  pane.scrollToEnd();
  const before = pane.scrollOffset;
  pane.handleInput("\x1b[B");
  assertEquals(pane.scrollOffset, before);
});

Deno.test("ScrollPane: arrow up at top is no-op", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane({
    getLines: (_w) => content,
    tui: makeTui(),
    title: "T",
    getHeight: () => 5,
  });
  pane.handleInput("\x1b[A");
  assertEquals(pane.scrollOffset, 0);
});
