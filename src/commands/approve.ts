import { commitTicket, readTicket, writeTicket } from "../state/store.ts";
import { expandHome, loadConfig } from "../config.ts";
import type { ApprovalEntry } from "../state/types.ts";
import type { Command } from "./types.ts";
import { join } from "@std/path";
import { exists } from "../filesystem.ts";
import {
  ceremonyHash,
  readApprovals,
  writeApprovals,
} from "../ceremonies/approvals.ts";
import type { ApprovalRecord } from "../ceremonies/approvals.ts";
import { BUILT_IN_CEREMONY_NAMES } from "../ceremonies/types.ts";

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

export async function performApproveCeremony(
  stateDir: string,
  name: string,
  deps: {
    readApprovalsFn?: () => Promise<ApprovalRecord>;
    writeApprovalsFn?: (record: ApprovalRecord) => Promise<void>;
    hashFn?: (ceremonyDir: string) => Promise<string>;
  } = {},
): Promise<void> {
  if (BUILT_IN_CEREMONY_NAMES.includes(name)) {
    throw new Error(`${name} is a built-in ceremony and needs no approval`);
  }
  const ceremonyDir = join(stateDir, "ceremonies", name);
  if (!await exists(ceremonyDir)) {
    throw new Error(`No ceremony named ${name}`);
  }
  const readApprovalsFn = deps.readApprovalsFn ?? readApprovals;
  const writeApprovalsFn = deps.writeApprovalsFn ?? writeApprovals;
  const hashFn = deps.hashFn ?? ceremonyHash;
  const approvals = await readApprovalsFn();
  approvals[name] = {
    ...approvals[name],
    hash: await hashFn(ceremonyDir),
    approvedAt: Temporal.Now.instant().toString(),
    lastWarnedWindow: undefined,
  };
  await writeApprovalsFn(approvals);
}

export const approve: Command = {
  name: "approve",
  description: "approve the current phase gate",
  usage: "lazyboy approve <ticket-id|ceremony/<name>>",
  completesWith: "_ids",
  async run(args) {
    const id = args[0];
    if (!id) {
      console.error("Usage: lazyboy approve <ticket-id|ceremony/<name>>");
      Deno.exit(1);
    }
    const config = await loadConfig();
    const stateDir = expandHome(config.state.dir);
    if (id.startsWith("ceremony/")) {
      const name = id.slice("ceremony/".length);
      await performApproveCeremony(stateDir, name);
      console.log(`Approved ceremony ${name}`);
      return;
    }
    const ticket = await readTicket(stateDir, id);
    await performApprove(stateDir, id);
    console.log(`Approved ${id} (phase: ${ticket.phase}/${ticket.status})`);
  },
};
