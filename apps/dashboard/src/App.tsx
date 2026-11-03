import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, Navigate, useLocation, useParams } from 'react-router-dom';

declare const __APP_VERSION__: string;
import { Layout, NavigationShortcuts } from './components/Layout.js';
import { HomePage } from './pages/HomePage.js';
import { StatsPage, PlanStatsPage } from './pages/StatsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { WidgetsPage } from './pages/WidgetsPage.js';
import { PlansPage } from './pages/PlansPage.js';
import { TokenConsumptionPage } from './pages/TokenConsumptionPage.js';
import { ProvidersPage } from './pages/ProvidersPage.js';
import { SetupPage } from './pages/SetupPage.js';
import { UpgradePage } from './pages/UpgradePage.js';
import { api } from './api/client.js';
import { UpdateChecker } from './components/UpdateChecker.js';
import { CommandPalette } from './navigation/CommandPalette.js';
import { compatibilityRedirects } from './navigation/routes.js';

const StatsRoutes = () => {
  const { pathname } = useLocation();
  if (pathname === '/insights/plans') return <PlanStatsPage />;
  if (pathname === '/insights/tokens') return <TokenConsumptionPage />;
  return <StatsPage />;
};
function LegacyRedirect() {
  const { pathname, search } = useLocation();
  const target = compatibilityRedirects[pathname];
  return target ? <Navigate to={{ pathname: target, search }} replace /> : null;
}
function KnowledgeEntryRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const edit = params.get('edit');
  return edit ? <Navigate to={{ pathname: `/knowledge/${encodeURIComponent(edit)}`, search }} replace /> : <HomePage />;
}
function PlanDetailRedirect() {
  const { pathname, search } = useLocation();
  const { id } = useParams();
  const initializedPath = useRef('');
  const params = new URLSearchParams(search);
  const select = params.get('select') || id;
  if (id && !params.has('select')) {
    if (initializedPath.current === pathname) return <Navigate to={{ pathname: '/plans', search: params.get('scope') ? `?scope=${encodeURIComponent(params.get('scope')!)}` : '' }} replace />;
    initializedPath.current = pathname;
    params.set('select', id);
    return <Navigate to={{ pathname: `/plans/${encodeURIComponent(id)}`, search: `?${params}` }} replace />;
  }
  if (select && id !== select) return <Navigate to={{ pathname: `/plans/${encodeURIComponent(select)}`, search }} replace />;
  return <PlansPage />;
}
function KnowledgeDetailRoute() {
  const { pathname, search } = useLocation();
  const { id } = useParams();
  const initializedPath = useRef('');
  const params = new URLSearchParams(search);
  if (id && !params.has('edit')) {
    if (initializedPath.current === pathname) return <Navigate to={{ pathname: '/knowledge', search: params.get('scope') ? `?scope=${encodeURIComponent(params.get('scope')!)}` : '' }} replace />;
    initializedPath.current = pathname;
    params.set('edit', id);
    return <Navigate to={{ pathname, search: `?${params}` }} replace />;
  }
  return <HomePage />;
}

const DesignPage = lazy(() => import('./pages/DesignPage.js').then((module) => ({ default: module.DesignPage })));

const isTauri = !!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__;

function WidgetEventListener() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isTauri) return;
    const unlisteners: (() => void)[] = [];
    import('@tauri-apps/api/event').then(({ listen }) => {
      const showMainWindow = () => {
        import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
          const win = getCurrentWindow();
          win.show();
          win.setFocus();
        }).catch(() => {});
      };

      listen<string>('open-plan', (event) => {
        navigate(`/plans/${encodeURIComponent(event.payload)}`);
        showMainWindow();
      }).then((fn) => unlisteners.push(fn));

      listen<string>('navigate', (event) => {
        navigate(event.payload);
        showMainWindow();
      }).then((fn) => unlisteners.push(fn));
    });
    return () => { unlisteners.forEach(fn => fn()); };
  }, [navigate]);

  return null;
}

// Hidden entry to the internal design preview (U.0.2): Ctrl/Cmd+Shift+D.
function DesignShortcut() {
  const navigate = useNavigate();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        navigate('/_design');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);
  return null;
}

function DashboardNavigation() {
  const { pathname } = useLocation();
  if (pathname === '/_design' || pathname.startsWith('/_design/')) return null;
  return <><CommandPalette /><NavigationShortcuts /></>;
}

type AppState = 'loading' | 'setup' | 'upgrade' | 'ready';

export function App() {
  const [state, setState] = useState<AppState>('loading');
  const [upgradeFrom, setUpgradeFrom] = useState<string>('');
  // What the boot sequence is waiting on, so the loading screen says something.
  const [loadingPhase, setLoadingPhase] = useState('Checking setup…');

  useEffect(() => {
    (async () => {
      try {
        // 1. Check if setup is needed
        const status = await api.getSetupStatus();
        if (!status.allReady) {
          setState('setup');
          return;
        }

        // 2. Check if upgrade is needed. The upgrade itself runs on the upgrade
        // screen, which shows its progress — it used to run silently here, and a
        // long one (re-embed, artifact redeploy) looked like a frozen app.
        setLoadingPhase('Checking version…');
        const upgrade = await api.checkUpgrade();
        if (upgrade.needsUpgrade) {
          setUpgradeFrom(upgrade.fromVersion || '?');
          setState('upgrade');
          return;
        }

        // 3. First install — save version (no upgrade screen needed)
        if (upgrade.isFirstInstall) {
          // Version will be saved by setup/complete hook
        }

        setState('ready');
      } catch {
        setState('setup');
      }
    })();
  }, []);

  const renderScreen = () => {
    // Loading
    if (state === 'loading') {
      return (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100vh', background: 'var(--bg-main)', color: 'var(--text-secondary)',
          flexDirection: 'column', gap: 8,
        }}>
          <div style={{ fontSize: 36 }}>🧠</div>
          <span>{loadingPhase}</span>
          <span style={{ fontSize: 10, opacity: 0.5 }}>v{__APP_VERSION__}</span>
        </div>
      );
    }

    // Setup wizard (first install)
    if (state === 'setup') {
      return <SetupPage onComplete={() => setState('ready')} />;
    }

    // Upgrade screen (version changed)
    if (state === 'upgrade') {
      return <UpgradePage fromVersion={upgradeFrom} onComplete={() => setState('ready')} />;
    }

    // Normal dashboard
    return (
        <Routes>
          <Route path="/_design/*" element={<Suspense fallback={<div>Loading…</div>}><DesignPage /></Suspense>} />
          <Route path="*" element={<>
            <UpdateChecker />
            <WidgetEventListener />
            <Layout>
              <Routes>
                <Route path="/" element={<KnowledgeEntryRedirect />} />
                <Route path="/knowledge/tags" element={<SettingsPage />} />
                <Route path="/knowledge/:id" element={<KnowledgeDetailRoute />} />
                <Route path="/knowledge/*" element={<HomePage />} />
                <Route path="/plans/:id" element={<PlanDetailRedirect />} />
                <Route path="/plans" element={<PlanDetailRedirect />} />
                <Route path="/insights/*" element={<StatsRoutes />} />
                <Route path="/stats/*" element={<LegacyRedirect />} />
                <Route path="/tokens" element={<LegacyRedirect />} />
                <Route path="/providers" element={<LegacyRedirect />} />
                <Route path="/widgets" element={<LegacyRedirect />} />
                <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
                <Route path="/settings/*" element={<SettingsPage />} />
                <Route path="/curation/*" element={<SettingsPage />} />
                <Route path="/integrations/agents" element={<SettingsPage />} />
                <Route path="/integrations/providers" element={<ProvidersPage />} />
                <Route path="/integrations/widgets" element={<WidgetsPage />} />
                <Route path="/system/*" element={<SettingsPage />} />
              </Routes>
            </Layout>
          </>} />
        </Routes>
    );
  };

  // Register navigation before asynchronous boot checks can finish.
  return <BrowserRouter>
    <DesignShortcut />
    {(state === 'loading' || state === 'ready') && <DashboardNavigation />}
    {renderScreen()}
  </BrowserRouter>;
}
