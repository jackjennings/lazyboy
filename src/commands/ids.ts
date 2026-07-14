import { listTickets } from "../state/store.ts";
import { expandHome, loadConfig } from "../config.ts";
import type { Command } from "./types.ts";

export const ids: Command = {
  name: "_ids",
  async run(_args) {
    const config = await loadConfig();
    const stateDir = expandHome(config.state.dir);
    const ticketIds = await listTickets(stateDir);
    for (const id of ticketIds) {
      console.log(id);
    }
  },
};
