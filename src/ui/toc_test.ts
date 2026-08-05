import { assertEquals } from "@std/assert";
import { stripAnsiCode } from "@std/fmt/colors";
import {
  buildCompositedGetLines,
  compositeSideBySide,
  extractHeadings,
  renderTocLines,
} from "./toc.ts";

// ── extractHeadings ───────────────────────────────────────────────────────────

Deno.test("extractHeadings: returns empty array for document with no headings", () => {
  assertEquals(extractHeadings("no headings here\njust text"), []);
});

Deno.test("extractHeadings: extracts H1 through H6", () => {
  const md = "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6";
  const headings = extractHeadings(md);
  assertEquals(headings.length, 6);
  assertEquals(headings[0], { level: 1, title: "H1" });
  assertEquals(headings[5], { level: 6, title: "H6" });
});

Deno.test("extractHeadings: captures level as hash count", () => {
  const headings = extractHeadings("## Second level");
  assertEquals(headings[0].level, 2);
});

Deno.test("extractHeadings: strips ** markers from title", () => {
  const headings = extractHeadings("# **Bold** heading");
  assertEquals(headings[0].title, "Bold heading");
});

Deno.test("extractHeadings: strips * _ and backtick markers from title", () => {
  const headings = extractHeadings("# *italic* and _under_ and `code`");
  assertEquals(headings[0].title, "italic and under and code");
});

Deno.test("extractHeadings: does not parse setext-style headings", () => {
  const md = "Not a heading\n==============\nAlso not\n----------";
  assertEquals(extractHeadings(md), []);
});

Deno.test("extractHeadings: requires space after hashes", () => {
  assertEquals(extractHeadings("##NoSpace"), []);
});

// ── renderTocLines ────────────────────────────────────────────────────────────

Deno.test("renderTocLines: returns empty array for empty headings", () => {
  assertEquals(renderTocLines([], 40), []);
});

Deno.test("renderTocLines: H1 has no indentation", () => {
  const lines = renderTocLines([{ level: 1, title: "Top" }], 40);
  assertEquals(lines[0], "• Top");
});

Deno.test("renderTocLines: H2 has 2-space indent", () => {
  const lines = renderTocLines([{ level: 2, title: "Sub" }], 40);
  assertEquals(lines[0], "  • Sub");
});

Deno.test("renderTocLines: H3 has 4-space indent", () => {
  const lines = renderTocLines([{ level: 3, title: "Deep" }], 40);
  assertEquals(lines[0], "    • Deep");
});

Deno.test("renderTocLines: H6 has 10-space indent", () => {
  const lines = renderTocLines([{ level: 6, title: "Six" }], 40);
  assertEquals(lines[0], "          • Six");
});

Deno.test("renderTocLines: uses bullet character •", () => {
  const lines = renderTocLines([{ level: 1, title: "X" }], 40);
  assertEquals(lines[0].includes("•"), true);
});

Deno.test("renderTocLines: long title wraps to continuation line", () => {
  const title =
    "A very long heading title that will not fit on one line at all";
  const lines = renderTocLines([{ level: 1, title }], 20);
  assertEquals(lines.length > 1, true);
});

Deno.test("renderTocLines: continuation lines aligned with text after bullet", () => {
  const title =
    "A very long heading title that will not fit on one line at all";
  const lines = renderTocLines([{ level: 2, title }], 20);
  // H2 indent = 2 spaces, continuation = indent + 2 spaces = 4 spaces
  assertEquals(lines.every((l, i) => i === 0 || l.startsWith("    ")), true);
});

Deno.test("renderTocLines: applies no styling to entries", () => {
  const lines = renderTocLines([{ level: 1, title: "Plain" }], 40);
  assertEquals(stripAnsiCode(lines[0]), lines[0]);
});

// ── compositeSideBySide ───────────────────────────────────────────────────────

Deno.test("compositeSideBySide: height equals max of content and toc lengths", () => {
  const content = ["a", "b", "c"];
  const toc = ["x", "y"];
  const result = compositeSideBySide(content, 10, toc, "|");
  assertEquals(result.length, 3);
});

Deno.test("compositeSideBySide: height equals toc length when toc is longer", () => {
  const content = ["a"];
  const toc = ["x", "y", "z"];
  const result = compositeSideBySide(content, 10, toc, "|");
  assertEquals(result.length, 3);
});

Deno.test("compositeSideBySide: separator appears in every row", () => {
  const content = ["hello", "world"];
  const toc = ["item"];
  const result = compositeSideBySide(content, 10, toc, "|");
  assertEquals(result.every((l) => l.includes("|")), true);
});

Deno.test("compositeSideBySide: pads short content lines to contentWidth", () => {
  const content = ["hi"];
  const toc = ["x"];
  const result = compositeSideBySide(content, 10, toc, "|");
  const beforeSep = result[0].split("|")[0];
  assertEquals(beforeSep.length, 10);
});

Deno.test("compositeSideBySide: rows past end of toc have separator then blank", () => {
  const content = ["a", "b", "c"];
  const toc = ["x"];
  const result = compositeSideBySide(content, 10, toc, "|");
  assertEquals(result[1].endsWith("|"), true);
  assertEquals(result[2].endsWith("|"), true);
});

// ── buildCompositedGetLines ───────────────────────────────────────────────────

Deno.test("buildCompositedGetLines: passes full width to contentGetLines when no headings", () => {
  let captured = 0;
  const getLines = (w: number) => {
    captured = w;
    return [];
  };
  const fn = buildCompositedGetLines(getLines, [], "|");
  fn(120);
  assertEquals(captured, 120);
});

Deno.test("buildCompositedGetLines: passes full width to contentGetLines when width < 100", () => {
  let captured = 0;
  const getLines = (w: number) => {
    captured = w;
    return [];
  };
  const fn = buildCompositedGetLines(getLines, [{ level: 1, title: "X" }], "|");
  fn(99);
  assertEquals(captured, 99);
});

Deno.test("buildCompositedGetLines: at width >= 100 with headings, passes contentWidth to contentGetLines", () => {
  let captured = 0;
  const getLines = (w: number) => {
    captured = w;
    return [];
  };
  const fn = buildCompositedGetLines(getLines, [{ level: 1, title: "X" }], "|");
  fn(120);
  const tocWidth = Math.floor(120 / 3);
  assertEquals(captured, 120 - tocWidth - 1);
});

Deno.test("buildCompositedGetLines: at width >= 100 with headings, returns composited lines containing separator", () => {
  const getLines = (_w: number) => ["content line"];
  const fn = buildCompositedGetLines(
    getLines,
    [{ level: 1, title: "Section" }],
    "|",
  );
  const lines = fn(120);
  assertEquals(lines.some((l) => l.includes("|")), true);
});

Deno.test("buildCompositedGetLines: at width exactly 100 shows TOC", () => {
  let captured = 0;
  const getLines = (w: number) => {
    captured = w;
    return [];
  };
  const fn = buildCompositedGetLines(getLines, [{ level: 1, title: "X" }], "|");
  fn(100);
  assertEquals(captured < 100, true);
});
