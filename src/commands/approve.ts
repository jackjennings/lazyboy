import { commitTicket, readTicket, writeTicket } from "../state/store.ts";
import { expandHome, loadConfig } from "../config.ts";
import type { Command } from "./types.ts";

export const approve: Command = {
  name: "approve",
  async run(args) {
    const id = args[0];
    if (!id) {
      console.error("Usage: lazyboy approve <ticket-id>");
      Deno.exit(1);
    }
    const config = await loadConfig();
    const stateDir = expandHome(config.state.dir);
    const ticket = await readTicket(stateDir, id);
    await writeTicket(stateDir, {
      ...ticket,
      approved: true,
      updated: Temporal.Now.instant().toString(),
    });
    await commitTicket(stateDir, id, `approve: ${id}`);
    console.log(`Approved ${id} (phase: ${ticket.phase}/${ticket.status})`);
  },
};
