import { useEffect, useLayoutEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sidebar, SidebarContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuItem, SidebarProvider, SidebarTrigger } from './ui/sidebar.js';
import { applicationRoutes } from '../navigation/routes.js';
import { api } from '../api/client.js';

declare const __APP_VERSION__: string;
const navItems = applicationRoutes.filter((route) => route.sidebar).map((route) => ({
  path: route.path,
  key: route.id === 'knowledge' ? 'home' : route.id === 'plans' ? 'plans' : route.id === 'curation' ? 'curation' : route.id === 'insights-knowledge' ? 'stats' : route.id === 'providers' ? 'providers' : 'settings',
  icon: route.id === 'knowledge' ? '🔍' : route.id === 'plans' ? '📋' : route.id === 'curation' ? '🧹' : route.id === 'insights-knowledge' ? '📊' : route.id === 'agents' ? '⚙️' : '🔌',
}));
const activePath = (pathname: string, path: string) => path === '/' ? pathname === '/' || pathname.startsWith('/knowledge') : pathname === path || pathname.startsWith(`${path}/`);

export function Layout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('cognistore.sidebar.collapsed') === 'true');
  const [narrow, setNarrow] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches);
  const [peek, setPeek] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(max-width: 767px)');
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  useEffect(() => { setPeek(false); }, [narrow]);
  const compact = narrow ? !peek : collapsed;
  useEffect(() => { localStorage.setItem('cognistore.sidebar.collapsed', String(collapsed)); }, [collapsed]);
  // Pending curation count for the sidebar badge; silent on failure (background read).
  const [pending, setPending] = useState(0);
  useEffect(() => { let live = true; api.getCurationOverview().then(o => { if (live) setPending(o.pending); }).catch(() => {}); return () => { live = false; }; }, [location.pathname, location.search]);
  return <SidebarProvider open={!compact}>
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar data-testid="app-sidebar">
        <SidebarHeader>
          <span style={{ flex: 1, display: compact ? 'none' : undefined, fontWeight: 700, color: 'var(--accent)' }}><span aria-hidden="true">🧠</span> {t('app.title')}</span>
          <SidebarTrigger onClick={() => narrow ? setPeek(v => !v) : setCollapsed(v => !v)}>{compact ? '→' : '←'}</SidebarTrigger>
        </SidebarHeader>
        <SidebarContent><nav aria-label="Primary"><SidebarMenu>
          {navItems.map((item) => { const scope = new URLSearchParams(location.search).get('scope'); return <SidebarMenuItem key={item.path}><Link to={{ pathname: item.path, search: scope ? `?${new URLSearchParams({ scope })}` : '' }} aria-current={activePath(location.pathname, item.path) ? 'page' : undefined} className={`sidebar-link${activePath(location.pathname, item.path) ? ' is-active' : ''}`} title={t(`nav.${item.key}`)} aria-label={t(`nav.${item.key}`)}><span aria-hidden="true">{item.icon}</span>{!compact && <span>{t(`nav.${item.key}`)}</span>}{item.key === 'curation' && pending > 0 && <span data-testid="curation-badge" className="ml-auto rounded-full bg-primary px-2 text-xs text-primary-foreground">{pending}</span>}</Link></SidebarMenuItem>; })}
        </SidebarMenu></nav></SidebarContent>
        {!compact && <div style={{ padding: 12, fontSize: 10, color: 'var(--text-secondary)', textAlign: 'center' }}>v{__APP_VERSION__}</div>}
      </Sidebar>
      <SidebarInset className="shell-main"><div data-testid="route-content">{children}</div></SidebarInset>
    </div>
  </SidebarProvider>;
}

// Mounted with the router, including while the dashboard checks setup/version.
export function NavigationShortcuts() {
  const location = useLocation();
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const navTo = (path: string) => { const scope = new URLSearchParams(location.search).get('scope'); navigate({ pathname: path, search: scope ? `?${new URLSearchParams({ scope })}` : '' }); };
  useLayoutEffect(() => {
    let first = '';
    let timer = 0;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey || (event.shiftKey && event.key !== '?') || target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"],[aria-modal="true"]')) { first = ''; window.clearTimeout(timer); return; }
      if (event.key === 'Escape' && /^\/(knowledge|plans)\/[^/]+$/.test(location.pathname)) { navTo(location.pathname.startsWith('/plans/') ? '/plans' : '/knowledge'); return; }
      if (event.key === '/') { event.preventDefault(); document.querySelector<HTMLInputElement>('input[placeholder]')?.focus(); return; }
      if (event.key === '?') { setHelpOpen(true); return; }
      if (event.key === 'g') { first = 'g'; window.clearTimeout(timer); timer = window.setTimeout(() => { first = ''; }, 900); return; }
      if (first === 'g') {
        first = ''; window.clearTimeout(timer);
        const paths: Record<string, string> = { k: '/knowledge', p: '/plans', c: '/curation', i: '/insights/knowledge', s: '/settings/general' };
        if (paths[event.key]) navTo(paths[event.key]);
      } else if (event.key === 'n' && location.pathname.startsWith('/knowledge')) document.querySelector<HTMLButtonElement>('button[title="Add New Knowledge"],button[title="Adicionar Conhecimento"]')?.click();
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.clearTimeout(timer); };
  }, [location.pathname, location.search, navigate]);
  return <> {helpOpen && <div className="command-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpOpen(false); }}><section className="shortcut-help" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"><h2>Keyboard shortcuts</h2><p><kbd>g</kbd> then <kbd>k</kbd>, <kbd>p</kbd>, <kbd>c</kbd>, <kbd>i</kbd>, or <kbd>s</kbd> to navigate</p><p><kbd>/</kbd> search · <kbd>n</kbd> new knowledge · <kbd>Esc</kbd> close detail</p><button onClick={() => setHelpOpen(false)}>Close</button></section></div>} </>;
}
