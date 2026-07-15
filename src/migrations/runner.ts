import type { TicketState } from "../state/types.ts";
import type { Migration } from "./types.ts";

export type MigrationFn = (
  stateDir: string,
  tickets: TicketState[],
) => Promise<TicketState[]>;

export interface MigrationRunnerDeps {
  listMigrationFiles(): Promise<string[]>;
  loadMigration(id: string): Promise<Migration>;
  readApplied(stateDir: string): Promise<string[]>;
  writeApplied(stateDir: string, ids: string[]): Promise<void>;
  writeTicket(stateDir: string, ticket: TicketState): Promise<void>;
}

export function createMigrationRunner(deps: MigrationRunnerDeps): MigrationFn {
  return async (stateDir, tickets) => {
    const applied = await deps.readApplied(stateDir);
    const known = await deps.listMigrationFiles();
    const appliedSet = new Set(applied);
    const unapplied = known.filter((id) => !appliedSet.has(id));

    if (unapplied.length === 0) return tickets;

    let current = [...tickets];
    for (const id of unapplied) {
      const migration = await deps.loadMigration(id);
      const next: TicketState[] = [];
      for (const ticket of current) {
        try {
          next.push(await migration.run(ticket, stateDir));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(
            `Migration ${id} failed on ticket ${ticket.id}: ${msg}`,
            { cause: e },
          );
        }
      }
      current = next;
    }

    for (const ticket of current) {
      await deps.writeTicket(stateDir, ticket);
    }
    await deps.writeApplied(stateDir, [...applied, ...unapplied]);

    return current;
  };
}
