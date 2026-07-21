import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { join } from "@std/path";
import { selfReview } from "./self-review.ts";

Deno.test("selfReview: returns false when no self-review prompt exists for phase", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(new Response("{}", { status: 200 })),
    );
    const result = await selfReview("spec", tempDir, fetcher);
    assertEquals(result, false);
    assertSpyCalls(fetcher, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: returns false when no phase output file is found", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(new Response("{}", { status: 200 })),
    );
    const result = await selfReview("intake", tempDir, fetcher);
    assertEquals(result, false);
    assertSpyCalls(fetcher, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: returns true when API responds APPROVE", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-intake.md"),
      "## Proposed Scope\n\n```yaml\nscope:\n  - /Users/jack/code/myorg/repo\n```\n\n## Reasoning\n\nThe ticket is about this repo.\n",
    );
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ content: [{ type: "text", text: "APPROVE" }] }),
            { status: 200 },
          ),
        ),
    );
    const result = await selfReview("intake", tempDir, fetcher);
    assertEquals(result, true);
    assertSpyCalls(fetcher, 1);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: returns false when API responds REJECT", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-intake.md"),
      "bad output",
    );
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ content: [{ type: "text", text: "REJECT" }] }),
            { status: 200 },
          ),
        ),
    );
    const result = await selfReview("intake", tempDir, fetcher);
    assertEquals(result, false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: returns false on non-OK HTTP status", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-intake.md"),
      "output",
    );
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(new Response("{}", { status: 500 })),
    );
    const result = await selfReview("intake", tempDir, fetcher);
    assertEquals(result, false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: returns false when fetch throws", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-intake.md"),
      "output",
    );
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.reject(new Error("network error")),
    );
    const result = await selfReview("intake", tempDir, fetcher);
    assertEquals(result, false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: sends output file content as user message", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const outputContent =
      "## Proposed Scope\n\n```yaml\nscope:\n  - /code/repo\n```\n\n## Reasoning\n\nSentence.\n";
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-intake.md"),
      outputContent,
    );
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ content: [{ type: "text", text: "APPROVE" }] }),
            { status: 200 },
          ),
        ),
    );
    await selfReview("intake", tempDir, fetcher);
    assertSpyCalls(fetcher, 1);
    const body = JSON.parse(fetcher.calls[0].args[1]!.body as string);
    assertEquals(body.messages[0].content, outputContent);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: uses intake-self-review.md content as system message", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-intake.md"),
      "output",
    );
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ content: [{ type: "text", text: "REJECT" }] }),
            { status: 200 },
          ),
        ),
    );
    await selfReview("intake", tempDir, fetcher);
    assertSpyCalls(fetcher, 1);
    const body = JSON.parse(fetcher.calls[0].args[1]!.body as string);
    assertEquals(typeof body.system, "string");
    assertEquals(body.system.includes("APPROVE"), true);
    assertEquals(body.system.includes("REJECT"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: requests model claude-haiku-4-5 with max_tokens 5", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-intake.md"),
      "output",
    );
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ content: [{ type: "text", text: "REJECT" }] }),
            { status: 200 },
          ),
        ),
    );
    await selfReview("intake", tempDir, fetcher);
    assertSpyCalls(fetcher, 1);
    const body = JSON.parse(fetcher.calls[0].args[1]!.body as string);
    assertEquals(body.model, "claude-haiku-4-5");
    assertEquals(body.max_tokens, 5);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: is case-insensitive for APPROVE response", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-intake.md"),
      "output",
    );
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ content: [{ type: "text", text: "approve" }] }),
            { status: 200 },
          ),
        ),
    );
    const result = await selfReview("intake", tempDir, fetcher);
    assertEquals(result, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: returns true for enrichment phase when output file exists and API responds APPROVE", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const enrichmentContent =
      "## Relevant Code\n\nFile: src/main.ts\n\n## Dependencies and Constraints\n\nDepends on deno runtime.\n\n## Open Questions\n\nNone at this time.\n";
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-enrichment.md"),
      enrichmentContent,
    );
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ content: [{ type: "text", text: "APPROVE" }] }),
            { status: 200 },
          ),
        ),
    );
    const result = await selfReview("enrichment", tempDir, fetcher);
    assertEquals(result, true);
    assertSpyCalls(fetcher, 1);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
