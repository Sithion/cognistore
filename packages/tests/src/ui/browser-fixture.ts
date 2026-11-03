import { test as base, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  SERVER_ENTRY, TEST_TOKEN, authFetch, getFreePort, spawnSidecar,
  startMockOllama, stopSidecar, waitForSidecar,
} from '../sidecar-helpers.js';

export type UI = {
  url: string;
  entryId: string;
  planId: string;
  call(path: string, init?: RequestInit): Promise<Response>;
};

export const test = base.extend<{ ui: UI }>({
  ui: async ({ page }, use) => {
    const home = mkdtempSync(join(tmpdir(), 'cognistore-ui-r8-'));
    mkdirSync(join(home, '.cognistore'), { recursive: true });
    const mock = await startMockOllama('nomic-embed-text');
    const port = await getFreePort();
    const url = `http://127.0.0.1:${port}`;
    const { child, readLog } = spawnSidecar({
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      COGNISTORE_HOME: join(home, '.cognistore'),
      COGNISTORE_MANAGED: '0',
      SQLITE_PATH: join(home, '.cognistore', 'knowledge.db'),
      DASHBOARD_PORT: String(port),
      SIDECAR_TOKEN: TEST_TOKEN,
      OLLAMA_HOST: `http://127.0.0.1:${mock.port}`,
      OLLAMA_MODEL: 'nomic-embed-text',
      DASHBOARD_DIST_PATH: resolve(dirname(SERVER_ENTRY), '../dist'),
    });
    try {
      expect(await waitForSidecar(url), readLog()).toBe(true);
      const call = (path: string, init?: RequestInit) => authFetch(`${url}${path}`, init);
      const create = async (path: string, body: object) => {
        const response = await call(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        expect(response.ok, await response.clone().text()).toBe(true);
        return response.json() as Promise<{ id: string }>;
      };
      const entry = await create('/api/knowledge', {
        title: 'Round eight knowledge',
        content: 'A searchable fixture about semantic navigation.',
        type: 'pattern', tags: ['round-eight'], scope: 'workspace:r8',
        source: 'round-eight-fixture',
      });
      const plan = await create('/api/plans', {
        title: 'Round eight plan', content: 'Deliver the new interface.',
        tags: ['round-eight'], scope: 'workspace:r8',
        source: 'round-eight-fixture',
        tasks: [{ description: 'Migrate screens', priority: 'medium' }],
      });
      await page.addInitScript(token => {
        (window as any).__COGNISTORE_TOKEN__ = token;
        localStorage.setItem('cognistore-lang', 'en');
      }, TEST_TOKEN);
      await page.route('**/api/setup/status', route => route.fulfill({ json: { allReady: true } }));
      await page.route('**/api/upgrade/check', route => route.fulfill({ json: {
        needsUpgrade: false, fromVersion: null,
        toVersion: '2.5.4', isFirstInstall: false,
      } }));
      await use({ url, entryId: entry.id, planId: plan.id, call });
    } finally {
      await stopSidecar(child);
      await new Promise<void>(done => mock.server.close(() => done()));
      rmSync(home, { recursive: true, force: true });
    }
  },
});
export { expect };
