import { tick as runTick } from "../tick.ts";
import type { Command } from "./types.ts";

export const tick: Command = {
  name: "tick",
  description: "advance all active tickets",
  async run(_args) {
    await runTick();
  },
};
