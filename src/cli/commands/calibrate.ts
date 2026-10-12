import * as fs from "node:fs";
import * as path from "node:path";
import { calibrate, type Domain, inferDomain } from "../../analysis/calibrate";
import { ConfigNotFound, loadCases, loadConfig } from "../../core/config";
import { Store } from "../../core/store";
import type { Case } from "../../core/types";
import { createScorers } from "../../scorers/index";
import type { CalibrationFile } from "../../tui/screens/calibrate";
import { ArgError, parseArgs, usageLine } from "../args";
import type { CommandIo } from "./run";

export const CALIBRATE_SPEC = { flags: ["json"], strings: ["scorer", "domain", "run", "labels"], numbers: ["n", "seed"], repeatable: [] } as const;
const HELP: Record<string, string> = { scorer: "scorer name from hone.config.ts (required)", domain: "rag | qa | agent (default: inferred from the traces)", run: "run id (default: latest)", n: "passing trials to sample (default 20)", seed: "fault injection seed", labels: "csv of trialId,label (true/false) for kappa", json: "print the calibration file" };

export function calibrateUsage(): string {
  return `usage: hone calibrate --scorer name [--domain rag|qa|agent] [--run id] [--n 20] [--seed n] [--labels file.csv] [--json]\n\nInject silent faults into passing trials, re-score with one judge, and write .hone/analysis/calibration-<scorer>.json.\n\n${usageLine(CALIBRATE_SPEC, HELP)}\n`;
}

const TRUE = new Set(["true", "pass", "1", "yes", "good"]);
const FALSE = new Set(["false", "fail", "0", "no", "bad"]);

export function parseLabels(csv: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const raw of csv.split("\n")) {
    const [id, label] = raw.split(",").map((s) => s.trim());
    if (!id || label === undefined) continue;
    const l = label.toLowerCase();
    if (TRUE.has(l)) out.set(id, true);
    else if (FALSE.has(l)) out.set(id, false);
  }
  return out;
}

export function renderCalibration(file: CalibrationFile): string {
  const lines = [`judge ${file.judge}   domain ${file.domain}`, "", "  fault                     detected   rate   95% CI"];
  for (const f of file.faults) lines.push(`  ${f.type.padEnd(25)} ${`${f.detected}/${f.injected}`.padStart(8)}   ${f.injected ? (f.rate * 100).toFixed(0).padStart(3) : "  -"}%   [${(f.lo * 100).toFixed(0)}%, ${(f.hi * 100).toFixed(0)}%]`);
  lines.push("", `  false alarms ${file.falseAlarms.flagged}/${file.falseAlarms.n} (${(file.falseAlarms.rate * 100).toFixed(0)}%)${file.kappa !== undefined ? `   kappa vs labels ${file.kappa.toFixed(2)}` : ""}`);
  return `${lines.join("\n")}\n`;
}

export async function calibrateCommand(argv: string[], io: CommandIo): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, CALIBRATE_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${calibrateUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(calibrateUsage());
    return 0;
  }
  const name = args.values.scorer?.[0];
  if (!name) {
    io.stderr(`--scorer is required\n${calibrateUsage()}`);
    return 2;
  }
  const domainArg = args.values.domain?.[0];
  if (domainArg && !["rag", "qa", "agent"].includes(domainArg)) {
    io.stderr(`--domain must be rag, qa or agent\n`);
    return 2;
  }
  let config;
  try {
    config = (await loadConfig(io.cwd)).config;
  } catch (e) {
    io.stderr(`${e instanceof ConfigNotFound ? e.message : `config error: ${e instanceof Error ? e.message : String(e)}`}\n`);
    return 2;
  }
  const scorers = createScorers(config.scorers);
  const scorer = scorers.find((s) => s.name === name);
  if (!scorer) {
    io.stderr(`scorer ${name} not found; configured: ${scorers.map((s) => s.name).join(", ") || "(none)"}\n`);
    return 2;
  }
  let labels: Map<string, boolean> | undefined;
  if (args.values.labels?.[0]) {
    try {
      labels = parseLabels(fs.readFileSync(path.resolve(io.cwd, args.values.labels[0]), "utf8"));
    } catch (e) {
      io.stderr(`cannot read labels: ${e instanceof Error ? e.message : String(e)}\n`);
      return 2;
    }
  }
  const root = path.resolve(io.cwd, config.cacheDir ?? ".hone");
  const store = new Store(root);
  try {
    const runId = args.values.run?.[0] ?? store.listRuns(1)[0]?.id;
    if (!runId || !store.getRun(runId)) {
      io.stderr(`run ${runId ?? "(none)"} not found\n`);
      return 2;
    }
    const trials = store.queryTrials({ runId, pass: true });
    let cases: Case[];
    try {
      cases = await loadCases(config.cases, io.cwd);
    } catch {
      cases = []; // imported runs may have no case files; scorers then get a minimal case
    }
    const domain = (domainArg as Domain | undefined) ?? inferDomain(trials);
    const file = await calibrate({ trials, scorer, domain, n: args.numbers.n, seed: args.numbers.seed, labels, cases });
    const out = path.join(root, "analysis", `calibration-${scorer.name}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
    io.stdout(args.flags.json ? `${JSON.stringify(file, null, 2)}\n` : `${renderCalibration(file)}wrote ${path.relative(io.cwd, out)}\n`);
    return 0;
  } finally {
    store.close();
  }
}
