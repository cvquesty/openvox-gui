"""
Command groups for ovox.

Each group is a Typer sub-application that is mounted under the main `cli`.
Keep individual files small and focused; heavy logic belongs in the server.
"""

from . import certs, nodes  # re-export for main.py

__all__ = ["nodes", "certs"]
