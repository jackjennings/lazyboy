import { assertEquals } from "@std/assert";
import { installPackages } from "./packages.ts";

Deno.test("installPackages: empty list returns []", async () => {
  const calls: string[] = [];
  const out = await installPackages([], {
    run: (s) => {
      calls.push(s);
      return Promise.resolve({ success: true, stderr: "" });
    },
    isInstalled: () => Promise.resolve(false),
  });
  assertEquals(out, []);
  assertEquals(calls, []);
});

Deno.test("installPackages: installs each source sequentially", async () => {
  const calls: string[] = [];
  const out = await installPackages(["a", "b", "c"], {
    run: (s) => {
      calls.push(s);
      return Promise.resolve({ success: true, stderr: "" });
    },
    isInstalled: () => Promise.resolve(false),
  });
  assertEquals(calls, ["a", "b", "c"]);
  assertEquals(out.map((r) => r.success), [true, true, true]);
});

Deno.test("installPackages: skips already-installed sources", async () => {
  const calls: string[] = [];
  const out = await installPackages(["a", "b"], {
    run: (s) => {
      calls.push(s);
      return Promise.resolve({ success: true, stderr: "" });
    },
    isInstalled: (s) => Promise.resolve(s === "a"),
  });
  assertEquals(calls, ["b"]);
  assertEquals(out, [
    { source: "a", success: true },
    { source: "b", success: true },
  ]);
});

Deno.test(
  "installPackages: failure on one source does not abort remaining",
  async () => {
    const warned: string[] = [];
    const calls: string[] = [];
    const out = await installPackages(["a", "b", "c"], {
      run: (s) => {
        calls.push(s);
        return Promise.resolve(
          s === "b"
            ? { success: false, stderr: "boom" }
            : { success: true, stderr: "" },
        );
      },
      isInstalled: () => Promise.resolve(false),
    });
    assertEquals(calls, ["a", "b", "c"]);
    assertEquals(out.map((r) => r.success), [true, false, true]);
    assertEquals(warned.length, 1);
  },
);
