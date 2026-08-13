import { join } from "@std/path";

export function lazyboyDir(): string {
  const override = Deno.env.get("LAZYBOY_DIR");
  if (override) return override;
  return join(Deno.env.get("HOME")!, ".lazyboy");
}

export function bootId(): string {
  const result = new Deno.Command("sysctl", {
    args: ["-n", "kern.boottime"],
    stdout: "piped",
    stderr: "null",
  }).outputSync();
  const raw = new TextDecoder().decode(result.stdout).trim();
  const match = raw.match(/sec\s*=\s*(\d+)/);
  if (!match) throw new Error(`bootId: unexpected sysctl output: ${raw}`);
  return match[1];
}
