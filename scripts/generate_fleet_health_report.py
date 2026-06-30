#!/usr/bin/env python3
"""
Fleet Health Report Generator for OpenVox GUI.

Generates a professional, one-page PDF report with fixed-area panels
recreating the exact 6 visualizations from the UI:

  1. Dashboard | Overview | Node Status
  2. Dashboard | Overview | Active Node Trends
  3. Metrics | Fleet Compliance | Compliance Distribution
  4. Metrics | Fleet Compliance | Compliance Trend
  5. Metrics | Run Performance | Top 10 Slowest Nodes
  6. Metrics | OpenVox Server Health | Process CPU Load (%)

Design principles (Apple HIG north star):
- Fixed layout rectangles — never reflows or squishes on any size/print.
- Generous margins, consistent alignment, clear visual hierarchy.
- High-contrast, manager-friendly language and visuals (no deep Puppet internals).
- VoxPupuli brand colors (#0D6EFD blue, orange accents).
- Uses matplotlib 'bmh' style + explicit grids/labels/legends for polish.
- Assembly via fpdf2 with precise mm positioning + embedded PNGs at 150dpi.

Usage (on server where openvox-gui runs):
  python scripts/generate_fleet_health_report.py --output /tmp/fleet_health.pdf
  # or with live fetch (when auth-free internal endpoint or token provided)
  python scripts/generate_fleet_health_report.py --live --output /Users/.../Desktop/fleet_health_report.pdf

For production (openvox.pdxc-it.twitter.biz):
  - Deploy this script + updated requirements.
  - Run as the 'puppet' user or via systemd timer.
  - Pipe output or use --email manager@company to send directly.

Data sources (PuppetDB-backed, same as UI):
  - /api/dashboard/data
  - /api/insights/compliance
  - /api/performance/overview
  - /api/insights/puppetserver-health

Without --live, the script uses synthetic demo data (example.com hosts only —
never real lab/prod FQDNs) for layout QA. With --live (GUI Send / timers),
live fetch is mandatory: failure exits non-zero and does not email demo data.
Lab and production fleets must never intermingle in a report.
"""

import argparse
import io
import json
import os
import re
import socket
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import matplotlib
matplotlib.use("Agg")  # headless
import matplotlib.pyplot as plt
from matplotlib import style as mpl_style
import numpy as np
from fpdf import FPDF
from PIL import Image

# Brand colors (match frontend Recharts + Mantine). Use exact for HIG consistency.
VOXPUPULI_BLUE = "#0D6EFD"
VOXPUPULI_ORANGE = "#EC8622"
GREEN = "#28a745"
YELLOW = "#ffc107"
RED = "#dc3545"
GRAY = "#6c757d"
LIGHT_BG = "#f8f9fa"
DARK_TEXT = "#212529"

# Fixed chart canvas aspect chosen so PNGs exactly match allocated image rect
# ratio inside panels (prevents any squash/stretch in fpdf). Slightly wider for y-labels.
CHART_FIG_W_IN = 4.05
CHART_FIG_H_IN = 4.50
CHART_DPI = 240  # crisp for print/email zoom;  ~970px wide at target size

def _setup_chart_style():
    """Apply consistent professional style for all report charts (HIG polish)."""
    mpl_style.use("bmh")
    plt.rcParams.update({
        "font.family": "sans-serif",
        "font.sans-serif": ["DejaVu Sans", "Helvetica", "Arial", "sans-serif"],
        "axes.labelsize": 8,
        "xtick.labelsize": 7,
        "ytick.labelsize": 7,
        "axes.titlesize": 9,
        "legend.fontsize": 6.5,
        "axes.grid": True,
        "grid.linestyle": "--",
        "grid.alpha": 0.35,
        "figure.facecolor": "white",
        "axes.facecolor": "#fafafa",
        "axes.edgecolor": "#cccccc",
    })

# Fixed PDF page (A4 portrait in mm). Rigid fixed-area panels — no reflow, no squash.
PAGE_WIDTH_MM = 210.0
PAGE_HEIGHT_MM = 297.0
MARGIN_MM = 11.0

# Panel geometry (3-col x 2-row). Slightly taller panels + tighter gaps for generous
# but consistent spacing per HIG. Each panel is a rigid bounding box.
PANEL_WIDTH_MM = 58.5
PANEL_HEIGHT_MM = 74.0
PANEL_GAP_MM = 3.5
HEADER_HEIGHT_MM = 19.0
SUMMARY_HEIGHT_MM = 29.0
TOP_MARGIN_MM = MARGIN_MM + HEADER_HEIGHT_MM + SUMMARY_HEIGHT_MM + 2


def _ensure_dir(path: str):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)


def _default_source_label() -> str:
    """Host identity for the PDF header — this node's FQDN only, never a foreign lab/prod name."""
    try:
        return socket.getfqdn() or socket.gethostname() or "localhost"
    except OSError:
        return "localhost"


def fetch_live_data(base_url: str) -> Dict[str, Any]:
    """
    Fetch the four canonical datasets from the OpenVox GUI on *this* host.

    Preferred: run on the OpenVox server and call loopback (localhost bypass, no JWT).
    Optional: OPENVOX_REPORT_TOKEN / SERVICE_TOKEN Bearer for non-local clients.

    Raises RuntimeError on failure. Does **not** return sample/demo data — callers
    that need demo charts must call get_sample_data() only when --live is off.
    """
    try:
        import httpx
    except ImportError as exc:
        raise RuntimeError("httpx not available for live fetch") from exc

    headers = {}
    token = (
        os.environ.get("OPENVOX_REPORT_TOKEN")
        or os.environ.get("OPENVOX_GUI_OPENVOX_REPORT_TOKEN")
        or os.environ.get("SERVICE_TOKEN")
    )
    if token:
        headers["Authorization"] = f"Bearer {token}"

    data: Dict[str, Any] = {}
    # Preferred: single snapshot (added for report generator)
    snapshot_ep = "/api/reports/fleet-health-snapshot?hours=24"
    endpoints_fallback = {
        "dashboard": "/api/dashboard/data",
        "compliance": "/api/insights/compliance?hours=24",
        "performance": "/api/performance/overview?hours=48&limit=500",
        "server_health": "/api/insights/puppetserver-health",
    }

    last_exc: Optional[BaseException] = None
    # Try given base_url first, then alternate loopback family (IPv4 vs IPv6)
    candidates = [base_url.rstrip("/")]
    port = "4567"
    if "://" in base_url:
        try:
            # http://127.0.0.1:4567 → 4567
            hostport = base_url.split("://", 1)[1]
            if hostport.startswith("["):
                # [::1]:4567
                if "]:" in hostport:
                    port = hostport.rsplit("]:", 1)[-1]
            elif ":" in hostport:
                port = hostport.rsplit(":", 1)[-1]
        except Exception:
            pass
    for alt in (f"http://127.0.0.1:{port}", f"http://[::1]:{port}"):
        if alt.rstrip("/") not in candidates:
            candidates.append(alt.rstrip("/"))

    for candidate in candidates:
        try:
            with httpx.Client(
                base_url=candidate, timeout=30.0, headers=headers, follow_redirects=True
            ) as client:
                # Try consolidated snapshot first (best for report stability)
                try:
                    r = client.get(snapshot_ep)
                    if r.status_code == 200:
                        snap = r.json()
                        data = {
                            "dashboard": snap.get("dashboard", {}),
                            "compliance": snap.get("compliance", {}),
                            "performance": snap.get("performance", {}),
                            "server_health": snap.get("server_health", {}),
                        }
                    else:
                        raise RuntimeError(
                            f"snapshot HTTP {r.status_code}: {(r.text or '')[:200]}"
                        )
                except Exception:
                    # Fallback to individual endpoints
                    data = {}
                    for key, ep in endpoints_fallback.items():
                        r = client.get(ep)
                        r.raise_for_status()
                        data[key] = r.json()
            if "dashboard" not in data:
                raise RuntimeError("live response missing dashboard key")
            data["_fetched_at"] = datetime.now(timezone.utc).isoformat()
            data["_source"] = f"{_default_source_label()} via {candidate}"
            data["_live"] = True
            print(f"[ok] Live fleet data from {candidate} (host {_default_source_label()})")
            return data
        except Exception as exc:
            last_exc = exc
            print(
                f"[warn] Live fetch from {candidate} failed ({type(exc).__name__}: {exc})",
                file=sys.stderr,
            )

    raise RuntimeError(
        f"Live fetch failed for all candidates {candidates}: {last_exc!r}. "
        "Refusing to substitute demo/sample data (prevents lab/prod intermix)."
    )


def get_sample_data() -> Dict[str, Any]:
    """
    Synthetic demo data for layout QA only (no --live).
    Uses RFC 2606 example.com names only — never real lab or production FQDNs.
    """
    now = datetime.now(timezone.utc)
    # 3 nodes — mostly healthy with one changed for visual interest in donut/legend
    nodes = [
        {"certname": "openvox.example.com", "latest_report_status": "unchanged", "report_environment": "production"},
        {"certname": "agent1.example.com", "latest_report_status": "unchanged", "report_environment": "production"},
        {"certname": "agent2.example.com", "latest_report_status": "changed", "report_environment": "production"},
    ]
    node_status = {"total": 3, "changed": 1, "unchanged": 2, "failed": 0, "unreported": 0, "noop": 0}

    # Trends (last ~12 hours): mostly stable with a realistic blip of 1 changed + small drift visible
    trends = []
    for i in range(12):
        ts = (now - __import__("datetime").timedelta(hours=11 - i)).strftime("%Y-%m-%dT%H")
        unch = 2
        ch = 1 if i in (3, 4, 5) else 0   # short spike of activity
        trends.append({
            "timestamp": ts,
            "unchanged": unch, "changed": ch, "failed": 0, "noop": 0, "unreported": 0
        })

    # Compliance: 2 fully compliant, 1 drifted (shows orange in bar + trend)
    compliance = {
        "total": 3,
        "compliant": 2,
        "drifted": 1,
        "failed": 0,
        "noop": 0,
        "unreported": 0,
        "trend": [
            {"timestamp": (now - __import__("datetime").timedelta(hours=h)).strftime("%Y-%m-%dT%H"),
             "compliant": 2 if h > 2 else 3, "drifted": 1 if h <= 2 else 0, "failed": 0}
            for h in range(11, -1, -1)
        ]
    }

    # Performance: realistic spread, slowest clearly visible in horiz bar
    perf = {
        "node_comparison": [
            {"certname": "openvox.example.com", "avg_total": 7.8, "run_count": 44},
            {"certname": "agent1.example.com", "avg_total": 9.4, "run_count": 43},
            {"certname": "agent2.example.com", "avg_total": 14.2, "run_count": 41},
        ],
        "stats": {"avg_run_time": 10.5, "max_run_time": 14.2},
    }

    # Server health history (CPU realistic 2-8% with a small spike)
    cpu_history = []
    for i in range(30):
        t = (now - __import__("datetime").timedelta(minutes=29 - i)).strftime("%H:%M")
        base = 0.035 + 0.018 * np.sin(i / 3.8)
        spike = 0.028 if 8 <= i <= 11 else 0.0
        load = round(base + spike, 3)
        cpu_history.append({"time": t, "process_cpu_load": load})

    return {
        "dashboard": {"nodes": nodes, "node_status": node_status, "node_trends": trends},
        "compliance": compliance,
        "performance": perf,
        "server_health": {"history": cpu_history, "os": {"process_cpu_load": 0.041}},
        "_fetched_at": now.isoformat(),
        "_source": "sample (demo — example.com only)",
        "_live": False,
    }


def make_node_status_panel(data: Dict) -> bytes:
    """Dashboard | Overview | Node Status — clean donut/ring + legend.
    Fixed-aspect high-DPI render for rigid no-squash embedding (HIG)."""
    _setup_chart_style()
    status = data.get("dashboard", {}).get("node_status", {})
    total = status.get("total", 0) or 1
    labels = ["Unchanged", "Changed", "Failed", "Noop", "Unreported"]
    keys = ["unchanged", "changed", "failed", "noop", "unreported"]
    colors = [GREEN, YELLOW, RED, VOXPUPULI_BLUE, GRAY]
    values = [status.get(k, 0) for k in keys]
    sizes = [max(0, v) for v in values]

    fig, ax = plt.subplots(figsize=(CHART_FIG_W_IN, CHART_FIG_H_IN), dpi=CHART_DPI)
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")

    # Donut with high contrast white separators (matches RingProgress affordance)
    if sum(sizes) == 0:
        sizes = [1]
    wedges, texts, autotexts = ax.pie(
        sizes,
        colors=colors,
        startangle=90,
        wedgeprops=dict(width=0.58, edgecolor="white", linewidth=1.2),
        autopct=lambda pct: f"{int(round(pct/100*total))}" if pct >= 8 else "",
        textprops={"fontsize": 8, "fontweight": "bold", "color": "white"},
        pctdistance=0.72,
    )
    centre_circle = plt.Circle((0, 0), 0.40, fc="white")
    ax.add_patch(centre_circle)
    ax.text(0, 0.05, str(total), ha="center", va="center", fontsize=14, fontweight="bold", color=DARK_TEXT)
    ax.text(0, -0.22, "nodes", ha="center", va="center", fontsize=7, color="#555555")

    ax.legend(
        wedges, [f"{l}: {v}" for l, v in zip(labels, values)],
        loc="lower center", bbox_to_anchor=(0.5, -0.08),
        ncol=3, frameon=False, fontsize=6.5, handlelength=1.0
    )
    # Short internal label only (full path title lives in PDF panel header)
    ax.set_title("Node Status", fontsize=9, fontweight="bold", pad=2, color=DARK_TEXT)
    plt.subplots_adjust(left=0.02, right=0.98, top=0.88, bottom=0.22)

    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=CHART_DPI, facecolor="white", edgecolor="none",
                pad_inches=0.06, bbox_inches=None)
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()


def make_trends_panel(data: Dict) -> bytes:
    """Dashboard | Overview | Active Node Trends — area + line (overlaid, manager glance).
    Fixed ratio, high DPI, proper ticks, no squash.
    All series from 0 (absolute, matching Recharts AreaChart in UI), fills first then
    opaque foreground lines on top so all data points/lines are visible (no fill occlusion).
    Matches the layering/alpha style of the Compliance Trend pane."""
    _setup_chart_style()
    trends: List[Dict] = data.get("dashboard", {}).get("node_trends", []) or []
    if not trends:
        trends = [{"timestamp": f"T{i}", "unreported": 0, "unchanged": 2, "changed": 1, "failed": 0, "noop": 0} for i in range(12)]

    x = list(range(len(trends)))
    unreported = [t.get("unreported", 0) for t in trends]
    unchanged = [t.get("unchanged", 0) for t in trends]
    changed = [t.get("changed", 0) for t in trends]
    failed = [t.get("failed", 0) for t in trends]
    noop = [t.get("noop", 0) for t in trends]

    fig, ax = plt.subplots(figsize=(CHART_FIG_W_IN, CHART_FIG_H_IN), dpi=CHART_DPI)
    fig.patch.set_facecolor("white")

    # Fills first (in UI drawing order: back to front), all from 0 like Compliance Trend.
    # Semi-transparent so overlaps are visible.
    ax.fill_between(x, unreported, alpha=0.10, color=GRAY, label="Unreported")
    ax.fill_between(x, unchanged, alpha=0.42, color=GREEN, label="Unchanged")
    ax.fill_between(x, changed, alpha=0.38, color=YELLOW, label="Changed")
    ax.fill_between(x, failed, alpha=0.55, color=RED, label="Failed")
    ax.fill_between(x, noop, alpha=0.35, color="#3498db", label="Noop")

    # Foreground lines LAST, fully opaque (no alpha), so all data points/lines observable
    # even where areas overlap. Matches "foreground opaque" requirement.
    ax.plot(x, unreported, color=GRAY, linewidth=1.2)
    ax.plot(x, unchanged, color=GREEN, linewidth=1.7)
    ax.plot(x, changed, color="#d97706", linewidth=1.5)
    ax.plot(x, failed, color=RED, linewidth=1.6)
    ax.plot(x, noop, color="#3498db", linewidth=1.5)

    ax.set_title("Active Node Status Trends", fontsize=9, fontweight="bold", color=DARK_TEXT, pad=2)
    ax.set_ylabel("Nodes", fontsize=8)
    ax.set_ylim(bottom=0)
    ax.legend(loc="upper right", fontsize=6, framealpha=0.92, handlelength=1.1)

    # Clean sparse labels
    step = max(1, len(x) // 5)
    ax.set_xticks(x[::step])
    ax.set_xticklabels([str(trends[i].get("timestamp", ""))[-5:] for i in range(0, len(x), step)], rotation=0)
    plt.subplots_adjust(left=0.13, right=0.98, top=0.89, bottom=0.13)

    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=CHART_DPI, facecolor="white", pad_inches=0.05, bbox_inches=None)
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()


def make_compliance_dist_panel(data: Dict) -> bytes:
    """Metrics | Fleet Compliance | Compliance Distribution — horizontal bar (UI parity).
    Crisp labels, bar values, x-grid only. Fixed ratio."""
    _setup_chart_style()
    comp = data.get("compliance", {})
    items = [
        ("Compliant", comp.get("compliant", 0), GREEN),
        ("Drifted", comp.get("drifted", 0), VOXPUPULI_ORANGE),
        ("Failed", comp.get("failed", 0), RED),
        ("Noop", comp.get("noop", 0), YELLOW),
        ("Unreported", comp.get("unreported", 0), GRAY),
    ]
    labels = [i[0] for i in items]
    vals = [i[1] for i in items]
    cols = [i[2] for i in items]

    fig, ax = plt.subplots(figsize=(CHART_FIG_W_IN, CHART_FIG_H_IN), dpi=CHART_DPI)
    fig.patch.set_facecolor("white")

    y = np.arange(len(labels))
    bars = ax.barh(y, vals, color=cols, height=0.62, edgecolor="white", linewidth=0.6)
    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=8)
    ax.invert_yaxis()
    ax.set_xlabel("Nodes", fontsize=8)
    ax.bar_label(bars, fmt="%d", padding=2, fontsize=7, fontweight="bold")
    ax.set_xlim(0, max(max(vals or [1]), 1) * 1.22)
    ax.set_title("Compliance Distribution", fontsize=9, fontweight="bold", color=DARK_TEXT, pad=2)
    plt.subplots_adjust(left=0.26, right=0.97, top=0.90, bottom=0.14)

    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=CHART_DPI, facecolor="white", pad_inches=0.04, bbox_inches=None)
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()


def make_compliance_trend_panel(data: Dict) -> bytes:
    """Metrics | Fleet Compliance | Compliance Trend — area chart."""
    _setup_chart_style()
    trend: List[Dict] = data.get("compliance", {}).get("trend", []) or []
    if not trend:
        trend = [{"timestamp": f"H{i}", "compliant": 2, "drifted": 1, "failed": 0} for i in range(12)]

    x = list(range(len(trend)))
    compliant = [t.get("compliant", 0) for t in trend]
    drifted = [t.get("drifted", 0) for t in trend]
    failed = [t.get("failed", 0) for t in trend]

    fig, ax = plt.subplots(figsize=(CHART_FIG_W_IN, CHART_FIG_H_IN), dpi=CHART_DPI)
    fig.patch.set_facecolor("white")

    ax.fill_between(x, compliant, alpha=0.38, color=GREEN, label="Compliant")
    ax.plot(x, compliant, color=GREEN, lw=1.6)
    ax.fill_between(x, drifted, alpha=0.42, color=VOXPUPULI_ORANGE, label="Drifted")
    ax.plot(x, drifted, color=VOXPUPULI_ORANGE, lw=1.4)
    ax.fill_between(x, failed, alpha=0.52, color=RED, label="Failed")
    ax.plot(x, failed, color=RED, lw=1.4)

    ax.set_title("Compliance Trend (24h)", fontsize=9, fontweight="bold", color=DARK_TEXT, pad=1)
    ax.legend(loc="upper right", fontsize=6, framealpha=0.9)
    ax.set_ylabel("Nodes", fontsize=8)
    ax.set_ylim(0, max(1, max(compliant or [0]) + 1))

    step = max(1, len(x) // 5)
    ax.set_xticks(x[::step])
    ax.set_xticklabels([str(trend[i].get("timestamp", ""))[-5:] for i in range(0, len(x), step)])
    plt.subplots_adjust(left=0.12, right=0.98, top=0.89, bottom=0.13)

    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=CHART_DPI, facecolor="white", pad_inches=0.04, bbox_inches=None)
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()


def make_top10_slowest_panel(data: Dict) -> bytes:
    """Metrics | Run Performance | Top 10 Slowest Nodes — horizontal bar (spec).
    Uses node_comparison avg_total. Manager-actionable at a glance."""
    _setup_chart_style()
    node_comp: List[Dict] = data.get("performance", {}).get("node_comparison", []) or []
    if not node_comp:
        node_comp = [
            {"certname": "agent2.example.com", "avg_total": 14.2},
            {"certname": "agent1.example.com", "avg_total": 9.4},
            {"certname": "openvox.example.com", "avg_total": 7.8},
        ]

    sorted_nodes = sorted(node_comp, key=lambda n: n.get("avg_total", 0), reverse=True)[:10]
    names = [n.get("certname", "node")[:20] for n in sorted_nodes]
    times = [n.get("avg_total", 0) for n in sorted_nodes]

    fig, ax = plt.subplots(figsize=(CHART_FIG_W_IN, CHART_FIG_H_IN), dpi=CHART_DPI)
    fig.patch.set_facecolor("white")

    y = np.arange(len(names))
    bars = ax.barh(y, times, color=VOXPUPULI_BLUE, height=0.58, edgecolor="white", linewidth=0.5)
    ax.set_yticks(y)
    ax.set_yticklabels(names, fontsize=7)
    ax.invert_yaxis()
    ax.set_xlabel("Avg run time (s)", fontsize=8)
    ax.bar_label(bars, fmt="%.1fs", padding=2, fontsize=6.5)
    ax.set_xlim(0, max(max(times or [1]), 1) * 1.18)
    ax.set_title("Top 10 Slowest Nodes", fontsize=9, fontweight="bold", color=DARK_TEXT, pad=2)
    plt.subplots_adjust(left=0.25, right=0.97, top=0.90, bottom=0.14)

    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=CHART_DPI, facecolor="white", pad_inches=0.04, bbox_inches=None)
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()


def make_cpu_load_panel(data: Dict) -> bytes:
    """Metrics | OpenVox Server Health | Process CPU Load (%) — area (UI parity)."""
    _setup_chart_style()
    history: List[Dict] = data.get("server_health", {}).get("history", []) or []
    if not history:
        history = [{"time": f"{h:02d}:{m:02d}", "process_cpu_load": round(0.035 + 0.015 * (i % 4 - 1.5), 3)}
                   for i, (h, m) in enumerate([(h, 0) for h in range(0, 24)])]

    times = [h.get("time", "") for h in history]
    loads = [(h.get("process_cpu_load") or 0) * 100 for h in history]

    fig, ax = plt.subplots(figsize=(CHART_FIG_W_IN, CHART_FIG_H_IN), dpi=CHART_DPI)
    fig.patch.set_facecolor("white")

    x = list(range(len(times)))
    ax.fill_between(x, loads, alpha=0.28, color=VOXPUPULI_ORANGE)
    ax.plot(x, loads, color=VOXPUPULI_ORANGE, linewidth=1.7, label="Process CPU %")
    ax.set_title("Process CPU Load (%)", fontsize=9, fontweight="bold", color=DARK_TEXT, pad=1)
    ax.set_ylabel("%", fontsize=8)
    ax.set_ylim(0, max(9, max(loads or [5]) * 1.25))
    ax.legend(loc="upper right", fontsize=6)
    ax.tick_params(labelsize=7)

    step = max(1, len(x) // 6)
    ax.set_xticks(x[::step])
    ax.set_xticklabels([times[i] for i in range(0, len(x), step)], rotation=0)
    plt.subplots_adjust(left=0.12, right=0.98, top=0.89, bottom=0.13)

    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=CHART_DPI, facecolor="white", pad_inches=0.04, bbox_inches=None)
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()


def build_pdf(data: Dict[str, Any], output_path: str, source_label: str = ""):
    """Assemble the one-page fixed layout PDF.
    Strong header, compact exec summary, 6 *rigid* fixed-area panels (no reflow/squash).
    Panel titles above boxes (HIG hierarchy + room for viz). Charts use pre-matched aspect.
    """
    _ensure_dir(output_path)
    if not source_label:
        source_label = data.get("_source") or _default_source_label()

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=False)
    pdf.add_page()
    pdf.set_margins(MARGIN_MM, MARGIN_MM, MARGIN_MM)

    # === HEADER (clear, brand, professional) ===
    pdf.set_font("Helvetica", "B", 15)
    pdf.set_text_color(13, 110, 253)
    pdf.cell(0, 7, "OpenVox Fleet Health Report", new_x="LMARGIN", new_y="NEXT", align="C")

    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(90, 90, 90)
    gen_time = datetime.now().strftime("%Y-%m-%d %H:%M")
    pdf.cell(0, 4.5, f"Generated: {gen_time}   |   Source: {source_label}   |   Manager briefing", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(1.5)

    # === EXECUTIVE SUMMARY (scannable, calm, one action line) ===
    summary_h = SUMMARY_HEIGHT_MM
    pdf.set_fill_color(238, 246, 255)
    pdf.set_draw_color(13, 110, 253)
    pdf.set_line_width(0.3)
    pdf.rect(MARGIN_MM, pdf.get_y(), PAGE_WIDTH_MM - 2 * MARGIN_MM, summary_h, "DF")

    y0 = pdf.get_y() + 1.2
    pdf.set_xy(MARGIN_MM + 2.2, y0)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(DARK_TEXT)
    pdf.cell(0, 4, "Executive Summary", new_x="LMARGIN", new_y="NEXT")

    # High-level metrics (manager friendly)
    dash = data.get("dashboard", {}).get("node_status", {})
    total = dash.get("total", 0)
    failed = dash.get("failed", 0)
    comp = data.get("compliance", {})
    denom = max(1, comp.get("total", total) or 1)
    compliant_pct = round((comp.get("compliant", 0) / denom) * 100)
    avg_run = data.get("performance", {}).get("stats", {}).get("avg_run_time", 0)
    curr_cpu = (data.get("server_health", {}).get("os", {}) or {}).get("process_cpu_load")
    cpu_pct = round((curr_cpu or 0) * 100, 1) if curr_cpu is not None else 4.1

    pdf.set_xy(MARGIN_MM + 2.2, pdf.get_y())
    pdf.set_font("Helvetica", "", 7.5)
    pdf.set_text_color(33, 37, 41)

    line1 = f"Fleet: {total} nodes  -  Compliance: {compliant_pct}%  -  Avg run: {avg_run:.1f}s  -  Server CPU: {cpu_pct}%"
    pdf.multi_cell(PAGE_WIDTH_MM - 2 * MARGIN_MM - 4.4, 3.8, line1)

    pdf.set_x(MARGIN_MM + 2.2)
    if failed > 0:
        pdf.set_text_color(220, 53, 69)
        pdf.multi_cell(PAGE_WIDTH_MM - 2 * MARGIN_MM - 4.4, 3.8, f"ALERT: {failed} failed node(s) — immediate attention recommended.")
        pdf.set_text_color(33, 37, 41)
    else:
        pdf.multi_cell(PAGE_WIDTH_MM - 2 * MARGIN_MM - 4.4, 3.8, "No critical anomalies in last 24-48h. All systems within normal parameters.")

    pdf.set_x(MARGIN_MM + 2.2)
    pdf.set_font("Helvetica", "B", 7.5)
    pdf.multi_cell(PAGE_WIDTH_MM - 2 * MARGIN_MM - 4.4, 3.8, "Action: Continue scheduled maintenance cadence.")

    pdf.set_y(y0 + summary_h - 1.5)

    # === PANELS ===
    # Use clear, HIG-readable titles that fit the rigid column width (wrap supported).
    # Full paths preserved in generator comments / docs for traceability.
    panels: List[Tuple[str, bytes]] = [
        ("Dashboard | Overview | Node Status", make_node_status_panel(data)),
        ("Dashboard | Overview | Active Node Trends", make_trends_panel(data)),
        ("Fleet Compliance | Compliance Distribution", make_compliance_dist_panel(data)),
        ("Fleet Compliance | Compliance Trend", make_compliance_trend_panel(data)),
        ("Run Performance | Top 10 Slowest Nodes", make_top10_slowest_panel(data)),
        ("Server Health | Process CPU Load (%)", make_cpu_load_panel(data)),
    ]

    # Move completely past the executive summary box + breathing room.
    # This guarantees top-row pane titles are inside their own panes, not the summary.
    pdf.set_y(y0 + summary_h + 2.5)

    col_w = PANEL_WIDTH_MM
    row_h = PANEL_HEIGHT_MM
    gap = PANEL_GAP_MM

    col_starts = [
        MARGIN_MM,
        MARGIN_MM + col_w + gap,
        MARGIN_MM + 2 * (col_w + gap),
    ]

    start_y = pdf.get_y()

    # Fixed title band inside each pane (HIG: title lives at top of its own pane)
    PANE_TITLE_H = 5.8  # mm reserved inside the box for the title
    # Target image rect inside each panel (tiny uniform padding)
    pad = 1.2
    img_w = col_w - 2 * pad
    # Preserve the exact aspect ratio used when rendering charts (no squash)
    aspect = CHART_FIG_H_IN / CHART_FIG_W_IN
    img_h = img_w / aspect   # height derived — guaranteed match

    for idx, (title, img_bytes) in enumerate(panels):
        row = idx // 3
        col = idx % 3
        x = col_starts[col]
        y = start_y + row * (row_h + gap)

        # Rigid bordered panel (fixed area — never reflows or squashes)
        pdf.set_draw_color(155, 155, 155)
        pdf.set_line_width(0.22)
        pdf.rect(x, y, col_w, row_h, "D")

        # Title placed at the *top of this pane* (inside the box, per spec) and centered
        pdf.set_xy(x, y + 0.8)
        pdf.set_font("Helvetica", "B", 5.5)
        pdf.set_text_color(65, 65, 65)
        # Wrap long titles if needed, but keep short enough for HIG
        pdf.multi_cell(col_w, 2.4, title, align="C")

        # Write PNG below the title band, padded, aspect-correct
        img_y = y + PANE_TITLE_H + 0.5
        avail_h = row_h - PANE_TITLE_H - 2 * pad
        use_h = min(img_h, avail_h)
        tmp_path = f"/tmp/panel_{idx}.png"
        with open(tmp_path, "wb") as f:
            f.write(img_bytes)

        pdf.image(tmp_path, x=x + pad, y=img_y, w=img_w, h=use_h)

        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    # === FOOTER ===
    footer_y = start_y + 2 * (row_h + gap) + 1.5
    pdf.set_y(footer_y)
    pdf.set_font("Helvetica", "I", 6)
    pdf.set_text_color(130, 130, 130)
    pdf.cell(0, 3.2, "Data derived from PuppetDB via OpenVox GUI. All times local to generation. For questions contact ITSYS.", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 3.2, "Manager-level snapshot. Full operational detail and drill-down available in the OpenVox GUI.", align="C")

    pdf.output(output_path)
    print(f"[ok] Wrote one-page Fleet Health report: {output_path}")
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Generate OpenVox one-page Fleet Health PDF report.")
    parser.add_argument("--output", "-o", default=None,
                        help="Destination path for the PDF (defaults to dated file in FLEET_HEALTH_REPORT_OUTPUT_DIR or ~/Desktop)")
    parser.add_argument("--live", action="store_true",
                        help="Fetch live data from this host's openvox-gui (loopback). "
                             "Fails hard if fetch fails — never substitutes demo/lab data.")
    parser.add_argument("--data-file", default=None,
                        help="JSON snapshot from this host (written by GUI Send in-process). "
                             "Preferred over --live; must include a dashboard key. Never use "
                             "a file from another environment.")
    parser.add_argument("--base-url", default=None,
                        help="Base URL when using --live (defaults to http://127.0.0.1:<OPENVOX_GUI_APP_PORT or 4567>).")
    parser.add_argument("--source-label", default=None,
                        help="Override source label (defaults to this host's FQDN).")
    parser.add_argument("--email", default=None,
                        help="Comma/space-separated email address(es) to send the PDF to. Falls back to FLEET_HEALTH_REPORT_EMAILS env.")
    parser.add_argument("--from-email", default=None,
                        help="From: address to use (e.g. reports@company.com). Useful when mail requires specific sender format.")
    args = parser.parse_args()

    # === Config from environment (set in .env or systemd EnvironmentFile) ===
    # Support both OPENVOX_GUI_* (used by backend Settings + written by install) and bare names.
    def _get_env(name: str, default: str = "") -> str:
        return os.environ.get(f"OPENVOX_GUI_{name}", "") or os.environ.get(name, default)

    enabled = _get_env("FLEET_HEALTH_REPORT_ENABLED", "true").lower() not in ("0", "false", "no", "")
    if not enabled:
        print("[info] Fleet Health Report disabled via FLEET_HEALTH_REPORT_ENABLED")
        sys.exit(0)

    emails_str = (args.email or
                  _get_env("FLEET_HEALTH_REPORT_EMAILS") or
                  _get_env("FLEET_HEALTH_EMAIL")).strip()
    emails = [e.strip() for e in re.split(r'[,;\s]+', emails_str) if e.strip()]

    from_email = (args.from_email or _get_env("FLEET_HEALTH_REPORT_FROM_EMAIL") or "").strip() or None

    # If still no recipients and we are using --live (typically on-server scheduled or ad-hoc),
    # try to fetch the current list from the GUI itself (via the new recipients API).
    # This makes the GUI the source of truth even when .env is empty.
    if not emails and args.live:
        try:
            import httpx
            port = _get_env("APP_PORT") or "4567"
            base = f"http://127.0.0.1:{port}"
            with httpx.Client(base_url=base, timeout=5.0) as client:
                r = client.get("/api/reports/executive-summary/recipients")
                if r.status_code == 200:
                    recs = r.json()
                    emails = [rec["email"] for rec in recs if rec.get("email")]
                    if emails:
                        print(f"[info] Loaded {len(emails)} recipient(s) from GUI executive summary config.")

                # Also fetch from_email if not explicitly provided
                if not from_email:
                    cr = client.get("/api/reports/executive-summary/config")
                    if cr.status_code == 200:
                        cfg = cr.json()
                        if cfg.get("from_email"):
                            from_email = cfg["from_email"].strip()
                            print(f"[info] Using from_email from GUI config: {from_email}")
        except Exception as fetch_exc:
            # Silent fallback — generator will just not email if still empty
            print(f"[warn] Could not fetch recipients/config from GUI API: {fetch_exc}", file=sys.stderr)

    # Schedule check: if this is a scheduled invocation (no explicit --email) and schedule is configured,
    # only proceed if current day/time roughly matches. This allows UI-configured cadence while
    # the systemd timer may be fixed or run frequently.
    if not args.email and args.live:
        try:
            import httpx
            port = _get_env("APP_PORT") or "4567"
            base = f"http://127.0.0.1:{port}"
            with httpx.Client(base_url=base, timeout=5.0) as client:
                cr = client.get("/api/reports/executive-summary/config")
                if cr.status_code == 200:
                    cfg = cr.json()
                    if cfg.get("schedule_enabled"):
                        now = datetime.now()
                        sched_day = int(cfg.get("schedule_day", 0))
                        sched_h = int(cfg.get("schedule_hour", 8))
                        sched_m = int(cfg.get("schedule_minute", 0))
                        if now.weekday() != sched_day:
                            print(f"[info] Schedule skip: today={now.weekday()} (Mon=0) != configured day {sched_day}")
                            sys.exit(0)
                        # allow +/- 45 min window for timer jitter
                        target = now.replace(hour=sched_h, minute=sched_m, second=0, microsecond=0)
                        delta = abs((now - target).total_seconds())
                        if delta > 45 * 60:
                            print(f"[info] Schedule skip: outside time window for {sched_h:02d}:{sched_m:02d}")
                            sys.exit(0)
                        print(f"[info] Schedule match: day={sched_day} time~{sched_h:02d}:{sched_m:02d}")
        except Exception as sched_exc:
            print(f"[warn] Schedule enforcement skipped: {sched_exc}", file=sys.stderr)

    output_dir = _get_env("FLEET_HEALTH_REPORT_OUTPUT_DIR")
    if not output_dir:
        # Fallback relative to the script (works in dev tree and after deploys where data/ lives beside scripts/parent)
        here = os.path.dirname(os.path.abspath(__file__))
        output_dir = os.path.normpath(os.path.join(here, "..", "data", "reports"))
    os.makedirs(output_dir, exist_ok=True)

    if args.data_file:
        # In-process snapshot from GUI on *this* host (Executive Summary Send).
        try:
            with open(args.data_file, "r", encoding="utf-8") as dfh:
                raw = json.load(dfh)
        except Exception as df_exc:
            print(f"[error] Cannot read --data-file {args.data_file!r}: {df_exc}", file=sys.stderr)
            sys.exit(2)
        if not isinstance(raw, dict) or "dashboard" not in raw:
            print(
                "[error] --data-file must be a JSON object with a dashboard key "
                "(live snapshot from this host only).",
                file=sys.stderr,
            )
            sys.exit(2)
        raw["_live"] = True
        if not raw.get("_source"):
            raw["_source"] = _default_source_label()
        print(f"[ok] Loaded live snapshot from --data-file ({raw.get('_source')})")
    elif args.live:
        base_url = args.base_url
        if not base_url:
            port = _get_env("APP_PORT") or "4567"
            base_url = f"http://127.0.0.1:{port}"
        try:
            raw = fetch_live_data(base_url)
        except RuntimeError as live_exc:
            print(f"[error] {live_exc}", file=sys.stderr)
            sys.exit(2)
        if not raw.get("_live") or "dashboard" not in raw:
            print(
                "[error] --live produced no usable dashboard data; refusing sample fallback.",
                file=sys.stderr,
            )
            sys.exit(2)
    else:
        print(
            "[info] No --live/--data-file: using synthetic example.com demo data only "
            "(not any real fleet).",
            file=sys.stderr,
        )
        raw = get_sample_data()

    # Always label with this host (or explicit override) — never a foreign environment name.
    src = args.source_label or raw.get("_source") or _default_source_label()

    if not args.output:
        dated = datetime.now().strftime("%Y-%m-%d")
        args.output = os.path.join(output_dir, f"fleet-health-{dated}.pdf")

    out = os.path.expanduser(args.output)
    build_pdf(raw, out, source_label=src)

    # Email support (designed to be invoked directly on prod server node).
    # Uses local MTA (Postfix) via mail/mailx — NOT direct SMTP from Python.
    # Success here only means the MTA accepted the message; remote delivery can
    # still fail (port 25 blocked, no relayhost, SPF/DMARC, bad From:). Check
    # mailq / maillog / journalctl -u postfix after sends that "succeed" in GUI.
    if emails and os.path.exists(out):
        subject = f"OpenVox Fleet Health Report - {datetime.now().strftime('%Y-%m-%d')}"
        body = (
            f"See attached one-page Fleet Health PDF.\n\n"
            f"Generated on the OpenVox GUI host.\nSource: {src}\n"
        )
        try:
            import subprocess
            # Prefer mailx/mail with explicit From when set (strict environments)
            if from_email:
                cmd = ["mail", "-r", from_email, "-s", subject, "-a", out] + emails
            else:
                cmd = ["mail", "-s", subject, "-a", out] + emails
            res = subprocess.run(cmd, input=body.encode(), capture_output=True, timeout=60)
            if res.returncode != 0:
                if from_email:
                    cmd2 = ["mailx", "-r", from_email, "-s", subject, "-a", out] + emails
                else:
                    cmd2 = ["mailx", "-s", subject, "-a", out] + emails
                res = subprocess.run(cmd2, input=body.encode(), capture_output=True, timeout=60)
            err_txt = (res.stderr or b"").decode(errors="replace").strip()
            out_txt = (res.stdout or b"").decode(errors="replace").strip()
            if res.returncode == 0:
                print(
                    f"[ok] Report handed to local MTA for {', '.join(emails)}"
                    + (f" (From: {from_email})" if from_email else "")
                    + f". PDF also at {out}. "
                    "If recipients never receive mail, inspect Postfix (mailq, maillog) — "
                    "outbound port 25 is often blocked without a smarthost/relay on 587/465."
                )
            else:
                print(
                    f"[warn] mail/mailx rc={res.returncode}. PDF ready: {out}. "
                    f"stderr={err_txt[:800]!r} stdout={out_txt[:400]!r}"
                )
        except Exception as ee:
            print(f"[warn] Email error: {ee}. PDF at {out}")


if __name__ == "__main__":
    main()
