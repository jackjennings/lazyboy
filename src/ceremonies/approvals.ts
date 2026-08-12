import { join, relative } from "@std/path";
import { lazyboyDir } from "../paths.ts";
import {
  mkdir,
  readDir,
  readLink,
  readTextFile,
  stat,
  writeTextFile,
} from "../filesystem.ts";

export interface CeremonyApproval {
  hash?: string;
  approvedAt?: string;
  lastWarnedWindow?: string;
}

export type ApprovalRecord = Record<string, CeremonyApproval>;

function approvalsPath(): string {
  return join(lazyboyDir(), "ceremony-approvals.json");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function collectManifestLines(
  dir: string,
  base: string,
  visited: Set<string> = new Set(),
): Promise<string[]> {
  const realDir = await Deno.realPath(dir);
  if (visited.has(realDir)) {
    return [];
  }
  visited.add(realDir);

  const lines: string[] = [];
  for await (const entry of readDir(dir)) {
    const full = join(dir, entry.name);
    const rel = relative(base, full);

    if (entry.isDirectory) {
      if (dir === base && entry.name === "output") continue;
      lines.push(...await collectManifestLines(full, base, visited));
    } else if (entry.isFile) {
      const contentHash = await sha256(await readTextFile(full));
      lines.push(`${rel} ${contentHash}`);
    } else if (entry.isSymlink) {
      const target = await readLink(full);
      try {
        const fileStat = await stat(full);
        if (fileStat.isDirectory) {
          lines.push(`${rel} -> ${target}`);
          lines.push(...await collectManifestLines(full, base, visited));
        } else if (fileStat.isFile) {
          const contentHash = await sha256(await readTextFile(full));
          lines.push(`${rel} -> ${target} ${contentHash}`);
        }
      } catch {
        lines.push(`${rel} -> ${target}`);
      }
    }
  }
  return lines;
}

export async function ceremonyHash(ceremonyDir: string): Promise<string> {
  const lines = (await collectManifestLines(ceremonyDir, ceremonyDir)).sort();
  return `sha256:${await sha256(lines.join("\n"))}`;
}

export async function readApprovals(): Promise<ApprovalRecord> {
  try {
    return JSON.parse(await readTextFile(approvalsPath())) as ApprovalRecord;
  } catch {
    return {};
  }
}

export async function writeApprovals(record: ApprovalRecord): Promise<void> {
  await mkdir(lazyboyDir(), { recursive: true });
  await writeTextFile(approvalsPath(), `${JSON.stringify(record, null, 2)}\n`);
}

export async function isCeremonyApproved(
  name: string,
  ceremonyDir: string,
): Promise<boolean> {
  const entry = (await readApprovals())[name];
  if (!entry?.hash) return false;
  return entry.hash === await ceremonyHash(ceremonyDir);
}
