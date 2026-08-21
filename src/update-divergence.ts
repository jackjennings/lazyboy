import { join } from "@std/path";
import { urrasDir } from "./paths.ts";
import { mkdir, readTextFile, remove, writeTextFile } from "./filesystem.ts";
import type { Divergence } from "./commands/update.ts";

const STATE_FILE = "update-divergence.json";

function statePath(): string {
  return join(urrasDir(), STATE_FILE);
}

function commits(n: number): string {
  return n === 1 ? "1 commit" : `${n} commits`;
}

export function formatDivergenceMessage(divergence: Divergence): string {
  return `${commits(divergence.ahead)} ahead, ${
    commits(divergence.behind)
  } behind upstream. Self-update is paused; the tick is running local code.`;
}

export async function readLastDivergence(): Promise<Divergence | null> {
  let raw: string;
  try {
    raw = await readTextFile(statePath());
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Divergence;
    if (
      !Number.isInteger(parsed?.ahead) || !Number.isInteger(parsed?.behind)
    ) {
      return null;
    }
    return { ahead: parsed.ahead, behind: parsed.behind };
  } catch {
    return null;
  }
}

export async function writeLastDivergence(
  divergence: Divergence | null,
): Promise<void> {
  if (divergence === null) {
    try {
      await remove(statePath());
    } catch {
      // already absent
    }
    return;
  }
  await mkdir(urrasDir(), { recursive: true });
  await writeTextFile(statePath(), JSON.stringify(divergence));
}

export interface DivergenceNotifierDeps {
  notify: (title: string, message: string) => Promise<void>;
  readLast: () => Promise<Divergence | null>;
  writeLast: (divergence: Divergence | null) => Promise<void>;
}

export function makeDivergenceNotifier(
  deps: DivergenceNotifierDeps,
): (divergence: Divergence | null) => Promise<void> {
  return async (divergence) => {
    const last = await deps.readLast();
    if (divergence === null) {
      if (last !== null) await deps.writeLast(null);
      return;
    }
    if (
      last !== null && last.ahead === divergence.ahead &&
      last.behind === divergence.behind
    ) {
      return;
    }
    await deps.writeLast(divergence);
    try {
      await deps.notify(
        "lazyboy self-update paused",
        formatDivergenceMessage(divergence),
      );
    } catch {
      // a failed notification must not break the tick
    }
  };
}
