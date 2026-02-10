# Changelog

All notable changes to OpenVox GUI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.1] - 2025-02-09

### Added
- **Login Page**: Branded sign-in page with OpenVox icon, gradient background, username/password form, and error handling (`frontend/src/pages/Login.tsx`)
- **Auth Context**: React context for authentication state management — handles login, logout, token persistence in localStorage, and automatic token validation on app load (`frontend/src/hooks/AuthContext.tsx`)
- **OpenVox Logo**: SVG logo file served from the `public/` directory, displayed on both the login page and the app header (`frontend/public/openvox-logo.svg`)
- **User Display in Header**: Logged-in username shown as a badge with role indicator and a sign-out button in the AppShell header
- **API Auth Headers**: All API calls now include `Authorization: Bearer <token>` header from stored JWT token (`frontend/src/services/api.ts`)
- **401 Auto-Redirect**: API client automatically clears expired tokens and reloads to show the login page on 401 responses
- **Auth Status Check**: On app load, checks `/api/auth/status` to determine if authentication is required; auto-authenticates when `AUTH_BACKEND=none`

### Changed
- `frontend/src/App.tsx` — Wrapped all routes in `<AuthProvider>`, renders `<LoginPage>` when unauthenticated instead of directly showing the dashboard
- `frontend/src/components/AppShell.tsx` — Added user badge, role display, sign-out button, and OpenVox logo to the header; uses `useAuth()` hook
- `frontend/src/services/api.ts` — Added `getAuthHeaders()` function; all `fetchJSON()` calls now include JWT auth headers; 401 responses trigger automatic logout

### Fixed
- Application was unusable with `AUTH_BACKEND=local` because no login page existed — all API calls returned 401 with no way to authenticate
- Frontend `dist/` directory permissions were too restrictive (`750`), preventing proper file serving

---

## [0.2.0] - 2025-02-09

### Added
- **Active User Sessions**: Track logged-in users with a 15-minute activity threshold, displayed on the dashboard (`backend/app/models/session.py`, `backend/app/services/auth_local.py`)
- **Report Detail Page**: Clickable report rows with full drill-down into individual Puppet runs (`frontend/src/pages/ReportDetail.tsx`)
  - Events tab: Resource-level changes with type, title, property, old/new values, file, and line number
  - Logs tab: Full Puppet agent log output with severity-level filtering
  - Metrics tab: Complete timing breakdown and resource count summary
- **Code Deployment Page**: GUI interface for triggering r10k Puppet code deployments (`frontend/src/pages/CodeDeployment.tsx`, `backend/app/routers/deploy.py`)
  - Deploy all environments or target a specific one
  - Repository discovery from r10k.yaml configuration
  - Real-time deployment output and exit codes
- **Deploy API**: `GET /api/deploy/environments`, `GET /api/deploy/repos`, `GET /api/deploy/status`, `POST /api/deploy/run`
- **Dashboard Active Sessions Widget**: `GET /api/dashboard/active-sessions` endpoint showing current active user count

### Changed
- Reports page rows are now clickable, navigating to `/reports/:hash` for detail view
- Node.js upgraded from v16 to v18 for frontend builds
- Dashboard services monitoring expanded

---

## [0.1.0] - 2025-02-08

### Added
- **Fleet Dashboard**: Real-time node status donut chart, report trend line charts, service health cards, environment overview
- **Performance Dashboard**: Run timing analysis, per-node comparisons, timing breakdown pie chart, resource count area chart, recent runs table
- **Node Management**: Node listing with status/environment filters, node detail page with facts, resources, and recent reports
- **Report Listing**: Filterable report list with status, certname, environment, and timestamp columns
- **External Node Classifier (ENC)**:
  - Node Groups with Puppet class and parameter management
  - Per-node Classifications with class picker from PuppetServer modules
  - Classification Rules with fact-based auto-classification and priority ordering
  - Available Classes browser scanning module manifests
  - ENC script (`scripts/enc.py`) for PuppetServer integration with fail-open design
- **Hiera Data Management**: Hierarchy editor, data file browser/editor with YAML validation and backup
- **Configuration Management**: PuppetServer config editor, PuppetDB config viewer, environment/module browser, service controls
- **Authentication**: Pluggable auth backends (none/local), htpasswd + bcrypt password hashing, JWT tokens, role-based access control (admin/operator/viewer)
- **User Management**: CLI tool (`scripts/manage_users.py`) and REST API for user CRUD
- **Installer**: Interactive and unattended install via `install.sh` with answer file support, systemd service, SELinux, and firewall configuration
- **API Documentation**: Auto-generated Swagger UI at `/api/docs` and ReDoc at `/api/redoc`

### Infrastructure
- FastAPI 0.104 + Uvicorn 0.24 backend (Python 3.8+)
- React 18 + TypeScript + Vite frontend
- Mantine UI v7 component library
- Recharts for data visualization
- SQLite via SQLAlchemy 2.0 + aiosqlite
- httpx 0.25 for async PuppetDB SSL communication
- Apache reverse proxy with SSL (Let's Encrypt)
