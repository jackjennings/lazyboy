import { disableCron } from "../cron.ts";
import type { Command } from "./types.ts";

export const disable: Command = {
  name: "disable",
  async run(_args) {
    await disableCron();
  },
};
