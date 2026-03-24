"""
API Routers Package

This package contains all FastAPI route handlers (API endpoints) for OpenVox GUI.
Each router module handles a specific domain of functionality.

**Router Modules:**
- auth.py - Authentication endpoints (login, logout, token refresh, user management)
- bolt.py - Bolt orchestration (run commands, tasks, plans on remote nodes)
- certificates.py - Certificate Authority management (sign, revoke, clean certs)
- config.py - Application and service configuration (PuppetServer, PuppetDB, settings)
- dashboard.py - Dashboard statistics and overview data
- deploy.py - Code deployment via r10k (deploy environments, view history)
- enc.py - External Node Classifier (hierarchical classification management)
- execution_history.py - Bolt execution history tracking and statistics
- facts.py - Fact Explorer (query and explore PuppetDB facts)
- nodes.py - Node management and status (list, details, Run OpenVox)
- performance.py - Performance metrics and monitoring data
- pql.py - PQL Console (execute Puppet Query Language queries)
- reports.py - Compliance reports and audit data

**Security Notes:**
All routers (except public endpoints like /api/version) require authentication.
Routes are protected via the AuthMiddleware which validates JWT tokens.
Rate limiting is applied per-router via slowapi to prevent abuse.
"""
