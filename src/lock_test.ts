import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { PidFileLock } from "./lock.ts";

Deno.test(
  "PidFileLock: acquires lock when no pid file exists, calls fn, removes pid file",
  async () => {
    const dir = await Deno.makeTempDir();
    const pidFile = join(dir, "lock.pid");
    let fnCalled = false;
    const lock = new PidFileLock(pidFile, () => false);
    await lock.withLock(() => {
      fnCalled = true;
      return Promise.resolve();
    });
    assertEquals(fnCalled, true);
    let pidExists = false;
    try {
      await Deno.stat(pidFile);
      pidExists = true;
    } catch { /* not found */ }
    assertEquals(pidExists, false);
  },
);

Deno.test(
  "PidFileLock: does not call fn when live pid file is fresh",
  async () => {
    const dir = await Deno.makeTempDir();
    const pidFile = join(dir, "lock.pid");
    await Deno.writeTextFile(pidFile, "999999");
    let fnCalled = false;
    const lock = new PidFileLock(pidFile, () => true);
    await lock.withLock(() => {
      fnCalled = true;
      return Promise.resolve();
    });
    assertEquals(fnCalled, false);
  },
);

Deno.test("PidFileLock: reclaims stale lock and calls fn", async () => {
  const dir = await Deno.makeTempDir();
  const pidFile = join(dir, "lock.pid");
  await Deno.writeTextFile(pidFile, "999999");
  const staleSeconds = Math.floor(Date.now() / 1000) - 31 * 60;
  await Deno.utime(pidFile, staleSeconds, staleSeconds);
  let fnCalled = false;
  const lock = new PidFileLock(pidFile, () => true);
  await lock.withLock(() => {
    fnCalled = true;
    return Promise.resolve();
  });
  assertEquals(fnCalled, true);
});

Deno.test("PidFileLock: removes pid file when fn throws", async () => {
  const dir = await Deno.makeTempDir();
  const pidFile = join(dir, "lock.pid");
  const lock = new PidFileLock(pidFile, () => false);
  await assertRejects(
    () => lock.withLock(() => Promise.reject(new Error("boom"))),
    Error,
    "boom",
  );
  let pidExists = false;
  try {
    await Deno.stat(pidFile);
    pidExists = true;
  } catch { /* not found */ }
  assertEquals(pidExists, false);
});
