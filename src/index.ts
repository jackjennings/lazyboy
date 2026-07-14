import { tick } from "./tick.ts";
import {
  commitTicket,
  listTickets,
  readTicket,
  writeTicket,
} from "./state/store.ts";
import { FULL_PHASE_SEQUENCE } from "./phases/types.ts";
import { expandHome, loadConfig } from "./config.ts";
import { disableCron, enableCron } from "./cron.ts";

const LAZYBOY_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const command = Deno.args[0];

if (command === "tick") {
  await tick();
} else if (command === "approve") {
  const id = Deno.args[1];
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
} else if (command === "status") {
  const config = await loadConfig();
  const stateDir = expandHome(config.state.dir);
  const ids = await listTickets(stateDir);
  if (ids.length === 0) {
    console.log("No active tickets.");
    Deno.exit(0);
  }
  const tickets = await Promise.all(ids.map((id) => readTicket(stateDir, id)));
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
} else if (command === "enable") {
  await enableCron(LAZYBOY_DIR);
} else if (command === "disable") {
  await disableCron();
} else if (command === "_ids") {
  const config = await loadConfig();
  const stateDir = expandHome(config.state.dir);
  const ids = await listTickets(stateDir);
  for (const id of ids) {
    console.log(id);
  }
} else if (command === "review") {
  const id = Deno.args[1];
  if (!id) {
    console.error("Usage: lazyboy review <ticket-id>");
    Deno.exit(1);
  }
  const { review } = await import("./review.ts");
  await review(id);
} else if (command === "shell") {
  const id = Deno.args[1];
  if (!id) {
    console.error("Usage: lazyboy shell <ticket-id>");
    Deno.exit(1);
  }
  const config = await loadConfig();
  const stateDir = expandHome(config.state.dir);
  let ticket;
  try {
    ticket = await readTicket(stateDir, id);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  }
  const worktreeEntries = Object.values(ticket.worktrees);
  if (worktreeEntries.length === 0) {
    console.error(`No worktrees found for ${id}`);
    Deno.exit(1);
  }
  const worktreePath = worktreeEntries[0].path;
  let stat;
  try {
    stat = await Deno.stat(worktreePath);
  } catch {
    console.error(`shell: ${worktreePath}: not a directory`);
    Deno.exit(1);
  }
  if (!stat.isDirectory) {
    console.error(`shell: ${worktreePath}: not a directory`);
    Deno.exit(1);
  }
  const shellBin = Deno.env.get("SHELL") || "/bin/sh";
  const child = new Deno.Command(shellBin, {
    cwd: worktreePath,
    env: { ...Deno.env.toObject(), LAZYBOY_SUBSHELL: "1" },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const shellStatus = await child.status;
  Deno.exit(shellStatus.code);
} else if (command === "completion") {
  const shell = Deno.args[1];
  if (!shell) {
    console.error("Usage: lazyboy completion <zsh>");
    Deno.exit(1);
  }
  if (shell !== "zsh") {
    console.error(`Unsupported shell: ${shell}`);
    Deno.exit(1);
  }
  const scriptPath = new URL(`completion.${shell}`, import.meta.url).pathname;
  console.log(await Deno.readTextFile(scriptPath));
} else {
  console.error(
    "Usage: lazyboy <tick|approve|status|enable|disable|completion|review|shell>",
  );
  Deno.exit(1);
}
