import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { dim, stripAnsiCode } from "@std/fmt/colors";
import type { TUI } from "@earendil-works/pi-tui";
import { ScrollPane } from "./scroll-pane.ts";
import { computeVisibleHeadingIndices, renderTocLines } from "./toc.ts";

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

Deno.test("ScrollPane: header of the focused pane is undimmed", () => {
  const pane = new ScrollPane({
    getLines: (_w) => ["line"],
    tui: makeTui(),
    title: "status",
    getHeight: () => 5,
  });
  pane.focused = true;
  const header = pane.render(80)[0];
  assertEquals(header, stripAnsiCode(header));
});

Deno.test("ScrollPane: header of an unfocused pane is dimmed", () => {
  const pane = new ScrollPane({
    getLines: (_w) => ["line"],
    tui: makeTui(),
    title: "status",
    getHeight: () => 5,
  });
  pane.focused = false;
  const header = pane.render(80)[0];
  assertEquals(header, dim(stripAnsiCode(header)));
});

Deno.test("ScrollPane: repeated renders at one width wrap the lines once", () => {
  const getLines = spy((_w: number) => ["alpha", "beta"]);
  const pane = new ScrollPane({
    getLines,
    tui: makeTui(),
    title: "T",
    getHeight: () => 5,
  });
  pane.render(80);
  pane.render(80);
  pane.isAtEnd(80);
  pane.scrollToEnd();
  assertSpyCalls(getLines, 1);
});

Deno.test("ScrollPane: a width change re-wraps the lines", () => {
  const getLines = spy((_w: number) => ["alpha", "beta"]);
  const pane = new ScrollPane({
    getLines,
    tui: makeTui(),
    title: "T",
    getHeight: () => 5,
  });
  pane.render(80);
  pane.render(60);
  assertSpyCalls(getLines, 2);
});

Deno.test("ScrollPane: invalidate re-reads content on the next render", () => {
  let content = ["before"];
  const pane = new ScrollPane({
    getLines: (_w) => content,
    tui: makeTui(),
    title: "T",
    getHeight: () => 5,
  });
  pane.render(80);
  content = ["after"];
  pane.invalidate();
  assert(pane.render(80).some((l) => l.includes("after")));
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

Deno.test(
  "ScrollPane: 160-char line expands to 2 visual lines at width 80",
  () => {
    const longLine = "x".repeat(160);
    const pane = new ScrollPane({
      getLines: (_w) => [longLine],
      tui: makeTui(24, 80),
      title: "T",
      getHeight: () => 1,
    });
    const firstPage = pane.render(80);
    assertEquals(firstPage.length, 2);
    assertEquals(firstPage[1], "x".repeat(80));
    pane.handleInput(" ");
    const secondPage = pane.render(80);
    assertEquals(secondPage.length, 2);
    assertEquals(secondPage[1], "x".repeat(80));
  },
);

Deno.test("ScrollPane: scrollToEnd accounts for wrapped lines", () => {
  const longLine = "x".repeat(160);
  const pane = new ScrollPane({
    getLines: (_w) => [longLine],
    tui: makeTui(24, 80),
    title: "T",
    getHeight: () => 1,
  });
  pane.scrollToEnd();
  assertEquals(pane.render(80)[1], "x".repeat(80));
});

Deno.test(
  "ScrollPane: isAtEnd is false when wrapped line extends past viewport",
  () => {
    const longLine = "x".repeat(160);
    const pane = new ScrollPane({
      getLines: (_w) => [longLine],
      tui: makeTui(24, 80),
      title: "T",
      getHeight: () => 1,
    });
    assertFalse(pane.isAtEnd(80));
    pane.scrollToEnd();
    assert(pane.isAtEnd(80));
  },
);

Deno.test(
  "ScrollPane: no-whitespace line hard-wraps at width boundary",
  () => {
    const noSpaceLine = "a".repeat(160);
    const pane = new ScrollPane({
      getLines: (_w) => [noSpaceLine],
      tui: makeTui(24, 80),
      title: "T",
      getHeight: () => 5,
    });
    const rendered = pane.render(80);
    assertEquals(rendered.length, 6);
    const contentLines = rendered.slice(1);
    assertEquals(contentLines.length, 5);
    assert(contentLines.every((l) => l.length <= 80));
  },
);

Deno.test(
  "ScrollPane: expandLines falls back to newline split when width is 0",
  () => {
    const pane = new ScrollPane({
      getLines: (_w) => ["first\nsecond"],
      tui: makeTui(24, 0),
      title: "T",
      getHeight: () => 5,
    });
    const rendered = pane.render(0);
    assert(rendered.some((l) => l === "first"));
    assert(rendered.some((l) => l === "second"));
  },
);

Deno.test("ScrollPane: bare \\r is treated as a line break", () => {
  const pane = new ScrollPane({
    getLines: (_w) => ["before\rafter"],
    tui: makeTui(),
    title: "T",
    getHeight: () => 10,
  });
  const rendered = pane.render(80);
  assert(rendered.some((l) => l === "before"));
  assert(rendered.some((l) => l === "after"));
});

Deno.test("ScrollPane: pinned sidebar appears at row 0 after scrolling content", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane({
    getLines: (_w) => content,
    tui: makeTui(),
    title: "T",
    getHeight: () => 5,
    pinnedSidebar: (_w) => ["Section 1", "Section 2"],
    pinnedSidebarWidth: (_w) => 20,
  });
  pane.handleInput(" ");
  const rendered = pane.render(100);
  assert(rendered.some((l) => l.includes("Section 1")));
  assertFalse(rendered.some((l) => l.includes("line 0")));
});

Deno.test("ScrollPane: getLines receives effectiveContentWidth when sidebar is present", () => {
  let capturedWidth = 0;
  const pane = new ScrollPane({
    getLines: (w) => {
      capturedWidth = w;
      return ["x"];
    },
    tui: makeTui(),
    title: "T",
    getHeight: () => 10,
    pinnedSidebar: (_w) => ["toc"],
    pinnedSidebarWidth: (_w) => 30,
  });
  pane.render(100);
  assertEquals(capturedWidth, 69);
});

Deno.test("ScrollPane: no sidebar rendered when pinnedSidebarWidth returns 0", () => {
  const pane = new ScrollPane({
    getLines: (_w) => ["content"],
    tui: makeTui(),
    title: "T",
    getHeight: () => 10,
    pinnedSidebar: (_w) => ["toc entry"],
    pinnedSidebarWidth: (_w) => 0,
  });
  assertFalse(pane.render(80).some((l) => l.includes("|")));
});

Deno.test("ScrollPane: scrollToEnd accounts for effectiveContentWidth with sidebar", () => {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane({
    getLines: (_w) => content,
    tui: makeTui(24, 100),
    title: "T",
    getHeight: () => 5,
    pinnedSidebar: (_w) => ["toc"],
    pinnedSidebarWidth: (_w) => 29,
  });
  pane.scrollToEnd();
  assert(pane.render(100).some((l) => l.includes("line 19")));
});

Deno.test("ScrollPane: pinnedSidebar receives the computed sidebarWidth", () => {
  let capturedSidebarWidth = 0;
  const pane = new ScrollPane({
    getLines: (_w) => ["line"],
    tui: makeTui(),
    title: "T",
    getHeight: () => 10,
    pinnedSidebar: (w) => {
      capturedSidebarWidth = w;
      return ["toc"];
    },
    pinnedSidebarWidth: (_w) => 25,
  });
  pane.render(100);
  assertEquals(capturedSidebarWidth, 25);
});

Deno.test("ScrollPane: render pads to getHeight lines when content is short", () => {
  const pane = new ScrollPane({
    getLines: (_w) => ["line 0", "line 1"],
    tui: makeTui(),
    title: "T",
    getHeight: () => 10,
  });
  assertEquals(pane.render(80).length, 11);
});

Deno.test("ScrollPane: pinnedSidebar receives scrollState with scrollOffset totalLines height", () => {
  let capturedState:
    | { scrollOffset: number; totalLines: number; height: number }
    | undefined;
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane({
    getLines: (_w) => content,
    tui: makeTui(),
    title: "T",
    getHeight: () => 5,
    pinnedSidebar: (_w, state) => {
      capturedState = state;
      return ["toc"];
    },
    pinnedSidebarWidth: (_w) => 20,
  });
  pane.render(100);
  assertEquals(capturedState?.scrollOffset, 0);
  assertEquals(capturedState?.totalLines, 20);
  assertEquals(capturedState?.height, 5);
});

Deno.test("ScrollPane: pinnedSidebar scrollState reflects updated scrollOffset after scrolling", () => {
  let capturedOffset = -1;
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const pane = new ScrollPane({
    getLines: (_w) => content,
    tui: makeTui(),
    title: "T",
    getHeight: () => 5,
    pinnedSidebar: (_w, state) => {
      capturedOffset = state.scrollOffset;
      return ["toc"];
    },
    pinnedSidebarWidth: (_w) => 20,
  });
  pane.handleInput(" ");
  pane.render(100);
  assertEquals(capturedOffset, 5);
});

Deno.test("ScrollPane: title option renders static title in header", () => {
  const pane = new ScrollPane({
    title: "spec",
    getLines: () => [],
    tui: makeTui(),
    getHeight: () => 10,
  });
  const lines = pane.render(80);
  assertStringIncludes(stripAnsiCode(lines[0]), "spec");
});

Deno.test(
  "ScrollPane: getTitle is called on each render and its return value appears in the header",
  () => {
    let label = "intake";
    const getTitle = spy(() => label);
    const pane = new ScrollPane({
      getTitle,
      getLines: () => [],
      tui: makeTui(),
      getHeight: () => 10,
    });

    pane.render(80);
    assertSpyCalls(getTitle, 1);

    label = "spec";
    const lines = pane.render(80);
    assertSpyCalls(getTitle, 2);
    assertStringIncludes(stripAnsiCode(lines[0]), "spec");
  },
);

Deno.test("ScrollPane: ┃ indicator appears for visible heading via computeVisibleHeadingIndices", () => {
  const headings = [
    { level: 1, title: "Section A", sourceLine: 0 },
    { level: 1, title: "Section B", sourceLine: 50 },
  ];
  const totalSourceLines = 100;
  const pane = new ScrollPane({
    getLines: (_w) => Array.from({ length: 100 }, (_, i) => `line ${i}`),
    tui: makeTui(),
    title: "T",
    getHeight: () => 10,
    pinnedSidebar: (w, scrollState) =>
      renderTocLines(
        headings,
        w,
        computeVisibleHeadingIndices({
          headings,
          totalSourceLines,
          ...scrollState,
        }),
      ),
    pinnedSidebarWidth: (_w) => 25,
  });
  const rendered = pane.render(120);
  // Section A occupies rendered lines [0, 50); viewport [0, 10) overlaps → ┃
  assert(
    rendered.some((l) =>
      stripAnsiCode(l).includes("┃") && l.includes("Section A")
    ),
  );
  // Section B occupies rendered lines [50, 100); viewport [0, 10) does not overlap → space
  assertFalse(
    rendered.some((l) =>
      stripAnsiCode(l)[0] === "┃" && l.includes("Section B")
    ),
  );
});
