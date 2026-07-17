import { disableCron } from "../cron.ts";
import type { Command } from "./types.ts";

export const disable: Command = {
  name: "disable",
  description: "remove cron job",
  async run(_args) {
    await disableCron();
  },
};
