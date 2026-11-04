// Probe the system WebKitGTK engine through its W3C WebDriver implementation.
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUTPUT_DIR, startHarness, TEST_TOKEN } from './design-harness.ts';

type Probe = { name: string; pass: boolean; detail: string };
const results: Probe[] = [];
const record = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail });
const freePort = async () => {
  const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening');
  const port = (s.address() as { port: number }).port; await new Promise<void>((r, j) => s.close(e => e ? j(e) : r())); return port;
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const h = await startHarness();
let proxy: Server | undefined;
let driver: ChildProcess | undefined;
let sessionId = '';
let driverUrl = '';
const request = async (path: string, method = 'GET', body?: unknown) => {
  const response = await fetch(`${driverUrl}${path}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return data as any;
};
const script = async (code: string, args: unknown[] = []) => (await request(`/session/${sessionId}/execute/sync`, 'POST', { script: code, args })).value;
const waitFor = async (condition: string, timeout = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await script(`return (${condition});`)) return; await sleep(150); }
  throw new Error(`Timed out waiting for ${condition}`);
};
const click = (selector: string) => script(`document.querySelector(${JSON.stringify(selector)})?.click(); return !!document.querySelector(${JSON.stringify(selector)});`);
const screenshot = async (name: string) => {
  const data = await request(`/session/${sessionId}/screenshot`);
  writeFileSync(join(OUTPUT_DIR, name), Buffer.from(data.value, 'base64'));
};
const check = async (name: string, fn: () => Promise<string | undefined>) => {
  try { const detail = await fn(); record(name, true, detail ?? 'passed'); }
  catch (e) { record(name, false, e instanceof Error ? e.message : String(e)); }
};
const key = async (value: string) => request(`/session/${sessionId}/actions`, 'POST', { actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value }, { type: 'keyUp', value }] }] });
const shortcut = async (modifier: string, value: string) => request(`/session/${sessionId}/actions`, 'POST', { actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: modifier }, { type: 'keyDown', value }, { type: 'keyUp', value }, { type: 'keyUp', value: modifier }] }] });
const navigateClient = (path: string) => script(`history.pushState({}, '', ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent('popstate')); return location.pathname;`);
const run = async () => {
  try {
    const proxyPort = await freePort();
    proxy = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${proxyPort}`);
      if (url.pathname === '/__token.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); res.end(`window.__COGNISTORE_TOKEN__=${JSON.stringify(TEST_TOKEN)};try{localStorage.setItem('cognistore.theme','dark')}catch(e){}`); return; }
      if (url.pathname === '/api/setup/status') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"allReady":true}'); return; }
      if (url.pathname === '/api/upgrade/check') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"needsUpgrade":false,"fromVersion":null,"toVersion":"0","isFirstInstall":false}'); return; }
      const headers = { ...req.headers };
      delete headers['accept-encoding'];
      headers.host = new URL(h.baseUrl).host;
      if (headers.origin) headers.origin = h.baseUrl;
      try {
        const upstream = await fetch(new URL(`${url.pathname}${url.search}`, h.baseUrl), { method: req.method, headers: headers as HeadersInit, body: ['GET', 'HEAD'].includes(req.method ?? '') ? undefined : req, duplex: 'half' } as RequestInit);
        const responseHeaders = new Headers(upstream.headers);
        responseHeaders.delete('content-length');
        const contentType = responseHeaders.get('content-type') ?? '';
        let body = await upstream.text();
        if (contentType.includes('text/html')) body = body.replace(/<head([^>]*)>/i, '<head$1><script src="/__token.js"></script>');
        res.writeHead(upstream.status, Object.fromEntries(responseHeaders.entries())); res.end(body);
      } catch (error) { res.writeHead(502); res.end(String(error)); }
    });
    proxy.listen(proxyPort, '127.0.0.1'); await once(proxy, 'listening');
    const webdriverPort = await freePort(); driverUrl = `http://127.0.0.1:${webdriverPort}`;
    driver = spawn('/usr/bin/WebKitWebDriver', [`--port=${webdriverPort}`], { stdio: 'ignore' });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`${driverUrl}/status`)).ok) break; } catch {} await sleep(100); }
    const created = await request('/session', 'POST', { capabilities: { alwaysMatch: { browserName: 'MiniBrowser', 'webkitgtk:browserOptions': { binary: '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser', args: ['--automation'] } } } });
    sessionId = created.value.sessionId;
    await request(`/session/${sessionId}/window/rect`, 'POST', { x: 0, y: 0, width: 1440, height: 900 });
    await request(`/session/${sessionId}/url`, 'POST', { url: `http://127.0.0.1:${proxyPort}/` });
    await waitFor("document.body && document.body.innerText.length > 0");
    await navigateClient('/_design/gallery');
    await check('Gallery heading renders', async () => { await waitFor("document.body.innerText.includes('Component gallery')"); return 'Component gallery visible'; });
    await check('Dark screenshot', async () => { await screenshot('design-dark-webkitgtk.png'); return 'written'; });
    await check('Theme switch and light screenshot', async () => { await script("document.querySelector('[role=switch]')?.click()"); await waitFor("!document.documentElement.classList.contains('dark')"); await screenshot('design-light-webkitgtk.png'); return 'theme switched and screenshot written'; });
    await check('Backdrop filter support', async () => { const v = await script("return [CSS.supports('backdrop-filter','blur(4px)'), CSS.supports('-webkit-backdrop-filter','blur(4px)')]"); return JSON.stringify(v); });
    await check('Select opens, picks, closes and restores focus', async () => { await click('[role=combobox]'); await waitFor("!!document.querySelector('[role=listbox]')"); await script("document.querySelector('[role=option]')?.click()"); await waitFor("!document.querySelector('[role=listbox]')"); return await script("return document.activeElement?.getAttribute('role') || document.activeElement?.tagName"); });
    await check('Dialog escape closes and restores focus', async () => { await waitFor("[...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='Open dialog')"); const clicked = await script("const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Open dialog'); if(!b) return false; b.click(); return true"); if (!clicked) throw new Error('Open dialog trigger not found'); await waitFor("!!document.querySelector('[role=dialog]')"); await key('\uE00C'); await waitFor("!document.querySelector('[role=dialog]')"); return await script("return document.activeElement?.textContent"); });
    await check('Toast appears', async () => { await script("[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Show toast'))?.click()"); await waitFor("!!document.querySelector('[data-sonner-toast]') || document.body.innerText.includes('Your changes have been saved')"); return await script("return document.querySelector('[data-sonner-toast]')?.innerText || 'Your changes have been saved'"); });
    await navigateClient('/_design');
    await check('Proof detail and route', async () => { await script("[...document.querySelectorAll('button')].find(x=>x.textContent.includes('A reliable design token'))?.click()"); await waitFor("!!document.querySelector('[data-testid=knowledge-detail]')?.innerText.includes('Prefer semantic color tokens to hardcoded values.')"); return await script("return location.pathname"); });
    await check('Palette filters and navigates', async () => { await shortcut('\uE009', 'k'); await waitFor("!!document.querySelector('[cmdk-root]')"); await script("const i=document.querySelector('[cmdk-input]'); i.value='event'; i.dispatchEvent(new Event('input',{bubbles:true}))"); await waitFor("document.querySelector('[cmdk-root]')?.innerText.includes('Avoid blocking the event loop')"); await key('\uE007'); await waitFor("location.pathname.includes('/_design/k/')"); await script("history.pushState({}, '', '/_design/k/'+document.querySelector('[data-testid=knowledge-detail]')?.innerText.match(/[0-9a-f-]{36}/)?.[0]); dispatchEvent(new PopStateEvent('popstate'))"); await waitFor("!!document.querySelector('[data-testid=knowledge-detail]')"); await shortcut('\uE009', 'k'); await waitFor("!!document.querySelector('[cmdk-root]')"); await screenshot('proof-list-panel-palette-webkitgtk.png'); return 'filtered, navigated, screenshot written'; });
    await check('Filter input shows a focus ring (box-shadow changes on keyboard focus)', async () => {
      await key('\uE00C');
      await script("history.pushState({}, '', '/_design'); dispatchEvent(new PopStateEvent('popstate')); return 1");
      await script("document.activeElement.blur(); return 1");
      await key('\uE004'); // establish keyboard modality so :focus-visible applies
      const raw = String(await script(`const el=document.querySelector('input[aria-label="Filter knowledge"]'); if(!el) return JSON.stringify({error:'filter input not found'}); el.blur(); const before=getComputedStyle(el).boxShadow; el.focus(); const s=getComputedStyle(el); return JSON.stringify({before,after:s.boxShadow,focusVisible:el.matches(':focus-visible')})`));
      const v = JSON.parse(raw);
      if (v.error) throw new Error(v.error);
      if (!v.focusVisible) throw new Error('filter input did not match :focus-visible after keyboard modality: ' + raw);
      if (v.after === v.before || v.after === 'none') throw new Error('no focus ring on filter input: ' + raw);
      return raw;
    });
  } catch (e) { record('Probe runner', false, e instanceof Error ? e.stack ?? e.message : String(e)); }
  finally {
    if (sessionId) { try { await request(`/session/${sessionId}`, 'DELETE'); } catch {} }
    if (driver) { driver.kill('SIGTERM'); }
    if (proxy) await new Promise<void>(resolve => proxy!.close(() => resolve()));
    await h.stop();
    writeFileSync(join(OUTPUT_DIR, 'webkitgtk-results.json'), JSON.stringify(results, null, 2));
    console.log('| Check | Pass | Detail |\n|---|---:|---|');
    for (const r of results) console.log(`| ${r.name.replaceAll('|', '\\|')} | ${r.pass ? 'yes' : 'no'} | ${r.detail.replaceAll('|', '\\|').replaceAll('\n', ' ')} |`);
  }
};
await run();
