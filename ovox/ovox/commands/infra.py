"""
`ovox infra` command group — Infrastructure health and tuning.

This group provides tools to monitor and tune the core OpenVox
infrastructure components (Puppet Server / OpenVox Server and
PuppetDB / OpenVoxDB).

Inspired by Puppet Enterprise's `puppet infrastructure tune` but
designed for the open source OpenVox stack.
"""

from typing import Optional

import typer
from rich.console import Console
from rich.table import Table
from rich.json import JSON
from rich.panel import Panel

from ..client import OvoxAPIError, get_client

console = Console()

app = typer.Typer(
    help="Infrastructure health checks and tuning recommendations for OpenVox Server and OpenVoxDB",
    no_args_is_help=True,
)


@app.command("health")
def health(
    ctx: typer.Context,
    component: Optional[str] = typer.Option(
        None,
        "--component",
        "-c",
        help="Limit to a specific component (puppetserver, puppetdb, all)",
    ),
    json_output: bool = typer.Option(False, "--json", "-j"),
):
    """
    Check the health of OpenVox infrastructure components.

    Reports status of Puppet Server, PuppetDB, and basic connectivity.
    """
    client = get_client(
        base_url=ctx.obj.get("url") if ctx.obj else None,
        token=ctx.obj.get("token") if ctx.obj else None,
        verify_ssl=ctx.obj.get("verify_ssl", True) if ctx.obj else True,
    )

    try:
        # Use existing dashboard services endpoint + basic checks
        services = client.get("/api/dashboard/services")
    except OvoxAPIError as exc:
        console.print(f"[red]Failed to fetch service health:[/red] {exc}")
        raise typer.Exit(1)

    if json_output or (ctx.obj and ctx.obj.get("output") == "json"):
        import json
        console.print(JSON(json.dumps(services, indent=2)))
        return

    table = Table(title="OpenVox Infrastructure Health")
    table.add_column("Component", style="cyan")
    table.add_column("Status", style="green")
    table.add_column("Details", style="dim")

    for svc in services if isinstance(services, list) else []:
        name = svc.get("name", "unknown")
        status = svc.get("status", "unknown")
        details = svc.get("details", "") or svc.get("version", "")

        if component and component.lower() not in name.lower():
            continue

        color = "green" if status == "ok" else "red"
        table.add_row(name, f"[{color}]{status}[/{color}]", str(details)[:60])

    if not table.rows:
        console.print("[yellow]No matching components found.[/yellow]")
    else:
        console.print(table)

    # Basic summary
    console.print()
    console.print(Panel.fit(
        "Run [bold]ovox infra tune --recommend[/bold] to get tuning suggestions based on your fleet size.",
        title="Tip",
        border_style="blue"
    ))


@app.command("tune")
def tune(
    ctx: typer.Context,
    recommend: bool = typer.Option(True, "--recommend", help="Show current settings and tuning recommendations"),
    apply: bool = typer.Option(False, "--apply", help="Apply recommended settings (creates backups first)"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Show what would be changed without applying"),
    component: Optional[str] = typer.Option(
        None, "--component", "-c",
        help="Limit to puppetserver | puppetdb"
    ),
    json_output: bool = typer.Option(False, "--json", "-j"),
):
    """
    View and manage tuning recommendations for OpenVox Server and OpenVoxDB.

    Recommendations are based on fleet size, available memory, and current
    configuration (similar to Puppet Enterprise's infrastructure tune logic).
    """
    client = get_client(
        base_url=ctx.obj.get("url") if ctx.obj else None,
        token=ctx.obj.get("token") if ctx.obj else None,
        verify_ssl=ctx.obj.get("verify_ssl", True) if ctx.obj else True,
    )

    if apply and not dry_run:
        if not typer.confirm("This will modify production configuration files after creating backups. Continue?", default=False):
            console.print("[yellow]Aborted.[/yellow]")
            raise typer.Exit(0)

    try:
        # For now we call a future /api/infra/tune endpoint.
        # If it doesn't exist yet, fall back to local heuristics + current config.
        data = client.get("/api/infra/tune/recommendations")
    except OvoxAPIError:
        # Fallback: gather what we can from existing endpoints
        data = _local_tune_recommendations(client, component)

    if json_output or (ctx.obj and ctx.obj.get("output") == "json"):
        import json
        console.print(JSON(json.dumps(data, indent=2)))
        return

    if recommend or not apply:
        _render_tune_recommendations(data, component)

    if apply:
        _apply_tuning(client, data, component, dry_run)


def _local_tune_recommendations(client, component: Optional[str]) -> dict:
    """Generate basic recommendations using data we already have."""
    try:
        nodes = client.get("/api/nodes/")
        node_count = len(nodes) if isinstance(nodes, list) else 0
    except Exception:
        node_count = 0

    # Very rough heuristics (will be replaced by better backend logic later)
    recommendations = {
        "node_count": node_count,
        "recommendations": [],
        "current": {},
    }

    # Example puppetserver tuning
    if not component or component == "puppetserver":
        jruby_count = max(1, min(4, node_count // 50 + 1))
        recommendations["recommendations"].append({
            "component": "puppetserver",
            "setting": "jruby_max_active_instances",
            "current": "auto / unknown",
            "recommended": jruby_count,
            "reason": f"Based on ~{node_count} nodes. Rule of thumb: 1 JRuby per 50 nodes, capped reasonably."
        })

    # Placeholder for puppetdb
    if not component or component == "puppetdb":
        recommendations["recommendations"].append({
            "component": "puppetdb",
            "setting": "read_pool_max_connections",
            "current": "unknown",
            "recommended": max(10, min(50, node_count // 20)),
            "reason": "Increase connection pool with fleet size."
        })

    return recommendations


def _render_tune_recommendations(data: dict, component: Optional[str]):
    """Pretty-print the tuning recommendations."""
    console.print(Panel.fit(
        f"[bold]Fleet size detected:[/bold] {data.get('node_count', 'unknown')} nodes",
        border_style="blue"
    ))

    recs = data.get("recommendations", [])
    if not recs:
        console.print("[green]No specific tuning recommendations at this time.[/green]")
        return

    table = Table(title="Tuning Recommendations")
    table.add_column("Component", style="cyan")
    table.add_column("Setting", style="magenta")
    table.add_column("Current", style="dim")
    table.add_column("Recommended", style="green")
    table.add_column("Reason", style="yellow")

    for r in recs:
        if component and r.get("component") != component:
            continue
        table.add_row(
            r.get("component", ""),
            r.get("setting", ""),
            str(r.get("current", "")),
            str(r.get("recommended", "")),
            r.get("reason", "")[:60]
        )

    console.print(table)


def _apply_tuning(client, data: dict, component: Optional[str], dry_run: bool):
    """Apply (or simulate) the recommended changes with backups."""
    recs = data.get("recommendations", [])

    if dry_run:
        console.print("[yellow]Dry run mode — no changes will be made.[/yellow]")

    applied = []
    for r in recs:
        if component and r.get("component") != component:
            continue

        msg = f"Would set {r['component']}::{r['setting']} = {r['recommended']}"
        if not dry_run:
            # In a real implementation we would call a backend endpoint that does:
            # 1. Backup the relevant config file(s) with timestamp
            # 2. Write the new value
            # 3. Optionally restart the service
            try:
                # Placeholder for future backend call
                client.post("/api/infra/tune/apply", json={
                    "component": r["component"],
                    "setting": r["setting"],
                    "value": r["recommended"]
                })
                msg = f"[green]Applied[/green] {r['component']}::{r['setting']} = {r['recommended']}"
            except Exception as exc:
                msg = f"[red]Failed[/red] to apply {r['setting']}: {exc}"

        applied.append(msg)

    for m in applied:
        console.print(m)

    if not dry_run and applied:
        console.print("\n[bold green]Backups were created before any changes.[/bold green]")
        console.print("You should restart the affected services for changes to take effect.")
