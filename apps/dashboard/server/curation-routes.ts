import type { FastifyInstance } from 'fastify';
import type { CurationScheduler, SchedulerStore } from './curation-scheduler.js';
import type { createModelManager } from './curation-models.js';
import type { AppSettings } from './settings.js';

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emptyBody = (body: unknown) => body === undefined || body !== null && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0;
export function registerCurationRoutes(app: FastifyInstance, deps: {
  sdk: any; scheduler: CurationScheduler; store: SchedulerStore;
  db(): { prepare(sql: string): any } | undefined;
  settings(): AppSettings;
  models: ReturnType<typeof createModelManager>;
  ensureReady(reply: any): unknown;
  excluded(): boolean;
  sendError(reply: any, code: number, error: string): unknown;
}) {
  const fail = deps.sendError;
  const actionColumns = 'a.id,a.kind,a.status,a.confidence,a.entry_ids';
  const summary = (row: any) => {
    const entryIds = JSON.parse(row.entry_ids) as string[];
    const titles = entryIds.map(id => deps.db()!.prepare('SELECT title FROM knowledge_entries WHERE id=?').get(id)?.title ?? null);
    return { id: row.id, kind: row.kind, status: row.status, confidence: row.confidence, titles, entryIds };
  };
  const handleError = (reply: any, error: any) => {
    if (error.statusCode === 400 || error.statusCode === 409 || error.statusCode === 503) return fail(reply, error.statusCode, error.message);
    if (/stale|protect|conflict|expired|pending|lease|disabled/i.test(error.message)) return fail(reply, 409, 'Curation action conflicts with current state');
    throw error;
  };
  app.post('/api/curation/run', async (request, reply) => {
    const ready = deps.ensureReady(reply); if (ready) return ready;
    const body = request.body === undefined ? {} : request.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => k !== 'runId') ||
        ('runId' in body && (typeof body.runId !== 'string' || !idPattern.test(body.runId)))) return fail(reply, 400, 'Invalid run body');
    try { return reply.code(202).send(deps.scheduler.manual((body as { runId?: string }).runId)); }
    catch (error) { return handleError(reply, error); }
  });
  app.get<{ Params: { id: string } }>('/api/curation/runs/:id', async (request, reply) => {
    const ready = deps.ensureReady(reply); if (ready) return ready;
    if (!idPattern.test(request.params.id)) return fail(reply, 400, 'Invalid run id');
    const run = deps.store.getRun(request.params.id);
    return run ? { run } : fail(reply, 404, 'Curation run not found');
  });
  app.get<{ Querystring: { scope?: string; limit?: string; cursor?: string } }>('/api/curation/queue', async (request, reply) => {
    const ready = deps.ensureReady(reply); if (ready) return ready;
    const { scope, limit: rawLimit, cursor } = request.query;
    if (Object.keys(request.query).some(k => !['scope','limit','cursor'].includes(k)) ||
        scope !== undefined && (typeof scope !== 'string' || !/^(global|workspace:[^\s]{1,200})$/.test(scope)) ||
        rawLimit !== undefined && (typeof rawLimit !== 'string' || !/^\d{1,3}$/.test(rawLimit) || +rawLimit < 1) ||
        cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 250)) return fail(reply, 400, 'Invalid queue query');
    const limit = Math.min(100, Number(rawLimit ?? 50));
    let after: [string, string] | null = null;
    if (cursor) {
      try {
        const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || !Number.isFinite(Date.parse(parsed[0])) || typeof parsed[1] !== 'string' || !idPattern.test(parsed[1])) throw new Error();
        after = parsed as [string, string];
      } catch { return fail(reply, 400, 'Invalid queue cursor'); }
    }
    const rows = deps.db()!.prepare(`SELECT ${actionColumns},a.created_at FROM curation_actions a
      WHERE a.status='proposed' AND (? IS NULL OR (a.created_at,a.id)>(?,?))
      AND (? IS NULL OR EXISTS (SELECT 1 FROM json_each(a.expected_versions) v WHERE json_extract(v.value,'$.scope')=?))
      ORDER BY a.created_at,a.id LIMIT ?`).all(after?.[0] ?? null, after?.[0] ?? '', after?.[1] ?? '', scope ?? null, scope ?? null, limit + 1);
    const page = rows.slice(0, limit), last = page.at(-1);
    return { actions: page.map(summary), nextCursor: rows.length > limit ? Buffer.from(JSON.stringify([last.created_at,last.id])).toString('base64url') : null };
  });
  // Entry content is fetched only for this one action, with bounded field sizes.
  app.get<{ Params: { id: string } }>('/api/curation/actions/:id', async (request, reply) => {
    const ready = deps.ensureReady(reply); if (ready) return ready;
    if (!idPattern.test(request.params.id)) return fail(reply, 400, 'Invalid action id');
    const row = deps.db()!.prepare(`SELECT ${actionColumns} FROM curation_actions a WHERE a.id=?`).get(request.params.id);
    if (!row) return fail(reply, 404, 'Curation action not found');
    const action = summary(row);
    const entries = action.entryIds.slice(0, 100).map(id => deps.db()!.prepare('SELECT id,title,substr(content,1,12000) AS content FROM knowledge_entries WHERE id=?').get(id)).filter(Boolean);
    return { action: { ...action, entries } };
  });
  for (const operation of ['apply','reject','undo'] as const) {
    app.post<{ Params: { id: string } }>(`/api/curation/actions/:id/${operation}`, async (request, reply) => {
      const ready = deps.ensureReady(reply); if (ready) return ready;
      if (!idPattern.test(request.params.id) || !emptyBody(request.body)) return fail(reply, 400, 'Invalid action request');
      if (deps.excluded()) return fail(reply, 409, 'Maintenance or upgrade is active');
      const read = () => deps.db()!.prepare(`SELECT ${actionColumns} FROM curation_actions a WHERE a.id=?`).get(request.params.id);
      if (!read()) return fail(reply, 404, 'Curation action not found');
      try {
        const method = { apply: 'applyCurationAction', reject: 'rejectCurationAction', undo: 'undoCurationAction' }[operation];
        const result = await deps.sdk[method](request.params.id, { signal: AbortSignal.timeout(60_000) });
        if (operation === 'apply' && !result.applied) return fail(reply, 409, 'Curation action is stale, protected, or conflicting');
        return { action: summary(read()) };
      } catch (error) { return handleError(reply, error); }
    });
  }
  app.post('/api/curation/model/prepare', async (request, reply) => {
    const ready = deps.ensureReady(reply); if (ready) return ready;
    if (!emptyBody(request.body)) return fail(reply, 400, 'Model preparation uses the configured model');
    if (deps.excluded()) return fail(reply, 409, 'Maintenance or upgrade is active');
    try { return await deps.models.prepare(deps.settings().curationModel); }
    catch (error: any) { return fail(reply, error.statusCode === 400 ? 400 : 503, 'Model preparation unavailable; retry to recover pending installation'); }
  });
}
