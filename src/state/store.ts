import matter from "gray-matter";
import { join } from "@std/path";
import type { TicketState, Phase } from "./types.ts";

export async function readTicket(stateDir: string, id: string): Promise<TicketState> {
  const metaPath = join(stateDir, id, "meta.md");
  const raw = await Deno.readTextFile(metaPath);
  const { data, content } = matter(raw);
  return {
    id: data.id,
    provider: data.provider,
    title: data.title,
    url: data.url,
    phase: data.phase as Phase,
    approved: data.approved ?? false,
    scope: data.scope ?? [],
    pid: data.pid,
    created: data.created,
    updated: data.updated,
    body: content.trim(),
  };
}

export async function writeTicket(stateDir: string, ticket: TicketState): Promise<void> {
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
    created: ticket.created,
    updated: ticket.updated,
  };
  if (ticket.pid !== undefined) frontmatter.pid = ticket.pid;
  const raw = matter.stringify(ticket.body, frontmatter);
  await Deno.writeTextFile(join(dir, "meta.md"), raw);
}

export async function writePhaseOutput(stateDir: string, id: string, filename: string, content: string): Promise<void> {
  await Deno.writeTextFile(join(stateDir, id, filename), content);
}

export async function readPhaseOutput(stateDir: string, id: string, filename: string): Promise<string> {
  return Deno.readTextFile(join(stateDir, id, filename));
}

export async function listTickets(stateDir: string): Promise<string[]> {
  const ids: string[] = [];
  for await (const entry of Deno.readDir(stateDir)) {
    if (entry.isDirectory) ids.push(entry.name);
  }
  return ids;
}

export async function commitState(stateDir: string, message: string): Promise<void> {
  const run = (cmd: string[]) =>
    new Deno.Command(cmd[0], { args: cmd.slice(1), cwd: stateDir }).output();
  await run(["git", "add", "-A"]);
  const result = await run(["git", "commit", "-m", message]);
  if (result.code !== 0) {
    const stderr = new TextDecoder().decode(result.stderr);
    const stdout = new TextDecoder().decode(result.stdout);
    if (!stderr.includes("nothing to commit") && !stdout.includes("nothing to commit")) {
      throw new Error(`git commit failed: ${stderr}`);
    }
  }
}
