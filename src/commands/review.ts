import type { Command } from "./types.ts";

export const review: Command = {
  name: "review",
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
