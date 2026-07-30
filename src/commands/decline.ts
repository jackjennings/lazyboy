import {
  appendTicketLog,
  commitTicket,
  readTicket,
  writeTicket,
} from "../state/store.ts";
import { expandHome, loadConfig } from "../config.ts";
import type { TicketPhase } from "../state/types.ts";
import type { Command } from "./types.ts";

export async function performDecline(
  stateDir: string,
  id: string,
  reason?: string,
  commitFn = commitTicket,
): Promise<{ from: TicketPhase }> {
  const ticket = await readTicket(stateDir, id);
  const from = ticket.phase;

  const body = reason
    ? `${ticket.body}\n\n---\nDeclined: ${reason}`
    : ticket.body;

  await writeTicket(stateDir, {
    ...ticket,
    phase: "wont-do",
    status: "done",
    updated: Temporal.Now.instant().toString(),
    body,
  });

  await appendTicketLog(stateDir, id, {
    event: "phase-transition",
    from,
    to: "wont-do",
  });

  await commitFn(stateDir, id, `decline: ${id}`);

  return { from };
}

export const decline: Command = {
  name: "decline",
  description: "permanently exclude a ticket from the queue",
  usage: "lazyboy decline <ticket-id> [reason]",
  completesWith: "_ids",
  async run(args) {
    const id = args[0];
    if (!id) {
      console.error("Usage: lazyboy decline <ticket-id> [reason]");
      Deno.exit(1);
    }
    const config = await loadConfig();
    const stateDir = expandHome(config.state.dir);
    try {
      await performDecline(stateDir, id, args[1]);
    } catch (e) {
      if (e instanceof Error) {
        console.error(`Error: ${e.message}`);
      }
      Deno.exit(1);
    }
    console.log(`Declined ${id}`);
  },
};
