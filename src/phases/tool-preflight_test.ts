import { assertArrayIncludes, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { checkToolAvailability, TOOL_REQUIREMENTS } from "./tool-preflight.ts";

Deno.test("TOOL_REQUIREMENTS: notion has binary and envVar", () => {
  const req = TOOL_REQUIREMENTS["notion"];
  assertEquals(req?.binary, "notion-fetch");
  assertEquals(req?.envVar, "NOTION_TOKEN");
});

Deno.test(
  "checkToolAvailability: empty partials list passes",
  async () => {
    const result = await checkToolAvailability([], "/some/path", {});
    assertEquals(result, { ok: true });
  },
);

Deno.test(
  "checkToolAvailability: partial not in manifest passes silently",
  async () => {
    const result = await checkToolAvailability(
      ["principles"],
      "/nonexistent/path",
      {},
    );
    assertEquals(result, { ok: true });
  },
);

Deno.test(
  "checkToolAvailability: binary not found returns binary failure",
  async () => {
    const result = await checkToolAvailability(
      ["notion"],
      "/nonexistent/path",
      { NOTION_TOKEN: "secret" },
    );
    assertEquals(result, {
      ok: false,
      tool: "notion",
      missing: "binary",
      name: "notion-fetch",
    });
  },
);

Deno.test(
  "checkToolAvailability: binary found env var absent returns env-var failure",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(dir, "notion-fetch"), "#!/bin/sh\n");
      const result = await checkToolAvailability(["notion"], dir, {});
      assertEquals(result, {
        ok: false,
        tool: "notion",
        missing: "env-var",
        name: "NOTION_TOKEN",
      });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "checkToolAvailability: binary found env var empty returns env-var failure",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(dir, "notion-fetch"), "#!/bin/sh\n");
      const result = await checkToolAvailability(["notion"], dir, {
        NOTION_TOKEN: "",
      });
      assertEquals(result, {
        ok: false,
        tool: "notion",
        missing: "env-var",
        name: "NOTION_TOKEN",
      });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "checkToolAvailability: binary found on second PATH segment",
  async () => {
    const dir1 = await Deno.makeTempDir();
    const dir2 = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(dir2, "notion-fetch"), "#!/bin/sh\n");
      const result = await checkToolAvailability(
        ["notion"],
        `${dir1}:${dir2}`,
        { NOTION_TOKEN: "secret" },
      );
      assertEquals(result, { ok: true });
    } finally {
      await Deno.remove(dir1, { recursive: true });
      await Deno.remove(dir2, { recursive: true });
    }
  },
);

Deno.test(
  "checkToolAvailability: binary found and env set returns ok",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(dir, "notion-fetch"), "#!/bin/sh\n");
      const result = await checkToolAvailability(
        ["notion"],
        dir,
        { NOTION_TOKEN: "secret" },
      );
      assertEquals(result, { ok: true });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "checkToolAvailability: stops at first failing partial",
  async () => {
    const result = await checkToolAvailability(
      ["notion", "principles"],
      "/nonexistent",
      {},
    );
    assertEquals(result, {
      ok: false,
      tool: "notion",
      missing: "binary",
      name: "notion-fetch",
    });
  },
);

Deno.test(
  "checkToolAvailability: directory at binary path does not satisfy binary check",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(join(dir, "notion-fetch"));
      const result = await checkToolAvailability(
        ["notion"],
        dir,
        { NOTION_TOKEN: "secret" },
      );
      assertEquals(result, {
        ok: false,
        tool: "notion",
        missing: "binary",
        name: "notion-fetch",
      });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "checkToolAvailability: unknown partial names alongside known ones are skipped",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(dir, "notion-fetch"), "#!/bin/sh\n");
      const result = await checkToolAvailability(
        ["agents-md-update", "notion", "principles"],
        dir,
        { NOTION_TOKEN: "secret" },
      );
      assertEquals(result, { ok: true });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "TOOL_REQUIREMENTS: keys are valid partial names",
  () => {
    const keys = Object.keys(TOOL_REQUIREMENTS);
    assertArrayIncludes(keys, ["notion"]);
  },
);
