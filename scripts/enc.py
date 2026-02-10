#!/usr/bin/env python3
"""
External Node Classifier (ENC) script for Puppet.

This script is called by PuppetServer for each node during catalog compilation.
It queries the OpenVox GUI API to get the node's classification and outputs
YAML that Puppet understands.

Usage in puppet.conf:
    [server]
    node_terminus = exec
    external_nodes = /opt/openvox-gui/scripts/enc.py

The script expects the certname as the first argument.
"""
import sys
import urllib.request
import urllib.error
import json
import yaml

API_BASE = "http://127.0.0.1:4567"


def classify_node(certname: str) -> str:
    """Query the OpenVox GUI API for node classification."""
    url = f"{API_BASE}/api/enc/classify/{certname}/yaml"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        if e.code == 404:
            # Node not classified - return empty classification
            return yaml.dump({
                "environment": "production",
                "classes": {},
                "parameters": {},
            }, default_flow_style=False)
        else:
            print(f"Error querying ENC API: {e}", file=sys.stderr)
            sys.exit(1)
    except Exception as e:
        print(f"Error connecting to ENC API: {e}", file=sys.stderr)
        # Fail open with empty classification rather than breaking Puppet
        return yaml.dump({
            "environment": "production",
            "classes": {},
            "parameters": {},
        }, default_flow_style=False)


def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <certname>", file=sys.stderr)
        sys.exit(1)

    certname = sys.argv[1]
    result = classify_node(certname)
    print(result)


if __name__ == "__main__":
    main()
