export function parseTicketId(
  id: string,
): { org: string; repo: string; number: number } | null {
  const match = id.match(/^github\/([^/]+)\/([^/]+)\/(\d+)$/);
  if (!match) return null;
  return { org: match[1], repo: match[2], number: parseInt(match[3], 10) };
}

export function ticketIdFor(parts: {
  org: string;
  repo: string;
  number: number;
}): string {
  return `github/${parts.org}/${parts.repo}/${parts.number}`;
}

export function parsePrUrl(
  url: string,
): { org: string; repo: string; number: number } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { org: match[1], repo: match[2], number: parseInt(match[3], 10) };
}

export function parseIssueUrl(
  url: string,
): { org: string; repo: string; number: number } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (!match) return null;
  return { org: match[1], repo: match[2], number: parseInt(match[3], 10) };
}

export function slugOf(parts: { org: string; repo: string }): string {
  return `${parts.org}/${parts.repo}`;
}

export function extractGitHubSlug(url: string): string {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) throw new Error(`Cannot extract GitHub slug from URL: ${url}`);
  return match[1];
}

export function parseRemoteSlug(url: string): string | null {
  const match = url.match(/[:/]([^/:]+)\/([^/:]+?)(?:\.git)?$/);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

const SLUG_RE = /^([a-zA-Z0-9_.\-]+)\/([a-zA-Z0-9_.\-]+)$/;
const GITHUB_URL_RE = /^\/([^/]+)\/([^/]+)/;

export function resolveGitHubSlug(entry: string): string | null {
  if (entry.startsWith("https://github.com/")) {
    const path = entry.slice("https://github.com".length);
    const match = path.match(GITHUB_URL_RE);
    if (!match || !match[2]) return null;
    return `${match[1]}/${match[2]}`;
  }
  if (entry.startsWith("/") || entry.startsWith("~/")) return null;
  const match = entry.match(SLUG_RE);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}
