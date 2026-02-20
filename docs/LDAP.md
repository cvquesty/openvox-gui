# LDAP / Active Directory Authentication Guide

**OpenVox GUI Version 2.0.0-2 Alpha**

This guide explains how to configure OpenVox GUI to authenticate users against an LDAP directory server (OpenLDAP, 389 Directory Server, Red Hat Directory Server, or Microsoft Active Directory).

## Table of Contents

1. [Overview](#overview)
2. [How It Works](#how-it-works)
3. [Quick Setup](#quick-setup)
4. [Configuration Reference](#configuration-reference)
5. [Directory Server Presets](#directory-server-presets)
6. [Per-User Authentication Source](#per-user-authentication-source)
7. [Group-to-Role Mapping](#group-to-role-mapping)
8. [Active Directory Specifics](#active-directory-specifics)
9. [Testing Your Configuration](#testing-your-configuration)
10. [Troubleshooting LDAP](#troubleshooting-ldap)
11. [Security Considerations](#security-considerations)

---

## Overview

OpenVox GUI supports **split authentication** — a hybrid model where:

- **Credentials** (username + password) are validated against your LDAP directory
- **Roles** (Admin, Operator, Viewer) are managed locally in the OpenVox GUI database
- **Local accounts** continue to work alongside LDAP for service accounts and break-glass access
- **Each user** can be individually configured to authenticate via LDAP or local password

This means you can use your organization's existing directory for login while retaining full control over what each user is allowed to do in OpenVox GUI.

## How It Works

### Login Flow

When a user logs in, OpenVox GUI checks the user's configured authentication source:

1. **User is set to `ldap`** → Validate credentials against the LDAP server
2. **User is set to `local`** → Validate credentials against the local password hash
3. **Unknown user + LDAP enabled** → Try LDAP (auto-provisions on success)
4. **Unknown user + LDAP disabled** → Try local (fails if not found)

### Auto-Provisioning

When a new user authenticates via LDAP for the first time:

1. OpenVox GUI creates a local user record automatically
2. The initial role is determined by LDAP group membership (see [Group-to-Role Mapping](#group-to-role-mapping))
3. If no group matches, the configured default role is assigned (typically `viewer`)
4. The local password hash is set to a placeholder — the user always authenticates via LDAP
5. Administrators can change the user's role at any time via the UI

---

## Quick Setup

### Step 1: Navigate to Auth Settings

1. Log in as an administrator
2. Go to **Settings** → **Auth Settings** tab
3. You'll see the **LDAP / Active Directory** configuration panel

### Step 2: Choose a Preset

Click one of the **Quick Presets** to pre-fill settings for your directory type:

| Preset | Best For |
|--------|----------|
| **OpenLDAP** | OpenLDAP, slapd |
| **389 DS / Red Hat DS** | 389 Directory Server, Red Hat Directory Server, Fedora DS |
| **Active Directory** | Microsoft Active Directory |

### Step 3: Configure Connection

Fill in your LDAP server details:

- **Server URL**: `ldap://your-ldap-server:389` or `ldaps://your-ldap-server:636`
- **Bind DN**: Service account DN (e.g., `cn=openvox-svc,ou=services,dc=example,dc=com`)
- **Bind Password**: Service account password
- **User Base DN**: Where user accounts live (e.g., `ou=people,dc=example,dc=com`)

### Step 4: Test the Connection

Click **Test Connection** to verify connectivity. The test will:

- Connect to the LDAP server
- Bind with the service account
- Verify the User Base DN exists
- Verify the Group Base DN exists (if configured)

### Step 5: Enable and Save

Toggle the **Enabled** switch and click **Save LDAP Configuration**.

### Step 6: Create Users

Go to **Settings** → **User Manager** and create users with **LDAP / Active Directory** as the authentication source. These users will log in with their LDAP credentials.

---

## Configuration Reference

### Connection Settings

| Setting | Description | Example |
|---------|-------------|---------|
| **Server URL** | LDAP server address. Use `ldaps://` for SSL. | `ldap://ldap.example.com:389` |
| **Timeout** | Connection timeout in seconds | `10` |
| **Use SSL (LDAPS)** | Connect over SSL on port 636 | Off |
| **Use STARTTLS** | Upgrade plain connection to TLS | Off |
| **Verify SSL Certificate** | Require valid SSL cert (disable for self-signed) | On |
| **CA Certificate Path** | Path to CA cert file for SSL verification | `/etc/ssl/certs/ldap-ca.pem` |

### Bind Credentials

| Setting | Description | Example |
|---------|-------------|---------|
| **Bind DN** | Service account used to search for users | `cn=admin,dc=example,dc=com` |
| **Bind Password** | Password for the bind account | *(masked)* |

> **Note**: For Active Directory with UPN mode, the Bind DN is optional — users bind directly with `user@domain`.

### User Search Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **User Base DN** | Where to search for user accounts | `dc=example,dc=com` |
| **User Search Filter** | Filter to find users. `{username}` is replaced with the login name | `(uid={username})` |
| **Username Attribute** | LDAP attribute containing the username | `uid` |
| **Email Attribute** | LDAP attribute containing email address | `mail` |
| **Display Name Attribute** | LDAP attribute containing display name | `cn` |

### Group Mapping Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Group Base DN** | Where to search for groups | *(empty — groups disabled)* |
| **Group Search Filter** | Filter to find group objects | `(objectClass=groupOfNames)` |
| **Group Member Attribute** | Attribute listing group members | `member` |
| **Group Name Attribute** | Attribute containing group name | `cn` |
| **Admin Group** | LDAP group name → Admin role | *(empty)* |
| **Operator Group** | LDAP group name → Operator role | *(empty)* |
| **Viewer Group** | LDAP group name → Viewer role | *(empty)* |
| **Default Role** | Role when no group matches | `viewer` |

---

## Directory Server Presets

### OpenLDAP

```
User Search Filter:    (uid={username})
Username Attribute:    uid
Group Search Filter:   (objectClass=groupOfNames)
Group Member Attr:     member
AD UPN Mode:           Off
```

### 389 Directory Server / Red Hat DS

```
User Search Filter:    (uid={username})
Username Attribute:    uid
Group Search Filter:   (objectClass=groupOfUniqueNames)
Group Member Attr:     uniqueMember
AD UPN Mode:           Off
```

### Microsoft Active Directory

```
User Search Filter:    (sAMAccountName={username})
Username Attribute:    sAMAccountName
Display Name Attr:     displayName
Group Search Filter:   (objectClass=group)
Group Member Attr:     member
AD UPN Mode:           On
AD Domain:             corp.example.com
```

---

## Per-User Authentication Source

Each user in OpenVox GUI has an **authentication source** that determines how they log in:

| Source | Behavior |
|--------|----------|
| **LDAP** | Credentials validated against the LDAP directory. No local password stored. |
| **Local** | Credentials validated against a locally stored bcrypt password hash. |

### Setting Auth Source When Creating Users

In the **User Manager** tab, the **Add User** form includes an **Authentication Source** selector:

- **LDAP / Active Directory** (default): The user authenticates with their directory credentials. No password needs to be entered in the form.
- **Local**: A password must be provided and is stored locally.

### Changing Auth Source for Existing Users

Click the ⇌ (switch) icon in the user table's **Actions** column to change a user's authentication source.

> **Warning**: Switching a user from **local** to **LDAP** will invalidate their local password. They will need to use their LDAP credentials going forward.

---

## Group-to-Role Mapping

When LDAP group mapping is configured, new LDAP users are assigned a role based on their group memberships:

| Priority | LDAP Group Config | Assigned Role |
|----------|-------------------|---------------|
| 1 (highest) | Admin Group | `admin` — Full access |
| 2 | Operator Group | `operator` — Deploy & manage |
| 3 | Viewer Group | `viewer` — Read only |
| 4 (fallback) | No match | Default Role (configurable) |

### Example

If your LDAP directory has these groups:
- `openvox-admins` → Map to **Admin Group**
- `openvox-ops` → Map to **Operator Group**
- `openvox-viewers` → Map to **Viewer Group**

A user who is a member of `openvox-ops` will be auto-provisioned with the `operator` role on first login.

> **Note**: Administrators can always override a user's role locally after they've been provisioned, regardless of their LDAP group membership.

---

## Active Directory Specifics

### UPN Bind Mode

Active Directory supports **User Principal Name (UPN)** authentication, where users bind as `username@domain` rather than with a full Distinguished Name (DN).

To enable:
1. Toggle **Use AD User Principal Name (UPN) for bind**
2. Enter your **AD Domain** (e.g., `corp.example.com`)

With UPN mode enabled, a user `jsmith` will bind as `jsmith@corp.example.com`.

### Common AD Configuration

```
Server URL:            ldaps://dc01.corp.example.com:636
Use SSL:               On
Bind DN:               CN=openvox-svc,OU=Service Accounts,DC=corp,DC=example,DC=com
User Base DN:          DC=corp,DC=example,DC=com
User Search Filter:    (sAMAccountName={username})
Username Attribute:    sAMAccountName
Display Name Attr:     displayName
Group Base DN:         OU=Groups,DC=corp,DC=example,DC=com
Group Search Filter:   (objectClass=group)
Group Member Attr:     member
AD UPN Mode:           On
AD Domain:             corp.example.com
```

---

## Testing Your Configuration

### Using the Built-In Test

The **Test Connection** button on the Auth Settings page will:

1. ✅ Connect to the LDAP server
2. ✅ Authenticate with the bind credentials
3. ✅ Verify the User Base DN is accessible
4. ✅ Verify the Group Base DN is accessible (if configured)

### Manual Testing with ldapsearch

If you need to debug outside the UI:

```bash
# Test basic connectivity (OpenLDAP)
ldapsearch -x -H ldap://your-server:389 \
  -D "cn=admin,dc=example,dc=com" \
  -W -b "ou=people,dc=example,dc=com" "(uid=testuser)"

# Test Active Directory
ldapsearch -x -H ldaps://dc01.corp.example.com:636 \
  -D "openvox-svc@corp.example.com" \
  -W -b "DC=corp,DC=example,DC=com" "(sAMAccountName=testuser)"
```

---

## Troubleshooting LDAP

### Connection Refused

- Verify the LDAP server is running and accepting connections
- Check firewall rules (port 389 for LDAP, 636 for LDAPS)
- Verify the server URL is correct (hostname, port, protocol)

### Bind Failed

- Verify the Bind DN and password are correct
- Check that the service account has search permissions
- For AD: ensure the account is not locked or expired

### User Not Found

- Verify the User Base DN is correct
- Check the User Search Filter — try `(uid={username})` for OpenLDAP or `(sAMAccountName={username})` for AD
- Ensure the user exists in the directory under the specified base DN

### SSL Certificate Errors

- For self-signed certificates, disable **Verify SSL Certificate** or provide the CA cert path
- Ensure the server's certificate is valid and not expired
- Check that the hostname in the certificate matches the server URL

### Users Auto-Provisioned with Wrong Role

- Check the Group Base DN and Group Search Filter
- Verify group names match exactly (case-insensitive comparison)
- Check the Group Member Attribute — `member` for most servers, `uniqueMember` for 389 DS

---

## Security Considerations

### Service Account Permissions

The LDAP bind account should have **minimal permissions**:
- Read access to user entries (for searching)
- Read access to group entries (for role mapping)
- **No write access** — OpenVox GUI never modifies the LDAP directory

### Password Handling

- LDAP bind passwords are stored encrypted in the local database
- Bind passwords are **never exposed** via the API (the UI shows only whether a password is set)
- User passwords are validated against LDAP in real-time — they are never stored locally
- When a user is switched from local to LDAP, their local password hash is invalidated

### Local Break-Glass Access

Always maintain at least one local administrator account (like the default `admin` account) as a break-glass mechanism. If the LDAP server becomes unreachable, local accounts can still authenticate.

### Network Security

- Use **LDAPS** (port 636) or **STARTTLS** for encrypted connections to your directory
- If using self-signed certificates, provide the CA certificate path rather than disabling verification
- The `ldap3` Python library used by OpenVox GUI is a pure-Python implementation with no system dependencies