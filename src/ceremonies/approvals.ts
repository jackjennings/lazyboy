import { isAbsolute, join, relative } from "@std/path";
import { lazyboyDir } from "../paths.ts";
import {
  mkdir,
  readDir,
  readFile,
  readLink,
  readTextFile,
  realPath,
  remove,
  rename,
  stat,
  writeTextFile,
} from "../filesystem.ts";

export interface CeremonyApproval {
  hash?: string;
  approvedAt?: string;
  lastWarnedWindow?: string;
}

export type ApprovalRecord = Record<string, CeremonyApproval>;

export const MAX_MANIFEST_FILES = 2000;
export const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;

export class CeremonyManifestLimitError extends Error {}

export class CorruptApprovalsError extends Error {}

function approvalsPath(): string {
  return join(lazyboyDir(), "ceremony-approvals.json");
}

async function sha256Bytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function sha256(text: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(text));
}

interface WalkState {
  base: string;
  realBase: string;
  visited: Set<string>;
  fileCount: number;
  byteCount: number;
}

async function isInsideBase(path: string, state: WalkState): Promise<boolean> {
  let real: string;
  try {
    real = await realPath(path);
  } catch {
    return false;
  }
  if (real === state.realBase) return true;
  const rel = relative(state.realBase, real);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

async function hashFileContents(
  path: string,
  state: WalkState,
): Promise<string> {
  state.fileCount += 1;
  if (state.fileCount > MAX_MANIFEST_FILES) {
    throw new CeremonyManifestLimitError(
      `ceremony directory holds more than ${MAX_MANIFEST_FILES} files`,
    );
  }
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return "<unreadable>";
  }
  state.byteCount += size;
  if (state.byteCount > MAX_MANIFEST_BYTES) {
    throw new CeremonyManifestLimitError(
      `ceremony directory holds more than ${MAX_MANIFEST_BYTES} bytes`,
    );
  }
  try {
    return await sha256Bytes(await readFile(path));
  } catch {
    return "<unreadable>";
  }
}

export interface CeremonyManifestEntry {
  path: string;
  detail: string;
}

export function manifestLine(entry: CeremonyManifestEntry): string {
  return `${entry.path} ${entry.detail}`;
}

async function collectManifestEntries(
  dir: string,
  state: WalkState,
): Promise<CeremonyManifestEntry[]> {
  const realDir = await realPath(dir);
  if (state.visited.has(realDir)) return [];
  state.visited.add(realDir);

  const dirEntries: Deno.DirEntry[] = [];
  for await (const entry of readDir(dir)) dirEntries.push(entry);
  dirEntries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const entries: CeremonyManifestEntry[] = [];
  for (const entry of dirEntries) {
    const full = join(dir, entry.name);
    const path = relative(state.base, full);

    if (entry.isDirectory) {
      entries.push(...await collectManifestEntries(full, state));
    } else if (entry.isFile) {
      entries.push({ path, detail: await hashFileContents(full, state) });
    } else if (entry.isSymlink) {
      const target = await readLink(full);
      let linkStat: Deno.FileInfo;
      try {
        linkStat = await stat(full);
      } catch {
        entries.push({ path, detail: `-> ${target}` });
        continue;
      }
      if (linkStat.isDirectory) {
        const inside = await isInsideBase(full, state);
        entries.push({
          path,
          detail: inside ? `-> ${target}` : `-> ${target} <unsupported>`,
        });
        if (inside) {
          entries.push(...await collectManifestEntries(full, state));
        }
      } else if (linkStat.isFile) {
        entries.push({
          path,
          detail: `-> ${target} ${await hashFileContents(full, state)}`,
        });
      } else {
        entries.push({ path, detail: `-> ${target} <unsupported>` });
      }
    } else {
      entries.push({ path, detail: "<unsupported>" });
    }
  }
  return entries;
}

export async function ceremonyManifest(
  ceremonyDir: string,
): Promise<CeremonyManifestEntry[]> {
  const state: WalkState = {
    base: ceremonyDir,
    realBase: await realPath(ceremonyDir),
    visited: new Set(),
    fileCount: 0,
    byteCount: 0,
  };
  const entries = await collectManifestEntries(ceremonyDir, state);
  return entries.sort((a, b) => {
    const left = manifestLine(a);
    const right = manifestLine(b);
    if (left < right) return -1;
    return left > right ? 1 : 0;
  });
}

export async function ceremonyHash(ceremonyDir: string): Promise<string> {
  const entries = await ceremonyManifest(ceremonyDir);
  return `sha256:${await sha256(entries.map(manifestLine).join("\n"))}`;
}

export async function readApprovals(): Promise<ApprovalRecord> {
  let raw: string;
  try {
    raw = await readTextFile(approvalsPath());
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return {};
    throw e;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CorruptApprovalsError(
      `${approvalsPath()} is not valid JSON; repair or remove it by hand`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CorruptApprovalsError(
      `${approvalsPath()} does not hold a ceremony approval record`,
    );
  }
  return parsed as ApprovalRecord;
}

export async function writeApprovals(record: ApprovalRecord): Promise<void> {
  await mkdir(lazyboyDir(), { recursive: true });
  const path = approvalsPath();
  const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeTextFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`);
    await rename(temporaryPath, path);
  } catch (e) {
    try {
      await remove(temporaryPath);
    } catch {
      // the temporary file may never have been created
    }
    throw e;
  }
}

export async function isCeremonyApproved(
  name: string,
  ceremonyDir: string,
): Promise<boolean> {
  try {
    const entry = (await readApprovals())[name];
    if (!entry?.hash) return false;
    return entry.hash === await ceremonyHash(ceremonyDir);
  } catch {
    return false;
  }
}
