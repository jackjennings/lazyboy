import type { TicketState } from "./state/types.ts";

export function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "github/org/repo/1",
    provider: "github",
    title: "T",
    url: "https://github.com/org/repo/issues/1",
    phase: "intake",
    status: "new",
    approvals: [],
    scope: [],
    worktrees: {},
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-01T00:00:00Z",
    body: "",
    artifact: "pr",
    ...overrides,
  };
}

export function withLazyboyDir(): Disposable & { path: string } {
  const path = Deno.makeTempDirSync();
  const original = Deno.env.get("LAZYBOY_DIR");
  Deno.env.set("LAZYBOY_DIR", path);
  return {
    path,
    [Symbol.dispose]() {
      if (original !== undefined) {
        Deno.env.set("LAZYBOY_DIR", original);
      } else {
        Deno.env.delete("LAZYBOY_DIR");
      }
      try {
        Deno.removeSync(path, { recursive: true });
      } catch {
        // temp dir already removed
      }
    },
  };
}
