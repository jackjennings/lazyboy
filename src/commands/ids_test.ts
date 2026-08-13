import { assertArrayIncludes, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { listCeremonyIds } from "./ids.ts";

Deno.test("listCeremonyIds: emits namespaced ceremony ids", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(stateDir, "ceremonies", "digest"), {
      recursive: true,
    });
    await Deno.mkdir(join(stateDir, "ceremonies", "documentation-gaps"), {
      recursive: true,
    });
    assertArrayIncludes(await listCeremonyIds(stateDir), ["ceremony/digest"]);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("listCeremonyIds: omits built-in ceremonies", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(stateDir, "ceremonies", "documentation-gaps"), {
      recursive: true,
    });
    assertEquals(await listCeremonyIds(stateDir), []);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});
