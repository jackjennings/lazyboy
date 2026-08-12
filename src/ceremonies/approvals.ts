import { join, relative } from "@std/path";
import { lazyboyDir } from "../paths.ts";
import { mkdir, readDir, readTextFile, writeTextFile } from "../filesystem.ts";

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

async function collectFiles(dir: string, base: string): Promise<string[]> {
  const paths: string[] = [];
  for await (const entry of readDir(dir)) {
    const full = join(dir, entry.name);
    if (entry.isDirectory) {
      if (dir === base && entry.name === "output") continue;
      paths.push(...await collectFiles(full, base));
    } else if (entry.isFile) {
      paths.push(relative(base, full));
    }
  }
  return paths;
}

export async function ceremonyHash(ceremonyDir: string): Promise<string> {
  const files = (await collectFiles(ceremonyDir, ceremonyDir)).sort();
  const lines: string[] = [];
  for (const path of files) {
    lines.push(
      `${path} ${await sha256(await readTextFile(join(ceremonyDir, path)))}`,
    );
  }
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
