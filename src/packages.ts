export interface InstallResult {
  source: string;
  success: boolean;
  error?: string;
}

export interface InstallDeps {
  run: (source: string) => Promise<{ success: boolean; stderr: string }>;
  isInstalled: (source: string) => Promise<boolean>;
}

export async function installPackages(
  sources: string[],
  deps: InstallDeps,
): Promise<InstallResult[]> {
  const results: InstallResult[] = [];
  for (const source of sources) {
    if (await deps.isInstalled(source)) {
      results.push({ source, success: true });
      continue;
    }
    const { success, stderr } = await deps.run(source);
    if (success) {
      results.push({ source, success: true });
    } else {
      results.push({ source, success: false, error: stderr });
    }
  }
  return results;
}

export async function runPiInstall(
  source: string,
): Promise<{ success: boolean; stderr: string }> {
  const out = await new Deno.Command("pi", {
    args: ["install", source],
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { success: out.success, stderr: new TextDecoder().decode(out.stderr) };
}

export async function isPackageInstalled(source: string): Promise<boolean> {
  const out = await new Deno.Command("pi", {
    args: ["list"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) return false;
  const lines = new TextDecoder().decode(out.stdout).split("\n").map((l) =>
    l.trim()
  );
  return lines.includes(source);
}
