# install.ps1 -- OpenVox agent bootstrap installer (Windows)
#
# Modelled on Puppet Enterprise's install.ps1, this script downloads
# the openvox-agent MSI from the local OpenVox package mirror (typically
# the openvox-gui server) and installs it on the requesting Windows
# host.
#
# Recommended invocation (matches the PE one-liner):
#
#   [System.Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; `
#   [Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}; `
#   $wc = New-Object System.Net.WebClient; `
#   $wc.DownloadFile('https://<openvox-gui-server>:8140/packages/install.ps1','install.ps1'); `
#   .\install.ps1 -v
#
# This file is shipped via openvox-gui sync at:
#   /opt/openvox-pkgs/install.ps1
# and exposed at https://<server>:8140/packages/install.ps1 via the
# puppetserver static-content mount.
[CmdletBinding()]
Param(
  # FQDN of the puppetserver this agent should report to. Resolution
  # order (highest priority first):
  #   1. -Server CLI parameter
  #   2. The __OPENVOX_PUPPET_SERVER__ placeholder, replaced by the
  #      openvox-gui server when install.ps1 is installed into
  #      /opt/openvox-pkgs/install.ps1
  #   3. The "server" line under [main] in the existing puppet.conf
  #      (helpful when re-installing on an already-configured host)
  [String]$Server = '__OPENVOX_PUPPET_SERVER__',

  # Override the default openvox-gui mirror URL. Almost never needed:
  # if not set, it is derived from -Server as
  # "https://<server>:8140/packages". Useful only when the package
  # mirror lives on a different host from the puppetserver.
  [String]$PkgRepoUrl = '',

  # OpenVox major version (7 or 8). Defaults to 8.
  [String]$OpenVoxVersion = '__OPENVOX_DEFAULT_VERSION__',

  # Optional MSI tweaks (mirrors PE's PowerShell installer).
  [String]$InstallDir,
  [String]$PuppetAgentAccountUser,
  [String]$PuppetAgentAccountPassword,
  [String]$PuppetAgentAccountDomain,
  [Switch]$EnableLongPaths,

  # Service management.  Defaults match `puppet resource service puppet
  # ensure=running enable=true` behaviour.
  [ValidateSet("running","stopped")]   [String]$PuppetServiceEnsure = "running",
  [ValidateSet("true","false","manual")][String]$PuppetServiceEnable = "true",

  # Any remaining args become section:setting=value directives.
  [Parameter(ValueFromRemainingArguments = $true)]
  [String[]]$arguments = @()
)

$ErrorActionPreference = "Stop"

# ─── Constants ──────────────────────────────────────────────────────────────
$puppet_conf_dir = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'PuppetLabs\puppet\etc'

# ─── Resolve $Server / $PkgRepoUrl ──────────────────────────────────────────
# Treat the unsubstituted placeholder as "not set" so we fall through
# to the recovery paths instead of failing immediately.
#
# CRITICAL: build the placeholder string via runtime concatenation.
# The literal sequence __OPENVOX_PUPPET_SERVER__ must NOT appear in
# this script outside the actual default-value position above, because
# the server-side `sed` render substitutes EVERY occurrence with the
# puppetserver FQDN. If we wrote the marker as a literal here, the
# render would turn it into the real FQDN, this -like check would
# falsely match a successful render, and $Server would be cleared --
# the exact bug that hit install.bash on production in 3.3.5-13 and
# was fixed there in 3.3.5-14. The PowerShell + concatenation keeps
# `sed` from matching the token.
$placeholderMarker = '__OPENVOX' + '_PUPPET_SERVER__'
if ($Server -like "*$placeholderMarker*") { $Server = '' }

# Recovery path: re-install on a host that already has puppet.conf.
# Pull the server= line out of [main]. This makes the script work
# correctly when a Windows host is being rebuilt and the server is
# already known locally -- no -Server parameter needed.
if (-not $Server -and (Test-Path "$puppet_conf_dir\puppet.conf")) {
    $section = ''
    foreach ($line in Get-Content "$puppet_conf_dir\puppet.conf") {
        if ($line -match '^\s*\[(.+)\]\s*$') { $section = $matches[1]; continue }
        if ($section -in @('', 'main') -and $line -match '^\s*server\s*=\s*(\S+)') {
            $Server = $matches[1]
            Write-Verbose "Reusing puppetserver from existing puppet.conf: $Server"
            break
        }
    }
}

if (-not $Server) {
    throw @"
Could not determine the puppetserver FQDN.
This usually means the openvox-gui that served install.ps1 didn't
substitute its hostname into the script when it was installed. To
fix the underlying issue, on the openvox-gui server run:
    cd ~/openvox-gui && git pull && sudo ./scripts/update_local.sh --force
As a one-shot workaround, re-run this installer with -Server:
    .\install.ps1 -Server <puppetserver-fqdn>
"@
}

# Default OpenVox version handling (placeholder OR junk -> 8)
if (-not $OpenVoxVersion -or $OpenVoxVersion -notmatch '^[78]$') {
    $OpenVoxVersion = '8'
}

# Derive PkgRepoUrl from $Server unless explicitly set
if (-not $PkgRepoUrl) {
    $PkgRepoUrl = "https://${Server}:8140/packages"
}

Write-Verbose "Server     : $Server"
Write-Verbose "Repo URL   : $PkgRepoUrl"
Write-Verbose "OpenVox ver: $OpenVoxVersion"

# ─── Install puppet CA into the system trust store ─────────────────────────
# Mirrors the install.bash 3.3.5-18 behaviour for Windows. Without this,
# every subsequent HTTPS request to the puppetserver from this host
# (PowerShell, browser, future puppet-agent invocations) would have to
# disable cert verification. We install once, here, so the puppet CA is
# permanently trusted system-wide via Cert:\LocalMachine\Root.
function Install-PuppetCaCert {
    param([String]$Server)

    $caUrl = "https://${Server}:8140/puppet-ca/v1/certificate/ca"
    $caTmp = Join-Path ([System.IO.Path]::GetTempPath()) 'openvox-puppet-ca.crt'

    # We don't trust the cert yet, so disable verification just for this
    # one fetch. Same chicken-and-egg as the bash installer.
    $oldCallback = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
    try {
        $wcCa = New-Object System.Net.WebClient
        $wcCa.Proxy = $null
        $wcCa.DownloadFile($caUrl, $caTmp)
    } catch {
        Write-Warning "Could not fetch puppet CA from $caUrl ($_). Subsequent HTTPS to the puppetserver may need -SkipCertificateCheck or equivalent."
        [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $oldCallback
        return $false
    } finally {
        [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $oldCallback
    }

    if (-not (Test-Path $caTmp) -or (Get-Item $caTmp).Length -lt 100) {
        Write-Warning "Downloaded CA file is empty or too small; skipping trust-store import."
        return $false
    }

    try {
        # LocalMachine\Root requires admin (we're running elevated already).
        Import-Certificate -FilePath $caTmp -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
        Write-Output "openvox-install: Installed puppet CA into LocalMachine\Root"
        return $true
    } catch {
        Write-Warning "Could not import CA into LocalMachine\Root ($_). Subsequent HTTPS may fail until trust is established."
        return $false
    } finally {
        Remove-Item -Force -ErrorAction SilentlyContinue $caTmp
    }
}

# Failure is non-fatal -- the bootstrap download already used
# ServerCertificateValidationCallback={$true} as a fallback, and the
# MSI install below doesn't depend on system-trust cert verification.
[void](Install-PuppetCaCert -Server $Server)

$date_time_stamp = (Get-Date -Format s) -replace ':', '-'
$install_log     = Join-Path ([System.IO.Path]::GetTempPath()) "$date_time_stamp-openvox-install.log"

if ($InstallDir) {
    $puppet_bin_dir = Join-Path $InstallDir 'bin'
} else {
    $puppet_bin_dir = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Puppet Labs\Puppet\bin'
}

# Pick the right MSI based on OS architecture.  Vox Pupuli only ships
# x64 MSIs upstream as of 2026; if/when x86 returns we'll add it.
$arch     = 'x64'
$msi_name = "openvox-agent-${arch}.msi"
if ((Get-WmiObject Win32_OperatingSystem).OSArchitecture -match '^32') {
    throw "32-bit Windows is not currently supported by upstream Vox Pupuli MSIs.  See downloads.voxpupuli.org/windows/."
}

# Mirror layout produced by sync-openvox-repo.sh (3.3.5-2+):
#   /packages/windows/openvox{N}/openvox-agent-{ver}-x64.msi   (every version)
#   /packages/windows/openvox{N}/openvox-agent-x64.msi         (latest copy)
# install.ps1 always pulls the latest-copy URL so it doesn't have to
# know which version to ask for.  The puppetserver static-content
# mount does not follow symlinks, so the sync uses a real copy.
$msi_source = "${PkgRepoUrl}/windows/openvox${OpenVoxVersion}/${msi_name}"
$msi_dest   = Join-Path ([System.IO.Path]::GetTempPath()) $msi_name

Write-Verbose "Mirror URL : $msi_source"
Write-Verbose "Local copy : $msi_dest"
Write-Verbose "Install log: $install_log"

# ─── Download helper ────────────────────────────────────────────────────────
# Uses the .NET WebClient so we don't depend on Invoke-WebRequest being
# present (which it isn't on stripped-down Windows Server Core images).
function Get-OpenVoxMsi {
    Write-Output "Downloading openvox-agent MSI from $msi_source ..."

    # Permit TLS 1.0/1.1/1.2 in case a downstream proxy negotiates an
    # older protocol.  Most modern installs use 1.2 exclusively.
    $tls1  = [Net.SecurityProtocolType]::Tls
    $tls11 = [Net.SecurityProtocolType]::Tls11
    $tls12 = [Net.SecurityProtocolType]::Tls12
    [System.Net.ServicePointManager]::SecurityProtocol = $tls1 -bor $tls11 -bor $tls12

    # The puppetserver presents a self-signed (or internal CA) cert on
    # 8140.  We accept any cert here -- if the caller wants strict
    # verification they can set the validation callback before invoking
    # the script.
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }

    $wc = New-Object System.Net.WebClient
    try {
        $wc.DownloadFile($msi_source, $msi_dest)
    }
    catch [System.Net.WebException] {
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode -eq [System.Net.HttpStatusCode]::NotFound) {
            throw "openvox-agent MSI not found at $msi_source.  Has the openvox-gui repo sync run?  See the Installer page in the GUI for status."
        }
        throw
    }
}

# ─── MSI properties ─────────────────────────────────────────────────────────
function Get-MsiProperties {
    $props = @()
    if ($InstallDir)                  { $props += "INSTALLDIR=`"$InstallDir`"" }
    if ($PuppetAgentAccountUser)      { $props += "PUPPET_AGENT_ACCOUNT_USER=$PuppetAgentAccountUser" }
    if ($PuppetAgentAccountPassword)  { $props += "PUPPET_AGENT_ACCOUNT_PASSWORD=$PuppetAgentAccountPassword" }
    if ($PuppetAgentAccountDomain)    { $props += "PUPPET_AGENT_ACCOUNT_DOMAIN=$PuppetAgentAccountDomain" }
    if ($EnableLongPaths)             { $props += "ENABLE_LONG_PATHS=true" }

    # Two hard-coded properties: the puppet master FQDN (so the agent
    # registers against the right server) and Manual startup mode (we
    # let `puppet resource service puppet ensure=running` handle the
    # actual start so service mode and ensure stay consistent with the
    # Set-PuppetService call below).
    $props += "PUPPET_MASTER_SERVER=$Server"
    $props += "PUPPET_AGENT_STARTUP_MODE=Manual"
    ($props -join ' ')
}

# ─── puppet.conf / csr_attributes.yaml extras ───────────────────────────────
function Set-CustomPuppetConfiguration {
    # Parse remaining arguments of the form
    #   <section>:<setting>=<value>
    # and apply them via `puppet config set` (puppet.conf) or by
    # writing csr_attributes.yaml (custom_attributes / extension_requests).
    $regex = '^(main|server|agent|user|custom_attributes|extension_requests):(.+?)=(.*)$'
    $attr_array = @()
    $extn_array = @()

    foreach ($entry in $arguments) {
        if (-not ($m = [regex]::Match($entry,$regex)).Success) {
            throw "Unable to interpret argument '$entry'.  Expected '<section>:<setting>=<value>'."
        }
        $section = $m.Groups[1].Value
        $setting = $m.Groups[2].Value
        $value   = $m.Groups[3].Value
        switch ($section) {
            'custom_attributes'   { $attr_array += "${setting}: '${value}'" ; break }
            'extension_requests'  { $extn_array += "${setting}: '${value}'" ; break }
            default {
                Write-Verbose "Setting puppet.conf: [${section}] ${setting}=${value}"
                & "$puppet_bin_dir\puppet" config set $setting $value --section $section
            }
        }
    }

    if ($attr_array.Length -gt 0 -or $extn_array.Length -gt 0) {
        $csr = Join-Path $puppet_conf_dir 'csr_attributes.yaml'
        Write-Verbose "Writing $csr"
        '---' | Out-File -FilePath $csr -Encoding UTF8
        if ($attr_array.Length -gt 0) {
            'custom_attributes:' | Out-File -FilePath $csr -Append -Encoding UTF8
            foreach ($a in $attr_array) { "  $a" | Out-File -FilePath $csr -Append -Encoding UTF8 }
        }
        if ($extn_array.Length -gt 0) {
            'extension_requests:' | Out-File -FilePath $csr -Append -Encoding UTF8
            foreach ($e in $extn_array) { "  $e" | Out-File -FilePath $csr -Append -Encoding UTF8 }
        }
    }
}

# ─── MSI install ────────────────────────────────────────────────────────────
function Install-OpenVox {
    $msi_props = Get-MsiProperties
    $args      = "/qn /norestart /log `"$install_log`" /i `"$msi_dest`" $msi_props"
    Write-Output "Installing openvox-agent ($arch) ..."
    Write-Output "Install log: $install_log"
    $proc = [System.Diagnostics.Process]::Start('msiexec', $args)
    $proc.WaitForExit()
    # 0 = success, 1641 = success/reboot initiated, 3010 = success/reboot required
    if (@(0,1641,3010) -notcontains $proc.ExitCode) {
        throw "openvox-agent MSI install failed (exit $($proc.ExitCode)).  Inspect $install_log for details."
    }

    # The MSI doesn't always write certname into puppet.conf -- copy
    # the value the agent computed back so reboots don't surprise us.
    $certname = & "$puppet_bin_dir\puppet" config print certname --section main
    if ($certname) {
        & "$puppet_bin_dir\puppet" config set certname $certname --section main
    }

    # Always set the server explicitly (the MSI's PUPPET_MASTER_SERVER
    # alone doesn't always make it into puppet.conf reliably).
    & "$puppet_bin_dir\puppet" config set server $Server --section main
}

# ─── Service management ────────────────────────────────────────────────────
function Set-PuppetService {
    Write-Verbose "Setting puppet service: ensure=$PuppetServiceEnsure enable=$PuppetServiceEnable"
    & "$puppet_bin_dir\puppet" resource service puppet `
        "ensure=$PuppetServiceEnsure" `
        "enable=$PuppetServiceEnable" | Out-Null
}

# ─── Main flow ──────────────────────────────────────────────────────────────
Get-OpenVoxMsi
Install-OpenVox
Set-CustomPuppetConfiguration
Set-PuppetService

$installed = & "$puppet_bin_dir\puppet" --version 2>$null

Write-Output ""
Write-Output "=============================================================="
Write-Output "          OpenVox agent install complete"
Write-Output "=============================================================="
Write-Output "  Version : $installed"
Write-Output "  Server  : $Server"
Write-Output "  Service : $PuppetServiceEnsure / enabled=$PuppetServiceEnable"
Write-Output ""
Write-Output "  Next steps:"
Write-Output "    1. On the puppetserver:  puppetserver ca sign --certname <fqdn>"
Write-Output "    2. Trigger a run:        puppet agent --test"
Write-Output ""
