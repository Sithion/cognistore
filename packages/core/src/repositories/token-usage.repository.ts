import type { SQLiteDatabase } from '../db/client.js';
import type {
  ScanState,
  TokenUsageByDay,
  TokenUsageByHourDay,
  TokenUsageByModel,
  TokenUsageByProject,
  TokenUsageFilter,
  TokenUsageRecord,
  TokenUsageTotals,
  TopSession,
} from '../services/token-usage/types.js';
import { setImmediate as yieldImmediate } from 'node:timers/promises';

const RANGE_CLAUSE = 'occurred_at >= ? AND occurred_at <= ?';
function addDay(day: string): string { return new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10); }
function previousDay(day: string): string { return new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10); }

function applyOptionalFilters(filter: TokenUsageFilter): { sql: string; params: (string | number)[] } {
  const params: (string | number)[] = [filter.from, filter.to];
  let sql = RANGE_CLAUSE;
  if (filter.source) { sql += ' AND source = ?'; params.push(filter.source); }
  if (filter.model)  { sql += ' AND model = ?';  params.push(filter.model);  }
  if (filter.project){ sql += ' AND project = ?';params.push(filter.project);}
  return { sql, params };
}

export class TokenUsageRepository {
  private watermarkStatement: ReturnType<SQLiteDatabase['prepare']> | undefined;
  constructor(private readonly sqlite: SQLiteDatabase) {}

  // ─── Writes ────────────────────────────────────────────────────

  /** Insert if new; never throw on conflict (deterministic id makes this idempotent). */
  insertMany(records: TokenUsageRecord[]): number {
    if (records.length === 0) return 0;
    const stmt = this.sqlite.prepare(`
      INSERT OR IGNORE INTO token_usage
        (id, source, model, project, session_id, message_id, occurred_at,
         input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, scanned_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const scannedAt = new Date().toISOString();
    const tx = this.sqlite.transaction((rows: TokenUsageRecord[]) => {
      let inserted = 0;
      const cutoff = (this.sqlite.prepare("SELECT value FROM token_usage_meta WHERE key = 'pruned_before'").get() as { value: string } | undefined)?.value ?? '';
      for (const r of rows) {
        if (r.occurredAt < cutoff) continue;
        const info = stmt.run(
          r.id, r.source, r.model, r.project, r.sessionId, r.messageId, r.occurredAt,
          r.inputTokens, r.outputTokens, r.cacheReadTokens, r.cacheCreationTokens, scannedAt,
        );
        if (info.changes > 0) inserted++;
      }
      return inserted;
    });
    return tx(records);
  }

  // ─── Scan state ────────────────────────────────────────────────

  getScanState(source: string, filePath: string): ScanState | undefined {
    const row = this.sqlite.prepare(`
      SELECT source, file_path as filePath, last_offset as lastOffset, last_mtime as lastMtime
      FROM scan_state WHERE source = ? AND file_path = ?
    `).get(source, filePath) as ScanState | undefined;
    return row;
  }

  /** Every scan_state row of one source, keyed by file path (one query per scan, not one per file). */
  getScanStates(source: string): Map<string, ScanState> {
    const rows = this.sqlite.prepare(`
      SELECT source, file_path as filePath, last_offset as lastOffset, last_mtime as lastMtime
      FROM scan_state WHERE source = ?
    `).all(source) as ScanState[];
    return new Map(rows.map((r) => [r.filePath, r]));
  }

  /** Upsert many scan_state rows in ONE transaction. */
  upsertScanStates(states: ScanState[]): void {
    if (states.length === 0) return;
    const stmt = this.sqlite.prepare(`
      INSERT INTO scan_state (source, file_path, last_offset, last_mtime, last_scanned_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source, file_path) DO UPDATE SET
        last_offset = excluded.last_offset,
        last_mtime = excluded.last_mtime,
        last_scanned_at = excluded.last_scanned_at
    `);
    const now = new Date().toISOString();
    this.sqlite.transaction(() => {
      for (const st of states) stmt.run(st.source, st.filePath, st.lastOffset, st.lastMtime, now);
    })();
  }

  upsertScanState(state: ScanState): void {
    this.sqlite.prepare(`
      INSERT INTO scan_state (source, file_path, last_offset, last_mtime, last_scanned_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source, file_path) DO UPDATE SET
        last_offset = excluded.last_offset,
        last_mtime = excluded.last_mtime,
        last_scanned_at = excluded.last_scanned_at
    `).run(state.source, state.filePath, state.lastOffset, state.lastMtime, new Date().toISOString());
  }

  // ─── Aggregations ──────────────────────────────────────────────

  totals(filter: TokenUsageFilter): TokenUsageTotals {
    const { sql, params } = this.aggregateParts(filter);
    if (!sql) return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    const row = this.sqlite.prepare(`
      SELECT COALESCE(SUM(inputTokens), 0) inputTokens,
        COALESCE(SUM(outputTokens), 0) outputTokens,
        COALESCE(SUM(cacheReadTokens), 0) cacheReadTokens,
        COALESCE(SUM(cacheCreationTokens), 0) cacheCreationTokens
      FROM (${sql})
    `).get(...params) as TokenUsageTotals;
    return row;
  }

  byDay(filter: TokenUsageFilter): TokenUsageByDay[] {
    const { sql, params } = this.aggregateParts(filter);
    if (!sql) return [];
    const rows = this.sqlite.prepare(`
      SELECT substr(day, 1, 10) date, SUM(inputTokens) inputTokens,
        SUM(outputTokens) outputTokens, SUM(cacheReadTokens) cacheReadTokens,
        SUM(cacheCreationTokens) cacheCreationTokens
      FROM (${sql}) GROUP BY day ORDER BY day
    `).all(...params) as TokenUsageByDay[];
    return rows;
  }

  byModel(filter: TokenUsageFilter): TokenUsageByModel[] {
    const { sql, params } = this.aggregateParts(filter);
    if (!sql) return [];
    const rows = this.sqlite.prepare(`
      SELECT
        model,
        SUM(inputTokens) inputTokens, SUM(outputTokens) outputTokens,
        SUM(cacheReadTokens) cacheReadTokens, SUM(cacheCreationTokens) cacheCreationTokens,
        SUM(inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens) totalTokens
      FROM (${sql})
      GROUP BY model
      ORDER BY totalTokens DESC
    `).all(...params) as TokenUsageByModel[];
    return rows;
  }

  byProject(filter: TokenUsageFilter): TokenUsageByProject[] {
    const { sql, params } = this.aggregateParts(filter);
    if (!sql) return [];
    const rows = this.sqlite.prepare(`
      SELECT
        CASE WHEN project_is_null = 1 THEN '(unknown)' ELSE project END as project,
        SUM(inputTokens) inputTokens, SUM(outputTokens) outputTokens,
        SUM(cacheReadTokens) cacheReadTokens, SUM(cacheCreationTokens) cacheCreationTokens,
        SUM(inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens) totalTokens,
        GROUP_CONCAT(DISTINCT source) sources
      FROM (${sql}) GROUP BY project, project_is_null
      ORDER BY totalTokens DESC
    `).all(...params) as TokenUsageByProject[];
    return rows;
  }

  byHourDay(filter: TokenUsageFilter): TokenUsageByHourDay[] {
    const { sql, params } = applyOptionalFilters(filter);
    // SQLite's strftime returns '0' (Sun) through '6' (Sat) for %w.
    const rows = this.sqlite.prepare(`
      SELECT
        CAST(strftime('%w', occurred_at) AS INTEGER) as dayOfWeek,
        CAST(strftime('%H', occurred_at) AS INTEGER) as hour,
        COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens), 0) as totalTokens
      FROM token_usage WHERE ${sql}
      GROUP BY dayOfWeek, hour
    `).all(...params) as TokenUsageByHourDay[];
    return rows;
  }

  topSessions(filter: TokenUsageFilter, limit = 20): TopSession[] {
    const { sql, params } = applyOptionalFilters(filter);
    const rows = this.sqlite.prepare(`
      SELECT
        session_id as sessionId,
        MAX(project) as project,
        MAX(model) as model,
        MIN(occurred_at) as startedAt,
        MAX(occurred_at) as endedAt,
        COUNT(*) as messageCount,
        COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens), 0) as totalTokens,
        MAX(source) as source
      FROM token_usage WHERE ${sql} AND session_id IS NOT NULL
      GROUP BY session_id
      ORDER BY totalTokens DESC
      LIMIT ?
    `).all(...params, limit) as TopSession[];
    return rows;
  }

  private aggregateParts(filter: TokenUsageFilter): { sql: string; params: (string | number)[] } {
    const empty = { sql: '', params: [] as (string | number)[] };
    if (filter.from > filter.to) return empty;
    const fromDate = Date.parse(filter.from);
    const toDate = Date.parse(filter.to);
    const hasDates = Number.isFinite(fromDate) && Number.isFinite(toDate);
    const fromDay = filter.from.slice(0, 10);
    const toDay = filter.to.slice(0, 10);
    this.watermarkStatement ??= this.sqlite.prepare("SELECT value FROM token_usage_meta WHERE key='pruned_before'");
    const watermark = (this.watermarkStatement.get({}) as { value: string } | undefined)?.value ?? '';
    const firstFull = filter.from.length === 10 || /^T00:00:00(?:\.000)?(?:Z|[+-]\d{2}:\d{2})?$/.test(filter.from.slice(10));
    const lastFull = filter.to.length === 10 || /^T23:59:59(?:\.999)?(?:Z|[+-]\d{2}:\d{2})?$/.test(filter.to.slice(10));

    const branches: string[] = [];
    const params: (string | number)[] = [];
    const filtersFor = (rollup: boolean) => {
      const clauses: string[] = [];
      const values: (string | number)[] = [];
      if (filter.source) { clauses.push('source = ?'); values.push(filter.source); }
      if (filter.model) { clauses.push('model = ?'); values.push(filter.model); }
      if (filter.project) {
        clauses.push(rollup ? 'project_is_null = 0 AND project = ?' : 'project = ?');
        values.push(filter.project);
      }
      return { clause: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', values };
    };
    const rollup = (from: string, to: string) => {
      if (from > to) return;
      const f = filtersFor(true);
      branches.push(`SELECT day, source, model, project, project_is_null, input_tokens inputTokens, output_tokens outputTokens, cache_read_tokens cacheReadTokens, cache_creation_tokens cacheCreationTokens FROM token_usage_daily WHERE day >= ? AND day <= ?${f.clause}`);
      params.push(from, to, ...f.values);
    };
    const raw = (from: string, to: string) => {
      if (from > to) return;
      const f = filtersFor(false);
      const rawFilters = f.clause
        .replace(/\bsource = \?/g, '+source = ?')
        .replace(/\bmodel = \?/g, '+model = ?')
        .replace(/\bproject = \?/g, '+project = ?');
      branches.push(`SELECT substr(occurred_at,1,10) day, source, model, COALESCE(project,'') AS project, (project IS NULL) AS project_is_null, input_tokens inputTokens, output_tokens outputTokens, cache_read_tokens cacheReadTokens, cache_creation_tokens cacheCreationTokens FROM token_usage WHERE occurred_at >= ? AND occurred_at <= ?${rawFilters}`);
      params.push(from, to, ...f.values);
    };

    // Interior full days always come from rollups. Partial edge days use raw
    // rows while retained; after pruning, use the complete lexical day rollup.
    if (!hasDates) {
      raw(filter.from, filter.to);
      return branches.length ? { sql: branches.join(' UNION ALL '), params } : empty;
    }
    const interiorStart = firstFull ? fromDay : addDay(fromDay);
    const interiorEnd = lastFull ? toDay : previousDay(toDay);
    rollup(interiorStart, interiorEnd);

    const edgeDays = new Set<string>();
    if (!firstFull) edgeDays.add(fromDay);
    if (!lastFull) edgeDays.add(toDay);
    for (const day of edgeDays) {
      if (watermark && day < watermark.slice(0, 10)) {
        rollup(day, day);
      } else {
        const lower = day === fromDay ? filter.from : `${day}T00:00:00`;
        const upper = day === toDay ? filter.to : `${addDay(day)}T00:00:00.000Z`;
        raw(lower, upper);
      }
    }
    // A single-day full range has no partial edge and is covered above.
    return branches.length ? { sql: branches.join(' UNION ALL '), params } : empty;
  }

  async pruneBefore(cutoff: string, opts?: { signal?: AbortSignal }): Promise<number> {
    if (typeof cutoff !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(cutoff)
      || !Number.isFinite(Date.parse(cutoff)) || cutoff.slice(0, 10) !== new Date(Date.parse(cutoff)).toISOString().slice(0, 10)) {
      throw new TypeError('Invalid token usage retention cutoff');
    }
    const cutoffDay = `${cutoff.slice(0, 10)}T00:00:00.000Z`;
    const raise = this.sqlite.transaction(() => {
      this.sqlite.prepare(`UPDATE token_usage_meta SET value = CASE WHEN value > ? THEN value ELSE ? END WHERE key='pruned_before'`).run(cutoffDay, cutoffDay);
    });
    raise.immediate();
    let removed = 0;
    while (!opts?.signal?.aborted) {
      const batch = this.sqlite.transaction(() => this.sqlite.prepare(`DELETE FROM token_usage WHERE rowid IN (
        SELECT rowid FROM token_usage WHERE occurred_at < ? ORDER BY occurred_at, rowid LIMIT 5000
      )`).run(cutoffDay).changes);
      const count = batch.immediate();
      removed += count;
      if (count < 5000) break;
      await yieldImmediate();
    }
    return removed;
  }
}
