# Changelog

All notable changes to OpenVox GUI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## [0.2.41] - 2026-02-09

### Changed
- **Documentation**: Updated README.md with all features from v0.2.34–v0.2.40 including Hierarchical Node Classifier, Orchestration (Puppet Bolt), consolidated Application/User Manager settings
- **Installer**: Added Puppet Bolt sudoers rules for running commands, tasks, and plans as the service user; bumped installer version to v0.2.41
- **Version strings**: Bumped all version references to v0.2.41

---

## [0.2.40] - 2026-02-09

### Added
- **Orchestration page** (`/orchestration`): Full Puppet Bolt integration with 5 tabs:
  - **Overview**: Animated SVG illustration (BOLT-O-MATIC 4000) — a giant industrial machine with conveyor belt feeding servers into a processing chamber with lightning bolts, gears, and a smokestack
  - **Run Command**: Execute ad-hoc shell commands on remote nodes via `bolt command run`
  - **Run Task**: Run Puppet tasks on selected nodes via `bolt task run` — discovers tasks from installed modules
  - **Run Plan**: Execute Puppet plans via `bolt plan run` — discovers plans from installed modules
  - **Configuration**: View and manage `bolt-project.yaml` and `inventory.yaml` configuration
- **Bolt API endpoints** (`/api/bolt/`):
  - `GET /api/bolt/status` — check Bolt installation and version
  - `GET /api/bolt/tasks` — discover available Bolt tasks from modules
  - `GET /api/bolt/plans` — discover available Bolt plans from modules
  - `GET /api/bolt/inventory` — read Bolt inventory configuration
  - `GET /api/bolt/config` — read bolt-project.yaml
  - `POST /api/bolt/run/command` — execute a shell command on targets
  - `POST /api/bolt/run/task` — run a Puppet task on targets
  - `POST /api/bolt/run/plan` — run a Puppet plan on targets
- **NODE-O-SCOPE 2000**: Animated SVG illustration added to the Node Classifier Hierarchy tab — shows a complex scanning machine with rotating dishes and oscilloscopes processing server racks

### Changed
- **Navigation**: Added "Orchestration" section with Bolt icon in the sidebar

---

## [0.2.39] - 2026-02-09

### Fixed
- **Create Group blank screen crash**: Mantine v7 grouped MultiSelect requires data in `[{group, items: [{value, label}]}]` format — was incorrectly using Mantine v6 format `[{value, label, group}]` which caused the component to crash silently on render

---

## [0.2.38] - 2026-02-09

### Added
- **Available Classes API** (`GET /api/enc/available-classes`): Scans Puppet module manifests from `modules/`, `site-modules/`, and `site/` directories and returns all discovered class names organized by module
- **ClassPicker component**: Grouped MultiSelect dropdown for selecting Puppet classes — groups classes into Roles, Profiles, and Modules categories for easy browsing
- **ParamEditor component**: Key-value editor rows with Add/Remove buttons for managing Puppet class parameters — replaces raw JSON textarea

### Changed
- **Node Classifier**: All JSON textareas for classes and parameters replaced with ClassPicker dropdowns and ParamEditor key-value rows across Common, Environments, Node Groups, and Nodes tabs

---

## [0.2.37] - 2026-02-09

### Changed
- **Environments tab**: Auto-discovers environments from `/etc/puppetlabs/code/environments/` on the filesystem and creates any missing ones in the database automatically with a notification banner

---

## [0.2.36] - 2026-02-09

### Changed
- **Node Classifier**: Complete architectural redesign from flat ENC to hierarchical 4-layer deep merge model
  - **Common layer**: Global defaults applied to all nodes (lowest priority)
  - **Environment layer**: Per-environment classes and parameters
  - **Group layer**: Reusable groups of classifications
  - **Node layer**: Per-node overrides (highest priority)
  - Classification resolution uses deep merge: Common → Environment → Group → Node
- **Node Classifier page**: Redesigned from 3 separate pages into a single page with 6 tabs:
  - Hierarchy (overview with merge order visualization)
  - Common (global defaults)
  - Environments (per-environment classification)
  - Node Groups (reusable groups)
  - Nodes (per-node overrides)
  - Classification Lookup (deep-merged YAML output for any node)
- **ENC API endpoints**: New hierarchical endpoints replacing flat classification model:
  - `GET/POST /api/enc/common` — global common layer
  - `GET/POST /api/enc/environments`, `PUT/DELETE /api/enc/environments/{name}` — environment CRUD
  - `GET/POST /api/enc/groups`, `PUT/DELETE /api/enc/groups/{id}` — group CRUD
  - `GET/POST /api/enc/nodes`, `PUT/DELETE /api/enc/nodes/{certname}` — node CRUD
  - `GET /api/enc/resolve/{certname}` — deep-merged classification lookup
  - `GET /api/enc/{certname}` — Puppet ENC endpoint with deep merge
- **ENC database models**: New SQLAlchemy models: `EncCommon`, `EncEnvironment`, `EncGroup`, `EncNode`

### Removed
- Old flat ENC model (NodeGroup, Classification, ClassificationRule tables)
- Separate Node Groups, Classifications, and Rules pages

---

## [0.2.35] - 2026-02-09

### Changed
- **Node Classifier**: Consolidated three separate pages (Node Groups, Classifications, Rules) into a single tabbed page at `/enc`
- **Navigation**: Collapsed "Node Groups", "Classifications", and "Rules" sidebar links into a single "Node Classifier" link

### Removed
- Separate routes for `/enc/groups`, `/enc/classifications`, `/enc/rules` — all consolidated into `/enc`

---

## [0.2.34] - 2026-02-09

### Changed
- **Application page**: Converted to tabbed layout with "Application Settings" and "User Manager" tabs
- **User Manager**: Moved from standalone page under "Administration" nav group into the Application page as a tab — authentication panel moved to top of User Manager tab
- **Navigation**: Removed "Administration" group and "User Manager" sidebar link — user management accessible via Application → User Manager tab

### Removed
- Standalone User Manager page (`/users` route)
- "Administration" navigation group

---

---

## [0.2.19] - 2026-02-10

### Added
- **User Manager illustration**: Animated SVG "People Processing Machine" (USER-O-MATIC 3000) showing confused stick figures entering a conveyor belt machine with spinning gears, status lights, and a smokestack, then emerging as properly badged and sorted users (Admin with crown, Operator with wrench, Viewer with glasses). Caption: "unsorted humans in → properly badged users out (no humans were harmed in the making of this feature)"

---

## [0.2.18] - 2026-02-10

### Changed
- **Reports page**: Limited display to 50 reports (was 100)

---

## [0.2.17] - 2026-02-10

### Changed
- **Robot comic**: Now reactive to deployment state
  - **Idle**: Robot stands with arms lowered, amber eyes pulsing slowly, caption reads "impending doom / awaiting deployment orders..."
  - **Deploying**: Robot raises arm and fires laser at city, red eyes flash rapidly, sky turns red, explosion with smoke and debris, caption reads "r10k deployment in progress... / destroying legacy environments since 2014"
- **Output window**: Doubled in height (400px scrollable area); full scrollback preserved across multiple deployments with timestamped headers; auto-scrolls to bottom on new output; "Clear" button to reset
- **Output accumulation**: Each deploy appends to the log with a separator banner showing timestamp and environment, rather than replacing previous output

---

## [0.2.16] - 2026-02-10

### Changed
- **Code Deployment page**: Completely redesigned layout
  - "Deploy with r10k" panel moved to top-left half with environment selector and deploy button
  - Output window permanently visible below, spanning full width, with placeholder text when empty
  - Added animated SVG comic on the right half: a giant killer robot attacking a small city at night, complete with laser beam, explosions, animated eyes and reactor core, falling debris, and humorous captions

### Removed
- **Control Repository panel**: Removed from Code Deployment page
- **Module Repository panel**: Removed from Code Deployment page
- **Available Environments panel**: Removed from Code Deployment page (environments still selectable in the deploy dropdown)

---

## [0.2.15] - 2026-02-10

### Removed
- **Nodes menu item**: Removed from the navigation sidebar — nodes are accessible via the Dashboard table and clicking through to node details

---

## [0.2.14] - 2026-02-10

### Changed
- **Active Users**: Moved from Dashboard stats row to the navigation sidebar — displayed as a small text line under the version number (e.g. "2 active users"), with a hover popover showing each user's name and IP
- **Active sessions polling**: The sidebar now polls `/api/dashboard/active-sessions` every 30 seconds to keep the count current across all pages

### Removed
- **Dashboard stats cards**: Removed the Total Nodes, Unchanged, Changed, Failed, Noop, and Active Users cards — this data was redundant with the Node Status donut chart already shown below
- **StatsCard component**: No longer used, removed from Dashboard

---

## [0.2.13] - 2026-02-10

### Changed
- **Dashboard**: Added a full-width Nodes table below the Node Status donut and Report Trends chart — shows certname, status badge, environment, and last report time with clickable rows linking to node details
- **Application Configuration page**: Services panel (puppetserver, puppetdb, puppet agent status) moved here from the Dashboard

### Removed
- **Services panel from Dashboard**: Relocated to the Application Configuration page under Configuration menu

---

## [0.2.12] - 2026-02-10

### Fixed
- **Logo**: Reverted to the original unmodified OpenVox logo from [voxpupuli/logos](https://github.com/voxpupuli/logos/blob/master/images/OpenVox/Black/original_files_by_smortex/logo.svg) — both the header and login page now use the same original SVG

### Removed
- **`openvox-logo-white.svg`**: Deleted the color-swapped variant; only the original `openvox-logo.svg` is used

---

## [0.2.11] - 2026-02-10

### Changed
- **Active Users card**: Now displays a hover dropdown when moused over — shows each active user's name, IP address, and time since last seen (e.g. "3m ago"), while the card itself remains the same compact size as the other stats cards showing just the count and icon

---

## [0.2.10] - 2026-02-10

### Changed
- **Active Users**: Converted from a large panel to a compact StatsCard matching the other summary cards (Total Nodes, Unchanged, Changed, Failed, Noop), placed immediately to the right of the Noop card
- **Stats row**: Expanded from 5 to 6 columns to accommodate the Active Users card
- **Report Trends**: Moved back to the first grid row (8 columns, next to Node Status donut)
- **Services**: Now the only card in the bottom grid row

### Removed
- Large Active Users panel with user list detail (replaced by compact StatsCard showing count)

---

## [0.2.9] - 2026-02-10

### Fixed
- **Header logo/title overlap**: Set explicit `width: 36` and `display: block` on logo image, used numeric gap `16`, and `wrap="nowrap"` on the Group to prevent the title text from bleeding over the logo

### Changed
- **Dashboard layout**: Moved Active Users panel from the bottom row to the top row (spanning 8 columns next to Node Status), displaying users in a compact horizontal layout
- **Report Trends**: Moved from the top row to the bottom row (spanning 8 columns next to Services)

### Removed
- **Environments panel**: Removed from the dashboard

---

## [0.2.8] - 2026-02-10

### Changed
- **Header bar**: Removed blue (`#0D6EFD`) background — reverted to default dark theme header; title and badge styling returned to defaults

### Added
- **User Manager page** (`frontend/src/pages/UserManager.tsx`): Full user administration UI with:
  - User listing table with username, role badges (admin/operator/viewer)
  - Add User modal (username, password, role selector)
  - Change Password modal per user
  - Change Role modal per user
  - Delete user with confirmation (cannot delete yourself)
  - Toast notifications for all operations
- **User management API client** (`frontend/src/services/api.ts`): `users.list()`, `users.create()`, `users.remove()`, `users.changePassword()`, `users.changeRole()`
- **Administration nav section** in sidebar with User Manager link (`/users`)
- Route `/users` registered in `App.tsx`

---

## [0.2.7] - 2026-02-10

### Changed
- **All accent colors**: Replaced VoxPupuli Orange (`#EC8622`) with VoxPupuli Blue (`#0D6EFD`) across the entire UI — header bar, nav active states, buttons, badges, stats cards, deployment controls, report icons, login page
- **Mantine primary palette**: Renamed `vporange` back to `vpblue` with 10-shade ramp centred on `#0D6EFD`

### Removed
- All references to `#EC8622` (orange) from the frontend

---

## [0.2.6] - 2026-02-10

### Changed
- **Accent color**: Swapped all VoxPupuli Blue (`#0D6EFD`) accent colors to VoxPupuli Orange (`#EC8622`) — nav active states, buttons, badges, stats cards, deployment controls, report icons, and login page now use the orange palette
- **Mantine primary palette**: Renamed `vpblue` to `vporange` with a 10-shade ramp centred on `#EC8622`
- **Login page**: Background gradient and sign-in button changed from blue to orange

---

## [0.2.5] - 2026-02-10

### Changed
- **Header bar**: Background color changed to official VoxPupuli Orange (`#EC8622`); user badge and logout icon styled white for contrast
- **Logo/title spacing**: Increased gap between OpenVox fox-V logo and "OpenVox GUI" title text to prevent overlap; title set to `whiteSpace: nowrap` and logo to `flexShrink: 0`
- **Primary color**: Replaced Mantine `primaryColor` from `violet` to custom `vpblue` palette based on VoxPupuli Blue (`#0D6EFD`) — affects all NavLink active states, buttons, and interactive elements
- **Login page**: Background gradient changed from purple (`#667eea`/`#764ba2`) to blue (`#0D6EFD`/`#0a58ca`); sign-in button changed from violet-cyan gradient to solid blue
- **Dashboard**: "Total Nodes" stats card icon changed from violet to VoxPupuli Blue
- **Code Deployment**: Page icon, branch badges, deploy buttons, and environment select all changed from violet to VoxPupuli Blue
- **Report Detail**: Report icon and audit status badge changed from violet to blue

### Removed
- All references to `violet`, `purple`, `grape`, and `#667eea`/`#764ba2` colors throughout the frontend

---

## [0.2.4] - 2026-02-10

### Changed
- **Login Page**: Replaced placeholder `IconCategory` icon with the official OpenVox fox-V logo (black variant, from [voxpupuli/logos](https://github.com/voxpupuli/logos)) displayed at 72px height on the login card
- **AppShell Header**: Switched from black logo to white variant (`openvox-logo-white.svg`) so the fox-V mark is visible against the dark header background
- **Version strings**: Bumped to v0.2.4 in Login page and AppShell sidebar

### Added
- **`frontend/public/openvox-logo-white.svg`**: White-on-transparent variant of the official OpenVox logo for use on dark backgrounds
- **Official OpenVox Logo**: `frontend/public/openvox-logo.svg` now contains the actual OpenVox fox-V mark by Romain Tartière (CC BY-SA 4.0), replacing the placeholder hexagonal icon

---

## [0.2.3] - 2026-02-09

### Fixed
- **Duplicate logo in header**: Removed leftover `ThemeIcon` + `IconCategory` that appeared alongside the SVG logo in the AppShell header — now shows only the SVG image
- **Duplicate admin badges**: Consolidated two user badges (one colored, one grey) into a single small grey outline badge showing username and role
- **Empty report logs tab**: Updated backend `get_report_logs()` to query PuppetDB sub-endpoint `/pdb/query/v4/reports/<hash>/logs` directly instead of relying on lazy-loaded href references; changed Puppet `log_level` from `err` to `info` so non-error log entries are captured in reports

---

## [0.2.2] - 2025-02-10

### Added
- **`install.sh`**: Full installer script with 9-step process — service user creation, directory setup, file copying, Python venv, frontend build, configuration generation, systemd service, permissions/firewall/SELinux, and initial admin user setup
  - Supports interactive mode, answer-file (`-c install.conf`), and silent mode (`-y`)
  - Auto-generates secure JWT secret keys and admin passwords
  - Validates sudoers rules with `visudo -cf`
  - Includes `--uninstall` for clean removal
- **`install.conf.example`**: Answer file template with all configurable variables documented
- **`config/.env.example`**: Template environment file (secrets never committed to git)
- **Consolidated sudoers rules** (`/etc/sudoers.d/openvox-gui`): Single file covering r10k deploy, PuppetDB config reading, and Puppet service management (start/stop/restart/status for puppetserver, puppetdb, puppet)

### Changed
- **`config/openvox-gui.service`**: Updated systemd unit file with correct security settings:
  - `NoNewPrivileges=false` — required for `sudo r10k` to work from child processes
  - `PrivateTmp=false` — r10k needs real `/tmp` for module extraction during deployment
  - `ReadWritePaths` expanded to include `/opt/puppetlabs/puppet/cache` (r10k git cache), `/etc/puppetlabs/code/environments` (code deployment target), and `/tmp`
  - Removed `ReadOnlyPaths=/etc/puppetlabs` which blocked r10k code deployment
  - Added `EnvironmentFile` directive pointing to `config/.env`
  - Uses `INSTALL_DIR` placeholder for portability
- **`scripts/deploy.sh`**: Rewritten as a quick re-deploy helper (git pull, pip install, npm build, fix permissions, restart) — for fresh installs use `install.sh` instead
- **`.gitignore`**: Added `config/.env`, `config/.credentials`, and `install.conf` to prevent committing site-specific secrets

### Fixed
- **r10k deployment failure**: `ProtectSystem=strict` with `ReadOnlyPaths=/opt/puppetlabs` made the entire Puppet directory tree read-only in the systemd mount namespace — even `sudo` couldn't write. r10k failed with "Read-only file system" when trying to update `FETCH_HEAD` in its git cache or extract modules to `/tmp`
- **Missing sudoers rule for r10k**: No sudoers entry existed for the puppet user to run `r10k deploy` via sudo
- **Frontend dist/ permissions**: Directory was `750` (puppet:puppet) preventing proper file serving; installer now ensures `755` for dirs and `644` for files in dist/

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
