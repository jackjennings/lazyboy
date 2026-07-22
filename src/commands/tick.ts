import { loadConfig } from "../config.ts";
import { composeTickDeps } from "../compose.ts";
import { TickService } from "../tick.ts";
import type { Command } from "./types.ts";

export const tick: Command = {
  name: "tick",
  description: "advance all active tickets",
  async run(_args) {
    const config = await loadConfig();
    const deps = composeTickDeps(config);
    await new TickService(deps).run();
  },
};
