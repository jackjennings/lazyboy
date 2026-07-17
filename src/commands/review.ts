import type { Command } from "./types.ts";

export const review: Command = {
  name: "review",
  description: "review the latest phase output",
  completesWith: "_ids",
  async run(args) {
    const id = args[0];
    if (!id) {
      console.error("Usage: lazyboy review <ticket-id>");
      Deno.exit(1);
    }
    const { review: runReview } = await import("../review.ts");
    await runReview(id);
  },
};
