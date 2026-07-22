import { dirname } from "@std/path";
import { isProcessAlive } from "./executor.ts";

export interface Lock {
  withLock(fn: () => Promise<void>): Promise<void>;
}

export interface PidFileLockDeps {
  log: (entry: object) => Promise<void>;
  isPidAlive?: (pid: number) => boolean;
}

const STALE_LOCK_MS = 30 * 60 * 1000;

export class PidFileLock implements Lock {
  #pidFile: string;
  #log: (entry: object) => Promise<void>;
  #isPidAlive: (pid: number) => boolean;

  constructor(pidFile: string, deps: PidFileLockDeps) {
    this.#pidFile = pidFile;
    this.#log = deps.log;
    this.#isPidAlive = deps.isPidAlive ?? isProcessAlive;
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
            await this.#log({ event: "tick-already-running", pid });
            return;
          }
          await this.#log({
            event: "stale-lock",
            pid,
            thresholdMinutes: STALE_LOCK_MS / 60_000,
          });
        }
      }
      await Deno.mkdir(dirname(this.#pidFile), { recursive: true });
      await Deno.writeTextFile(this.#pidFile, String(Deno.pid));
    } catch (e) {
      await this.#log({
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
