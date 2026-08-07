import type { TicketState } from "./state/types.ts";

export interface NotifyDeps {
  runCommand: (args: string[]) => Promise<{ code: number }>;
}

export function makeNotify(
  deps: NotifyDeps,
): (ticket: TicketState) => Promise<void> {
  return async (ticket: TicketState) => {
    const message = `${ticket.title} (${ticket.phase})`;
    await deps.runCommand([
      "osascript",
      "-e",
      `display notification "${message}" with title "${ticket.id}"`,
    ]);
  };
}
