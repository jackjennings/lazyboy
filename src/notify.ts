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
    const entries = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((e): e is Record<string, unknown> => e !== null);

    const alreadyNotified = entries.some(
      (e) => e.type === "notified-needs-attention",
    );
    if (alreadyNotified) return;

    await deps.appendLog(stateDir, ticket.id, {
      type: "notified-needs-attention",
    });

    const lastWithReason = [...entries]
      .reverse()
      .find((e) => typeof e.reason === "string");
    const reason = lastWithReason ? String(lastWithReason.reason) : undefined;
    const message = reason
      ? `${ticket.title} (${ticket.phase}): ${reason}`
      : `${ticket.title} (${ticket.phase})`;

    await deps.runCommand([
      "osascript",
      "-e",
      `display notification "${message}" with title "${ticket.id}"`,
    ]);
  };
}
