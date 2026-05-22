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
    help="OpenVox infrastructure health, recommendations, and automated tuning",
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


@app.command("recommend")
def recommend(
    ctx: typer.Context,
    server: bool = typer.Option(False, "--server", help="Only show recommendations for OpenVox Server / Puppet Server"),
    db: bool = typer.Option(False, "--db", "--puppetdb", help="Only show recommendations for OpenVoxDB / PuppetDB"),
    json_output: bool = typer.Option(False, "--json", "-j"),
):
    """
    Show tuning recommendations without applying any changes.

    By default shows recommendations for both server and database.
    Use --server or --db to limit the scope.
    """
    component = None
    if server:
        component = "server"
    elif db:
        component = "db"

    client = get_client(
        base_url=ctx.obj.get("url") if ctx.obj else None,
        token=ctx.obj.get("token") if ctx.obj else None,
        verify_ssl=ctx.obj.get("verify_ssl", True) if ctx.obj else True,
    )

    try:
        data = client.get("/api/infra/tune/recommendations", params={"component": component} if component else {})
    except OvoxAPIError:
        data = _local_tune_recommendations(client, component)

    if json_output or (ctx.obj and ctx.obj.get("output") == "json"):
        import json
        console.print(JSON(json.dumps(data, indent=2)))
        return

    _render_tune_recommendations(data, component)


@app.command("tune")
def tune(
    ctx: typer.Context,
    server: bool = typer.Option(False, "--server", help="Only tune OpenVox Server / Puppet Server"),
    db: bool = typer.Option(False, "--db", "--puppetdb", help="Only tune OpenVoxDB / PuppetDB"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Show what would be done without making changes"),
    json_output: bool = typer.Option(False, "--json", "-j"),
):
    """
    Apply recommended tuning settings for OpenVox Server and/or OpenVoxDB.

    This will:
      1. Create timestamped backups of the relevant configuration files
      2. Apply the recommended changes
      3. Restart the affected service(s) automatically

    Use --dry-run to preview changes without applying them.
    """
    component = None
    if server:
        component = "server"
    elif db:
        component = "db"

    client = get_client(
        base_url=ctx.obj.get("url") if ctx.obj else None,
        token=ctx.obj.get("token") if ctx.obj else None,
        verify_ssl=ctx.obj.get("verify_ssl", True) if ctx.obj else True,
    )

    try:
        data = client.get("/api/infra/tune/recommendations", params={"component": component} if component else {})
    except OvoxAPIError:
        data = _local_tune_recommendations(client, component)

    if json_output or (ctx.obj and ctx.obj.get("output") == "json"):
        import json
        console.print(JSON(json.dumps(data, indent=2)))
        return

    _render_tune_recommendations(data, component)

    if dry_run:
        console.print("\n[yellow]Dry run — no changes will be made.[/yellow]")
        return

    if not typer.confirm("\nApply these recommendations? This will back up configs and restart services.", default=False):
        console.print("[yellow]Aborted.[/yellow]")
        raise typer.Exit(0)

    _apply_tuning(client, data, component, dry_run=False)


@app.command("settings")
def settings_show(
    ctx: typer.Context,
    server: bool = typer.Option(False, "--server", help="Show settings for OpenVox Server / Puppet Server"),
    db: bool = typer.Option(False, "--db", "--puppetdb", help="Show settings for OpenVoxDB / PuppetDB"),
    json_output: bool = typer.Option(False, "--json", "-j"),
):
    """
    Display current key infrastructure tuning settings (including JVM configuration).

    This is the primary way to inspect what is actually configured right now.
    """
    client = get_client(
        base_url=ctx.obj.get("url") if ctx.obj else None,
        token=ctx.obj.get("token") if ctx.obj else None,
        verify_ssl=ctx.obj.get("verify_ssl", True) if ctx.obj else True,
    )

    try:
        data = client.get("/api/infra/settings", params={"component": "server" if server else ("db" if db else None)})
    except OvoxAPIError as exc:
        console.print(f"[red]Failed to fetch settings:[/red] {exc}")
        raise typer.Exit(1)

    if json_output or (ctx.obj and ctx.obj.get("output") == "json"):
        import json
        console.print(JSON(json.dumps(data, indent=2)))
        return

    if server or not db:
        ps = data.get("puppetserver", {})
        jvm = ps.get("jvm", {})
        console.print(Panel.fit(
            f"[bold]Puppet Server[/bold]\n"
            f"  JRuby max active instances : {ps.get('jruby_max_active_instances', 'unknown')}\n"
            f"  JVM heap (min)             : {jvm.get('heap_min', 'unknown')}\n"
            f"  JVM heap (max)             : {jvm.get('heap_max', 'unknown')}\n"
            f"  Reserved Code Cache        : {jvm.get('reserved_code_cache', 'unknown')}",
            title="Puppet Server Settings",
            border_style="cyan"
        ))

    if db or not server:
        pdb = data.get("puppetdb", {})
        pools = pdb.get("pools", {})
        jvm = pdb.get("jvm", {})
        console.print(Panel.fit(
            f"[bold]PuppetDB[/bold]\n"
            f"  Read pool max connections  : {pools.get('read', 'unknown')}\n"
            f"  Write pool max connections : {pools.get('write', 'unknown')}\n"
            f"  JVM heap (min)             : {jvm.get('heap_min', 'unknown')}\n"
            f"  JVM heap (max)             : {jvm.get('heap_max', 'unknown')}",
            title="PuppetDB Settings",
            border_style="magenta"
        ))


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
    table.add_column("Current", style="yellow")
    table.add_column("Recommended", style="green bold")
    table.add_column("Reason", style="dim")

    for r in recs:
        if component and r.get("component") != component:
            continue
        table.add_row(
            r.get("component", ""),
            r.get("setting", ""),
            str(r.get("current", "unknown")),
            str(r.get("recommended", "")),
            r.get("reason", "")[:70]
        )

    console.print(table)
    console.print("\n[bold]Run [cyan]ovox infra tune --server[/cyan] or [cyan]--db[/cyan] to apply.[/bold]")


def _apply_tuning(client, data: dict, component: Optional[str], dry_run: bool):
    """Apply the recommended changes (backend does backup + restart)."""
    recs = data.get("recommendations", [])

    if dry_run:
        console.print("[yellow]Dry run — no changes made.[/yellow]")
        return

    # Group changes by component for cleaner API calls
    changes_by_comp = {}
    for r in recs:
        if component and r.get("component") != component:
            continue
        comp = r.get("component", "unknown")
        changes_by_comp.setdefault(comp, []).append({
            "setting": r.get("setting"),
            "value": r.get("recommended")
        })

    for comp, changes in changes_by_comp.items():
        try:
            result = client.post("/api/infra/tune/apply", json={
                "component": comp,
                "changes": changes
            })
            console.print(f"[green]✓[/green] Submitted tuning for {comp}")
            if isinstance(result, dict):
                if result.get("backup_note"):
                    console.print(f"  {result['backup_note']}")
                if result.get("restarted"):
                    console.print(f"  [green]Service restarted automatically[/green]")
        except OvoxAPIError as exc:
            console.print(f"[red]Failed[/red] to apply changes for {comp}: {exc}")
