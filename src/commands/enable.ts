import { enableCron } from "../cron.ts";
import type { Command } from "./types.ts";

// Two levels up from src/commands/ reaches the project root, matching the
// path previously computed in src/index.ts with new URL("..", import.meta.url).
const lazboyDir = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

export const enable: Command = {
  name: "enable",
  description: "add cron job",
  async run(_args) {
    await enableCron(lazboyDir);
  },
};
