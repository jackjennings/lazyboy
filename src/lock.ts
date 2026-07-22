import { dirname, join } from "@std/path";
import { isProcessAlive } from "./executor.ts";

export interface Lock {
  withLock(fn: () => Promise<void>): Promise<void>;
}

const STALE_LOCK_MS = 30 * 60 * 1000;

async function appendTickLog(entry: object): Promise<void> {
  const home = Deno.env.get("HOME")!;
  const tickLogPath = join(home, ".lazyboy", "tick.ndjson");
  await Deno.mkdir(join(home, ".lazyboy"), { recursive: true });
  await Deno.writeTextFile(
    tickLogPath,
    JSON.stringify({ ts: Temporal.Now.instant().toString(), ...entry }) + "\n",
    { append: true },
  );
}

export class PidFileLock implements Lock {
  #pidFile: string;
  #isPidAlive: (pid: number) => boolean;

  constructor(
    pidFile: string,
    isPidAlive: (pid: number) => boolean = isProcessAlive,
  ) {
    this.#pidFile = pidFile;
    this.#isPidAlive = isPidAlive;
  }

  async withLock(fn: () => Promise<void>): Promise<void> {
    try {
      const existing = await Deno.readTextFile(this.#pidFile).catch(
        () => null,
      );
      if (existing) {
        const pid = parseInt(existing.trim(), 10);
        const alive = !isNaN(pid) && this.#isPidAlive(pid);
        if (alive) {
          const stat = await Deno.stat(this.#pidFile).catch(() => null);
          const ageMs = stat?.mtime
            ? Temporal.Now.instant().epochMilliseconds - stat.mtime.getTime()
            : 0;
          if (ageMs < STALE_LOCK_MS) {
            await appendTickLog({ event: "tick-already-running", pid });
            return;
          }
          await appendTickLog({
            event: "stale-lock",
            pid,
            thresholdMinutes: STALE_LOCK_MS / 60_000,
          });
        }
      }
      await Deno.mkdir(dirname(this.#pidFile), { recursive: true });
      await Deno.writeTextFile(this.#pidFile, String(Deno.pid));
    } catch (e) {
      await appendTickLog({
        event: "lock-failed",
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    try {
      await fn();
    } finally {
      await Deno.remove(this.#pidFile).catch(() => {});
    }
  }
}
