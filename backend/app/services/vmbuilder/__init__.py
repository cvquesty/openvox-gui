"""
VM builder (ported from openvox-ovbuilder).

Provisions VMware guests from vCenter templates and bootstraps them as
OpenVox agents of this estate.

Modules
-------
* ``netspec``    — hostname / IPv4 / prefix / DNS validation (no I/O).
* ``guestinfo``  — cloud-init ``guestinfo.*`` payload for the clone.
* ``client``     — ``VCenterClient`` protocol + inventory dataclasses.
* ``pyvmomi_client`` — real vCenter implementation (pyVmomi, lazy import).
* ``fake``       — in-memory vCenter used by tests and dev mode.
* ``provision``  — request validation and the build pipeline.
* ``config_store`` — vCenter settings in the app DB (password encrypted).

Everything except ``config_store`` is standard library only so it can be
unit-tested without the FastAPI stack or a vCenter.
"""
