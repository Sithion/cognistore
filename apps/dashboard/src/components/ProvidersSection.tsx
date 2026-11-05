import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { api, setProviderSecret, SIDECAR_TOKEN, type ProviderEntry } from '../api/client.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent } from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';
import { Switch } from '../components/ui/switch.js';
import { Label } from '../components/ui/label.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.js';
import { Badge } from '../components/ui/badge.js';
import { pageClass, pageTitleClass } from '../components/ui/control-styles.js';


// All providers are MCP connectors now. stdio = local subprocess; remote = Streamable HTTP.
const emptyStdio = (): ProviderEntry => ({ id: '', name: '', enabled: true, transport: 'stdio', mode: 'tool', command: '', toolName: 'search' });
const emptyRemote = (): ProviderEntry => ({ id: '', name: '', enabled: true, transport: 'http', mode: 'tool', url: '', toolName: 'search', auth: { type: 'none' } });

export function ProvidersSection() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [alwaysOn, setAlwaysOn] = useState(false);
  const [draft, setDraft] = useState<ProviderEntry | null>(null);
  const [secret, setSecret] = useState('');
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  // Per-provider in-flight guard (disables that provider's buttons; no double-submit).
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const snapshotRef = useRef<string | null>(null);

  const load = useCallback(() => {
    api.listProviders().then((c) => setProviders(c.providers)).catch(() => setProviders([]));
    api.getSettings().then((s) => setAlwaysOn(!!s.alwaysSearchExternalProviders)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  // 5s snapshot-poll for out-of-band provider changes (another window, config
  // edits, MCP). Only updates the LIST + alwaysOn — never touches `draft`,
  // `secret`, or `testResult`, so an open edit form is never clobbered.
  // SECURITY: the /api/providers response may contain stdio `env` secret
  // literals — never log or persist it; only the in-memory ref string is kept.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const [cfg, settings] = await Promise.all([api.listProviders(), api.getSettings()]);
        const snapshot = cfg.providers.map((p) => `${p.id}:${p.enabled}:${p.name}:${p.transport}`).join('|')
          + `|always:${!!settings.alwaysSearchExternalProviders}`;
        if (snapshotRef.current !== null && snapshot !== snapshotRef.current) {
          setProviders(cfg.providers);
          setAlwaysOn(!!settings.alwaysSearchExternalProviders);
        }
        snapshotRef.current = snapshot;
      } catch { /* ignore polling errors */ }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const withBusy = async (id: string, fn: () => Promise<void>) => {
    setBusy((prev) => new Set(prev).add(id));
    try { await fn(); } finally {
      setBusy((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const toggleAlways = async (v: boolean) => { setAlwaysOn(v); await api.updateSettings({ alwaysSearchExternalProviders: v }).catch(() => {}); };

  const toggleEnabled = (p: ProviderEntry) => withBusy(p.id, async () => {
    try { await api.updateProvider(p.id, { ...p, enabled: !p.enabled }); load(); } catch (e: any) { setError(e?.message ?? 'update failed'); }
  });
  const remove = (id: string) => withBusy(id, async () => {
    try {
      // Keychain first: if providers.json still lists the id, cleanup_provider_secrets
      // will catch it on uninstall even if the keychain delete failed here.
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('delete_provider_secret', { token: SIDECAR_TOKEN, id });
        await invoke('delete_oauth_tokens', { token: SIDECAR_TOKEN, id }); // clear the oauth keychain mirror too
      } catch { /* not Tauri or no secret */ }
      await api.deleteProvider(id);
      load();
    } catch (e: any) { setError(e?.message ?? 'delete failed'); }
  });
  const test = async (id: string) => {
    setTestResult((r) => ({ ...r, [id]: t('providers.testing') }));
    try {
      const res = await api.testProvider(id);
      const label = res.ok ? t('providers.testOk') : (res.needsAuth ? `🔑 ${res.message ?? 'needs auth'}` : `✕ ${res.message ?? ''}`);
      setTestResult((r) => ({ ...r, [id]: label }));
    } catch (e: any) { setTestResult((r) => ({ ...r, [id]: `✕ ${e?.message ?? ''}` })); }
  };
  // Interactive OAuth 2.1: Tauri reserves a loopback port → server builds the
  // authorization URL → Tauri opens the browser and captures the redirect → server
  // exchanges the code for tokens. Requires the desktop app (Tauri invoke).
  const connect = async (id: string) => {
    setTestResult((r) => ({ ...r, [id]: t('providers.connecting') }));
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { port, redirect_uri } = await invoke<{ port: number; redirect_uri: string }>('oauth_reserve');
      const started = await api.oauthStart(id, redirect_uri);
      if (started.alreadyConnected) { setTestResult((r) => ({ ...r, [id]: t('providers.connected') })); return; }
      if (!started.ok || !started.authorizeUrl) throw new Error(started.message ?? 'could not start OAuth');
      const cb = await invoke<{ code?: string; state?: string; error?: string }>('oauth_await', { port, authorizeUrl: started.authorizeUrl });
      if (cb.error || !cb.code) throw new Error(cb.error ?? 'no authorization code returned');
      const fin = await api.oauthFinish(id, cb.code);
      setTestResult((r) => ({ ...r, [id]: fin.ok ? t('providers.connected') : `✕ ${fin.message ?? ''}` }));
    } catch (e: any) {
      setTestResult((r) => ({ ...r, [id]: `✕ ${e?.message ?? String(e)}` }));
    }
  };

  const save = async () => {
    if (!draft) return;
    setError('');
    try {
      // Default secretRef to the provider id for static-header auth.
      const entry: ProviderEntry = draft.transport === 'http' && draft.auth?.type === 'header'
        ? { ...draft, auth: { ...draft.auth, secretRef: draft.auth.secretRef ?? draft.id } }
        : draft;
      const existing = providers.some((p) => p.id === entry.id);
      // Server write first — it's the source of truth. Keychain is best-effort after.
      if (existing) await api.updateProvider(entry.id, entry); else await api.addProvider(entry);
      if (secret && entry.transport === 'http' && entry.auth?.type === 'header') {
        const ref = entry.auth.secretRef ?? entry.id;
        await api.injectProviderSecret(entry.id, secret).catch(() => {});
        try { await setProviderSecret(ref, secret); } catch { /* not Tauri */ }
      }
      setDraft(null); setSecret(''); load();
    } catch (e: any) { setError(e?.message ?? 'save failed'); }
  };

  const isRemote = draft?.transport === 'http';

  return (
    <div className={pageClass}>
      <h1 className={pageTitleClass}>
        {t('providers.section')}
      </h1>
      <Button type="button" className="mb-3" onClick={() => { setDraft(emptyRemote()); setSecret(''); setError(''); }}>Add provider</Button>

      <Card className="mb-3"><CardContent className="flex items-center justify-between gap-4 p-4">
        <Label htmlFor="always-external" className="cursor-pointer"><span>{t('providers.alwaysOn')}</span><span className="mt-1 block text-xs text-muted-foreground">{t('providers.alwaysOnHint')}</span></Label>
        <Switch id="always-external" checked={alwaysOn} onCheckedChange={toggleAlways} />
      </CardContent></Card>

      {providers.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('providers.none')}</p>}
      {providers.map((p) => (
        <Card key={p.id} className="mb-3"><CardContent className="space-y-3 p-4">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span>
              <strong>{p.name}</strong>{' '}
              <Badge variant="outline" className="ml-2 text-[10px]">
                mcp · {p.transport}{p.transport === 'http' && p.auth?.type === 'oauth' ? ' · oauth' : ''}
              </Badge>
              {!p.enabled && <Badge variant="secondary">{t('providers.disabled')}</Badge>}
            </span>
            <span style={{ display: 'flex', gap: 6, opacity: busy.has(p.id) ? 0.5 : 1 }}>
              {p.transport === 'http' && p.auth?.type === 'oauth' && (
              <Button size="sm" variant="outline" disabled={busy.has(p.id)} onClick={() => connect(p.id)}>{t('providers.connect')}</Button>
              )}
              <Button size="sm" variant="outline" disabled={busy.has(p.id)} onClick={() => test(p.id)}>{t('providers.test')}</Button>
              <Button size="sm" variant="outline" disabled={busy.has(p.id)} onClick={() => toggleEnabled(p)}>{p.enabled ? t('providers.disable') : t('providers.enable')}</Button>
              <Button size="sm" variant="outline" disabled={busy.has(p.id)} onClick={() => { setDraft(JSON.parse(JSON.stringify(p))); setSecret(''); }}>{t('actions.edit')}</Button>
              <Button size="sm" variant="destructive" disabled={busy.has(p.id)} onClick={() => remove(p.id)}>{t('actions.delete')}</Button>
            </span>
          </div>
          {testResult[p.id] && <div style={{ fontSize: 11, marginTop: 6, color: 'var(--text-secondary)' }}>{testResult[p.id]}</div>}
        </CardContent></Card>
      ))}

      {!draft && (
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <Button variant="outline" onClick={() => setDraft(emptyStdio())}>+ {t('providers.addStdio')}</Button>
          <Button variant="outline" onClick={() => setDraft(emptyRemote())}>+ {t('providers.addRemote')}</Button>
        </div>
      )}

      {draft && (
        <Card><CardContent className="flex flex-col gap-3 p-4">
          <div style={{ display: 'flex', gap: 8 }}>
            <Input aria-label={t('providers.id')} placeholder={t('providers.id')} value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} />
            <Input aria-label={t('providers.name')} placeholder={t('providers.name')} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>

          {!isRemote ? (
            <Input aria-label={t('providers.commandPlaceholder')} placeholder={t('providers.commandPlaceholder')} value={draft.command ?? ''} onChange={(e) => setDraft({ ...draft, command: e.target.value })} />
          ) : (
            <>
              <Input aria-label={t('providers.urlPlaceholder')} placeholder={t('providers.urlPlaceholder')} value={draft.url ?? ''} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
              <div style={{ display: 'flex', gap: 8 }}>
                <Select value={draft.auth?.type ?? 'none'} onValueChange={(value) => setDraft({ ...draft, auth: { ...(draft.auth ?? { type: 'none' }), type: value as any } })}><SelectTrigger aria-label={t('providers.authNone')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t('providers.authNone')}</SelectItem><SelectItem value="header">{t('providers.authHeader')}</SelectItem><SelectItem value="oauth">OAuth 2.1</SelectItem></SelectContent></Select>
                {draft.auth?.type === 'header' && (
                  <Input aria-label={t('providers.secret')} type="password" autoComplete="new-password" placeholder={t('providers.secret')} value={secret} onChange={(e) => setSecret(e.target.value)} />
                )}
              </div>
              {draft.auth?.type === 'oauth' && (
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0 }}>{t('providers.oauthHint')}</p>
              )}
            </>
          )}

          <Input aria-label={t('providers.toolNamePlaceholder')} placeholder={t('providers.toolNamePlaceholder')} value={draft.toolName ?? ''} onChange={(e) => setDraft({ ...draft, toolName: e.target.value })} />

          {error && <div role="alert" className="text-sm text-destructive">{error}</div>}
          <div style={{ display: 'flex', gap: 6 }}>
            <Button onClick={save}>{t('actions.save')}</Button>
            <Button variant="outline" onClick={() => { setDraft(null); setSecret(''); setError(''); }}>{t('actions.cancel')}</Button>
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}
