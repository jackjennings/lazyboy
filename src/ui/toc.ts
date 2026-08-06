import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export function extractHeadings(
  markdown: string,
): { level: number; title: string; sourceLine: number }[] {
  const results: { level: number; title: string; sourceLine: number }[] = [];
  for (const match of markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
    const sourceLine =
      (markdown.slice(0, match.index).match(/\n/g) ?? []).length;
    results.push({
      level: match[1].length,
      title: match[2].trim().replace(/[*_`]/g, ""),
      sourceLine,
    });
  }
  return results;
}

export function computeVisibleHeadingIndices({
  headings,
  scrollOffset,
  height,
  totalLines,
  totalSourceLines,
}: {
  headings: { sourceLine: number }[];
  scrollOffset: number;
  height: number;
  totalLines: number;
  totalSourceLines: number;
}): Set<number> {
  const visible = new Set<number>();
  if (totalSourceLines === 0 || totalLines === 0) return visible;
  for (let i = 0; i < headings.length; i++) {
    const start = Math.floor(
      (headings[i].sourceLine / totalSourceLines) * totalLines,
    );
    const end = i + 1 < headings.length
      ? Math.floor(
        (headings[i + 1].sourceLine / totalSourceLines) * totalLines,
      )
      : totalLines;
    if (end <= start) continue;
    if (end > scrollOffset && start < scrollOffset + height) {
      visible.add(i);
    }
  }
  return visible;
}

export function renderTocLines(
  headings: { level: number; title: string }[],
  tocWidth: number,
  visibleHeadingIndices?: Set<number>,
): string[] {
  const lines: string[] = [];
  for (let h = 0; h < headings.length; h++) {
    const { level, title } = headings[h];
    const indicator = visibleHeadingIndices?.has(h) ? "┃" : " ";
    const indent = "  ".repeat(level - 1);
    const prefix = `${indent}• `;
    const available = Math.max(1, tocWidth - 1 - prefix.length);
    const wrapped = wrapTextWithAnsi(title, available);
    lines.push(`${indicator}${prefix}${wrapped[0] ?? ""}`);
    const contIndent = `${indent}  `;
    for (let i = 1; i < wrapped.length; i++) {
      lines.push(`${indicator}${contIndent}${wrapped[i]}`);
    }
  }
  return lines;
}

export function compositeSideBySide(
  contentLines: string[],
  contentWidth: number,
  tocLines: string[],
  sep: string,
): string[] {
  const height = Math.max(contentLines.length, tocLines.length);
  const result: string[] = [];
  for (let i = 0; i < height; i++) {
    const left = truncateToWidth(contentLines[i] ?? "", contentWidth, "", true);
    const right = tocLines[i] ?? "";
    result.push(`${left}${sep}${right}`);
  }
  return result;
}

export function buildCompositedGetLines(
  contentGetLines: (width: number) => string[],
  headings: { level: number; title: string }[],
  sep: string,
): (width: number) => string[] {
  return (width: number) => {
    if (headings.length === 0 || width < 100) {
      return contentGetLines(width);
    }
    const tocWidth = Math.floor(width / 3);
    const contentWidth = width - tocWidth - 1;
    const contentLines = contentGetLines(contentWidth);
    const tocLines = renderTocLines(headings, tocWidth);
    return compositeSideBySide(contentLines, contentWidth, tocLines, sep);
  };
}
