"""
`ovox nodes` command group.

Examples:
  ovox nodes list
  ovox nodes list --status failed --environment production
  ovox nodes show web01.example.com
  ovox nodes facts web01.example.com osfamily
"""

from typing import Optional

import typer
from rich.console import Console
from rich.table import Table
from rich.json import JSON

from ..client import OvoxAPIError, get_client

console = Console()

app = typer.Typer(
    help="Inspect and manage nodes in the Puppet/OpenVox fleet",
    no_args_is_help=True,
)


def _format_nodes_table(nodes: list, title: str = "Nodes") -> Table:
    """Render a compact, readable table for node lists."""
    table = Table(title=title, show_lines=False)
    table.add_column("Certname", style="cyan", no_wrap=True)
    table.add_column("Status", style="green")
    table.add_column("Env", style="magenta")
    table.add_column("Last Report", style="dim")
    table.add_column("OS", style="yellow")

    for n in nodes:
        # The exact shape depends on the /api/nodes serializer; be defensive
        cert = n.get("certname") or n.get("name") or "?"
        status = n.get("status") or n.get("latest_report_status") or "unknown"
        env = n.get("environment") or n.get("env") or "-"
        last = n.get("last_report") or n.get("report_timestamp") or "-"
        osfamily = ""
        facts = n.get("facts") or {}
        if isinstance(facts, dict):
            osfamily = facts.get("osfamily") or facts.get("os", {}).get("family", "")
        elif isinstance(facts, str):
            osfamily = facts[:20]
        table.add_row(str(cert), str(status), str(env), str(last)[:19], str(osfamily))
    return table


@app.command("list")
def list_nodes(
    ctx: typer.Context,
    status: Optional[str] = typer.Option(None, "--status", "-s", help="Filter by report status (failed, changed, unchanged, ... )"),
    environment: Optional[str] = typer.Option(None, "--environment", "-e", help="Puppet environment"),
    limit: int = typer.Option(50, "--limit", "-l", help="Maximum rows to return"),
    json_output: bool = typer.Option(False, "--json", "-j", help="Emit raw JSON instead of table"),
):
    """List nodes with optional filters (status, environment)."""
    client = get_client(
        base_url=ctx.obj.get("url") if ctx.obj else None,
        token=ctx.obj.get("token") if ctx.obj else None,
        verify_ssl=ctx.obj.get("verify_ssl", True) if ctx.obj else True,
    )
    try:
        nodes = client.get_nodes(status=status, environment=environment, limit=limit)
    except OvoxAPIError as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(1)

    if json_output or (ctx.obj and ctx.obj.get("output") == "json"):
        import json
        console.print(JSON(json.dumps(nodes, indent=2)))
        return

    if not nodes:
        console.print("[yellow]No nodes matched the filter.[/yellow]")
        return

    table = _format_nodes_table(nodes, f"Nodes (showing {len(nodes)})")
    console.print(table)


@app.command("show")
def show_node(
    ctx: typer.Context,
    certname: str = typer.Argument(..., help="Exact certname (FQDN) of the node"),
    json_output: bool = typer.Option(False, "--json", "-j"),
):
    """Show detailed information about a single node (facts, last report, resources)."""
    client = get_client(
        base_url=ctx.obj.get("url") if ctx.obj else None,
        token=ctx.obj.get("token") if ctx.obj else None,
        verify_ssl=ctx.obj.get("verify_ssl", True) if ctx.obj else True,
    )
    try:
        node = client.get_node(certname)
    except OvoxAPIError as exc:
        if exc.status_code == 404:
            console.print(f"[red]Node not found:[/red] {certname}")
        else:
            console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(1)

    if json_output or (ctx.obj and ctx.obj.get("output") == "json"):
        import json
        console.print(JSON(json.dumps(node, indent=2)))
        return

    # Pretty human output (expand as more fields become useful)
    console.print(f"[bold cyan]{node.get('certname', certname)}[/bold cyan]")
    console.print(f"  Environment : {node.get('environment', '-')}")
    console.print(f"  Status      : {node.get('status', node.get('latest_report_status', '-'))}")
    console.print(f"  Last report : {node.get('last_report', '-')}")
    facts = node.get("facts") or {}
    if facts:
        console.print("  Facts (sample):")
        for k in sorted(facts)[:8]:
            console.print(f"    {k}: {facts[k]}")
        if len(facts) > 8:
            console.print(f"    ... ({len(facts) - 8} more)")
