import type { TicketState } from "./state/types.ts";

export interface NotifyDeps {
  runCommand: (args: string[]) => Promise<{ code: number }>;
}

export function desktopNotificationArgs(
  opts: { title: string; message: string },
): string[] {
  return [
    "osascript",
    "-e",
    "on run argv",
    "-e",
    "display notification item 1 of argv with title item 2 of argv",
    "-e",
    "end run",
    "--",
    opts.message,
    opts.title,
  ];
}

export function makeDesktopNotifier(
  deps: NotifyDeps,
): (title: string, message: string) => Promise<void> {
  return async (title: string, message: string) => {
    await deps.runCommand(desktopNotificationArgs({ title, message }));
  };
}

export function makeNotify(
  deps: NotifyDeps,
): (ticket: TicketState) => Promise<void> {
  const notify = makeDesktopNotifier(deps);
  return (ticket: TicketState) =>
    notify(ticket.id, `${ticket.title} (${ticket.phase})`);
}
