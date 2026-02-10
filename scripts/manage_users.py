#!/usr/bin/env python3
"""
OpenVox GUI - User Management CLI

Manage local authentication users (htpasswd format).

Usage:
    manage_users.py add <username> [--role admin|operator|viewer]
    manage_users.py remove <username>
    manage_users.py list
    manage_users.py passwd <username>
"""
import sys
import os
import getpass
import argparse
from pathlib import Path

# Add the backend to the Python path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from app.middleware.auth_local import add_user, remove_user, list_users, change_password


def cmd_add(args):
    password = getpass.getpass(f"Password for '{args.username}': ")
    confirm = getpass.getpass("Confirm password: ")
    if password != confirm:
        print("Error: Passwords do not match.")
        sys.exit(1)
    add_user(args.username, password, args.role)
    print(f"User '{args.username}' created with role '{args.role}'.")


def cmd_remove(args):
    if remove_user(args.username):
        print(f"User '{args.username}' removed.")
    else:
        print(f"Error: User '{args.username}' not found.")
        sys.exit(1)


def cmd_list(args):
    users = list_users()
    if not users:
        print("No users found.")
        return
    print(f"{'Username':<20} {'Role':<10}")
    print("-" * 30)
    for u in users:
        print(f"{u['username']:<20} {u['role']:<10}")


def cmd_passwd(args):
    password = getpass.getpass(f"New password for '{args.username}': ")
    confirm = getpass.getpass("Confirm password: ")
    if password != confirm:
        print("Error: Passwords do not match.")
        sys.exit(1)
    if change_password(args.username, password):
        print(f"Password updated for '{args.username}'.")
    else:
        print(f"Error: User '{args.username}' not found.")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="OpenVox GUI User Management")
    sub = parser.add_subparsers(dest="command", help="Commands")

    add_p = sub.add_parser("add", help="Add a user")
    add_p.add_argument("username")
    add_p.add_argument("--role", default="viewer", choices=["admin", "operator", "viewer"])
    add_p.set_defaults(func=cmd_add)

    rm_p = sub.add_parser("remove", help="Remove a user")
    rm_p.add_argument("username")
    rm_p.set_defaults(func=cmd_remove)

    list_p = sub.add_parser("list", help="List all users")
    list_p.set_defaults(func=cmd_list)

    pw_p = sub.add_parser("passwd", help="Change a user's password")
    pw_p.add_argument("username")
    pw_p.set_defaults(func=cmd_passwd)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)
    args.func(args)


if __name__ == "__main__":
    main()
