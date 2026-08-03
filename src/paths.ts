import { join } from "@std/path";

export function lazyboyDir(): string {
  const override = Deno.env.get("LAZYBOY_DIR");
  if (override) return override;
  return join(Deno.env.get("HOME")!, ".lazyboy");
}
