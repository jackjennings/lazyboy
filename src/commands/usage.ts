import { join } from "@std/path";
import { listTickets } from "../state/store.ts";
import { expandHome, loadConfig } from "../config.ts";
import { formatLargeTokens, readUsageFiles } from "../usage.ts";
import type { PhaseUsage } from "../state/types.ts";
import type { Command } from "./types.ts";

type ModelGroup = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  count: number;
  costCount: number;
};

export function aggregateUsage(records: PhaseUsage[]): Map<string, ModelGroup> {
  const groups = new Map<string, ModelGroup>();
  for (const r of records) {
    const key = r.model.replace(/-\d{8}$/, "");
    let g = groups.get(key);
    if (!g) {
      g = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        count: 0,
        costCount: 0,
      };
      groups.set(key, g);
    }
    g.input += r.input;
    g.output += r.output;
    g.cacheRead += r.cacheRead;
    g.cacheWrite += r.cacheWrite;
    g.count++;
    if (r.costUsd !== undefined) {
      g.cost += r.costUsd;
      g.costCount++;
    }
  }
  return groups;
}

export function formatUsageOutput(groups: Map<string, ModelGroup>): string {
  if (groups.size === 0) return "Total cost:  —";

  const names = [...groups.keys()].sort();
  const maxLen = Math.max(...names.map((n) => n.length));
  const col = maxLen + 7;

  let totalCost = 0;
  let totalCount = 0;
  let totalCostCount = 0;
  for (const g of groups.values()) {
    totalCost += g.cost;
    totalCount += g.count;
    totalCostCount += g.costCount;
  }

  const totalCostStr = totalCostCount === 0
    ? "—"
    : totalCostCount === totalCount
    ? `$${totalCost.toFixed(2)}`
    : `~$${totalCost.toFixed(2)}`;

  const lines: string[] = [];
  lines.push("Total cost:".padEnd(col) + totalCostStr);
  lines.push("Usage by model:");

  for (const name of names) {
    const g = groups.get(name)!;
    const tokens =
      `${formatLargeTokens(g.input)} input, ${
        formatLargeTokens(g.output)
      } output, ` +
      `${formatLargeTokens(g.cacheRead)} cache read, ${
        formatLargeTokens(g.cacheWrite)
      } cache write`;
    const costStr = g.costCount === 0
      ? "(—)"
      : g.costCount === g.count
      ? `($${g.cost.toFixed(2)})`
      : `(~$${g.cost.toFixed(2)})`;
    lines.push(`    ${name.padStart(maxLen)}:  ${tokens} ${costStr}`);
  }

  return lines.join("\n");
}

export const usage: Command = {
  name: "usage",
  description: "show aggregate usage statistics",
  async run(_args) {
    const config = await loadConfig();
    const stateDir = expandHome(config.state.dir);
    const ids = await listTickets(stateDir);
    const allRecords: PhaseUsage[] = [];
    await Promise.all(
      ids.map(async (id) => {
        const records = await readUsageFiles(join(stateDir, id));
        if (records) allRecords.push(...records);
      }),
    );
    console.log(formatUsageOutput(aggregateUsage(allRecords)));
  },
};
