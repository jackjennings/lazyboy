import { loadConfig } from "../config.ts";
import { composeDoctorChecks } from "../compose.ts";
import { runChecks } from "../doctor/runner.ts";
import { formatDoctorReport } from "../doctor/formatter.ts";
import type { Command } from "./types.ts";

export const doctor: Command = {
  name: "doctor",
  description: "Run health checks and report status",
  async run(_args: string[]): Promise<void> {
    const config = await loadConfig();
    const checks = composeDoctorChecks(config);
    const results = await runChecks(checks);
    console.log(formatDoctorReport(checks, results));
    if (results.some((r) => r.status === "fail")) {
      Deno.exit(1);
    }
  },
};
