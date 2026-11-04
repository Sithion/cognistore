import { mkdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

type Sqlite = { prepare(sql: string): { get(...a: unknown[]): any; all(...a: unknown[]): any[] } };

export const cognistoreHome = () => process.env.COGNISTORE_HOME ?? join(homedir(), '.cognistore');

/**
 * Publishes the pending-curation count for the agent hooks (`curation-state.json`).
 * Two bounded indexed queries; the file is rewritten (async, atomic) only when the
 * counts change, so hook scripts never see a half-written file and idle ticks cost
 * no I/O.
 */
export function createCurationStateWriter(deps: {
  db(): Sqlite | undefined; dir?: () => string; now?: () => string; log?: (message: string) => void;
}) {
  let last = '';
  let flight: Promise<void> | undefined;
  let again = false;
  const compute = () => {
    const db = deps.db();
    if (!db) return undefined;
    const pending = Number(db.prepare("SELECT COUNT(*) AS n FROM curation_actions WHERE status='proposed'").get()?.n ?? 0);
    const scopes: Record<string, number> = {};
    for (const row of db.prepare(`SELECT json_extract(v.value,'$.scope') AS scope, COUNT(DISTINCT a.id) AS n
      FROM curation_actions a, json_each(a.expected_versions) v WHERE a.status='proposed' AND scope IS NOT NULL
      GROUP BY scope ORDER BY n DESC, scope LIMIT 50`).all()) scopes[row.scope] = Number(row.n);
    return { pending, scopes };
  };
  const writeOnce = async () => {
    const state = compute();
    if (!state) return;
    const key = JSON.stringify(state);
    if (key === last) return;
    const dir = (deps.dir ?? cognistoreHome)();
    await mkdir(dir, { recursive: true });
    const target = join(dir, 'curation-state.json');
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify({ ...state, updatedAt: (deps.now ?? (() => new Date().toISOString()))() }));
    await rename(temp, target);
    last = key;
  };
  return {
    /** Never rejects: a failed write is logged and retried on the next refresh. */
    refresh(): Promise<void> {
      if (flight) { again = true; return flight; }
      flight = (async () => {
        do { again = false; try { await writeOnce(); } catch (error: any) { deps.log?.(`curation-state write failed: ${error?.message ?? error}`); } } while (again);
      })().finally(() => { flight = undefined; });
      return flight;
    },
  };
}
export type CurationStateWriter = ReturnType<typeof createCurationStateWriter>;
