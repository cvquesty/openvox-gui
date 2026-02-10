import { Routes, Route } from 'react-router-dom';
import { AppShellLayout } from './components/AppShell';
import { DashboardPage } from './pages/Dashboard';
import { NodesPage } from './pages/Nodes';
import { NodeDetailPage } from './pages/NodeDetail';
import { ReportsPage } from './pages/Reports';
import { ENCGroupsPage } from './pages/ENCGroups';
import { ENCClassificationsPage } from './pages/ENCClassifications';
import { ENCRulesPage } from './pages/ENCRules';
import { ConfigPuppetPage } from './pages/ConfigPuppet';
import { ConfigPuppetDBPage } from './pages/ConfigPuppetDB';
import { ConfigAppPage } from './pages/ConfigApp';

export function App() {
  return (
    <Routes>
      <Route element={<AppShellLayout />}>
        {/* Monitoring */}
        <Route path="/" element={<DashboardPage />} />
        <Route path="/nodes" element={<NodesPage />} />
        <Route path="/nodes/:certname" element={<NodeDetailPage />} />
        <Route path="/reports" element={<ReportsPage />} />

        {/* ENC */}
        <Route path="/enc/groups" element={<ENCGroupsPage />} />
        <Route path="/enc/classifications" element={<ENCClassificationsPage />} />
        <Route path="/enc/rules" element={<ENCRulesPage />} />

        {/* Configuration */}
        <Route path="/config/puppet" element={<ConfigPuppetPage />} />
        <Route path="/config/puppetdb" element={<ConfigPuppetDBPage />} />
        <Route path="/config/app" element={<ConfigAppPage />} />
      </Route>
    </Routes>
  );
}
