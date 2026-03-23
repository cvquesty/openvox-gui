#!/usr/bin/env python3
"""
OpenVox GUI — User Management CLI

A command-line tool for managing local authentication users stored in
the SQLite database. This script is intended to be run directly on the
server as root (or with sudo) to administer user accounts without
needing to log into the web interface.

The user management functions in the backend are all async (they use
SQLAlchemy's async session), so this CLI uses asyncio.run() to bridge
the synchronous CLI world with the asynchronous database layer.

Usage:
    manage_users.py add <username> [--role admin|operator|viewer]
    manage_users.py remove <username>
    manage_users.py list
    manage_users.py passwd <username>

Examples:
    sudo ./manage_users.py add admin --role admin
    sudo ./manage_users.py list
    sudo ./manage_users.py passwd admin
    sudo ./manage_users.py remove olduser
"""
import sys
import os
import asyncio
import getpass
import argparse
from pathlib import Path

# Add the backend directory to the Python path so we can import the
# application modules. This allows the script to be run from any
# working directory, not just the project root.
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from app.middleware.auth_local import add_user, remove_user, list_users, change_password


def cmd_add(args):
    """Prompt for a password (with confirmation) and create a new user
    in the database with the specified role. Exits with code 1 if the
    passwords do not match or if user creation fails.
    """
    password = getpass.getpass(f"Password for '{args.username}': ")
    confirm = getpass.getpass("Confirm password: ")
    if password != confirm:
        print("Error: Passwords do not match.")
        sys.exit(1)
    # add_user is an async function — we must run it within an event loop
    asyncio.run(add_user(args.username, password, args.role))
    print(f"User '{args.username}' created with role '{args.role}'.")


def cmd_remove(args):
    """Remove an existing user from the database. Exits with code 1
    if the user does not exist.
    """
    # remove_user is an async function — we must run it within an event loop
    if asyncio.run(remove_user(args.username)):
        print(f"User '{args.username}' removed.")
    else:
        print(f"Error: User '{args.username}' not found.")
        sys.exit(1)


def cmd_list(args):
    """Print a formatted table of all users, their roles, and their
    authentication source (local or ldap).
    """
    # list_users is an async function — we must run it within an event loop
    users = asyncio.run(list_users())
    if not users:
        print("No users found.")
        return
    print(f"{'Username':<20} {'Role':<12} {'Auth Source':<10}")
    print("-" * 42)
    for u in users:
        auth = u.get('auth_source', 'local')
        print(f"{u['username']:<20} {u['role']:<12} {auth:<10}")


def cmd_passwd(args):
    """Prompt for a new password (with confirmation) and update the
    stored password hash for an existing user. Exits with code 1 if
    the user does not exist or passwords do not match.
    """
    password = getpass.getpass(f"New password for '{args.username}': ")
    confirm = getpass.getpass("Confirm password: ")
    if password != confirm:
        print("Error: Passwords do not match.")
        sys.exit(1)
    # change_password is an async function — we must run it within an event loop
    if asyncio.run(change_password(args.username, password)):
        print(f"Password updated for '{args.username}'.")
    else:
        print(f"Error: User '{args.username}' not found.")
        sys.exit(1)


def main():
    """Parse command-line arguments and dispatch to the appropriate
    subcommand handler. Prints usage information if no command is given.
    """
    parser = argparse.ArgumentParser(description="OpenVox GUI User Management")
    sub = parser.add_subparsers(dest="command", help="Commands")

    add_p = sub.add_parser("add", help="Add a new user")
    add_p.add_argument("username", help="Username for the new account")
    add_p.add_argument("--role", default="viewer", choices=["admin", "operator", "viewer"],
                       help="Role to assign (default: viewer)")
    add_p.set_defaults(func=cmd_add)

    rm_p = sub.add_parser("remove", help="Remove an existing user")
    rm_p.add_argument("username", help="Username to remove")
    rm_p.set_defaults(func=cmd_remove)

    list_p = sub.add_parser("list", help="List all users and their roles")
    list_p.set_defaults(func=cmd_list)

    pw_p = sub.add_parser("passwd", help="Change a user's password")
    pw_p.add_argument("username", help="Username whose password to change")
    pw_p.set_defaults(func=cmd_passwd)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)
    args.func(args)


if __name__ == "__main__":
    main()
