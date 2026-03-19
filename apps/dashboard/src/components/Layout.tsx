import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { triggerUpdateCheck, onUpdateState } from './UpdateChecker.js';

declare const __APP_VERSION__: string;

const navItems = [
  { key: 'home', path: '/', icon: '🔍' },
  { key: 'stats', path: '/stats', icon: '📊' },
  { key: 'monitoring', path: '/monitoring', icon: '⚙' },
];

const languages = [
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'pt', label: 'PT' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [updateState, setUpdateState] = useState<string>('idle');
  const [checkResult, setCheckResult] = useState<string | null>(null);

  useEffect(() => {
    return onUpdateState((state) => {
      setUpdateState(state);
      if (state === 'idle') {
        // Show "up to date" briefly after a manual check
        if (updateState === 'checking') {
          setCheckResult('upToDate');
          setTimeout(() => setCheckResult(null), 3000);
        }
      } else if (state === 'available') {
        setCheckResult('available');
        setTimeout(() => setCheckResult(null), 3000);
      }
    });
  }, [updateState]);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: collapsed ? 60 : 220,
          backgroundColor: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border)',
          padding: collapsed ? '16px 8px' : '16px',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.2s ease',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          {!collapsed && (
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>
              🧠 {t('app.title')}
            </span>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{
              background: 'none', border: 'none', color: 'var(--text-secondary)',
              cursor: 'pointer', fontSize: 18, padding: 4,
            }}
          >
            {collapsed ? '→' : '←'}
          </button>
        </div>

        <nav style={{ flex: 1 }}>
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.key}
                to={item.path}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', marginBottom: 4, borderRadius: 8,
                  textDecoration: 'none',
                  backgroundColor: active ? 'var(--accent)' : 'transparent',
                  color: active ? '#fff' : 'var(--text-secondary)',
                  fontSize: 14, transition: 'all 0.15s ease',
                }}
              >
                <span>{item.icon}</span>
                {!collapsed && <span>{t(`nav.${item.key}`)}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Check for Updates */}
        {!collapsed && (
          <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)', marginBottom: 8, textAlign: 'center' }}>
            <button
              onClick={() => {
                setCheckResult(null);
                triggerUpdateCheck();
              }}
              disabled={updateState === 'checking'}
              style={{
                background: 'none',
                border: 'none',
                color: checkResult === 'upToDate' ? 'var(--success)' : checkResult === 'available' ? 'var(--accent)' : 'var(--text-secondary)',
                cursor: updateState === 'checking' ? 'not-allowed' : 'pointer',
                fontSize: 11,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                margin: '0 auto',
                padding: '4px 0',
              }}
            >
              {updateState === 'checking' ? (
                <>
                  <span style={{
                    width: 10, height: 10,
                    border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
                    borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0,
                  }} />
                  {t('update.checking')}
                </>
              ) : checkResult === 'upToDate' ? (
                <>{t('update.upToDate')}</>
              ) : checkResult === 'available' ? (
                <>{t('update.available')}</>
              ) : (
                <>{t('update.check')}</>
              )}
            </button>
          </div>
        )}

        {/* Language Switcher */}
        <div style={{ display: 'flex', flexDirection: collapsed ? 'column' : 'row', alignItems: 'center', gap: 4, justifyContent: 'center', paddingTop: collapsed ? 12 : 0, borderTop: collapsed ? '1px solid var(--border)' : 'none' }}>
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => i18n.changeLanguage(lang.code)}
              style={{
                padding: '4px 8px', borderRadius: 4, border: 'none',
                backgroundColor: i18n.language === lang.code ? 'var(--accent)' : 'var(--bg-card)',
                color: i18n.language === lang.code ? '#fff' : 'var(--text-secondary)',
                cursor: 'pointer', fontSize: 11, fontWeight: 600,
              }}
            >
              {lang.label}
            </button>
          ))}
        </div>

        {/* Version Display */}
        {!collapsed && (
          <div style={{ textAlign: 'center', paddingTop: 8, fontSize: 10, color: 'var(--text-secondary)', opacity: 0.6 }}>
            v{__APP_VERSION__}
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main style={{ flex: 1, overflow: 'auto', padding: 24, backgroundColor: 'var(--bg-main)' }}>
        {children}
      </main>
    </div>
  );
}
