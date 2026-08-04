import { join } from "@std/path";

const LABEL = "com.jackjennings.lazyboy";

export function plistPath(): string {
  return join(
    Deno.env.get("HOME")!,
    "Library",
    "LaunchAgents",
    `${LABEL}.plist`,
  );
}

export function plistContent(lazboyDir: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${lazboyDir}/scripts/tick.sh</string>
  </array>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`;
}

export async function detectLaunchdEnabled(): Promise<boolean> {
  const result = await new Deno.Command("launchctl", {
    args: ["print", `gui/${Deno.uid()}/${LABEL}`],
    stdout: "null",
    stderr: "null",
  }).output();
  return result.code === 0;
}

export function isLaunchdEnabled(): Promise<boolean> {
  return detectLaunchdEnabled();
}

export async function enableLaunchd(lazboyDir: string): Promise<void> {
  if (await detectLaunchdEnabled()) {
    console.log("Already enabled.");
    return;
  }
  const path = plistPath();
  await Deno.writeTextFile(path, plistContent(lazboyDir));
  await new Deno.Command("launchctl", {
    args: ["bootstrap", `gui/${Deno.uid()}`, path],
  }).output();
  console.log("Enabled: tick runs every 5 minutes.");
}

export async function disableLaunchd(): Promise<void> {
  if (!(await detectLaunchdEnabled())) {
    console.log("Not loaded.");
    return;
  }
  await new Deno.Command("launchctl", {
    args: ["bootout", `gui/${Deno.uid()}/${LABEL}`],
  }).output();
  console.log("Disabled.");
}
