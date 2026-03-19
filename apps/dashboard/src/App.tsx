import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

declare const __APP_VERSION__: string;
import { Layout } from './components/Layout.js';
import { HomePage } from './pages/HomePage.js';
import { StatsPage } from './pages/StatsPage.js';
import { InfrastructurePage } from './pages/InfrastructurePage.js';
import { SetupPage } from './pages/SetupPage.js';
import { api } from './api/client.js';
import { UpdateChecker } from './components/UpdateChecker.js';

export function App() {
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null);

  useEffect(() => {
    api.getSetupStatus()
      .then(status => setSetupNeeded(!status.allReady))
      .catch(() => setSetupNeeded(true));
  }, []);

  // Loading state while checking setup
  if (setupNeeded === null) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg-main)', color: 'var(--text-secondary)',
        flexDirection: 'column', gap: 8,
      }}>
        <div style={{ fontSize: 36 }}>🧠</div>
        <span>Loading...</span>
        <span style={{ fontSize: 10, opacity: 0.5 }}>v{__APP_VERSION__}</span>
      </div>
    );
  }

  // Show setup wizard if not configured
  if (setupNeeded) {
    return <SetupPage onComplete={() => setSetupNeeded(false)} />;
  }

  // Normal dashboard
  return (
    <BrowserRouter>
      <UpdateChecker />
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/infra" element={<InfrastructurePage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
