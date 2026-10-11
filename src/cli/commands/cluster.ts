import * as fs from "node:fs";
import * as path from "node:path";
import { clusterFailures, type FailureCluster } from "../../analysis/cluster";
import { Store } from "../../core/store";
import type { Trial } from "../../core/types";
import { offlineEmbed } from "../../providers/embed";
import type { ClustersFile } from "../../tui/screens/clusters";
import { ArgError, parseArgs, usageLine } from "../args";
import { storeRoot } from "./compare";
import type { CommandIo } from "./run";

export const CLUSTER_SPEC = { flags: ["json", "offline"], strings: ["run"], numbers: ["k", "seed"], repeatable: [] } as const;
const HELP: Record<string, string> = { run: "run id (default: latest)", k: "number of clusters (default: sqrt(n/2), max 8)", seed: "k-means seed", offline: "hashed embeddings even when OPENAI_API_KEY is set", json: "print the clusters file" };

export function clusterUsage(): string {
  return `usage: hone cluster [--run id] [--k n] [--seed n] [--offline] [--json]\n\nGroup the failed trials of a run and write .hone/analysis/clusters-<runId>.json for the clusters screen.\n\n${usageLine(CLUSTER_SPEC, HELP)}\n`;
}

export function toClustersFile(runId: string, clusters: FailureCluster[], trials: Map<string, Trial>): ClustersFile {
  return {
    schemaVersion: 1,
    runId,
    codes: clusters.map((c) => ({
      code: c.id,
      axis: "system",
      definition: `${c.topTerms.join(", ")} (representative: ${trials.get(c.representative)?.trace.caseId ?? c.representative})`,
      evidencePatterns: c.topTerms,
      count: c.size,
      trialIds: c.trialIds,
    })),
  };
}

export function renderClusters(clusters: FailureCluster[], trials: Map<string, Trial>): string {
  const lines = ["  size  code        representative          top terms"];
  for (const c of clusters) lines.push(`  ${String(c.size).padStart(4)}  ${c.id.padEnd(11)} ${(trials.get(c.representative)?.trace.caseId ?? c.representative).slice(0, 22).padEnd(23)} ${c.topTerms.join(", ")}`);
  return `${lines.join("\n")}\n`;
}

export async function clusterCommand(argv: string[], io: CommandIo): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, CLUSTER_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${clusterUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(clusterUsage());
    return 0;
  }
  const root = await storeRoot(io);
  const store = new Store(root);
  try {
    const runId = args.values.run?.[0] ?? store.listRuns(1)[0]?.id;
    if (!runId || !store.getRun(runId)) {
      io.stderr(`run ${runId ?? "(none)"} not found\n`);
      return 2;
    }
    const trials = store.queryTrials({ runId });
    const { clusters, method } = await clusterFailures(trials, { k: args.numbers.k, seed: args.numbers.seed, env: io.env, embed: args.flags.offline ? offlineEmbed : undefined });
    if (clusters.length === 0) {
      io.stdout(`run ${runId}: no failed trials, nothing to cluster\n`);
      return 0;
    }
    const byId = new Map(trials.map((t) => [t.id, t]));
    const file = toClustersFile(runId, clusters, byId);
    const out = path.join(root, "analysis", `clusters-${runId}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
    if (args.flags.json) io.stdout(`${JSON.stringify(file, null, 2)}\n`);
    else io.stdout(`run ${runId}: ${clusters.reduce((s, c) => s + c.size, 0)} failed trials in ${clusters.length} clusters (method ${method})\n${renderClusters(clusters, byId)}wrote ${path.relative(io.cwd, out)}\n`);
    return 0;
  } finally {
    store.close();
  }
}
