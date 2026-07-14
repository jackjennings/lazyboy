import { parseArgs } from "@std/cli/parse-args";
import { join } from "@std/path";

export function getPiEnvironmentVariables(
	home: string,
): Record<string, string> {
	return {
		PI_CODING_AGENT_DIR: join(home, ".lazyboy", "pi"),
		PI_CODING_AGENT_SESSION_DIR: join(home, ".lazyboy", "pi", "sessions"),
	};
}

export async function setupPiDirectories(home: string): Promise<void> {
	const sessionsDir = join(home, ".lazyboy", "pi", "sessions");
	await Deno.mkdir(sessionsDir, { recursive: true });
}

export async function buildContextFiles(ticketDir: string): Promise<string[]> {
	const contextFiles = [`@${ticketDir}/meta.md`];
	for (const phase of ["intake", "enrichment", "spec", "plan"]) {
		try {
			await Deno.stat(`${ticketDir}/${phase}.md`);
			contextFiles.push(`@${ticketDir}/${phase}.md`);
		} catch {
			/* not yet written */
		}
		const phaseFiles: string[] = [];
		try {
			for await (const entry of Deno.readDir(ticketDir)) {
				if (
					entry.isFile &&
					entry.name.startsWith(`${phase}-`) &&
					entry.name.endsWith(".md")
				) {
					phaseFiles.push(entry.name);
				}
			}
		} catch {
			/* ticketDir not found */
		}
		phaseFiles.sort();
		for (const f of phaseFiles) {
			contextFiles.push(`@${ticketDir}/${f}`);
		}
	}
	return contextFiles;
}

export async function appendPhaseLog(
	ticketDir: string,
	entry: object,
): Promise<void> {
	await Deno.writeTextFile(
		join(ticketDir, "log.ndjson"),
		JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n",
		{ append: true },
	);
}

if (import.meta.main) {
	const args = parseArgs(Deno.args, {
		string: [
			"ticket-dir",
			"output-file",
			"phase",
			"scope",
			"prompt",
			"worktrees",
		],
	});

	const ticketDir = args["ticket-dir"]!;
	const outputFile = args["output-file"]!;
	const phase = args["phase"]!;
	const scopeDirs = args["scope"]
		? args["scope"].split(",").filter(Boolean)
		: [];
	const prompt = args["prompt"]!;
	const worktrees = args["worktrees"]
		? (JSON.parse(args["worktrees"]) as Record<
				string,
				{ path: string; branch: string }
			>)
		: {};

	const contextFiles = await buildContextFiles(ticketDir);

	const allPaths = [
		...scopeDirs,
		...Object.values(worktrees).map((w) => w.path),
	];
	const pathContext =
		`\n\nTicket directory: ${ticketDir}` +
		(allPaths.length > 0
			? `\n\nAvailable directories:\n${allPaths
					.map((p) => `- ${p}`)
					.join("\n")}`
			: "");

	const worktreePaths = Object.values(worktrees).map((w) => w.path);
	const cwd = worktreePaths[0] ?? ticketDir;

	const homeDir = Deno.env.get("HOME");
	if (!homeDir) {
		throw new Error("HOME environment variable is not set");
	}

	await setupPiDirectories(homeDir);
	const piEnv = getPiEnvironmentVariables(homeDir);

	await appendPhaseLog(ticketDir, { event: "phase-start", phase });

	const result = await new Deno.Command("pi", {
		args: [
			"-p",
			// Non-interactive mode skips project resources (including AGENTS.md) by
			// default unless a saved trust decision exists. --approve ensures the
			// project's AGENTS.md is loaded for every phase run.
			"--approve",
			"--provider",
			"anthropic",
			"--model",
			"claude-sonnet-4-6",
			"--system-prompt",
			prompt + pathContext,
			...contextFiles,
		],
		cwd,
		env: {
			...Deno.env.toObject(),
			ANTHROPIC_API_KEY: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
			...piEnv,
		},
		stdout: "piped",
		stderr: "piped",
	}).output();

	await Deno.writeTextFile(
		join(ticketDir, outputFile),
		new TextDecoder().decode(result.stdout),
	);

	await appendPhaseLog(ticketDir, {
		event: "phase-end",
		phase,
		exitCode: result.code,
		output: new TextDecoder().decode(result.stderr),
	});

	Deno.exit(result.code);
}
