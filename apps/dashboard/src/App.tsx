import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { HomePage } from './pages/HomePage.js';
import { StatsPage } from './pages/StatsPage.js';
import { InfrastructurePage } from './pages/InfrastructurePage.js';

export function App() {
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
