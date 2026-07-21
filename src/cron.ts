const MARKER = "# lazyboy";

export function cronLine(lazboyDir: string): string {
  return `*/5 * * * * ${lazboyDir}/scripts/tick.sh ${MARKER}`;
}

async function readCrontab(): Promise<string> {
  const result = await new Deno.Command("crontab", {
    args: ["-l"],
    stderr: "null",
  }).output();
  return result.code === 0 ? new TextDecoder().decode(result.stdout) : "";
}

async function writeCrontab(content: string): Promise<void> {
  const cmd = new Deno.Command("crontab", { args: ["-"], stdin: "piped" });
  const child = cmd.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(content));
  await writer.close();
  await child.status;
}

export async function enableCron(lazboyDir: string): Promise<void> {
  const current = await readCrontab();
  const lines = current.split("\n").filter(Boolean);
  const existing = lines.findIndex((l) => l.includes(MARKER));

  if (existing !== -1) {
    if (!lines[existing].startsWith("#")) {
      console.log("Already enabled.");
      return;
    }
    lines[existing] = cronLine(lazboyDir);
  } else {
    lines.push(cronLine(lazboyDir));
  }

  await writeCrontab(lines.join("\n") + "\n");
  console.log("Enabled: tick runs every 5 minutes.");
}

export async function disableCron(): Promise<void> {
  const current = await readCrontab();
  const lines = current.split("\n").filter(Boolean);
  const idx = lines.findIndex((l) => l.includes(MARKER));

  if (idx === -1) {
    console.log("Not in crontab.");
    return;
  }
  if (lines[idx].startsWith("#")) {
    console.log("Already disabled.");
    return;
  }

  lines[idx] = "#" + lines[idx];
  await writeCrontab(lines.join("\n") + "\n");
  console.log("Disabled.");
}
