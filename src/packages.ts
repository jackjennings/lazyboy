export interface InstallResult {
  source: string;
  success: boolean;
  error?: string;
}

export interface InstallDeps {
  run: (source: string) => Promise<{ success: boolean; stderr: string }>;
  isInstalled?: (source: string) => Promise<boolean>;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
}

export async function installPackages(
  sources: string[],
  deps: InstallDeps,
): Promise<InstallResult[]> {
  const results: InstallResult[] = [];
  const log = deps.log ?? console.log;
  const warn = deps.warn ?? console.warn;
  for (const source of sources) {
    if (
      deps.isInstalled && (await deps.isInstalled(source))
    ) {
      log(`package already installed: ${source}`);
      results.push({ source, success: true });
      continue;
    }
    const { success, stderr } = await deps.run(source);
    if (success) {
      log(`installed package: ${source}`);
      results.push({ source, success: true });
    } else {
      warn(`failed to install package ${source}: ${stderr}`);
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
