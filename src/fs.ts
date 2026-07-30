export async function stat(path: string) {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

export const readDir = (path: string) => Deno.readDir(path);
export const remove = (path: string) => Deno.remove(path);
export const readTextFile = (path: string) => Deno.readTextFile(path);
export const mkdir = (path: string, options?: Deno.MkdirOptions) =>
  Deno.mkdir(path, options);
export const writeTextFile = (
  path: string,
  data: string,
  options?: Deno.WriteFileOptions,
) => Deno.writeTextFile(path, data, options);
