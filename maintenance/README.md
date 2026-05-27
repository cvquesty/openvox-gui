# OpenVox GUI Maintenance Pages

This directory contains ready-to-use "Under Maintenance" pages for when the GUI is being updated or is temporarily unavailable.

## Philosophy

When performing maintenance on the OpenVox GUI (especially during updates, schema changes, or major deploys), users should see a friendly, branded page instead of raw JSON errors, 502/503 pages, or blank screens.

These pages are designed to be served **statically by Apache** (or nginx) so they work even when the FastAPI backend and/or frontend assets are completely down.

## Provided Pages

| File                        | Theme     | Tone                  | Best For                     |
|-----------------------------|-----------|-----------------------|------------------------------|
| `maintenance-formal.html`   | Formal    | Professional, calm    | Corporate / production environments |
| `maintenance-casual.html`   | Casual    | Friendly, whimsical   | Teams that enjoy the fun illustrations and dark mode |

Both pages are completely self-contained (Tailwind via CDN for rapid visual quality + easy customization).

## Recommended Apache Integration (Maintenance Mode)

The classic and most reliable pattern uses a flag file.

### 1. Place the maintenance page (usually automatic)

The deployment scripts (`install.sh`, `update_*`, `deploy.sh`) automatically copy the maintenance pages into `/opt/openvox-gui/maintenance/` and maintain the canonical `maintenance.html` there.

If you are configuring Apache manually, point the Alias at the deployed location:

```apache
Alias /maintenance.html /opt/openvox-gui/maintenance/maintenance.html
```

(You can still copy a page manually to a different location if you prefer; just update your vhost accordingly.)

(Adjust the path to match your Apache `DocumentRoot` or a dedicated location.)

### 2. Add the activation logic to your Apache vhost

In your OpenVox GUI virtual host (usually in `/etc/httpd/conf.d/openvox-gui.conf` or similar):

```apache
<VirtualHost *:443>
    ServerName openvox.yourcompany.com

    # ... existing SSL configuration ...

    # === Maintenance Mode ===
    # When /var/www/maintenance/maintenance.flag exists, serve the nice page
    # instead of proxying to the GUI backend.
    RewriteEngine On
    RewriteCond /opt/openvox-gui/data/maintenance.flag -f
    RewriteCond %{REQUEST_URI} !/maintenance.html
    RewriteCond %{REQUEST_URI} !/favicon.ico
    RewriteRule ^ /maintenance.html [R=503,L]

    # Serve the static maintenance page (maintained by the deployment scripts)
    Alias /maintenance.html /opt/openvox-gui/maintenance/maintenance.html

    # Normal proxy to the GUI (only active when flag is absent)
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:4567/
    ProxyPassReverse / http://127.0.0.1:4567/
</VirtualHost>
```

### 3. Activate / Deactivate maintenance mode

```bash
# Enable maintenance page
sudo touch /var/www/maintenance/maintenance.flag
sudo systemctl reload httpd

# Disable maintenance page (return to normal GUI)
sudo rm -f /var/www/maintenance/maintenance.flag
sudo systemctl reload httpd
```

You can wrap this in a tiny helper script if desired.

### 4. (Optional) Custom 503 ErrorDocument

For an even cleaner experience, you can also set:

```apache
ErrorDocument 503 /maintenance.html
```

## Branding Notes

- **Formal page**: Uses VoxPupuli Blue (`#0D6EFD`) and a clean light design.
- **Casual page**: Uses the signature orange (`#EC8622`), dark background, and includes a simple stylized fox SVG inspired by the official OpenVox fox-V logo.

For production use, replace the placeholder fox emoji / simple SVG with the real OpenVox logo asset (copy from your deployed frontend static assets or reference the path served by Apache).

The official logo must remain the unmodified version from the voxpupuli/logos repository.

## Customization

- Edit the estimated time directly in the HTML.
- Add a real countdown timer using a small script if you want more precision.
- Include a link to an internal status page or your team's Slack/Teams channel.
- For very long maintenance windows, add a "What we're changing" bullet list (see the third concept image in the design exploration).

## Automatic Maintenance During Install & Updates (3.7.3+ / RC2)

`install.sh`, `update_local.sh`, `update_remote.sh` (via `deploy.sh`), and `deploy.sh` itself **automatically** manage the full maintenance program:

- At the start of the risky phase (before any file overwrites, dependency updates, frontend rebuild, or service restart), they:
  - Copy/update the `maintenance/` assets (HTML pages + docs) into `/opt/openvox-gui/maintenance/`.
  - Raise the flag (`/opt/openvox-gui/data/maintenance.flag`) + write rich state (`maintenance.json` with message, ETA, started_at, activated_by).
  - Ensure proper permissions (644 on flag/JSON/HTML, 755 on data dir, a+rX on `maintenance/` assets) so the web server user can read them.
  - Best-effort reload of Apache so the RewriteCond takes effect immediately.
- A shell `trap 'disable_maintenance_page' EXIT ERR INT TERM` guarantees the flag is removed on any exit (success, failure, or hard kill/interrupt).
- Web users (through properly configured Apache) see the branded themed page (Formal or Casual, with OpenVox fox SVG) instead of errors/JSON/502s the entire time.
- The backend 503 middleware and `ovox maintenance status` reflect the same state.
- All underlying Puppet/OpenVox services (Server, DB, Bolt, agents) continue running normally.

The scripts document the recommended workflow in their headers and call the helper with a descriptive message and ETA. The `maintenance/` directory is now copied in all deployment paths.

**Flag & state locations (managed automatically):**
- `/opt/openvox-gui/data/maintenance.flag` (simple presence for Apache `RewriteCond`)
- `/opt/openvox-gui/data/maintenance.json` (rich details for backend + CLI)

**Canonical HTML (for Apache Alias):**
- `/opt/openvox-gui/maintenance/maintenance.html` (maintained from `maintenance-formal.html` or `maintenance-casual.html`)

Manual control remains available via `ovox maintenance enable/disable/status` (or directly touching the flag files).

See `apache-maintenance.conf` (updated for these canonical paths) and the workflows in INSTALL.md / UPDATE.md.

## Holistic Maintenance Program (Recommended)

The static HTML pages are only one part of a complete maintenance system. As of v3.7.3 the project includes a full "maintenance program":

### Components

1. **State management** (backend + CLI)
   - `/opt/openvox-gui/data/maintenance.json` — rich state with message, ETA, who enabled it, start time.
   - Simple flag file next to it for fast Apache `RewriteCond` checks.

2. **Backend behavior**
   - `POST /api/maintenance/enable` and `/disable` (admin/operator only).
   - `GET /api/maintenance/status` — always responds, even when maintenance is active.
   - Middleware that turns almost all API requests into clean 503 JSON responses containing the maintenance details (instead of errors or stack traces).
   - The maintenance status and login endpoints remain usable so operators can still disable the mode.

3. **ovox CLI** (primary operator interface)
   ```bash
   ovox maintenance enable --message "Applying node sorting + maintenance program updates" --eta "25 minutes"
   ovox maintenance status
   ovox maintenance disable
   ```

4. **Static pages** (this directory)
   - Served by Apache when the flag is present (see `apache-maintenance.conf`).
   - Two variants matching the existing Formal and Casual themes.

5. **Apache integration**
   - Use the `RewriteCond` + `Alias` pattern in `apache-maintenance.conf`.
   - Returns proper HTTP 503 (correct semantic status for planned maintenance).

### Typical Update Workflow

```bash
# 1. Put the GUI into maintenance (web users see the nice page, APIs return 503)
ovox maintenance enable -m "Updating to 3.7.3" -e "30 minutes" -y

# 2. Perform the actual update (the update scripts can optionally do step 1+3 automatically in the future)
OPENVOX_DEPLOY_HOST=... OPENVOX_DEPLOY_USER=... scripts/update_remote.sh --yes

# 3. Bring the GUI back
ovox maintenance disable
```

### During Maintenance

- **Browser users**: See the beautiful themed page (Apache layer).
- **API / ovox users**: Receive structured 503 JSON they can display nicely.
- **Puppet/OpenVox services**: Completely unaffected (agents keep checking in, Bolt runs still work, etc.).

### Extending the Program

- The update scripts (`update_local.sh`, `update_remote.sh`) can grow `--maintenance` / `--with-maintenance` flags that call the enable/disable steps automatically.
- A future `ovox infra maintenance` sub-group alias can be added for discoverability.
- The static pages can be made to read the JSON sidecar at request time if you convert them to a tiny server-side include or use a dynamic template during `enable`.

This combination (static pages + backend 503s + rich CLI + flag-driven Apache) gives operators a consistent, professional experience no matter how they interact with the system.


## Future Improvement Ideas

- Make the maintenance page theme-aware (detect `?theme=casual` or read a cookie).
- Ship the maintenance pages as part of the installer and provide an `ovox maintenance enable/disable` command.
- Add a simple API endpoint that returns maintenance status so the page can auto-refresh with real-time updates.

---

These pages were created to match the existing dual-theme system and branding of OpenVox GUI.
