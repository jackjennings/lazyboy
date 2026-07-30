import { commitTicket, readTicket, writeTicket } from "../state/store.ts";
import { expandHome, loadConfig } from "../config.ts";
import type { ApprovalEntry } from "../state/types.ts";
import type { Command } from "./types.ts";

export async function performApprove(
  stateDir: string,
  id: string,
  commitFn = commitTicket,
): Promise<void> {
  const ticket = await readTicket(stateDir, id);
  const now = Temporal.Now.instant().toString();
  const entry: ApprovalEntry = {
    timestamp: now,
    actor: "human",
    phase: ticket.phase,
  };
  await writeTicket(stateDir, {
    ...ticket,
    approvals: [...ticket.approvals, entry],
    updated: now,
  });
  await commitFn(stateDir, id, `approve: ${id}`);
}

export const approve: Command = {
  name: "approve",
  description: "approve the current phase gate",
  usage: "lazyboy approve <ticket-id>",
  completesWith: "_ids",
  async run(args) {
    const id = args[0];
    if (!id) {
      console.error("Usage: lazyboy approve <ticket-id>");
      Deno.exit(1);
    }
    const config = await loadConfig();
    const stateDir = expandHome(config.state.dir);
    const ticket = await readTicket(stateDir, id);
    await performApprove(stateDir, id);
    console.log(`Approved ${id} (phase: ${ticket.phase}/${ticket.status})`);
  },
};
