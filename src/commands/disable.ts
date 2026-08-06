import { disableLaunchd } from "../launchd.ts";
import type { Command } from "./types.ts";

export const disable: Command = {
  name: "disable",
  description: "remove launchd job",
  async run(_args) {
    await disableLaunchd();
  },
};
