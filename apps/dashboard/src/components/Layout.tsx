import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

declare const __APP_VERSION__: string;

const navItems = [
  { key: 'home', path: '/', icon: '🔍' },
  { key: 'plans', path: '/plans', icon: '📋' },
  { key: 'stats', path: '/stats', icon: '📊' },
  { key: 'settings', path: '/settings', icon: '⚙' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

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
