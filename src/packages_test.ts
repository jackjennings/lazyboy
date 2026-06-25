import { assertEquals } from "jsr:@std/assert";
import { installPackages } from "./packages.ts";

Deno.test("installPackages: empty list returns []", async () => {
  const calls: string[] = [];
  const out = await installPackages([], {
    run: async (s) => {
      calls.push(s);
      return { success: true, stderr: "" };
    },
  });
  assertEquals(out, []);
  assertEquals(calls, []);
});

Deno.test("installPackages: installs each source sequentially", async () => {
  const calls: string[] = [];
  const out = await installPackages(["a", "b", "c"], {
    run: async (s) => {
      calls.push(s);
      return { success: true, stderr: "" };
    },
  });
  assertEquals(calls, ["a", "b", "c"]);
  assertEquals(out.map((r) => r.success), [true, true, true]);
});

Deno.test("installPackages: skips already-installed sources", async () => {
  const calls: string[] = [];
  const out = await installPackages(["a", "b"], {
    run: async (s) => {
      calls.push(s);
      return { success: true, stderr: "" };
    },
    isInstalled: async (s) => s === "a",
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
      run: async (s) => {
        calls.push(s);
        return s === "b"
          ? { success: false, stderr: "boom" }
          : { success: true, stderr: "" };
      },
      warn: (m) => warned.push(m),
    });
    assertEquals(calls, ["a", "b", "c"]);
    assertEquals(out.map((r) => r.success), [true, false, true]);
    assertEquals(warned.length, 1);
  },
);
