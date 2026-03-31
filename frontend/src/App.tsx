/**
 * OpenVox GUI - Main Application Entry Point
 * 
 * This is the root React component that sets up the application routing,
 * authentication context, and code-splitting for all pages.
 * 
 * **Architecture:**
 * - Uses React Router 6 for client-side routing
 * - Wraps app in AuthProvider for authentication state management
 * - Uses ErrorBoundary for graceful error handling
 * - Code-splits all pages via React.lazy with lazyWithRetry for reliability
 * - Version checker monitors for application updates
 * 
 * **Route Structure:**
 * - /login - Authentication page (public)
 * - / - Dashboard (protected)
 * - /nodes - Node list and status (protected)
 * - /nodes/:certname - Node detail view (protected)
 * - /reports - Compliance reports (protected)
 * - /enc - Node Classifier / ENC management (protected)
 * - /orchestration - Bolt command execution (protected)
 * - /config/* - Configuration pages (protected)
 * 
 * **Security:**
 * - All routes except /login require authentication
 * - Unauthenticated users are redirected to /login
 * - Token is validated on every page load
 */

import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader, Center } from '@mantine/core';
import { AuthProvider, useAuth } from './hooks/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginPage } from './pages/Login';
import { AppShellLayout } from './components/AppShell';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { versionChecker } from './utils/versionCheck';

// ─── Code-split all pages via React.lazy with error handling ────────────────────
const DashboardPage = lazyWithRetry(() => import('./pages/Dashboard').then(m => ({ default: m.DashboardPage })));
const NodesPage = lazyWithRetry(() => import('./pages/Nodes').then(m => ({ default: m.NodesPage })));
const NodeDetailPage = lazyWithRetry(() => import('./pages/NodeDetail').then(m => ({ default: m.NodeDetailPage })));
const ReportsPage = lazyWithRetry(() => import('./pages/Reports').then(m => ({ default: m.ReportsPage })));
const ReportDetailPage = lazyWithRetry(() => import('./pages/ReportDetail').then(m => ({ default: m.ReportDetailPage })));
const CodeDeploymentPage = lazyWithRetry(() => import('./pages/CodeDeployment').then(m => ({ default: m.CodeDeploymentPage })));
const NodeClassifierPage = lazyWithRetry(() => import('./pages/NodeClassifier').then(m => ({ default: m.NodeClassifierPage })));
const ConfigPuppetPage = lazyWithRetry(() => import('./pages/ConfigPuppet').then(m => ({ default: m.ConfigPuppetPage })));
const ConfigAppPage = lazyWithRetry(() => import('./pages/ConfigApp').then(m => ({ default: m.ConfigAppPage })));
const ConfigSSLPage = lazyWithRetry(() => import('./pages/ConfigSSL').then(m => ({ default: m.ConfigSSLPage })));
const OrchestrationPage = lazyWithRetry(() => import('./pages/Orchestration').then(m => ({ default: m.OrchestrationPage })));
const PQLConsolePage = lazyWithRetry(() => import('./pages/PQLConsole').then(m => ({ default: m.PQLConsolePage })));
const CertificatesPage = lazyWithRetry(() => import('./pages/Certificates').then(m => ({ default: m.CertificatesPage })));
const FactExplorerPage = lazyWithRetry(() => import('./pages/FactExplorer').then(m => ({ default: m.FactExplorerPage })));
const ResourceExplorerPage = lazyWithRetry(() => import('./pages/ResourceExplorer').then(m => ({ default: m.ResourceExplorerPage })));
const PackagesPage = lazyWithRetry(() => import('./pages/Packages').then(m => ({ default: m.PackagesPage })));
const DataHieraPage = lazyWithRetry(() => import('./pages/DataHiera').then(m => ({ default: m.DataHieraPage })));
const DataLookupPage = lazyWithRetry(() => import('./pages/DataLookup').then(m => ({ default: m.DataLookupPage })));

function PageLoader() {
  return <Center h={400}><Loader size="xl" /></Center>;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  // Start version checker when app loads
  useEffect(() => {
    if (user) {
      versionChecker.start();
    }
    return () => {
      versionChecker.stop();
    };
  }, [user]);

  if (loading) {
    return <Center h="100vh"><Loader size="xl" /></Center>;
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <Suspense fallback={<PageLoader />}>
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

          {/* Classification */}
          <Route path="/enc" element={<NodeClassifierPage />} />

          {/* Orchestration */}
          <Route path="/orchestration" element={<OrchestrationPage />} />

          {/* OpenVoxDB Exploration */}
          <Route path="/pql" element={<PQLConsolePage />} />
          <Route path="/facts" element={<FactExplorerPage />} />
          <Route path="/resources" element={<ResourceExplorerPage />} />
          <Route path="/packages" element={<PackagesPage />} />

          {/* Data / Hiera */}
          <Route path="/data/hiera" element={<DataHieraPage />} />
          <Route path="/data/lookup" element={<DataLookupPage />} />

          {/* Certificate Authority */}
          <Route path="/certificates" element={<CertificatesPage />} />

          {/* Configuration */}
          <Route path="/config/puppet" element={<ConfigPuppetPage />} />
          <Route path="/config/app" element={<ConfigAppPage />} />
          <Route path="/config/ssl" element={<ConfigSSLPage />} />

          {/* Default: redirect any unknown route to Dashboard */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ErrorBoundary>
  );
}
