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

### 1. Place the maintenance page

Copy the version you want to use:

```bash
sudo cp maintenance/maintenance-casual.html /var/www/maintenance/maintenance.html
sudo mkdir -p /var/www/maintenance
```

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
    RewriteCond /var/www/maintenance/maintenance.flag -f
    RewriteCond %{REQUEST_URI} !/maintenance.html
    RewriteRule ^ /maintenance.html [R=503,L]

    # Serve the static maintenance page
    Alias /maintenance.html /var/www/maintenance/maintenance.html

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

## Future Improvement Ideas

- Make the maintenance page theme-aware (detect `?theme=casual` or read a cookie).
- Ship the maintenance pages as part of the installer and provide an `ovox maintenance enable/disable` command.
- Add a simple API endpoint that returns maintenance status so the page can auto-refresh with real-time updates.

---

These pages were created to match the existing dual-theme system and branding of OpenVox GUI.
