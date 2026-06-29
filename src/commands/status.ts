import { listTickets, readTicket } from "../state/store.ts";
import { expandHome, loadConfig } from "../config.ts";
import { FULL_PHASE_SEQUENCE } from "../phases/types.ts";
import type { Command } from "./types.ts";

export const status: Command = {
  name: "status",
  async run(_args) {
    const config = await loadConfig();
    const stateDir = expandHome(config.state.dir);
    const ids = await listTickets(stateDir);
    if (ids.length === 0) {
      console.log("No active tickets.");
      Deno.exit(0);
    }
    const tickets = await Promise.all(
      ids.map((id) => readTicket(stateDir, id)),
    );
    tickets.sort((a, b) => {
      const aIdx = FULL_PHASE_SEQUENCE.indexOf(
        a.phase as typeof FULL_PHASE_SEQUENCE[number],
      );
      const bIdx = FULL_PHASE_SEQUENCE.indexOf(
        b.phase as typeof FULL_PHASE_SEQUENCE[number],
      );
      const ai = aIdx === -1 ? FULL_PHASE_SEQUENCE.length : aIdx;
      const bi = bIdx === -1 ? FULL_PHASE_SEQUENCE.length : bIdx;
      if (ai !== bi) return ai - bi;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    console.log(
      `${"ID".padEnd(20)} ${"PHASE".padEnd(16)} ${"STATUS".padEnd(17)} ${
        "APPROVED".padEnd(9)
      } TITLE`,
    );
    console.log("-".repeat(90));
    for (const t of tickets) {
      console.log(
        `${t.id.padEnd(20)} ${t.phase.padEnd(16)} ${t.status.padEnd(17)} ${
          (t.approved ? "yes" : "no").padEnd(9)
        } ${t.title}`,
      );
    }
  },
};
