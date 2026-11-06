"""
Provisioning (VM builder, ported from openvox-ovbuilder).

Builds a machine through a provider and bootstraps it as an OpenVox agent
of this estate.

Shared (provider-agnostic)
--------------------------
* ``netspec``      — hostname / IPv4 / prefix / DNS validation (no I/O).
* ``cloudinit``    — first-boot payload: network, proxy, DNF, SSH keys, agent.
* ``csr``          — per-build CSR challenge and verification at sign time.
* ``provision``    — request validation and the build pipeline.
* ``jobs``         — job rows, CA / OpenVoxDB / ENC hooks, runner.
* ``config_store`` — guest defaults and provider connections (secrets encrypted).

Providers (``providers/``)
--------------------------
* ``base``   — ``Provider`` / ``ProviderSession`` interface.
* ``vmware`` — vCenter: pyVmomi client, in-memory fake, guestinfo delivery.

Bare-metal provisioning (issue #173) plugs in as another provider.
Everything except ``config_store`` and ``jobs`` is standard library (plus
``cryptography`` for CSR parsing) so it can be unit-tested without the
FastAPI stack or a vCenter.
"""
