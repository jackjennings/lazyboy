import type { TicketState } from "./state/types.ts";

export interface NotifyDeps {
  readLog: (stateDir: string, id: string) => Promise<string>;
  appendLog: (stateDir: string, id: string, entry: object) => Promise<void>;
  runCommand: (args: string[]) => Promise<{ code: number }>;
}

export function makeNotify(
  stateDir: string,
  deps: NotifyDeps,
): (ticket: TicketState) => Promise<void> {
  return async (ticket: TicketState) => {
    const raw = await deps.readLog(stateDir, ticket.id);
    const alreadyNotified = raw
      .split("\n")
      .filter(Boolean)
      .some((line) => {
        try {
          return (JSON.parse(line) as Record<string, unknown>).type ===
            "notified-needs-attention";
        } catch {
          return false;
        }
      });
    if (alreadyNotified) return;
    await deps.appendLog(stateDir, ticket.id, {
      type: "notified-needs-attention",
    });
    const message = `${ticket.title} (${ticket.phase})`;
    await deps.runCommand([
      "osascript",
      "-e",
      `display notification "${message}" with title "lazyboy"`,
    ]);
  };
}
