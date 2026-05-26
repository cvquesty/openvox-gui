"""
`ovox token` command group — Manage long-lived service/API tokens.

These tokens are intended for automation (e.g. the local 'bolt' user
talking to the OpenVox GUI for dynamic inventory).
"""

from typing import Optional
from datetime import datetime

import typer
from rich.console import Console
from rich.table import Table
from rich.json import JSON

from ..client import OvoxAPIError, get_client

console = Console()

app = typer.Typer(
    help="Manage long-lived service API tokens (for Bolt, automation, etc.)",
    no_args_is_help=True,
)


@app.command("generate")
def generate_token(
    ctx: typer.Context,
    username: str = typer.Option(..., "--user", "-u", help="Username the token is for (e.g. bolt or a service account)"),
    name: str = typer.Option(None, "--name", help="Human readable name for the token"),
    expires_in_days: Optional[int] = typer.Option(
        None, "--expires", "-e",
        help="Days until expiry. Omit or use 0 for a permanent token."
    ),
    output_file: Optional[str] = typer.Option(
        None, "--output", "-o",
        help="File to write the raw token to. Defaults to /etc/puppetlabs/bolt/.bolt_token when --user=bolt"
    ),
    json_output: bool = typer.Option(False, "--json", "-j"),
):
    """
    Generate a new long-lived service token for a user.

    The raw token is only shown once. Store it securely.
    """
    client = get_client(
        base_url=ctx.obj.get("url") if ctx.obj else None,
        token=ctx.obj.get("token") if ctx.obj else None,
        verify_ssl=ctx.obj.get("verify_ssl", True) if ctx.obj else True,
    )

    # Smart default for the most common case (the local bolt user)
    if username == "bolt" and output_file is None:
        output_file = "/etc/puppetlabs/bolt/.bolt_token"

    if not name:
        name = f"Generated for {username} at {datetime.utcnow().isoformat()}"

    payload = {
        "username": username,
        "name": name,
    }
    if expires_in_days and expires_in_days > 0:
        payload["expires_in_days"] = expires_in_days

    try:
        result = client.post(f"/api/auth/users/{username}/tokens", json=payload)
    except OvoxAPIError as exc:
        console.print(f"[red]Failed to generate token:[/red] {exc}")
        raise typer.Exit(1)

    if json_output or (ctx.obj and ctx.obj.get("output") == "json"):
        import json
        console.print(JSON(json.dumps(result, indent=2)))
        return

    token = result.get("token")
    console.print(f"[green]✓[/green] Token created for user '{username}'")
    console.print(f"  Name: {result.get('name')}")
    console.print(f"  ID:   {result.get('id')}")
    if result.get("expires_at"):
        console.print(f"  Expires: {result['expires_at']}")
    else:
        console.print("  Expires: never (permanent)")

    console.print("\n[bold yellow]Raw token (shown only once):[/bold yellow]")
    console.print(token)

    if output_file:
        try:
            # Ensure parent directory exists
            from pathlib import Path
            Path(output_file).parent.mkdir(parents=True, exist_ok=True)

            with open(output_file, "w") as f:
                f.write(token + "\n")

            # Best-effort: lock it down
            import os
            try:
                os.chmod(output_file, 0o600)
            except PermissionError:
                pass

            console.print(f"\n[green]Token written to {output_file}[/green]")
            console.print("Permissions set to 600 (best effort).")
            console.print("Make sure the file is owned by the user that will run Bolt (usually the 'bolt' user).")
        except Exception as e:
            console.print(f"[red]Failed to write token file:[/red] {e}")


@app.command("list")
def list_tokens(ctx: typer.Context, username: str = typer.Argument(..., help="Username to list tokens for")):
    """List active API tokens for a user (admin only)."""
    client = get_client(
        base_url=ctx.obj.get("url") if ctx.obj else None,
        token=ctx.obj.get("token") if ctx.obj else None,
    )
    try:
        # This endpoint doesn't exist yet — placeholder for now
        console.print("[yellow]Token listing endpoint not yet implemented in this build.[/yellow]")
        console.print("For now, use the web UI under User Management.")
    except OvoxAPIError as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(1)
