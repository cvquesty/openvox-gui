# Changelog

All notable changes to OpenVox GUI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.4] - 2026-02-17

### Changed
- **Centralized Version Management**: Eliminated hardcoded version strings scattered across the codebase
  - **Backend**: `backend/app/__init__.py` is now the single source of truth; `main.py` imports `__version__` instead of hardcoding the version in 3 places (FastAPI metadata, startup log, health endpoint)
  - **Frontend**: `package.json` version is injected at build time via Vite `define` → new `src/version.ts` module exports `APP_VERSION` for all components
  - **Login page & navigation bar**: Now import `APP_VERSION` instead of hardcoded strings — fixes the bug where the login page showed v1.3.0 while the dashboard showed v1.4.3
  - **New `scripts/bump-version.sh`**: Single command to update both `package.json` and `__init__.py` atomically, preventing version drift
  - **New `/api/version` endpoint**: Public (no-auth) endpoint returning the current application version
  - **`update_remote.sh`**: Now reads the version dynamically from `__init__.py` instead of hardcoding it

## [1.4.3] - 2026-02-16

### Fixed
- **User Deletion 404 Error**: Fixed bug where deleting a user from the User Manager returned "API Error 404: User not found" even though the user was successfully deleted from the database
  - **Root cause (backend)**: `remove_user()` in `auth_local.py` used a SQLAlchemy Core `delete()` statement whose `rowcount` is unreliable with aiosqlite after `commit()` — it could return `0` or `-1` even on a successful delete, causing the API to incorrectly report failure
  - **Fix (backend)**: Rewrote `remove_user()` to use the ORM pattern: fetch the user with `select()`, check if it exists, then delete with `session.delete(user)` — this gives a reliable existence check before deletion
  - **Fix (frontend)**: Moved `loadUsers()` call in `handleDeleteUser()` from the success-only path into a `finally` block so the user list always refreshes after a delete attempt, preventing stale UI state

## [1.4.2] - 2026-02-13

### 🔒 Comprehensive Security Update - All 11 Dependabot Alerts Fixed

This release addresses all 11 security vulnerabilities identified by GitHub Dependabot.

### Security
- **Fixed all 11 Dependabot security alerts**
- Updated Python dependencies to secure versions while maintaining compatibility
- Updated JavaScript dependencies with security overrides for transitive vulnerabilities
- Fixed vulnerable transitive dependencies including:
  - semver (ReDoS vulnerability)
  - ws (WebSocket DoS)
  - braces (prototype pollution)
  - micromatch (ReDoS vulnerability)
  - nanoid (insufficient entropy)
  - path-to-regexp (ReDoS vulnerability)
  - cookie (prototype pollution)
  - cross-spawn (command injection)
  - dompurify (XSS vulnerability)

### Changed
- Downgraded Vite from 6.x to 4.5.5 for Node 14 compatibility while maintaining security
- Updated PostCSS to 8.4.47 with security patches
- Updated all Python packages to latest secure versions
- Added package overrides to force secure versions of transitive dependencies

### Technical
- cryptography remains at 44.0.1 (secure version)
- All packages tested and verified to build successfully
- Maintained backward compatibility with production environment

## [1.4.1] - 2026-02-13

### 🔒 Security Update

This release focuses on strengthening the security posture of OpenVox GUI.

### Security
- **Fixed critical vulnerability in cryptography package** - Updated to v43.0.3
- **Implemented comprehensive security headers** including CSP, HSTS, X-Frame-Options
- **Added rate limiting** to prevent brute force attacks
  - Authentication endpoints: 5 requests/minute
  - API endpoints: 60 requests/minute
  - Resource-intensive endpoints: 10 requests/minute
- **Restricted CORS origins** - Only allows configured origins in production
- **Added input validation and sanitization module** to prevent injection attacks
- **Updated all frontend dependencies** to latest secure versions
- **Implemented secure cookie settings** with httponly and secure flags
- **Added protection against common attack patterns** in command execution

### Changed
- Updated backend dependencies to latest secure versions
- Enhanced authentication security with rate limiting
- Improved error handling for security-related failures
- CORS now restricts origins in production mode

### Added
- New validation utilities for all user inputs
- Security middleware with configurable headers
- Rate limiting middleware using slowapi
- Input sanitization for filenames and paths
- Command validation for Bolt execution
- PQL query validation

## [1.4.0] - 2026-02-13

**🎉 Production Release - Launch Ready!**

This is our first production-ready release with comprehensive documentation, improved stability, and a better user experience.

### ✨ New Features
- **Comprehensive Documentation Suite**
  - Brand new installation guide with step-by-step instructions
  - Detailed update guide for seamless upgrades
  - Complete troubleshooting guide for common issues
  - User-friendly README with clear explanations

### 🐛 Bug Fixes from Recent Development
- **Application Update Handling** - No more errors when navigating after deployments
- **Scrolling Issues** - Fixed multiple scrolling problems throughout the interface
- **Certificate Statistics** - Corrected counting and display of certificates
- **Fact Explorer** - Enhanced with nested fact support and autocomplete
- **Module Loading** - Better caching and error recovery

### 📝 Documentation
- Created [INSTALL.md](INSTALL.md) - Complete installation guide for new users
- Created [UPDATE.md](UPDATE.md) - Step-by-step update procedures
- Created [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Solutions for common problems
- Rewrote [README.md](README.md) - Clear, beginner-friendly overview
- Simplified this changelog to be more user-friendly

### 🔧 Technical Improvements
- Version checking system to detect updates
- Graceful error handling for chunk loading failures
- Improved cache control headers
- Better error messages throughout
- Enhanced ScrollArea components for better UX

## [1.3.11] - 2026-02-13

### Added
- **Graceful Handling of Application Updates**: Prevents errors when navigating after deployment
  - Added lazyWithRetry wrapper for code-split pages to handle chunk loading failures
  - Implemented version checking that runs every 5 minutes to detect updates
  - Shows user-friendly notification when new version is available
  - ErrorBoundary now detects and specially handles version mismatch errors
  - Users are prompted to refresh rather than seeing cryptic error messages
  - Prevents "Failed to fetch dynamically imported module" errors during deployments

### Technical Details
- Created `utils/versionCheck.ts` for version monitoring and chunk error detection
- Created `utils/lazyWithRetry.tsx` wrapper for React.lazy with error recovery
- Enhanced ErrorBoundary to differentiate between version errors and other crashes
- Version checker uses ETag/Last-Modified headers to detect changes without polling backend

## [1.3.10] - 2026-02-13

### Changed
- **Puppet Configuration Page**: Renamed "Hiera" tab to "Hiera Data Files" for clarity
  - Better describes the tab's content which shows Hiera data file management
  - Improves user understanding of the tab's functionality

## [1.3.9] - 2026-02-13

### Fixed
- **Fact Explorer Results Pane Scrolling**: Fixed scrolling issue with the main results table
  - Changed from maxHeight-only to fixed height (50vh) with min/max constraints
  - Results table now properly scrolls when content exceeds viewport
  - Maintains responsive behavior with viewport-based sizing

## [1.3.8] - 2026-02-13

### Fixed
- **Orchestration Result Tab Scrolling**: Fixed scrolling issues when switching between result tabs
  - Wrapped tab panels with ScrollArea components with fixed 65vh height
  - Removed redundant nested ScrollArea from renderOutput function
  - All three view modes (Human/JSON/Rainbow) now scroll properly
- **Fact Explorer Node Output Scrolling**: Fixed scrollability of large fact values in table cells
  - Wrapped individual fact values in ScrollArea with 300px max height
  - Large JSON and text values can now be scrolled within their cells
  - Improved usability when viewing complex nested fact structures

## [1.3.7] - 2026-02-13

### Fixed
- **Certificate Statistics Accuracy**: Fixed incorrect certificate counting in CA info panel
  - Now properly counts signed certificates from the actual list
  - Fixed pending count to accurately reflect waiting certificate requests
  - Statistics now match the data shown in the panels below
- **Certificate Details Modal Scrolling**: Fixed scrollability of certificate details window
  - Increased modal size to extra-large for better visibility
  - Set proper height with viewport units (70vh) for consistent scrolling
  - Added min/max height constraints for better usability
- **Certificate Statistics Clarity**: Improved labels and added tooltips
  - "Signed" renamed to "Active" to clarify these are currently active certificates
  - Added hover tooltips explaining each statistic
  - Clarified that revoked count is all-time total from CRL

## [1.3.6] - 2026-02-13

### Added
- **Certificate Authority Information Panel**: Added comprehensive CA info display to Certificates page
  - New dedicated panel at top of page showing CA certificate details
  - Displays Subject, Issuer, Serial Number, and Fingerprint
  - Shows validity dates with automatic expiration warnings
  - Displays days until expiry with color-coded badges
  - Shows key algorithm and key size information
  - Displays signature algorithm details
  - Real-time certificate statistics (signed, pending, revoked counts)
  - Automatic alerts for expired or soon-to-expire CA certificates
  - New backend endpoint `/api/certificates/ca-info` for fetching CA details
  - CRL (Certificate Revocation List) information when available

## [1.3.5] - 2026-02-13

### Fixed
- **Orchestration Result Window Scrolling**: Fixed scrollability issues in command/task/plan result output
  - Replaced fixed 500px height with dynamic viewport-based height (60vh)
  - Added proper ScrollArea component for smooth scrolling
  - Minimum height of 400px and maximum of 800px for better usability
  - All output formats (human, JSON, rainbow) now properly scrollable
  - Users can now view complete output regardless of length

## [1.3.4] - 2026-02-13

### Fixed
- **Resource Explorer Module Loading**: Fixed cache issues causing module loading failures
  - Added proper cache-control headers for versioned assets (immutable, long-term cache)
  - Ensured index.html is never cached to always get latest chunk references
  - Cleared stale cached files on production server
  - Prevents "Failed to fetch dynamically imported module" errors

## [1.3.3] - 2026-02-13

### Enhanced
- **Fact Explorer Nested Fact Support**: Significantly improved nested fact querying experience
  - Replaced Select dropdown with Autocomplete component for direct typing of nested facts
  - Added intelligent autocomplete suggestions that understand dotted notation (e.g., os.family, memory.system.total)
  - Added ability to press Enter or click Query button to submit any typed fact name
  - Added quick access badges for common nested facts organized by category (System, Network)
  - Improved suggestion filtering with prefix-first matching
  - Supports up to 100 autocomplete suggestions with scrollable dropdown
  - Clear button to reset the fact search
  - Better placeholder text showing example nested fact paths

## [1.3.2] - 2026-02-13

### Changed
- **Orchestration Page UI Reorganization**: Moved Execution History from bottom pane to dedicated tab
  - Removed split-screen layout with fixed bottom pane
  - Added new "Execution History" tab between "Run Plan" and "Configuration" tabs
  - Cleaner single-pane interface with all features accessible via tabs
  - Better use of screen real estate for command execution results

## [1.3.1] - 2026-02-13

### Bug Fixes
- **Resource Explorer Scrolling**: Fixed issue where query results extending beyond the visible area could not be scrolled
  - Output window now uses viewport-based dynamic height instead of fixed 500px
  - Scrollable area properly expands to show all results
  - Added proper word-wrapping for long resource titles and file paths
  - Improved scrollbar visibility and usability

## [1.3.0] - 2026-02-13

### New Features
- **Nested Fact Querying**: Fact Explorer now supports querying nested fact values using dot notation
  - Query structured facts like "os.family", "memory.system.total", "networking.hostname"
  - Automatically discovers and suggests available nested paths for structured facts
  - Shows both base fact and nested path information in results
  - Grouped dropdown organizes facts by their base name for easier navigation
- **Pretty JSON Display**: All JSON outputs throughout the application are now formatted for readability
  - Similar to `jq` output with proper indentation and syntax highlighting
  - Implemented in: Fact Explorer, PQL Console, Node Details, Node Classifier, Orchestration results, Execution History
  - New reusable PrettyJson component for consistent JSON formatting
- **Fact Structure Explorer**: New API endpoint to explore the structure of complex facts
  - Sample values from multiple nodes to understand fact structure
  - Automatically extract available nested paths from structured facts

### Technical Improvements
- Enhanced Facts API with nested value extraction using dot notation
- New `get_nested_value` function for traversing complex fact structures
- PrettyJson component with scrollable areas and proper overflow handling
- Improved fact name suggestions with common nested paths for known structured facts

## [1.2.0] - 2026-02-13

### New Features
- **Execution History Tracking**: New scrollable pane at the bottom of the Orchestration page showing all commands, tasks, and plans executed in the last 14 days
  - Automatic logging of all orchestration executions with timestamps, duration, and status
  - Filter by execution type (command/task/plan), status (success/failure/running), node, and time period
  - View detailed execution information including parameters, errors, and result previews
  - Auto-refresh every 10 seconds to show latest executions
  - Delete individual history entries or bulk cleanup old entries
- **Execution Statistics API**: New `/api/execution-history/stats` endpoint providing execution analytics

### Technical Improvements
- Added new `ExecutionHistory` database model with comprehensive execution tracking
- Modified Bolt orchestration endpoints to automatically log all executions
- New `ExecutionHistory` React component with advanced filtering and detail views
- Responsive layout with the history pane taking up to 40% of the Orchestration page

## [1.1.0] - 2026-02-13

### New Features
- **Multi-format Output Display**: Orchestration page now displays command/task/plan results in all three formats (Human, JSON, Rainbow) simultaneously in tabbed panes - users can switch between formats without re-running commands
- **Parallel Format Fetching**: All three output formats are fetched in parallel for better performance

### Security Updates
- **Critical Security Fixes**: Updated 11 vulnerable dependencies (1 critical, 3 high, 7 moderate)
  - **Frontend Dependencies**:
    - Vite: 5.0.8 → 6.4.1 (fixes CVE-2024-23331 critical directory traversal vulnerability)
    - React: 18.2.0 → 18.2.0 (kept stable)
    - React Router DOM: 6.20.0 → 6.21.0
    - TypeScript: 5.3.3 → 5.3.3 (kept compatible)
    - PostCSS and build tools updated to latest secure versions
    - esbuild: Now using 0.25.12 (fixes GHSA-67mh-4wv8-2f99 CORS vulnerability)
  - **Backend Dependencies**:
    - **python-jose**: 3.3.0 → 3.5.0 (CRITICAL - fixes CVE-2024-33663 CVSS 9.3 algorithm confusion, CVE-2025-61152 alg=none bypass)
    - FastAPI: 0.104.1 → 0.129.0
    - Uvicorn: 0.24.0 → 0.30.6
    - Pydantic: 2.5.2 → 2.10.5
    - SQLAlchemy: 2.0.23 → 2.0.36
    - Jinja2: 3.1.2 → 3.1.6
    - python-multipart: 0.0.6 → 0.0.22
    - bcrypt: 4.0.1 → 4.2.1
    - PyYAML: 6.0.1 → 6.0.2
    - aiosqlite: 0.19.0 → 0.20.0
    - alembic: 1.13.0 → 1.14.1
    - httpx: 0.25.2 → 0.27.2
- **Virtual Environment**: Added Python virtual environment support to backend for better dependency isolation
- **Node.js Requirement**: Vite 6+ requires Node.js 18+ (previously Node 14.18+ was sufficient)

### Improvements
- **Orchestration Results**: Removed single format selector in favor of tabbed display showing all formats
- **Error Handling**: Better error display in each format tab
- **Build System**: Updated to latest Vite which includes numerous performance improvements

### Bug Fixes
- **Security Vulnerability Remediation**: Resolved all critical and high severity vulnerabilities, reduced moderate vulnerabilities from 7 to 1

## [1.0.0] - 2026-02-12

### Highlights
First stable release of OpenVox GUI. All core features are complete, tested, and production-ready.

### New Features
- **Settings > Services Tab**: New dedicated Services tab in the Settings page with full ecosystem service management -- shows live status, PID, uptime, and individual restart buttons for PuppetServer, PuppetDB, Puppet agent, and the OpenVox GUI application itself
- **Dynamic Application Name**: The configured "Application Name" setting now dynamically updates the browser tab title, the login page title, and the app header -- changes take effect immediately on next page load
- **Clickable Logo and Title**: Clicking the OpenVox logo or application title in the header navigates back to the Dashboard
- **Service Restart Link**: The "service restart" text in the Application Settings instructions is now an active link that switches directly to the Services tab
- **Public App Name Endpoint**: New unauthenticated `GET /api/config/app/name` endpoint so the login page can display the configured app name before authentication

### Improvements
- **Code Deployment Restart Button**: Replaced the full services panel (individual service cards) with a single "Restart All Puppet Services" button that restarts PuppetDB, PuppetServer, and Puppet agent in the correct dependency order via `POST /api/config/services/restart-puppet-stack`
- **Node Classifier Tab Order**: Nodes tab is now the default/first tab; Hierarchy tab renamed to "Help" and moved to last position
- **Node Classifier Groups Dropdown**: The groups MultiSelect when classifying a node now shows ALL configured groups organized by environment as option groups, instead of filtering to only the selected environment (which hid groups in other environments)
- **Orchestration Format Isolation**: Switching output format (Human/JSON/Rainbow) in Run Command, Run Task, or Run Plan now clears the previous result to prevent stale output from a different format being displayed
- **Bolt Version Display**: Fixed the Orchestration Overview tab showing "unknown" for the Bolt version; the status endpoint now calls `bolt --version` directly without appending inventory flags
- **Save Notification**: Updated setting save notification to say "Go to the Services tab to restart" with clear guidance

### Bug Fixes
- **ENC Greenlet Error**: Fixed `greenlet_spawn has not been called` SQLAlchemy async error when classifying nodes -- root cause was lazy-loaded relationships on the `EncNode.groups` many-to-many; fixed by adding `lazy="selectin"` to both sides of the relationship and replacing `db.refresh(node)` with a proper re-fetch using `selectinload`
- **Bolt Version Endpoint**: `bolt --version` was routed through `run_bolt_command()` which appends `-i inventory.yaml`, causing the command to fail silently

### API Endpoints Added
- `GET /api/config/app/name` -- Public (no auth) endpoint returning the configured application name
- `POST /api/config/services/restart-puppet-stack` -- Ordered restart of PuppetDB, PuppetServer, Puppet agent

### Installer
- Version bumped to v1.0.0
- Added `openvox-gui` service restart permission to sudoers
- Added `puppetserver ca` and `openssl x509` sudoers rules
- Added `/opt/openvox-gui/config` to systemd `ReadWritePaths` for settings persistence

## [0.3.1] - 2026-02-11

### Bug Fixes
- **Fact Explorer**: Rewrote page to use dedicated REST endpoints (`/api/facts/names`, `/api/facts/values/{name}`) instead of broken PQL queries; dropdown now loads all 125+ fact names and displays certname + value table for the fleet
- **Code Deployment**: Fixed crash ("Table is not defined") caused by missing `Table` import from Mantine
- **Application Settings 500 Error**: Fixed "Read-only file system" crash when updating settings; added `/opt/openvox-gui/config` to systemd `ReadWritePaths`

### Improvements
- **Orchestration Output Format Selector**: Run Command, Run Task, and Run Plan tabs now include a segmented control to choose output format: Human (clean text), JSON (structured data), or Rainbow (full ANSI color). Rainbow output renders with proper terminal colors in the browser via `ansi-to-html`
- **Orchestration PTY Support**: Rainbow format uses `script(1)` to allocate a pseudo-TTY so Bolt emits full RGB ANSI color sequences; `--color` flag is appended automatically
- **Bolt Inventory Flag**: All Bolt commands now include `-i /etc/puppetlabs/bolt/inventory.yaml` automatically so the inventory file is always found
- **PQL Console Certname Dropdown**: Added a searchable node selector that auto-substitutes `NODENAME` placeholders in example queries with the selected certname
- **Settings Nav Rename**: Renamed "Application" sidebar link to "Settings" with a gear icon for clarity
- **PQL Console Unlimited Results**: Default query limit raised from 100 to 10,000; results pane uses viewport-height scrolling (`calc(100vh - 200px)`) instead of a fixed 500px cap

### API Endpoints Added
- `GET /api/facts/names` — List all known fact names from PuppetDB
- `GET /api/facts/values/{fact_name}` — Get certname + value for every node with the given fact

### Dependencies
- Added `ansi-to-html` npm package for ANSI escape code rendering in Orchestration results


## [0.3.0] - 2026-02-11

### Major Features
- **PQL Query Console** — Execute ad-hoc Puppet Query Language queries directly against PuppetDB with example library, auto-detected column rendering, and query history
- **Certificate Authority Management** — Sign, revoke, and clean Puppet CA certificates with detailed certificate inspection via `puppetserver ca`
- **Fact Explorer** — Search and compare any fact across the entire fleet with value distribution analysis and filtering
- **Resource Explorer** — Search Puppet resources (Package, Service, File, Class, etc.) across all nodes with regex title filtering
- **Deploy History** — Persistent deployment log tracking who deployed, when, what environment, and success/failure status

### Improvements
- **React Error Boundary** — Component crashes now show a friendly error message with stack trace and recovery options instead of a blank white page
- **Dashboard Auto-Refresh** — Configurable live polling (10s/30s/1m/5m) with "Live" indicator badge and last-updated timestamp
- **Code Splitting** — All pages are lazy-loaded via React.lazy/Suspense; initial bundle reduced significantly
- **Sidebar Navigation** — Added missing "Nodes" link; new sections for PuppetDB Explorer (PQL Console, Fact Explorer, Resource Explorer) and Infrastructure (Certificates)
- **Run Puppet Button** — Node detail page now has a "Run Puppet" button that triggers `puppet_agent::run` via Bolt
- **Version 0.3.0** — Major version bump reflecting the scope of new features

### Bug Fixes
- Fixed missing `json` import in config.py router that would crash preferences API
- Fixed sidebar missing Nodes navigation link
- Added sudoers rules for `puppetserver ca` and `openssl` commands

### API Endpoints Added
- `POST /api/pql/query` — Execute PQL queries against PuppetDB
- `GET /api/pql/examples` — PQL example query library
- `GET /api/certificates/list` — List all CA certificates (signed + pending)
- `POST /api/certificates/sign` — Sign a pending certificate
- `POST /api/certificates/revoke` — Revoke a signed certificate
- `POST /api/certificates/clean` — Clean (remove) a certificate
- `GET /api/certificates/info/{certname}` — OpenSSL certificate details
- `GET /api/deploy/history` — Persistent deployment history log


## [0.2.42] - 2026-02-09

### Added
- **Theme system**: Dual-theme support with Casual (dark mode, orange accents, animated SVG illustrations) and Formal (light mode, white background, black foreground, VoxPupuli Blue accents, no illustrations)
- **ThemeContext provider** (`frontend/src/hooks/ThemeContext.tsx`): React context managing theme state with `localStorage` + backend persistence
- **Theme selector**: SegmentedControl in Application → Application Settings tab to switch between Casual and Formal themes
- **Editable application settings**: All settings in the Application Settings tab are now editable inline — click Edit, modify the value, Save or Cancel
- **Preferences API** (`/api/config/preferences`): GET/PUT endpoint for persisting theme and future user preferences to `preferences.json`
- **Settings update API** (`PUT /api/config/app`): Endpoint to update individual `.env` settings by key/value pair

### Changed
- **AppShell**: Header, navbar, and logo dynamically adapt to active theme — white header and light gray navbar (`#f8f9fa`) in Formal mode
- **Login page**: Background gradient, logo, and sign-in button color adapt to active theme
- **MantineProvider**: Dynamically switches between dark/light color scheme and orange/blue primary palette based on theme
- **All illustration pages**: SVG cartoons (NODE-O-SCOPE 2000, BOLT-O-MATIC 4000, RobotComic, Report-O-Scope 9000, HIERA-TRON 5000, USER-O-MATIC 3000) conditionally hidden in Formal mode; layout panels expand to full width
- **Version strings**: Bumped to v0.2.42

### Fixed
- **NodeClassifier blank page**: Added missing `useAppTheme` import that caused a crash on navigation

---
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
