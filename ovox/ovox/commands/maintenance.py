"""
`ovox maintenance` command group — Holistic maintenance mode management.

This is the primary operator interface for the OpenVox GUI maintenance program:

- Enable maintenance with a rich message and ETA (writes state + flag files).
- Disable maintenance (restores normal operation).
- Check status (shows who enabled it, when, why, and when it is expected to end).

When maintenance is active:
  - Web users see the branded static "Under Maintenance" page (via Apache
    when configured — see the maintenance/ directory in the source tree).
  - API clients and `ovox` itself receive clean 503 responses with the
    details instead of confusing errors or stack traces.
  - Backend Puppet/OpenVox services (Server, PuppetDB, Bolt, agents) continue
    to operate normally.

The maintenance pages (formal and casual themes) live in the `maintenance/`
directory at the project root and are deployed alongside the GUI.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich import box

from ..client import get_client, OvoxAPIError

console = Console()

app = typer.Typer(
    help="Manage GUI maintenance mode (holistic program with static pages, API 503s, and CLI control)",
    no_args_is_help=True,
)


@app.command("status")
def status(
    ctx: typer.Context,
    json_output: bool = typer.Option(False, "--json", "-j", help="Output raw JSON"),
):
    """Show whether maintenance mode is currently active and any details."""
    client = get_client(
        base_url=ctx.obj.get("url") if ctx.obj else None,
        token=ctx.obj.get("token") if ctx.obj else None,
        verify_ssl=ctx.obj.get("verify_ssl", True) if ctx.obj else True,
    )

    try:
        data = client.get("/api/maintenance/status")
    except OvoxAPIError as exc:
        console.print(f"[red]Failed to fetch maintenance status:[/red] {exc}")
        raise typer.Exit(1)

    if json_output or (ctx.obj and ctx.obj.get("output") == "json"):
        import json
        from rich.json import JSON
        console.print(JSON(json.dumps(data, indent=2)))
        return

    if not data.get("enabled"):
        console.print("[green]Maintenance mode is currently DISABLED.[/green]")
        console.print("The OpenVox GUI is operating normally.")
        return

    # Active maintenance — pretty output
    table = Table(title="Maintenance Mode — ACTIVE", box=box.ROUNDED)
    table.add_column("Field", style="cyan")
    table.add_column("Value", style="yellow")

    table.add_row("Enabled", "[red]YES[/red]")
    if data.get("started_at"):
        table.add_row("Started at", data["started_at"])
    if data.get("message"):
        table.add_row("Message", data["message"])
    if data.get("eta"):
        table.add_row("Estimated return", data["eta"])
    if data.get("activated_by"):
        table.add_row("Activated by", data["activated_by"])

    console.print(table)
    console.print()
    console.print(
        Panel.fit(
            "Web users are seeing the branded maintenance page (if Apache is configured).\n"
            "Use [bold]ovox maintenance disable[/bold] to restore normal operation.",
            border_style="red",
        )
    )


@app.command("enable")
def enable(
    ctx: typer.Context,
    message: Optional[str] = typer.Option(
        None, "--message", "-m", help="Reason shown to users and in status output"
    ),
    eta: Optional[str] = typer.Option(
        None, "--eta", "-e", help="Estimated time until the GUI returns (e.g. '20 minutes')"
    ),
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation prompt"),
    json_output: bool = typer.Option(False, "--json", "-j"),
):
    """
    Enable maintenance mode for the OpenVox GUI.

    This will:
      - Write the maintenance state (with your message/ETA) so the backend and CLI know.
      - Cause web visitors to see the nice themed "Under Maintenance" page
        (when Apache is configured with the maintenance flag check).
      - Make API clients receive clean 503 responses instead of errors.
    """
    if not yes and not typer.confirm(
        "Enable maintenance mode? Web users will see the maintenance page and the API will return 503s.",
        default=False,
    ):
        console.print("[yellow]Aborted.[/yellow]")
        raise typer.Exit(0)

    client = get_client(
        base_url=ctx.obj.get("url") if ctx.obj else None,
        token=ctx.obj.get("token") if ctx.obj else None,
        verify_ssl=ctx.obj.get("verify_ssl", True) if ctx.obj else True,
    )

    payload = {}
    if message:
        payload["message"] = message
    if eta:
        payload["eta"] = eta

    try:
        data = client.post("/api/maintenance/enable", json=payload)
    except OvoxAPIError as exc:
        console.print(f"[red]Failed to enable maintenance:[/red] {exc}")
        raise typer.Exit(1)

    if json_output or (ctx.obj and ctx.obj.get("output") == "json"):
        import json
        from rich.json import JSON
        console.print(JSON(json.dumps(data, indent=2)))
        return

    console.print("[green]Maintenance mode ENABLED.[/green]")
    if data.get("message"):
        console.print(f"Message: {data['message']}")
    if data.get("eta"):
        console.print(f"ETA: {data['eta']}")
    console.print(
        "\n[bold]Remember to run[/bold] [cyan]ovox maintenance disable[/cyan] when the work is complete."
    )


@app.command("disable")
def disable(
    ctx: typer.Context,
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation prompt"),
    json_output: bool = typer.Option(False, "--json", "-j"),
):
    """Disable maintenance mode and restore normal GUI operation."""
    if not yes and not typer.confirm(
        "Disable maintenance mode and allow normal access to the GUI again?", default=True
    ):
        console.print("[yellow]Aborted.[/yellow]")
        raise typer.Exit(0)

    client = get_client(
        base_url=ctx.obj.get("url") if ctx.obj else None,
        token=ctx.obj.get("token") if ctx.obj else None,
        verify_ssl=ctx.obj.get("verify_ssl", True) if ctx.obj else True,
    )

    try:
        data = client.post("/api/maintenance/disable")
    except OvoxAPIError as exc:
        console.print(f"[red]Failed to disable maintenance:[/red] {exc}")
        raise typer.Exit(1)

    if json_output or (ctx.obj and ctx.obj.get("output") == "json"):
        import json
        from rich.json import JSON
        console.print(JSON(json.dumps(data, indent=2)))
        return

    console.print("[green]Maintenance mode DISABLED.[/green]")
    console.print("The OpenVox GUI should now be accessible normally.")


# Convenience aliases (common muscle memory)
@app.command("on", hidden=True)
def enable_alias(ctx: typer.Context, **kwargs):
    """Alias for 'enable'."""
    enable(ctx, **kwargs)


@app.command("off", hidden=True)
def disable_alias(ctx: typer.Context, **kwargs):
    """Alias for 'disable'."""
    disable(ctx, **kwargs)
