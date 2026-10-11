import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Run, Trial } from "./types";

/**
 * Runs and trials live as JSON under <root>/runs/<runId>/ (the source of truth,
 * committable to git). <root>/index.sqlite is a query index that is rebuilt from
 * the JSON whenever it is missing.
 */
export class Store {
  private db!: Database;
  readonly runsDir: string;
  readonly indexPath: string;

  constructor(readonly root = ".hone") {
    this.runsDir = path.join(root, "runs");
    this.indexPath = path.join(root, "index.sqlite");
    fs.mkdirSync(this.runsDir, { recursive: true });
    const fresh = !fs.existsSync(this.indexPath);
    this.open();
    if (fresh) this.reindexFromDisk();
  }

  static trialId(runId: string, caseId: string, targetId: string, trial: number): string {
    return [runId, caseId, targetId, String(trial)].map((s) => s.replaceAll("/", "_")).join("_");
  }

  private open(): void {
    this.db = new Database(this.indexPath, { create: true });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL, config_hash TEXT NOT NULL, summary_json TEXT
      );
      CREATE TABLE IF NOT EXISTS trials (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, case_id TEXT NOT NULL, target_id TEXT NOT NULL,
        trial INTEGER NOT NULL, pass INTEGER, cost_usd REAL NOT NULL, flags_json TEXT NOT NULL, scores_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS trials_run ON trials(run_id);
      CREATE INDEX IF NOT EXISTS trials_case_target ON trials(case_id, target_id);
    `);
  }

  close(): void {
    this.db.close();
  }

  private runDir(runId: string): string {
    return path.join(this.runsDir, runId);
  }
  private runFile(runId: string): string {
    return path.join(this.runDir(runId), "run.json");
  }
  private trialFile(runId: string, trialId: string): string {
    return path.join(this.runDir(runId), "trials", `${trialId}.json`);
  }

  private indexRun(run: Run): void {
    this.db
      .query("INSERT OR REPLACE INTO runs (id, created_at, config_hash, summary_json) VALUES (?, ?, ?, ?)")
      .run(run.id, run.createdAt, run.configHash, run.summary ? JSON.stringify(run.summary) : null);
  }

  private indexTrial(t: Trial): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO trials (id, run_id, case_id, target_id, trial, pass, cost_usd, flags_json, scores_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        t.id,
        t.runId,
        t.trace.caseId,
        t.trace.targetId,
        t.trace.trial,
        t.pass === null ? null : t.pass ? 1 : 0,
        t.costUsd,
        JSON.stringify(t.flags),
        JSON.stringify(t.scores),
      );
  }

  createRun(run: Omit<Run, "id" | "createdAt">): Run {
    const createdAt = new Date().toISOString();
    const id = `${createdAt.replaceAll(":", "-")}-${randomBytes(2).toString("hex")}`;
    const full: Run = { id, createdAt, ...run };
    fs.mkdirSync(path.join(this.runDir(id), "trials"), { recursive: true });
    fs.writeFileSync(this.runFile(id), JSON.stringify(full, null, 2));
    this.indexRun(full);
    return full;
  }

  getRun(id: string): Run | undefined {
    const f = this.runFile(id);
    if (!fs.existsSync(f)) return undefined;
    return JSON.parse(fs.readFileSync(f, "utf8")) as Run;
  }

  listRuns(limit = 50): Run[] {
    const rows = this.db.query<{ id: string }, [number]>("SELECT id FROM runs ORDER BY created_at DESC LIMIT ?").all(limit);
    return rows.map((r) => this.getRun(r.id)).filter((r): r is Run => r !== undefined);
  }

  finishRun(id: string, summary: Record<string, unknown>): void {
    const run = this.getRun(id);
    if (!run) throw new Error(`run ${id} not found`);
    run.summary = summary;
    fs.writeFileSync(this.runFile(id), JSON.stringify(run, null, 2));
    this.indexRun(run);
  }

  saveTrial(trial: Trial): void {
    const f = this.trialFile(trial.runId, trial.id);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(trial, null, 2));
    this.indexTrial(trial);
  }

  getTrial(id: string): Trial | undefined {
    const row = this.db.query<{ run_id: string }, [string]>("SELECT run_id FROM trials WHERE id = ?").get(id);
    if (!row) return undefined;
    const f = this.trialFile(row.run_id, id);
    if (!fs.existsSync(f)) return undefined;
    return JSON.parse(fs.readFileSync(f, "utf8")) as Trial;
  }

  queryTrials(q: { runId?: string; caseId?: string; targetId?: string; pass?: boolean | null }): Trial[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    const add = (clause: string, value: string | number): void => {
      where.push(clause);
      params.push(value);
    };
    if (q.runId !== undefined) add("run_id = ?", q.runId);
    if (q.caseId !== undefined) add("case_id = ?", q.caseId);
    if (q.targetId !== undefined) add("target_id = ?", q.targetId);
    if (q.pass === null) where.push("pass IS NULL");
    else if (q.pass !== undefined) add("pass = ?", q.pass ? 1 : 0);
    const sql = `SELECT id FROM trials${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY run_id, case_id, target_id, trial`;
    const rows = this.db.query<{ id: string }, (string | number)[]>(sql).all(...params);
    return rows.map((r) => this.getTrial(r.id)).filter((t): t is Trial => t !== undefined);
  }

  /** Drop the sqlite index and rebuild it from the JSON files. */
  rebuildIndex(): void {
    this.db.close();
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${this.indexPath}${suffix}`, { force: true });
    this.open();
    this.reindexFromDisk();
  }

  private reindexFromDisk(): void {
    if (!fs.existsSync(this.runsDir)) return;
    const insert = this.db.transaction(() => {
      for (const runId of fs.readdirSync(this.runsDir)) {
        const run = this.getRun(runId);
        if (!run) continue;
        this.indexRun(run);
        const dir = path.join(this.runDir(runId), "trials");
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir)) {
          if (!file.endsWith(".json")) continue;
          this.indexTrial(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as Trial);
        }
      }
    });
    insert();
  }
}
