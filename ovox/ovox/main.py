"""
ovox main entry point — Typer CLI application.

This file wires up the global options (--url, --output, --token, --no-verify)
and the top-level command groups.

Run `ovox --help` after `pip install -e ovox` (from the ovox/ directory).
"""

import sys
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
        help="Disable TLS certificate verification (development only)",
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

from .commands import nodes, certs  # noqa: E402

cli.add_typer(nodes.app, name="nodes", help="Node inventory, facts, reports, and Puppet runs")
cli.add_typer(certs.app, name="certs", help="Certificate authority operations (sign, revoke, audit)")


# Future groups (stubbed for now so --help shows the roadmap):
@cli.command(hidden=True)
def pql(ctx: typer.Context, query: str = typer.Argument(..., help="PQL query string")):
    """Execute a raw Puppet Query Language (PQL) statement."""
    client = _get_client(ctx)
    try:
        result = client.run_pql(query)
        if ctx.obj and ctx.obj.get("output") == "json":
            import json
            console.print_json(json.dumps(result))
        else:
            console.print(result)
    except OvoxAPIError as exc:
        console.print(f"[red]PQL failed:[/red] {exc}")
        raise typer.Exit(1)


# Entry point for `python -m ovox`
def run():
    cli()


if __name__ == "__main__":
    run()
