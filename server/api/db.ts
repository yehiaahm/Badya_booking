import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { clock } from "@/lib/time";
import { ApiError } from "@/api/types";
import { ROW_TABLES, SINGLETONS, type DbState, type RowTable, type Singleton } from "./state";

/**
 * The database.
 *
 * All data lives in memory (a university's bookings fit comfortably) and every
 * write is persisted to SQLite before it is acknowledged. Rows are immutable:
 * a write replaces the whole object, stored as JSON in `rows(tbl, id, data)`.
 *
 * Writes go through `transaction()`, which runs one mutation at a time and
 * commits its changes to disk in a single SQLite transaction. Two students
 * racing for the last spot are therefore serialised — the loser sees the
 * winner's booking when the rules are evaluated.
 */

// Loaded through require so bundlers that don't know this newer built-in (e.g. the test runner) leave it alone.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type DatabaseSync = InstanceType<typeof DatabaseSync>;

type Row = { id: string };
const listeners = new Set<() => void>();
const EMPTY = (): DbState => {
  const s = { dailyStats: [] } as unknown as Record<string, unknown>;
  for (const t of ROW_TABLES) s[t] = [];
  return s as unknown as DbState;
};

class Db {
  state: DbState = EMPTY();
  /** Bumped on every committed write; caches key off it. */
  rev = 1;
  private sql: DatabaseSync | null = null;
  private pendingRows = new Map<string, { table: RowTable; id: string; row: Row | null }>();
  private pendingSingletons = new Map<Singleton, unknown>();
  private queue: Promise<unknown> = Promise.resolve();
  private depth = 0;

  open(file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    const sql = new DatabaseSync(file);
    sql.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS rows (tbl TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (tbl, id));
      CREATE TABLE IF NOT EXISTS singletons (key TEXT PRIMARY KEY, data TEXT NOT NULL);
    `);
    this.sql = sql;
    this.load();
  }

  close() {
    this.sql?.close();
    this.sql = null;
  }

  get isEmpty() {
    return !this.state.meta;
  }

  /** (Re)load everything from disk. */
  load() {
    const sql = this.must();
    const s = EMPTY() as unknown as Record<string, unknown>;
    for (const r of sql.prepare("SELECT tbl, data FROM rows ORDER BY rowid").iterate() as Iterable<{ tbl: string; data: string }>) {
      const arr = s[r.tbl] as unknown[] | undefined;
      if (arr) arr.push(JSON.parse(r.data));
    }
    for (const r of sql.prepare("SELECT key, data FROM singletons").all() as { key: string; data: string }[]) s[r.key] = JSON.parse(r.data);
    this.state = s as unknown as DbState;
    this.rev += 1;
  }

  put<T extends RowTable>(table: T, row: DbState[T][number]) {
    const r = row as unknown as Row;
    const arr = this.state[table] as unknown as Row[];
    const i = arr.findIndex((x) => x.id === r.id);
    const next = [...arr];
    if (i >= 0) next[i] = r;
    else next.push(r);
    (this.state as unknown as Record<string, Row[]>)[table] = next;
    this.pendingRows.set(`${table}\u0000${r.id}`, { table, id: r.id, row: r });
    this.autoFlush();
  }

  remove(table: RowTable, id: string) {
    (this.state as unknown as Record<string, Row[]>)[table] = (this.state[table] as unknown as Row[]).filter((x) => x.id !== id);
    this.pendingRows.set(`${table}\u0000${id}`, { table, id, row: null });
    this.autoFlush();
  }

  setSingleton<K extends Singleton>(key: K, value: DbState[K]) {
    this.state = { ...this.state, [key]: value };
    this.pendingSingletons.set(key, value);
    this.autoFlush();
  }

  /**
   * Run a mutation and persist its writes. Mutations run strictly one after
   * another. `silent` writes (e.g. "last seen" timestamps) don't notify
   * live-update listeners.
   */
  transaction<T>(fn: () => T, opts: { silent?: boolean } = {}): Promise<T> {
    const run = () => {
      this.depth++;
      try {
        return fn();
      } finally {
        this.depth--;
        // Validation errors are thrown before any write. Writes that did
        // happen (e.g. a competing booking that won the race) are committed.
        this.flush(opts.silent);
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private autoFlush() {
    // Writes outside a transaction (seeding, scripts) are committed at once.
    if (this.depth === 0) this.flush(false);
  }

  private flush(silent = false) {
    if (this.pendingRows.size === 0 && this.pendingSingletons.size === 0) return;
    const sql = this.must();
    const rows = [...this.pendingRows.values()];
    const singles = [...this.pendingSingletons.entries()];
    this.pendingRows.clear();
    this.pendingSingletons.clear();
    try {
      sql.exec("BEGIN");
      const upsert = sql.prepare("INSERT INTO rows (tbl, id, data) VALUES (?, ?, ?) ON CONFLICT (tbl, id) DO UPDATE SET data = excluded.data");
      const del = sql.prepare("DELETE FROM rows WHERE tbl = ? AND id = ?");
      const single = sql.prepare("INSERT INTO singletons (key, data) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET data = excluded.data");
      for (const r of rows) {
        if (r.row) upsert.run(r.table, r.id, JSON.stringify(r.row));
        else del.run(r.table, r.id);
      }
      for (const [k, v] of singles) single.run(k, JSON.stringify(v));
      sql.exec("COMMIT");
    } catch (e) {
      try {
        sql.exec("ROLLBACK");
      } catch {
        /* nothing to roll back */
      }
      // Memory now disagrees with disk — go back to what was actually saved.
      this.load();
      console.error("[db] write failed:", e);
      throw new ApiError("NETWORK", "The server couldn’t save your change. Please try again in a moment.");
    }
    this.rev += 1;
    if (!silent) listeners.forEach((l) => l());
  }

  /** Replace the whole database (first-run setup and demo data). */
  replaceAll(next: DbState) {
    const sql = this.must();
    sql.exec("BEGIN");
    try {
      sql.exec("DELETE FROM rows; DELETE FROM singletons;");
      const ins = sql.prepare("INSERT INTO rows (tbl, id, data) VALUES (?, ?, ?)");
      for (const t of ROW_TABLES) for (const r of next[t] as unknown as Row[]) ins.run(t, r.id, JSON.stringify(r));
      const single = sql.prepare("INSERT INTO singletons (key, data) VALUES (?, ?)");
      for (const k of SINGLETONS) if (next[k] !== undefined) single.run(k, JSON.stringify(next[k]));
      sql.exec("COMMIT");
    } catch (e) {
      sql.exec("ROLLBACK");
      throw e;
    }
    this.load();
    listeners.forEach((l) => l());
  }

  /** Consistent online copy of the database file (for backups). */
  backupTo(file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.must().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  }

  nextSeq(): number {
    const meta = { ...this.state.meta, seq: this.state.meta.seq + 1 };
    this.setSingleton("meta", meta);
    return meta.seq;
  }

  nextBookingId(): string {
    const meta = { ...this.state.meta, bookingSeq: this.state.meta.bookingSeq + 1 };
    this.setSingleton("meta", meta);
    return `BK-${clock.now().getFullYear()}-${String(meta.bookingSeq).padStart(6, "0")}`;
  }

  /** When this database was created. Analytics before this come from the warehouse (demo data only). */
  get anchorDate() {
    return new Date(this.state.meta?.anchor ?? 0);
  }

  get isDemo() {
    return !!this.state.meta?.demo;
  }

  private must(): DatabaseSync {
    if (!this.sql) throw new Error("Database is not open.");
    return this.sql;
  }
}

export const db = new Db();

export function onDbChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
