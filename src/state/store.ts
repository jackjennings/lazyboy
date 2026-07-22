import matter from "gray-matter";
import { join } from "@std/path";
import {
  assertValidPhaseStatus,
  type PrEntry,
  type TicketPhase,
  type TicketState,
  type TicketStatus,
  type WorktreeInfo,
} from "./types.ts";

function migratePhase(oldPhase: string): [TicketPhase, TicketStatus] {
  const table: Record<string, [TicketPhase, TicketStatus]> = {
    "new": ["intake", "new"],
    "running-intake": ["intake", "running"],
    "waiting-intake": ["intake", "waiting"],
    "running-enrichment": ["enrichment", "running"],
    "waiting-enrichment": ["enrichment", "waiting"],
    "running-spec": ["spec", "running"],
    "waiting-spec": ["spec", "waiting"],
    "running-plan": ["plan", "running"],
    "waiting-plan": ["plan", "waiting"],
    "running-implementation": ["implementation", "running"],
    "waiting-diff": ["implementation", "waiting"],
    "waiting-merge": ["merge", "waiting"],
    "needs-attention": ["intake", "needs-attention"],
    "done": ["merge", "done"],
  };
  const result = table[oldPhase];
  if (!result) throw new Error(`Unknown legacy phase: ${oldPhase}`);
  return result;
}

export async function readTicket(
  stateDir: string,
  id: string,
): Promise<TicketState> {
  const metaPath = join(stateDir, id, "meta.md");
  const raw = await Deno.readTextFile(metaPath);
  const { data, content } = matter(raw);

  let phase: TicketPhase;
  let status: TicketStatus;
  const needsMigration = data.status === undefined;

  if (needsMigration) {
    [phase, status] = migratePhase(data.phase as string);
  } else {
    phase = data.phase as TicketPhase;
    status = data.status as TicketStatus;
  }

  assertValidPhaseStatus(phase, status);

  const worktreesRaw = data.worktrees as
    | Record<string, { path: string; branch: string }>
    | undefined;
  const worktrees: Record<string, WorktreeInfo> = {};
  if (worktreesRaw) {
    for (const [slug, info] of Object.entries(worktreesRaw)) {
      worktrees[slug] = { path: info.path, branch: info.branch };
    }
  }

  const prs = data.prs as PrEntry[] | undefined;

  const ticket: TicketState = {
    id: data.id,
    provider: data.provider,
    title: data.title,
    url: data.url,
    phase,
    status,
    approved: data.approved ?? false,
    scope: data.scope ?? [],
    worktrees,
    prs,
    created: data.created,
    updated: data.updated,
    body: content.trim(),
    phases: data.phases as TicketState["phases"],
  };

  if (needsMigration) {
    await writeTicket(stateDir, ticket);
  }

  return ticket;
}

export async function writeTicket(
  stateDir: string,
  ticket: TicketState,
): Promise<void> {
  assertValidPhaseStatus(ticket.phase, ticket.status);
  const dir = join(stateDir, ticket.id);
  await Deno.mkdir(dir, { recursive: true });
  const frontmatter: Record<string, unknown> = {
    id: ticket.id,
    provider: ticket.provider,
    title: ticket.title,
    url: ticket.url,
    phase: ticket.phase,
    status: ticket.status,
    approved: ticket.approved,
    scope: ticket.scope,
    worktrees: ticket.worktrees,
    created: ticket.created,
    updated: ticket.updated,
  };
  if (ticket.prs !== undefined) frontmatter.prs = ticket.prs;
  if (ticket.phases !== undefined) frontmatter.phases = ticket.phases;
  const raw = matter.stringify(ticket.body, frontmatter);
  await Deno.writeTextFile(join(dir, "meta.md"), raw);
}

export async function writePhaseOutput(
  stateDir: string,
  id: string,
  filename: string,
  content: string,
): Promise<void> {
  await Deno.writeTextFile(join(stateDir, id, filename), content);
}

export function readPhaseOutput(
  stateDir: string,
  id: string,
  filename: string,
): Promise<string> {
  return Deno.readTextFile(join(stateDir, id, filename));
}

async function walkStateDir(
  dir: string,
  relPath: string,
  depth: number,
  ids: string[],
): Promise<void> {
  if (depth > 4) return;
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isDirectory || entry.name.startsWith(".")) continue;
    const entryDir = join(dir, entry.name);
    const entryRel = relPath ? `${relPath}/${entry.name}` : entry.name;
    let hasMeta = false;
    try {
      await Deno.stat(join(entryDir, "meta.md"));
      hasMeta = true;
      // deno-lint-ignore no-empty
    } catch {}
    if (hasMeta) {
      ids.push(entryRel);
    } else {
      await walkStateDir(entryDir, entryRel, depth + 1, ids);
    }
  }
}

export async function listTickets(stateDir: string): Promise<string[]> {
  const ids: string[] = [];
  try {
    await walkStateDir(stateDir, "", 1, ids);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return ids;
}

export async function appendTicketLog(
  stateDir: string,
  id: string,
  entry: object,
): Promise<void> {
  await Deno.writeTextFile(
    join(stateDir, id, "log.ndjson"),
    JSON.stringify({ ts: Temporal.Now.instant().toString(), ...entry }) + "\n",
    { append: true },
  );
}

export async function commitState(
  stateDir: string,
  message: string,
): Promise<void> {
  const run = (cmd: string[]) =>
    new Deno.Command(cmd[0], { args: cmd.slice(1), cwd: stateDir }).output();
  await run(["git", "add", "-A"]);
  const result = await run(["git", "commit", "-m", message]);
  if (result.code !== 0) {
    const stderr = new TextDecoder().decode(result.stderr);
    const stdout = new TextDecoder().decode(result.stdout);
    if (
      !stderr.includes("nothing to commit") &&
      !stdout.includes("nothing to commit")
    ) {
      throw new Error(`git commit failed: ${stderr}`);
    }
  }
}

export async function commitTicket(
  stateDir: string,
  ticketId: string,
  message: string,
): Promise<void> {
  const run = (cmd: string[]) =>
    new Deno.Command(cmd[0], { args: cmd.slice(1), cwd: stateDir }).output();
  await run(["git", "add", "--", ticketId]);
  const result = await run(["git", "commit", "-m", message]);
  if (result.code !== 0) {
    const stderr = new TextDecoder().decode(result.stderr);
    const stdout = new TextDecoder().decode(result.stdout);
    if (
      !stderr.includes("nothing to commit") &&
      !stdout.includes("nothing to commit")
    ) {
      throw new Error(`git commit failed: ${stderr}`);
    }
  }
}
