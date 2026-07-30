import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export function extractHeadings(
  markdown: string,
): { level: number; title: string }[] {
  const results: { level: number; title: string }[] = [];
  for (const match of markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
    results.push({
      level: match[1].length,
      title: match[2].trim().replace(/[*_`]/g, ""),
    });
  }
  return results;
}

export function renderTocLines(
  headings: { level: number; title: string }[],
  tocWidth: number,
): string[] {
  const lines: string[] = [];
  for (const { level, title } of headings) {
    const indent = "  ".repeat(level - 1);
    const prefix = `${indent}• `;
    const available = Math.max(1, tocWidth - prefix.length);
    const wrapped = wrapTextWithAnsi(title, available);
    lines.push(`${prefix}${wrapped[0] ?? ""}`);
    const contIndent = `${indent}  `;
    for (let i = 1; i < wrapped.length; i++) {
      lines.push(`${contIndent}${wrapped[i]}`);
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
