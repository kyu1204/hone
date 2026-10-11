import * as fs from "node:fs";
import * as path from "node:path";
import { clusterFailures, type FailureCluster } from "../../analysis/cluster";
import { type ChatFn, type Classification, classify, induceTaxonomy, type JevAsk, readTaxonomy, writeTaxonomy } from "../../analysis/taxonomy";
import { Store } from "../../core/store";
import type { FailureCode, Trial } from "../../core/types";
import { offlineEmbed } from "../../providers/embed";
import { JevClient } from "../../providers/jev";
import { chat, resolveLlmProvider } from "../../providers/llm";
import type { ClustersFile } from "../../tui/screens/clusters";
import { ArgError, parseArgs, usageLine } from "../args";
import { storeRoot } from "./compare";
import type { CommandIo } from "./run";

export const CLUSTER_SPEC = { flags: ["json", "offline", "induce", "classify"], strings: ["run"], numbers: ["k", "seed"], repeatable: [] } as const;
const HELP: Record<string, string> = { run: "run id (default: latest)", k: "number of clusters (default: sqrt(n/2), max 8)", seed: "k-means seed", offline: "hashed embeddings even when OPENAI_API_KEY is set", json: "print the clusters file", induce: "name the clusters with the LLM, classify every failure with Jev, save .hone/taxonomy.json", classify: "classify against the saved taxonomy without inducing" };

export function clusterUsage(): string {
  return `usage: hone cluster [--run id] [--k n] [--seed n] [--offline] [--induce | --classify] [--json]\n\nGroup the failed trials of a run and write .hone/analysis/clusters-<runId>.json for the clusters screen.\n\n${usageLine(CLUSTER_SPEC, HELP)}\n`;
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

/** Codes with counts from a classification; `other` appears only when something landed there. */
export function toCodesFile(runId: string, codes: FailureCode[], labels: Map<string, Classification>): ClustersFile {
  const all = [...codes, { code: "other", axis: "system" as const, definition: "No listed failure mode fits.", evidencePatterns: [] }];
  return {
    schemaVersion: 1,
    runId,
    codes: all
      .map((c) => ({ ...c, trialIds: [...labels].filter(([, l]) => l.code === c.code).map(([id]) => id) }))
      .filter((c) => c.code !== "other" || c.trialIds.length > 0)
      .map((c) => ({ ...c, count: c.trialIds.length })),
  };
}

export function renderCodes(file: ClustersFile): string {
  const lines = ["  count  code                      definition"];
  for (const c of [...file.codes].sort((a, b) => b.count - a.count)) lines.push(`  ${String(c.count).padStart(5)}  ${c.code.slice(0, 25).padEnd(25)} ${c.definition}`);
  return `${lines.join("\n")}\n`;
}

export interface ClusterDeps {
  chat?: ChatFn;
  jev?: JevAsk;
}

export function renderClusters(clusters: FailureCluster[], trials: Map<string, Trial>): string {
  const lines = ["  size  code        representative          top terms"];
  for (const c of clusters) lines.push(`  ${String(c.size).padStart(4)}  ${c.id.padEnd(11)} ${(trials.get(c.representative)?.trace.caseId ?? c.representative).slice(0, 22).padEnd(23)} ${c.topTerms.join(", ")}`);
  return `${lines.join("\n")}\n`;
}

export async function clusterCommand(argv: string[], io: CommandIo, deps: ClusterDeps = {}): Promise<number> {
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
    const failed = trials.filter((t) => t.pass === false);
    const byId = new Map(trials.map((t) => [t.id, t]));
    const out = path.join(root, "analysis", `clusters-${runId}.json`);
    const write = (file: ClustersFile): void => {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
    };
    const jev = (): JevAsk => deps.jev ?? new JevClient();
    if (args.flags.classify) {
      const tax = readTaxonomy(root);
      if (!tax) {
        io.stderr("no taxonomy: run hone cluster --induce first\n");
        return 2;
      }
      const file = toCodesFile(runId, tax.codes, await classify(failed, tax.codes, { jev: jev() }));
      write(file);
      io.stdout(args.flags.json ? `${JSON.stringify(file, null, 2)}\n` : `run ${runId}: ${failed.length} failed trials classified against ${tax.codes.length} codes\n${renderCodes(file)}wrote ${path.relative(io.cwd, out)}\n`);
      return 0;
    }
    const { clusters, method } = await clusterFailures(trials, { k: args.numbers.k, seed: args.numbers.seed, env: io.env, embed: args.flags.offline ? offlineEmbed : undefined });
    if (clusters.length === 0) {
      io.stdout(`run ${runId}: no failed trials, nothing to cluster\n`);
      return 0;
    }
    if (args.flags.induce) {
      const existing = readTaxonomy(root)?.codes;
      const chatFn: ChatFn = deps.chat ?? ((req) => chat(req, { provider: resolveLlmProvider(io.env, { cwd: io.cwd }) }));
      const codes = await induceTaxonomy(clusters, { chat: chatFn, existing, jev: deps.jev ?? (existing?.length ? jev() : undefined) });
      writeTaxonomy(root, codes);
      const file = toCodesFile(runId, codes, await classify(failed, codes, { jev: jev() }));
      write(file);
      io.stdout(args.flags.json ? `${JSON.stringify(file, null, 2)}\n` : `run ${runId}: ${failed.length} failed trials, ${codes.length} codes induced (method ${method})\n${renderCodes(file)}wrote ${path.relative(io.cwd, out)} and ${path.relative(io.cwd, path.join(root, "taxonomy.json"))}\n`);
      return 0;
    }
    const file = toClustersFile(runId, clusters, byId);
    write(file);
    if (args.flags.json) io.stdout(`${JSON.stringify(file, null, 2)}\n`);
    else io.stdout(`run ${runId}: ${clusters.reduce((s, c) => s + c.size, 0)} failed trials in ${clusters.length} clusters (method ${method})\n${renderClusters(clusters, byId)}wrote ${path.relative(io.cwd, out)}\n`);
    return 0;
  } finally {
    store.close();
  }
}
