export type CommandRunner = (
  args: string[],
) => Promise<{ code: number; stdout: string }>;
export type ProcessSpawner = (args: string[]) => { kill: () => void };

export interface ApfelServer {
  url: string;
  kill: () => void;
}

const APFEL_URL = "http://127.0.0.1:11434";
const HEALTH_TIMEOUT_MS = 2000;
const HEALTH_POLL_MS = 100;

export async function checkApfelAvailable(
  run: CommandRunner,
): Promise<boolean> {
  const { code } = await run(["apfel", "--model-info"]);
  return code === 0;
}

export async function startApfelServer(
  spawn: ProcessSpawner,
  fetcher: typeof fetch,
): Promise<ApfelServer | null> {
  const proc = spawn(["apfel", "--serve", "--port", "11434"]);
  const deadline = Temporal.Now.instant().add({
    milliseconds: HEALTH_TIMEOUT_MS,
  });
  while (Temporal.Instant.compare(Temporal.Now.instant(), deadline) < 0) {
    try {
      const response = await fetcher(`${APFEL_URL}/health`);
      if (response.ok) {
        return { url: APFEL_URL, kill: () => proc.kill() };
      }
    } catch {
      // not ready yet
    }
    await new Promise<void>((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
  }
  proc.kill();
  return null;
}

export function defaultCommandRunner(): CommandRunner {
  return async (args) => {
    const out = await new Deno.Command(args[0], {
      args: args.slice(1),
      stdout: "null",
      stderr: "null",
    }).output();
    return { code: out.code, stdout: "" };
  };
}

export function captureCommandRunner(): CommandRunner {
  return async (args) => {
    const out = await new Deno.Command(args[0], {
      args: args.slice(1),
      stdout: "piped",
      stderr: "null",
    }).output();
    return { code: out.code, stdout: new TextDecoder().decode(out.stdout) };
  };
}

const SHORT_TITLE_SYSTEM_PROMPT =
  "Compress this title to a short 2–5 word label that remains identifiable at a glance. Prefer noun phrases. Output only the short title.";

export async function generateShortTitle(
  run: CommandRunner,
  title: string,
): Promise<string | null> {
  try {
    const { code, stdout } = await run([
      "apfel",
      "--quiet",
      "--max-tokens",
      "40",
      "-s",
      SHORT_TITLE_SYSTEM_PROMPT,
      title,
    ]);
    if (code !== 0) return null;
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export function defaultProcessSpawner(): ProcessSpawner {
  return (args) => {
    const cmd = new Deno.Command(args[0], {
      args: args.slice(1),
      stdout: "null",
      stderr: "null",
    });
    const child = cmd.spawn();
    return {
      kill: () => {
        try {
          child.kill();
        } catch {
          // already exited
        }
      },
    };
  };
}
