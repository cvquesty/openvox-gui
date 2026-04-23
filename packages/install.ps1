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
  # Override the default openvox-gui mirror URL.  When the script is
  # rendered by the openvox-gui backend the placeholder is rewritten
  # to the local mirror; allow operators to override via -PkgRepoUrl
  # for testing.
  [String]$PkgRepoUrl = '__OPENVOX_PKG_REPO_URL__',

  # FQDN of the puppetserver this agent should report to.
  [String]$Server = '__OPENVOX_PUPPET_SERVER__',

  # OpenVox major version (7 or 8).  Default baked in by the GUI.
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

# ─── Sanity-check the placeholders ──────────────────────────────────────────
# When this script is downloaded via the GUI the placeholders are
# substituted with real values.  If an operator runs install.ps1
# without the substitutions (e.g. from a checked-in copy), require
# them to pass -PkgRepoUrl and -Server explicitly.
if ($PkgRepoUrl  -like '*__OPENVOX_PKG_REPO_URL__*')  { throw "PkgRepoUrl is unset.  Pass -PkgRepoUrl https://<server>:8140/packages or download install.ps1 via the openvox-gui." }
if ($Server      -like '*__OPENVOX_PUPPET_SERVER__*') { throw "Server is unset.  Pass -Server <puppetserver-fqdn>." }
if (-not $OpenVoxVersion -or $OpenVoxVersion -like '*__OPENVOX_DEFAULT_VERSION__*') { $OpenVoxVersion = '8' }

# ─── Constants ──────────────────────────────────────────────────────────────
$puppet_conf_dir = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'PuppetLabs\puppet\etc'
$date_time_stamp = (Get-Date -Format s) -replace ':', '-'
$install_log     = Join-Path ([System.IO.Path]::GetTempPath()) "$date_time_stamp-openvox-install.log"

if ($InstallDir) {
    $puppet_bin_dir = Join-Path $InstallDir 'bin'
} else {
    $puppet_bin_dir = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Puppet Labs\Puppet\bin'
}

# Pick the right MSI based on OS architecture.
$arch     = 'x64'
$msi_name = "openvox-agent-${arch}.msi"
if ((Get-WmiObject Win32_OperatingSystem).OSArchitecture -match '^32') {
    $arch     = 'x86'
    $msi_name = "openvox-agent-${arch}.msi"
}

# Mirror paths produced by sync-openvox-repo.sh:
#   /packages/windows/openvox-agent-x64.msi
$msi_source = "${PkgRepoUrl}/windows/${msi_name}"
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
    # ManagePuppetService call below).
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
