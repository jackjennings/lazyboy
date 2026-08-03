export function tempHome(): Disposable & { path: string } {
  const path = Deno.makeTempDirSync();
  const original = Deno.env.get("HOME");
  Deno.env.set("HOME", path);
  return {
    path,
    [Symbol.dispose]() {
      if (original !== undefined) {
        Deno.env.set("HOME", original);
      } else {
        Deno.env.delete("HOME");
      }
      try {
        Deno.removeSync(path, { recursive: true });
      } catch {
        // temp home already removed
      }
    },
  };
}
