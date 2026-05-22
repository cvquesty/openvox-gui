"""
`ovox certs` command group — Certificate Authority operations.

Maps directly to the /api/certificates endpoints that the web GUI uses.
"""

from typing import Optional

import typer
from rich.console import Console
from rich.table import Table
from rich.json import JSON

from ..client import OvoxAPIError, get_client

console = Console()

app = typer.Typer(
    help="Certificate authority management (sign, revoke, audit, clean)",
    no_args_is_help=True,
)


def _format_cert_table(certs: list, title: str) -> Table:
    table = Table(title=title)
    table.add_column("Certname", style="cyan", no_wrap=True)
    table.add_column("Status", style="green")
    table.add_column("Fingerprint (short)", style="dim")
    table.add_column("Expiry", style="yellow")

    for c in certs:
        name = c.get("certname") or c.get("name") or "?"
        status = c.get("status") or "signed"
        fp = c.get("fingerprint") or c.get("sha256") or ""
        if fp and len(fp) > 16:
            fp = fp[:8] + "…" + fp[-8:]
        expiry = c.get("not_after") or c.get("expires") or "-"
        table.add_row(str(name), str(status), fp, str(expiry)[:10])
    return table


@app.command("list")
def list_certs(
    ctx: typer.Context,
    status: Optional[str] = typer.Option(None, "--status", "-s", help="signed | pending | revoked"),
    json_output: bool = typer.Option(False, "--json", "-j"),
):
    """List certificates known to the Puppet CA (via OpenVox GUI)."""
    client = get_client(
        base_url=ctx.obj.get("url") if ctx.obj else None,
        token=ctx.obj.get("token") if ctx.obj else None,
        verify_ssl=ctx.obj.get("verify_ssl", True) if ctx.obj else True,
    )
    try:
        certs = client.get_certificates(status=status)
    except OvoxAPIError as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(1)

    if json_output or (ctx.obj and ctx.obj.get("output") == "json"):
        import json
        console.print(JSON(json.dumps(certs, indent=2)))
        return

    if not certs:
        console.print("[yellow]No certificates found for that filter.[/yellow]")
        return

    console.print(_format_cert_table(certs, f"Certificates ({status or 'all'})"))


@app.command("sign")
def sign_cert(
    ctx: typer.Context,
    certname: str = typer.Argument(..., help="Certname to sign (must be in pending state)"),
):
    """Sign a pending certificate request."""
    client = get_client(
        base_url=ctx.obj.get("url") if ctx.obj else None,
        token=ctx.obj.get("token") if ctx.obj else None,
        verify_ssl=ctx.obj.get("verify_ssl", True) if ctx.obj else True,
    )
    try:
        res = client.sign_certificate(certname)
        console.print(f"[green]✓[/green] Signed certificate for [bold]{certname}[/bold]")
        if isinstance(res, dict) and res.get("message"):
            console.print(res["message"])
    except OvoxAPIError as exc:
        console.print(f"[red]Sign failed:[/red] {exc}")
        raise typer.Exit(1)


@app.command("revoke")
def revoke_cert(
    ctx: typer.Context,
    certname: str = typer.Argument(..., help="Certname to revoke"),
    clean: bool = typer.Option(False, "--clean", help="Also remove the cert from the CA (puppetserver ca clean)"),
):
    """Revoke (and optionally clean) a certificate."""
    client = get_client(
        base_url=ctx.obj.get("url") if ctx.obj else None,
        token=ctx.obj.get("token") if ctx.obj else None,
        verify_ssl=ctx.obj.get("verify_ssl", True) if ctx.obj else True,
    )
    try:
        res = client.revoke_certificate(certname, clean=clean)
        action = "Revoked and cleaned" if clean else "Revoked"
        console.print(f"[green]✓[/green] {action} [bold]{certname}[/bold]")
        if isinstance(res, dict) and res.get("message"):
            console.print(res["message"])
    except OvoxAPIError as exc:
        console.print(f"[red]Revoke failed:[/red] {exc}")
        raise typer.Exit(1)


@app.command("pending")
def pending(ctx: typer.Context, json_output: bool = typer.Option(False, "--json", "-j")):
    """Shortcut for `ovox certs list --status pending`."""
    list_certs(ctx, status="pending", json_output=json_output)
