"""
Simple output formatters for ovox CLI query results.

These mirror the behavior of frontend/src/utils/exportUtils.ts
so that `ovox pql ... --format markdown` produces output consistent
with what the web UI copy buttons generate.
"""

from typing import Any, List


def _safe_str(value: Any, max_len: int = 300) -> str:
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        s = str(value)
    else:
        try:
            import json
            s = json.dumps(value, ensure_ascii=False, default=str)
        except Exception:
            s = str(value)
    if len(s) > max_len:
        return s[: max_len - 3] + "..."
    return s


def _derive_columns(results: List[dict]) -> List[str]:
    if not results:
        return []
    cols = []
    for row in results[:50]:
        if isinstance(row, dict):
            for k in row.keys():
                if k not in cols:
                    cols.append(k)
    return cols


def results_to_markdown(results: List[dict], columns: List[str] | None = None) -> str:
    """Return a GitHub-flavored Markdown table."""
    if not results:
        return "_No results_"

    cols = columns or _derive_columns(results)
    if not cols:
        return "_No columns_"

    header = "| " + " | ".join(cols) + " |"
    sep = "| " + " | ".join(["---"] * len(cols)) + " |"

    rows = []
    for r in results:
        cells = []
        for c in cols:
            val = _safe_str(r.get(c) if isinstance(r, dict) else r)
            # Escape pipes for Markdown tables
            cells.append(val.replace("|", "\\|").replace("\n", "<br>"))
        rows.append("| " + " | ".join(cells) + " |")

    return "\n".join([header, sep] + rows)


def results_to_csv(results: List[dict], columns: List[str] | None = None) -> str:
    """Return a simple CSV string."""
    if not results:
        return ""

    cols = columns or _derive_columns(results)
    if not cols:
        return ""

    def _escape(v: Any) -> str:
        s = _safe_str(v)
        if "," in s or '"' in s or "\n" in s:
            return '"' + s.replace('"', '""') + '"'
        return s

    lines = [",".join(cols)]
    for r in results:
        lines.append(",".join(_escape(r.get(c) if isinstance(r, dict) else r) for c in cols))
    return "\n".join(lines)
