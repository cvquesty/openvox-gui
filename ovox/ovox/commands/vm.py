"""
`ovox vm` command group — Provisioning (VMware today) from the terminal.

Thin client over /api/provisioning (same RBAC as the web page: admin and
operator build; admin destroys and manages connections).

Examples:
  ovox vm connections
  ovox vm inventory --datacenter DC-East
  ovox vm images
  ovox vm build web01.example.com --ip 192.0.2.50 --netmask 24 --gateway 192.0.2.1 \\
      --dns 192.0.2.10 --preset prod-web --wait
  ovox vm builds
  ovox vm status <job-id> --wait
  ovox vm cancel <job-id>
  ovox vm machines --live
  ovox vm power <job-id> off
  ovox vm snapshot <job-id> before-patching
  ovox vm destroy <job-id> --confirm web01.example.com
"""

import json
import time
from typing import List, Optional

import typer
from rich.console import Console
from rich.json import JSON
from rich.table import Table

from ..client import OvoxAPIError, get_client
from ..utils.provisioning import apply_preset, build_body, finalize

console = Console()

app = typer.Typer(
    help="Provision VMs (VMware) and manage the machines the GUI built",
    no_args_is_help=True,
)

_ACTIVE = {"queued", "running", "cancelling"}


def _client(ctx: typer.Context):
    obj = ctx.obj or {}
    return get_client(base_url=obj.get("url"), token=obj.get("token"), verify_ssl=obj.get("verify_ssl", True))


def _json_mode(ctx: typer.Context, flag: bool) -> bool:
    return flag or bool(ctx.obj and ctx.obj.get("output") == "json")


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except OvoxAPIError as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(1)


def _default_connection(client) -> str:
    status = _call(client.get, "/api/provisioning/status")
    return status.get("default_connection") or ""


def _print_job(job: dict) -> None:
    console.print(f"[bold cyan]{job['certname']}[/bold cyan]  [bold]{job['status']}[/bold]  "
                  f"(job {job['id']}, connection {job.get('connection_id', '-')})")
    for step in job.get("steps", []):
        colour = {"done": "green", "running": "blue", "failed": "red", "rejected": "red",
                  "timeout": "yellow", "skipped": "dim"}.get(step.get("state"), "white")
        console.print(f"  [{colour}]{step['state']:>9}[/{colour}]  {step['name']:<12} {step.get('message', '')}")
    if job.get("error"):
        console.print(f"  [red]{job['error']}[/red]")


@app.command("connections")
def connections(ctx: typer.Context, json_output: bool = typer.Option(False, "--json", "-j")):
    """List provider connections (no secrets)."""
    rows = _call(_client(ctx).get, "/api/provisioning/connections")
    if _json_mode(ctx, json_output):
        console.print(JSON(json.dumps(rows)))
        return
    table = Table(title="Provisioning connections")
    for col in ("Id", "Provider", "Host", "Default", "Ready"):
        table.add_column(col)
    for c in rows:
        table.add_row(c["id"], c.get("provider_label", c["provider"]), c["host"],
                      "yes" if c["is_default"] else "", "yes" if c["configured"] else "no")
    console.print(table)


@app.command("inventory")
def inventory(
    ctx: typer.Context,
    datacenter: Optional[str] = typer.Option(None, "--datacenter", "-d", help="Show this datacenter's inventory"),
    connection: str = typer.Option("", "--connection", "-c"),
    json_output: bool = typer.Option(False, "--json", "-j"),
):
    """List datacenters, or a datacenter's compute / pools / folders / storage / networks."""
    client = _client(ctx)
    conn = connection or _default_connection(client)
    if not datacenter:
        rows = _call(client.get, f"/api/provisioning/connections/{conn}/scopes")
        if _json_mode(ctx, json_output):
            console.print(JSON(json.dumps(rows)))
            return
        for row in rows:
            console.print(row["name"])
        return
    inv = _call(client.get, f"/api/provisioning/connections/{conn}/inventory/{datacenter}")
    if _json_mode(ctx, json_output):
        console.print(JSON(json.dumps(inv)))
        return
    for section in ("compute", "resource_pools", "folders", "datastore_clusters", "datastores", "networks"):
        table = Table(title=section.replace("_", " ").title())
        for col in ("Id", "Name", "Kind"):
            table.add_column(col)
        for item in inv.get(section, []):
            table.add_row(item["moid"], item.get("path") or item["name"], item["kind"])
        console.print(table)


@app.command("images")
def images(ctx: typer.Context, connection: str = typer.Option("", "--connection", "-c"),
           json_output: bool = typer.Option(False, "--json", "-j")):
    """List templates offered for builds (filtered by the connection's prefix)."""
    client = _client(ctx)
    conn = connection or _default_connection(client)
    rows = _call(client.get, f"/api/provisioning/connections/{conn}/images")
    if _json_mode(ctx, json_output):
        console.print(JSON(json.dumps(rows)))
        return
    table = Table(title="Templates")
    for col in ("Id", "Name", "Guest OS", "Disk GB"):
        table.add_column(col)
    for t in rows:
        d = t.get("details", {})
        table.add_row(t["moid"], t["name"], d.get("guest_name", ""), str(d.get("disk_gb", "")))
    console.print(table)


@app.command("presets")
def presets(ctx: typer.Context, json_output: bool = typer.Option(False, "--json", "-j")):
    """List saved placement presets."""
    rows = _call(_client(ctx).get, "/api/provisioning/presets")
    if _json_mode(ctx, json_output):
        console.print(JSON(json.dumps(rows)))
        return
    for p in rows:
        console.print(f"{p['id']:<24} {p['name']}  ({p['connection_id']}, {len(p.get('networks', []))} NIC)")


def _wait(client, job_id: str, interval: float = 5.0) -> dict:
    last = None
    while True:
        job = _call(client.get, f"/api/provisioning/builds/{job_id}")
        steps = [(s["name"], s["state"]) for s in job.get("steps", [])]
        if steps != last:
            _print_job(job)
            last = steps
        if job["status"] not in _ACTIVE:
            return job
        time.sleep(interval)


@app.command("build")
def build(
    ctx: typer.Context,
    hostname: str = typer.Argument(..., help="Hostname or FQDN (becomes the certname and VM name)"),
    ip: str = typer.Option(..., "--ip"),
    netmask: str = typer.Option(..., "--netmask", "--prefix", help="24, /24 or 255.255.255.0"),
    gateway: str = typer.Option("", "--gateway"),
    dns: Optional[List[str]] = typer.Option(None, "--dns", help="Repeat or comma-separate"),
    search: Optional[List[str]] = typer.Option(None, "--search", help="DNS search domain (repeat)"),
    network: str = typer.Option("", "--network", help="NIC 1 port group id"),
    nic: Optional[List[str]] = typer.Option(None, "--nic", help="Extra NIC: NETWORK or NETWORK,IP/PREFIX (repeat)"),
    image: str = typer.Option("", "--template", "--image", help="Template id (see `ovox vm images`)"),
    datacenter: str = typer.Option("", "--datacenter"),
    compute: str = typer.Option("", "--compute", help="Cluster or standalone host id"),
    resource_pool: str = typer.Option("", "--resource-pool"),
    folder: str = typer.Option("", "--folder"),
    datastore: str = typer.Option("", "--datastore"),
    datastore_cluster: str = typer.Option("", "--datastore-cluster"),
    cpus: Optional[int] = typer.Option(None, "--cpus"),
    memory: Optional[int] = typer.Option(None, "--memory", help="GB"),
    disk: Optional[int] = typer.Option(None, "--disk", help="GB"),
    connection: str = typer.Option("", "--connection", "-c"),
    preset: str = typer.Option("", "--preset", help="Fill placement, NICs and size from a saved preset"),
    no_bootstrap: bool = typer.Option(False, "--no-bootstrap", help="Do not install the OpenVox agent"),
    no_sign: bool = typer.Option(False, "--no-sign", help="Leave the CSR for an operator to sign"),
    bootstrap_profile: str = typer.Option("", "--bootstrap-profile"),
    enc_environment: str = typer.Option("", "--enc-environment"),
    enc_group: Optional[List[int]] = typer.Option(None, "--enc-group", help="ENC group id (repeat)"),
    annotation: str = typer.Option("", "--notes"),
    preview: bool = typer.Option(False, "--preview", help="Show the cloud-init and agent command; do not build"),
    wait: bool = typer.Option(False, "--wait", "-w", help="Follow the build until it finishes"),
    json_output: bool = typer.Option(False, "--json", "-j"),
):
    """Queue a build (same validation and CSR challenge as the web page)."""
    client = _client(ctx)
    try:
        body = build_body(
            hostname=hostname, ip=ip, netmask=netmask, gateway=gateway, dns=dns, search=search,
            network=network, nics=nic, image=image,
            placement={"datacenter": datacenter, "compute": compute, "resource_pool": resource_pool,
                       "folder": folder, "datastore": datastore, "datastore_cluster": datastore_cluster},
            cpus=cpus, memory_gb=memory, disk_gb=disk, connection=connection,
            bootstrap=not no_bootstrap, bootstrap_profile=bootstrap_profile, sign=not no_sign,
            enc_environment=enc_environment, enc_groups=enc_group, annotation=annotation,
        )
    except ValueError as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(2)
    if preset:
        match = next((p for p in _call(client.get, "/api/provisioning/presets") if p["id"] == preset), None)
        if match is None:
            console.print(f"[red]Unknown preset:[/red] {preset}")
            raise typer.Exit(1)
        body = apply_preset(body, match)
        body["connection"] = body.get("connection") or match.get("connection_id", "")
    body = finalize(body)

    if preview:
        data = _call(client.post, "/api/provisioning/preview", json=body)
        if _json_mode(ctx, json_output):
            console.print(JSON(json.dumps(data)))
        else:
            console.print(f"[bold]{data['certname']}[/bold] {data['ip']}/{data['prefix']} ({len(data['nics'])} NIC)")
            if data.get("agent_command"):
                console.print(data["agent_command"])
            console.print(data["userdata"])
        return

    job = _call(client.post, "/api/provisioning/builds", json=body)
    if _json_mode(ctx, json_output) and not wait:
        console.print(JSON(json.dumps(job)))
        return
    console.print(f"[green]Queued[/green] {job['certname']} (job {job['id']})")
    if wait:
        final = _wait(client, job["id"])
        if final["status"] not in ("succeeded",):
            raise typer.Exit(1 if final["status"] == "failed" else 0)


@app.command("builds")
def builds(ctx: typer.Context, json_output: bool = typer.Option(False, "--json", "-j")):
    """Recent builds."""
    rows = _call(_client(ctx).get, "/api/provisioning/builds")
    if _json_mode(ctx, json_output):
        console.print(JSON(json.dumps(rows)))
        return
    table = Table(title="Builds")
    for col in ("Job", "Certname", "Status", "By", "Created"):
        table.add_column(col)
    for j in rows:
        table.add_row(j["id"][:8], j["certname"], j["status"], j["requested_by"], (j.get("created_at") or "")[:19])
    console.print(table)


@app.command("status")
def status(ctx: typer.Context, job_id: str = typer.Argument(...),
           wait: bool = typer.Option(False, "--wait", "-w"),
           json_output: bool = typer.Option(False, "--json", "-j")):
    """Show (or follow) one build."""
    client = _client(ctx)
    if wait:
        _wait(client, job_id)
        return
    job = _call(client.get, f"/api/provisioning/builds/{job_id}")
    if _json_mode(ctx, json_output):
        console.print(JSON(json.dumps(job)))
    else:
        _print_job(job)


@app.command("cancel")
def cancel(ctx: typer.Context, job_id: str = typer.Argument(...)):
    """Cancel a queued build, or stop a running one at its next checkpoint."""
    job = _call(_client(ctx).post, f"/api/provisioning/builds/{job_id}/cancel")
    console.print(f"{job['certname']}: {job['status']}")


@app.command("machines")
def machines(ctx: typer.Context, live: bool = typer.Option(False, "--live", help="Ask the provider for power state"),
             json_output: bool = typer.Option(False, "--json", "-j")):
    """VMs the GUI built."""
    rows = _call(_client(ctx).get, "/api/provisioning/machines", params={"live": "true"} if live else None)
    if _json_mode(ctx, json_output):
        console.print(JSON(json.dumps(rows)))
        return
    table = Table(title="Machines")
    for col in ("Job", "Certname", "Power", "IP", "Connection"):
        table.add_column(col)
    for m in rows:
        live_state = m.get("live") or {}
        table.add_row(m["job_id"][:8], m["certname"], live_state.get("power_state", "-"),
                      live_state.get("ip_address") or m.get("guest_ip") or "-", m["connection_id"])
    console.print(table)


@app.command("power")
def power(ctx: typer.Context, job_id: str = typer.Argument(...),
          action: str = typer.Argument(..., help="on | off | shutdown | reboot")):
    """Power a machine the GUI built."""
    result = _call(_client(ctx).post, f"/api/provisioning/machines/{job_id}/power", json={"action": action})
    console.print(f"power {action}: {result.get('power_state')}")


@app.command("snapshot")
def snapshot(ctx: typer.Context, job_id: str = typer.Argument(...), name: str = typer.Argument(...),
             description: str = typer.Option("", "--description")):
    """Take a disk snapshot of a machine the GUI built."""
    result = _call(_client(ctx).post, f"/api/provisioning/machines/{job_id}/snapshot",
                   json={"name": name, "description": description})
    console.print(f"snapshot {result.get('snapshot')} taken")


@app.command("destroy")
def destroy(
    ctx: typer.Context,
    job_id: str = typer.Argument(...),
    confirm: str = typer.Option(..., "--confirm", help="The machine's certname, to confirm"),
    keep_openvoxdb: bool = typer.Option(False, "--keep-openvoxdb", help="Do not deactivate the node"),
    keep_cert: bool = typer.Option(False, "--keep-cert", help="Do not clean the CA certificate"),
    keep_enc: bool = typer.Option(False, "--keep-enc", help="Do not remove the ENC node"),
):
    """Delete a machine the GUI built and decommission the node (admin)."""
    result = _call(_client(ctx).post, f"/api/provisioning/machines/{job_id}/destroy", json={
        "confirm": confirm, "deactivate": not keep_openvoxdb, "clean_cert": not keep_cert, "remove_enc": not keep_enc,
    })
    for key, step in result.get("steps", {}).items():
        mark = "[green]ok[/green]" if step["ok"] else "[red]FAILED[/red]"
        console.print(f"  {key:<10} {mark}  {step['message']}")
    if not result.get("ok"):
        raise typer.Exit(1)
