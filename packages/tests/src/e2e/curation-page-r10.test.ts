import { randomUUID } from 'node:crypto';
import { createDbClient, CurationRepository, KnowledgeRepository } from '@cognistore/core';
import { test, expect } from '../ui/browser-fixture.js';

// Round 10 (4.1): the Curation page against the REAL sidecar and built dashboard, sandboxed HOME.
const vec = [1, ...Array(255).fill(0)];

test('@e2e curation page: approve, batch reject, undo, restore, tab state, language and g c', async ({ page, ui }) => {
  test.setTimeout(120_000);
  const connection = createDbClient(ui.dbPath);
  try {
    const repo = new KnowledgeRepository(connection.db, connection.sqlite);
    const curation = new CurationRepository(connection.sqlite);
    const entry = async (title: string) => (await repo.create({ title, content: `${title} body`, type: 'pattern', scope: 'workspace:r10', source: 'test', tags: [], embedding: vec } as never) as unknown as { id: string }).id;
    const propose = (id: string, reason: string) => {
      const row = curation.getEntry(id);
      const versions = { [id]: { version: row.version, contentHash: row.content_hash, scope: row.scope, status: row.status } };
      return curation.createAction({ id: randomUUID(), kind: 'trash', actor: 'curation', entryIds: [id], snapshot: curation.captureSnapshot([id]), confidence: 0.9,
        payload: { reason }, versions, key: `trash:${id}:${randomUUID()}`, now: new Date().toISOString(), undoExpiresAt: new Date(Date.now() + 86_400_000).toISOString() }).id as string;
    };
    const apply = async (actionId: string) => expect((await ui.call(`/api/curation/actions/${actionId}/apply`, { method: 'POST' })).status).toBe(200);

    const [e1, e2, e3, e4, e5] = [await entry('Approve me'), await entry('Reject one'), await entry('Reject two'), await entry('Undo me'), await entry('Restore me')];
    propose(e1, 'first'); propose(e2, 'second'); propose(e3, 'third');
    await apply(propose(e4, 'undo target'));
    await apply(propose(e5, 'restore target'));

    await page.goto(`${ui.url}/curation`);
    await expect(page.getByTestId('autonomy-banner')).toContainText('nothing is applied without your approval');
    await expect(page.getByTestId('pending-row')).toHaveCount(3);
    await expect(page.getByTestId('curation-badge')).toHaveText('3');

    // approve one
    await page.getByTestId('pending-row').filter({ hasText: 'Approve me' }).getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByTestId('pending-row')).toHaveCount(2);
    // batch reject the other two
    await page.getByTestId('select-all').check();
    await page.getByTestId('batch-reject').click();
    await expect(page.getByTestId('pending-empty')).toBeVisible();

    // undo one applied action
    await page.getByTestId('tab-applied').click();
    await expect(page).toHaveURL(/tab=applied/);
    await expect(page.getByTestId('applied-row')).toHaveCount(3);
    await page.getByTestId('applied-row').filter({ hasText: 'Undo me' }).getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('applied-row')).toHaveCount(2);

    // restore one trashed entry
    await page.getByTestId('tab-trash').click();
    await expect(page.getByTestId('trash-row')).toHaveCount(2);
    await page.getByTestId('trash-row').filter({ hasText: 'Restore me' }).getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByTestId('trash-row')).toHaveCount(1);

    // the tab survives a reload
    await page.reload();
    await expect(page.getByTestId('tab-trash')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('trash-row')).toHaveCount(1);

    // health tab
    await page.getByTestId('tab-health').click();
    await expect(page.getByTestId('health-panel')).toContainText('knowledge_entries');

    // language switch
    await page.addInitScript(() => localStorage.setItem('cognistore-lang', 'pt'));
    await page.reload();
    await expect(page.getByTestId('tab-trash')).toContainText('Lixeira');

    // keyboard shortcut g c from another screen
    await page.goto(`${ui.url}/plans`);
    await page.locator('body').click();
    await page.keyboard.press('g');
    await page.keyboard.press('c');
    await expect(page).toHaveURL(/\/curation/);
  } finally { connection.sqlite.close(); }
});

test('@e2e curation page shows agent-authored text inert', async ({ page, ui }) => {
  const connection = createDbClient(ui.dbPath);
  try {
    const repo = new KnowledgeRepository(connection.db, connection.sqlite);
    const curation = new CurationRepository(connection.sqlite);
    const id = (await repo.create({ title: '<img src=x onerror="window.__pwned=1">', content: 'body', type: 'pattern', scope: 'workspace:r10', source: 'test', tags: [], embedding: vec } as never) as unknown as { id: string }).id;
    const row = curation.getEntry(id);
    curation.createAction({ id: randomUUID(), kind: 'flag', actor: 'agent:claude-code', entryIds: [id], snapshot: curation.captureSnapshot([id]), payload: { reason: '<script>window.__pwned=2</script>' },
      versions: { [id]: { version: row.version, contentHash: row.content_hash, scope: row.scope, status: row.status } }, key: `flag:${id}`, now: new Date().toISOString(), undoExpiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    await page.goto(`${ui.url}/curation`);
    await expect(page.getByTestId('pending-row')).toContainText('<script>window.__pwned=2</script>');
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(await page.locator('[data-testid="pending-row"] script, [data-testid="pending-row"] img').count()).toBe(0);
  } finally { connection.sqlite.close(); }
});
