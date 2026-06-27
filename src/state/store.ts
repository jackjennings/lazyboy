import matter from "gray-matter";
import { join } from "@std/path";
import type { Phase, TicketState, WorktreeInfo } from "./types.ts";

export async function readTicket(
  stateDir: string,
  id: string,
): Promise<TicketState> {
  const metaPath = join(stateDir, id, "meta.md");
  const raw = await Deno.readTextFile(metaPath);
  const { data, content } = matter(raw);

  const worktreesRaw = data.worktrees as
    | Record<string, { path: string; branch: string }>
    | undefined;
  const worktrees: Record<string, WorktreeInfo> = {};
  if (worktreesRaw) {
    for (const [slug, info] of Object.entries(worktreesRaw)) {
      worktrees[slug] = { path: info.path, branch: info.branch };
    }
  }

  return {
    id: data.id,
    provider: data.provider,
    title: data.title,
    url: data.url,
    phase: data.phase as Phase,
    approved: data.approved ?? false,
    scope: data.scope ?? [],
    pid: data.pid,
    worktrees,
    prUrl: data.prUrl,
    created: data.created,
    updated: data.updated,
    body: content.trim(),
  };
}

export async function writeTicket(
  stateDir: string,
  ticket: TicketState,
): Promise<void> {
  const dir = join(stateDir, ticket.id);
  await Deno.mkdir(dir, { recursive: true });
  const frontmatter: Record<string, unknown> = {
    id: ticket.id,
    provider: ticket.provider,
    title: ticket.title,
    url: ticket.url,
    phase: ticket.phase,
    approved: ticket.approved,
    scope: ticket.scope,
    worktrees: ticket.worktrees,
    created: ticket.created,
    updated: ticket.updated,
  };
  if (ticket.pid !== undefined) frontmatter.pid = ticket.pid;
  if (ticket.prUrl !== undefined) frontmatter.prUrl = ticket.prUrl;
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

export async function listTickets(stateDir: string): Promise<string[]> {
  const ids: string[] = [];
  try {
    for await (const entry of Deno.readDir(stateDir)) {
      if (entry.isDirectory && !entry.name.startsWith(".")) {
        ids.push(entry.name);
      }
    }
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
    JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n",
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
