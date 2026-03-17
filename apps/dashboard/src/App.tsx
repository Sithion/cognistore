import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { HomePage } from './pages/HomePage.js';
import { StatsPage } from './pages/StatsPage.js';
import { InfrastructurePage } from './pages/InfrastructurePage.js';
import { SetupPage } from './pages/SetupPage.js';
import { api } from './api/client.js';

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
      }}>
        Loading...
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
