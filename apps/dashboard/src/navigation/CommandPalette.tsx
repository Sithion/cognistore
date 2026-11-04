import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { applicationRoutes } from './routes.js';

type Result = { label: string; path?: string; action?: () => void; detail?: string; scope?: string };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<Result[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('cognistore.route-recent') || '[]'); } catch { return []; } });
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const commands = useMemo(() => applicationRoutes.filter((route) => !route.hidden && route.id !== 'widgets' && route.path !== '/knowledge/:id' && route.path !== '/plans/:id').map((route) => ({ label: route.label, path: route.path })).concat([{ label: 'Review pending curation', path: '/curation?tab=pending' }, { label: 'Run curation', path: '/curation?tab=pending&run=1' }]), []);
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat || event.altKey || event.shiftKey) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen((value) => !value); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setRemote([]);
    setSelectedIndex(0);
    input.current?.focus();
    return () => {
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
      returnFocus.current = null;
    };
  }, [open]);
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) { setRemote([]); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const tags = [...q.matchAll(/(?:^|\s)tag:([^\s]+)/gi)].map((match) => match[1]);
        const scope = /(?:^|\s)scope:([^\s]+)/i.exec(q)?.[1];
        const textQuery = q.replace(/(?:^|\s)(?:tag:[^\s]+|scope:[^\s]+)/gi, ' ').trim();
        const knowledge = textQuery ? await api.search(textQuery, { ...(tags.length ? { tags } : {}), ...(scope ? { scope } : {}) }) : await api.listRecent(50, { ...(tags.length ? { tags } : {}), ...(scope ? { scope } : {}) });
        if (!active) return;
        const results = Array.isArray(knowledge) ? knowledge : [];
        setRemote(results.map((result: any) => {
          const item = result?.entry ?? result;
          const plan = item.type === 'plan';
          return { label: item.title, path: `${plan ? '/plans' : '/knowledge'}/${encodeURIComponent(item.id)}`, scope: item.scope, detail: `${plan ? 'Plan' : 'Knowledge'} · ${(item.tags || []).join(', ')} · ${item.scope || ''}` };
        }));
      } catch { if (active) setRemote([]); }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, query]);
  if (!open) return null;
  const lower = query.toLowerCase();
  const routeMatches = commands.filter((item) => `${item.label} ${item.path}`.toLowerCase().includes(lower));
  const contextual: Result[] = location.pathname.startsWith('/knowledge') ? [{ label: 'New knowledge entry', action: () => document.querySelector<HTMLButtonElement>('button[title="Add New Knowledge"],button[title="Adicionar Conhecimento"]')?.click(), detail: 'Action' }] : [];
  const contextMatches = contextual.filter((item) => item.label.toLowerCase().includes(lower));
  const results: Result[] = [...remote, ...routeMatches, ...contextMatches];
  const close = () => setOpen(false);
  const go = (result: Result) => {
    if (result.path) {
      const scope = result.scope || new URLSearchParams(location.search).get('scope');
      const params = new URLSearchParams();
      if (scope) params.set('scope', scope);
      if (result.path !== location.pathname || params.toString() !== new URLSearchParams(location.search).toString()) returnFocus.current = null;
      navigate({ pathname: result.path, search: params.toString() ? `?${params}` : '' });
      const next = [result.path, ...recent.filter((path) => path !== result.path)].slice(0, 8);
      setRecent(next); localStorage.setItem('cognistore.route-recent', JSON.stringify(next));
    } else result.action?.();
    close();
  };
  return <div className="command-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={(event) => {
      if (event.key === 'Escape') { close(); return; }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length) {
        event.preventDefault();
        const next = (selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
        setSelectedIndex(next);
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-command-index="${next}"]`)?.focus());
      }
      if (event.key === 'Enter' && results[selectedIndex]) { event.preventDefault(); go(results[selectedIndex]); }
    }}>
      <input aria-label="Search knowledge, plans, tags, scopes, or commands" ref={input} data-testid="command-search" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0); }} placeholder="Search knowledge, plans, tags, scopes, or commands…" />
      {!query && recent.length > 0 && <div className="command-recent" role="listbox" aria-label="Recent pages"><small>Recent</small>{recent.map((path) => <button role="option" aria-selected={false} key={path} onClick={() => go({ label: path, path })}>{path}</button>)}</div>}
      <div className="command-results" role="listbox" aria-label="Search results">{results.map((result, index) => <button role="option" aria-selected={index === selectedIndex} data-command-index={index} tabIndex={index === selectedIndex ? 0 : -1} key={`${result.path ?? result.label}-${index}`} onFocus={() => setSelectedIndex(index)} onClick={() => go(result)}><span>{result.label}</span><small>{result.path ? `${result.path}${result.detail ? ` · ${result.detail}` : ''}` : result.detail}</small></button>)}</div>
      <footer>↑↓ navigate · Enter open · Esc close</footer>
    </section>
  </div>;
}
