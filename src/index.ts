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
} else if (command === "_ids") {
  const config = await loadConfig();
  const stateDir = expandHome(config.state.dir);
  const ids = await listTickets(stateDir);
  for (const id of ids) {
    console.log(id);
  }
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
  console.log(`#compdef lazyboy

_lazyboy() {
  local state
  _arguments '1: :->cmd' '*: :->args'
  case $state in
    cmd)
      local commands
      commands=(
        'tick:advance all active tickets'
        'approve:approve the current phase gate'
        'status:show all active tickets'
        'enable:add cron job'
        'disable:remove cron job'
        'completion:print shell completion script'
      )
      _describe 'command' commands
      ;;
    args)
      case $words[2] in
        approve)
          compadd -- \${(f)"\$(lazyboy _ids 2>/dev/null)"}
          ;;
        completion)
          compadd -- zsh
          ;;
      esac
      ;;
  esac
}

compdef _lazyboy lazyboy`);
} else {
  console.error(
    "Usage: lazyboy <tick|approve|status|enable|disable|completion>",
  );
  Deno.exit(1);
}
