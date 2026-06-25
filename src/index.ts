import { tick } from "./tick.ts";
import {
  commitState,
  commitTicket,
  listTickets,
  readTicket,
  writeTicket,
} from "./state/store.ts";
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
    updated: new Date().toISOString(),
  });
  await commitTicket(stateDir, id, `approve: ${id}`);
  console.log(`Approved ${id} (phase: ${ticket.phase})`);
} else if (command === "status") {
  const config = await loadConfig();
  const stateDir = expandHome(config.state.dir);
  const ids = await listTickets(stateDir);
  if (ids.length === 0) {
    console.log("No active tickets.");
    Deno.exit(0);
  }
  console.log(
    `${"ID".padEnd(20)} ${"PHASE".padEnd(25)} ${"WAITING".padEnd(8)} TITLE`,
  );
  console.log("-".repeat(80));
  for (const id of ids.sort()) {
    const t = await readTicket(stateDir, id);
    const waiting = t.phase.startsWith("waiting-") && !t.approved ? "YES" : "";
    console.log(
      `${t.id.padEnd(20)} ${t.phase.padEnd(25)} ${
        waiting.padEnd(8)
      } ${t.title}`,
    );
  }
} else if (command === "enable") {
  await enableCron(LAZYBOY_DIR);
} else if (command === "disable") {
  await disableCron();
} else {
  console.error("Usage: lazyboy <tick|approve|status|enable|disable>");
  Deno.exit(1);
}
