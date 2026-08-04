import { enableLaunchd } from "../launchd.ts";
import type { Command } from "./types.ts";

const lazboyDir = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

export const enable: Command = {
  name: "enable",
  description: "add launchd job",
  async run(_args) {
    await enableLaunchd(lazboyDir);
  },
};
