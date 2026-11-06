"""
ovox main entry point — Typer CLI application.

This file wires up the global options (--url, --output, --token, --no-verify)
and the top-level command groups.

Run `ovox --help` after `pip install -e ovox` (from the ovox/ directory).
"""

import sys
import glob
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from . import __version__
from .client import OvoxAPIError, OvoxClient, get_client
from .config import get_config_manager
from .version import get_version

# Rich console for pretty output (respects NO_COLOR etc.)
console = Console()

# The main Typer app
cli = typer.Typer(
    name="ovox",
    help="ovox — command-line and terminal interface for OpenVox / Puppet fleets",
    add_completion=True,
    rich_markup_mode="rich",
    no_args_is_help=True,
)


# ──────────────────────────────────────────────────────────────────────────────
# Global options (available to every subcommand via context)
# ──────────────────────────────────────────────────────────────────────────────

def _version_callback(value: bool) -> None:
    if value:
        console.print(f"ovox {get_version()}")
        raise typer.Exit()


@cli.callback()
def main(
    ctx: typer.Context,
    url: Optional[str] = typer.Option(
        None,
        "--url",
        "-u",
        envvar="OPENVOX_URL",
        help="Base URL of the OpenVox GUI (e.g. https://openvox.example.com:4567)",
    ),
    token: Optional[str] = typer.Option(
        None,
        "--token",
        "-t",
        envvar="OPENVOX_TOKEN",
        help="Bearer JWT token (bypasses stored credentials)",
    ),
    output: Optional[str] = typer.Option(
        None,
        "--output",
        "-o",
        envvar="OPENVOX_OUTPUT",
        help="Output format: table, json, yaml, csv",
        case_sensitive=False,
    ),
    no_verify: bool = typer.Option(
        False,
        "--no-verify",
        help="Disable TLS verification. Useful when connecting directly to the "
             "internal :4567 listener on the OpenVox server itself (the uvicorn "
             "process uses the Puppet CA, not a public LE cert).",
    ),
    version: bool = typer.Option(
        False,
        "--version",
        "-V",
        callback=_version_callback,
        is_eager=True,
        help="Show ovox version and exit",
    ),
):
    """
    ovox talks to the same FastAPI backend that powers the OpenVox web GUI.

    All heavy work (PuppetDB queries, certificate operations, r10k, Bolt, etc.)
    stays on the server — this client is intentionally thin and scriptable.
    """
    # Store overrides in the context so subcommands can build a client easily
    ctx.obj = {
        "url": url,
        "token": token,
        "output": output,
        "verify_ssl": not no_verify,
    }


def _get_client(ctx: typer.Context) -> OvoxClient:
    """Build an OvoxClient using global options + persisted config."""
    obj = ctx.obj or {}
    return get_client(
        base_url=obj.get("url"),
        token=obj.get("token"),
        verify_ssl=obj.get("verify_ssl"),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Top-level commands
# ──────────────────────────────────────────────────────────────────────────────

@cli.command()
def login(
    ctx: typer.Context,
    username: str = typer.Argument(..., help="Username (local account or LDAP/AD user)"),
    password: Optional[str] = typer.Option(
        None, "--password", "-p", prompt=True, hide_input=True, help="Password"
    ),
    url: Optional[str] = typer.Option(None, "--url", "-u", help="GUI base URL (if not already configured)"),
):
    """Authenticate and store a JWT token for future commands."""
    client = _get_client(ctx)
    if url:
        client.base_url = url.rstrip("/")
    try:
        info = client.login(username, password)
        user = info.get("user", {})
        console.print(f"[green]✓[/green] Logged in as [bold]{user.get('username', username)}[/bold] "
                      f"(role: {user.get('role', 'unknown')})")
        console.print(f"Server: {client.base_url}")
    except OvoxAPIError as exc:
        console.print(f"[red]✗ Login failed:[/red] {exc}")
        raise typer.Exit(1)


@cli.command()
def logout(ctx: typer.Context):
    """Forget the locally stored authentication token."""
    client = _get_client(ctx)
    client.logout()
    console.print("[green]✓[/green] Logged out (local token removed)")


@cli.command()
def whoami(ctx: typer.Context):
    """Show the currently authenticated user (if any)."""
    client = _get_client(ctx)
    info = client.whoami()
    if not info:
        console.print("[yellow]Not authenticated.[/yellow] Run [bold]ovox login[/bold]")
        raise typer.Exit(1)

    table = Table(title="Current Session")
    table.add_column("Field", style="cyan")
    table.add_column("Value", style="green")
    for k, v in info.items():
        table.add_row(str(k), str(v))
    console.print(table)


@cli.command()
def status(ctx: typer.Context):
    """Quick fleet and server health summary."""
    client = _get_client(ctx)
    try:
        data = client.get_status()
    except OvoxAPIError as exc:
        console.print(f"[red]Failed to fetch status:[/red] {exc}")
        raise typer.Exit(1)

    console.print(f"[bold]OpenVox GUI[/bold] @ {client.base_url}")
    console.print(f"ovox client: {get_version()}")
    if isinstance(data, dict):
        for k, v in data.items():
            console.print(f"  {k}: {v}")


# ──────────────────────────────────────────────────────────────────────────────
# Command groups (imported from commands/)
# ──────────────────────────────────────────────────────────────────────────────

from .commands import nodes, certs, infra, token, maintenance, vm  # noqa: E402

cli.add_typer(nodes.app, name="nodes", help="Node inventory, facts, reports, and Puppet runs")
cli.add_typer(certs.app, name="certs", help="Certificate authority operations (sign, revoke, audit)")
cli.add_typer(infra.app, name="infra", help="Infrastructure health, settings inspection, recommendations and tuning (with automatic service restart on apply)")
cli.add_typer(maintenance.app, name="maintenance", help="GUI maintenance mode (branded pages, clean 503s for APIs, and full operator control)")

# Also expose maintenance under infra for discoverability (ovox infra maintenance ...)
try:
    infra.app.add_typer(maintenance.app, name="maintenance", help="GUI maintenance (enable/disable/status with themed pages and clean API behavior)")
except Exception:
    pass  # If the infra app doesn't support late addition in this build, the top-level command is still available.
cli.add_typer(vm.app, name="vm", help="Provisioning: build VMware VMs as OpenVox agents and manage the machines the GUI built")
cli.add_typer(token.app, name="token", help="Manage long-lived service API tokens (for Bolt, etc.)")


# ──────────────────────────────────────────────────────────────────────────────
# DB backup / failback commands (for when the local SQLite gets cleared)
# ──────────────────────────────────────────────────────────────────────────────

@cli.command("db-backup")
def db_backup(
    ctx: typer.Context,
    out_dir: str = typer.Option("/backup", "--out", "-o", help="Base directory for backups"),
):
    """Create a timestamped backup of /opt/openvox-gui/data (ENC, users, history, etc.).

    Run this on the GUI host. Gives you an automatic failback if the local DB
    ever goes empty again (aggressive prune, bad deploy, disk problem, etc.).
    """
    import subprocess
    from datetime import datetime
    import os

    ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    backup_dir = os.path.join(out_dir, f"openvox-gui-data-{ts}")
    try:
        subprocess.check_call(["mkdir", "-p", backup_dir])
        if os.path.isdir("/opt/openvox-gui/data"):
            subprocess.check_call(["cp", "-a", "/opt/openvox-gui/data", backup_dir])
            console.print(f"[green]Backup created:[/green] {backup_dir}")
            # Rotate old ones (keep last 14)
            try:
                old = sorted(glob.glob(os.path.join(out_dir, "openvox-gui-data-*")), reverse=True)[14:]
                for d in old:
                    subprocess.check_call(["rm", "-rf", d])
            except Exception:
                pass
        else:
            console.print("[yellow]No /opt/openvox-gui/data directory found.[/yellow]")
    except Exception as e:
        console.print(f"[red]Backup failed:[/red] {e}")
        raise typer.Exit(1)


@cli.command("db-restore")
def db_restore(
    ctx: typer.Context,
    backup_dir: str = typer.Argument(..., help="Path to a previous backup (e.g. /backup/openvox-gui-data-20260706-.../data)"),
):
    """Restore the GUI data directory from a previous backup.

    Stops the service, replaces /opt/openvox-gui/data, restarts.
    Use with care — this will overwrite current local state (classifications, etc.).
    """
    import subprocess
    import os

    if not os.path.isdir(backup_dir):
        console.print(f"[red]Backup directory not found:[/red] {backup_dir}")
        raise typer.Exit(1)

    console.print(f"[yellow]This will STOP the GUI, replace /opt/openvox-gui/data with {backup_dir}, then restart.[/yellow]")
    if not typer.confirm("Proceed?"):
        raise typer.Exit(0)

    try:
        subprocess.check_call(["systemctl", "stop", "openvox-gui"])
        subprocess.check_call(["rm", "-rf", "/opt/openvox-gui/data"])
        subprocess.check_call(["cp", "-a", backup_dir, "/opt/openvox-gui/data"])
        subprocess.check_call(["chown", "-R", "puppet:puppet", "/opt/openvox-gui/data"])
        subprocess.check_call(["systemctl", "start", "openvox-gui"])
        console.print("[green]Restore complete. Service restarted.[/green]")
    except Exception as e:
        console.print(f"[red]Restore failed:[/red] {e}")
        raise typer.Exit(1)


@cli.command("db-reseed")
def db_reseed(ctx: typer.Context):
    """Re-seed ENC nodes from the current live fleet (safe, additive only).

    Adds any members of the live fleet (active PuppetDB record + signed CA cert)
    that are missing from the GUI's local classification store. Does **not**
    delete or overwrite existing ENC data.

    This is the recovery command after aggressive prunes, lost SQLite data,
    or other classification wipeouts where the fleet itself is still healthy.

    Equivalent backend operation: POST /api/enc/reseed
    """
    client = _get_client(ctx)
    try:
        result = client.db_reseed()
        reseed = result.get("reseed", {}) if isinstance(result, dict) else {}
        added = reseed.get("added", []) or []
        total = reseed.get("total_live", 0) or 0
        console.print(
            f"[green]✓[/green] Re-seed complete. Added {len(added)} node(s) "
            f"from live fleet ({total} total)."
        )
        if added:
            console.print("Added certnames:")
            for cn in added[:30]:
                console.print(f"  • {cn}")
            if len(added) > 30:
                console.print(f"  ... and {len(added) - 30} more")
    except OvoxAPIError as exc:
        console.print(f"[red]Re-seed failed:[/red] {exc}")
        raise typer.Exit(1)


# ──────────────────────────────────────────────────────────────────────────────
# PQL command (first-class query support from the terminal)
# ──────────────────────────────────────────────────────────────────────────────

@cli.command()
def pql(
    ctx: typer.Context,
    query: str = typer.Argument(..., help="PQL query string"),
    format: str = typer.Option(
        "table",
        "--format",
        "-f",
        help="Output format: table, markdown, csv, json, raw",
        case_sensitive=False,
    ),
):
    """
    Execute a raw Puppet Query Language (PQL) query against OpenVoxDB.

    Examples:
        ovox pql 'nodes { latest_report_status = "failed" }'
        ovox pql 'facts { name = "os" and value ~ "Rocky" }' --format markdown
        ovox pql '...' --format csv > results.csv
    """
    client = _get_client(ctx)
    fmt = (format or "table").lower()

    try:
        result = client.run_pql(query)

        # Normalize to the same shape the web UI receives
        data = result.get("results", []) if isinstance(result, dict) else result

        if fmt == "json":
            import json
            console.print_json(json.dumps(result))
        elif fmt == "markdown":
            from .utils.formatters import results_to_markdown
            console.print(results_to_markdown(data))
        elif fmt == "csv":
            from .utils.formatters import results_to_csv
            console.print(results_to_csv(data))
        elif fmt == "raw":
            console.print(result)
        else:
            # Default: pretty Rich table (best for interactive terminal use)
            if isinstance(data, list) and data and isinstance(data[0], dict):
                table = Table(show_header=True, header_style="bold cyan")
                cols = list(data[0].keys())[:8]  # cap columns for readability
                for col in cols:
                    table.add_column(col)
                for row in data[:100]:  # safety cap
                    table.add_row(*[str(row.get(c, ""))[:60] for c in cols])
                console.print(table)
                if len(data) > 100:
                    console.print(f"[dim]... {len(data) - 100} more rows (use --format csv/markdown for full export)[/dim]")
            else:
                console.print(data)

    except OvoxAPIError as exc:
        console.print(f"[red]PQL failed:[/red] {exc}")
        raise typer.Exit(1)


# Entry point for `python -m ovox`
def run():
    cli()


if __name__ == "__main__":
    run()
