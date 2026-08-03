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
