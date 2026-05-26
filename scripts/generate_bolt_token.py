#!/usr/bin/env python3
"""
Quick utility to generate a long-lived (or permanent) service token
for the 'bolt' user (or any user).

Usage (on the OpenVox GUI server):

    # As root or the user that can read the GUI's database
    python3 /opt/openvox-gui/scripts/generate_bolt_token.py \
        --username bolt \
        --name "Bolt service token - $(hostname)" \
        --expires never

This will print the raw token **once**. Store it in:
    /etc/puppetlabs/bolt/.bolt_token   (chmod 600, owned by bolt user)
"""

import argparse
import secrets
import hashlib
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Adjust these paths if your installation differs
DB_PATH = Path("/opt/openvox-gui/data/openvox_gui.db")
# For future: support the real encrypted secret, but for now we just need the token

def generate_token():
    return secrets.token_urlsafe(48)

def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

def main():
    parser = argparse.ArgumentParser(description="Generate a long-lived Bolt service token")
    parser.add_argument("--username", required=True, help="GUI username this token belongs to (can be a service account)")
    parser.add_argument("--name", required=True, help="Human readable name for the token")
    parser.add_argument("--expires", default="never", choices=["never", "30d", "90d", "1y"], help="Token lifetime")
    args = parser.parse_args()

    raw_token = generate_token()
    token_hash = hash_token(raw_token)

    if args.expires == "never":
        expires_at = None
    elif args.expires == "30d":
        expires_at = datetime.now(timezone.utc) + timedelta(days=30)
    elif args.expires == "90d":
        expires_at = datetime.now(timezone.utc) + timedelta(days=90)
    elif args.expires == "1y":
        expires_at = datetime.now(timezone.utc) + timedelta(days=365)

    print("=" * 70)
    print("NEW BOLT SERVICE TOKEN GENERATED")
    print("=" * 70)
    print(f"Username : {args.username}")
    print(f"Name     : {args.name}")
    print(f"Expires  : {args.expires}")
    print()
    print("RAW TOKEN (store this securely — it will not be shown again):")
    print(raw_token)
    print()
    print("Recommended location on control node:")
    print("  /etc/puppetlabs/bolt/.bolt_token")
    print("  chmod 600 /etc/puppetlabs/bolt/.bolt_token")
    print("  chown bolt:bolt /etc/puppetlabs/bolt/.bolt_token")
    print()
    print("Then reference it in inventory.yaml:")
    print("  - _plugin: openvox_enc")
    print("    api_url: 'https://your-gui:4567'")
    print("    token_file: /etc/puppetlabs/bolt/.bolt_token")
    print("=" * 70)

    # For now we just print. In a full implementation this would insert into the DB.
    print("\nNOTE: This script currently only prints the token.")
    print("After applying the api_tokens migration, a future `ovox token generate` command will insert it properly.")

if __name__ == "__main__":
    main()
