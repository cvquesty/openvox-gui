import { Routes, Route } from 'react-router-dom';
import { Loader, Center } from '@mantine/core';
import { AuthProvider, useAuth } from './hooks/AuthContext';
import { LoginPage } from './pages/Login';
import { AppShellLayout } from './components/AppShell';
import { DashboardPage } from './pages/Dashboard';
import { NodesPage } from './pages/Nodes';
import { NodeDetailPage } from './pages/NodeDetail';
import { ReportsPage } from './pages/Reports';
import { ReportDetailPage } from './pages/ReportDetail';
import { CodeDeploymentPage } from './pages/CodeDeployment';
import { NodeClassifierPage } from './pages/NodeClassifier';
import { ConfigPuppetPage } from './pages/ConfigPuppet';
import { ConfigAppPage } from './pages/ConfigApp';
import { OrchestrationPage } from './pages/Orchestration';

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return <Center h="100vh"><Loader size="xl" /></Center>;
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<AppShellLayout />}>
        {/* Monitoring */}
        <Route path="/" element={<DashboardPage />} />
        <Route path="/nodes" element={<NodesPage />} />
        <Route path="/nodes/:certname" element={<NodeDetailPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/reports/:hash" element={<ReportDetailPage />} />

        {/* Code Deployment */}
        <Route path="/deployment" element={<CodeDeploymentPage />} />

        {/* Node Classifier */}
        <Route path="/enc" element={<NodeClassifierPage />} />

        {/* Orchestration */}
        <Route path="/orchestration" element={<OrchestrationPage />} />

        {/* Configuration */}
        <Route path="/config/puppet" element={<ConfigPuppetPage />} />
        <Route path="/config/app" element={<ConfigAppPage />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

