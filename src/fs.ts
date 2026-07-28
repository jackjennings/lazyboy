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
