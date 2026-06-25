"""
Input validation and sanitization utilities.
"""
import re
import html
from typing import Any, List, Optional
from pydantic import GetCoreSchemaHandler
from pydantic_core import CoreSchema
import yaml
import json


class SafeString(str):
    """A string that has been sanitized for safe display.

    This is a Pydantic v2 custom type (using __get_pydantic_core_schema__).
    It HTML-escapes content and strips null bytes to mitigate XSS and
    certain injection risks when user-controlled strings (e.g. from Bolt
    output, node names in logs, or form input) are later rendered in the UI
    or logs.

    Migration note (pydantic update): Previously used the v1 __get_validators__
    + @validator pattern. Updated as part of the pydantic / pydantic-settings
    security and operational refresh (PR #37 + related work) to use the v2
    CoreSchema mechanism. See SECURITY.md and CHANGELOG for context on the
    pydantic-settings 2.14.2 patch (GHSA-4xgf-cpjx-pc3j) and broader ecosystem
    maintenance. No behavior change for callers.
    """

    @classmethod
    def __get_pydantic_core_schema__(
        cls, source_type: Any, handler: GetCoreSchemaHandler
    ) -> CoreSchema:
        from pydantic_core import core_schema

        return core_schema.no_info_after_validator_function(
            cls.validate,
            core_schema.str_schema(),
        )

    @classmethod
    def validate(cls, v: str) -> "SafeString":
        if not isinstance(v, str):
            raise TypeError("string required")
        # Remove any HTML/script tags (defense against XSS when rendered)
        v = html.escape(v)
        # Remove any null bytes (defense against certain null-byte injection)
        v = v.replace("\x00", "")
        return cls(v)


def sanitize_filename(filename: str) -> str:
    """
    Sanitize a filename to prevent directory traversal attacks.
    """
    # Remove any path components
    filename = filename.replace('../', '').replace('..\\', '')
    filename = filename.split('/')[-1].split('\\')[-1]
    
    # Remove dangerous characters
    filename = re.sub(r'[^a-zA-Z0-9._-]', '_', filename)
    
    # Limit length
    if len(filename) > 255:
        name, ext = filename.rsplit('.', 1) if '.' in filename else (filename, '')
        filename = name[:250] + ('.' + ext if ext else '')
    
    return filename


def validate_node_name(name: str) -> str:
    """
    Validate a Puppet node name (FQDN).
    """
    # Puppet node names should be valid FQDNs
    pattern = r'^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$'
    if not re.match(pattern, name):
        raise ValueError(f"Invalid node name: {name}")
    
    # Additional length check
    if len(name) > 253:
        raise ValueError(f"Node name too long: {name}")
    
    return name.lower()


def validate_environment_name(name: str) -> str:
    """
    Validate a Puppet environment name.
    """
    # Environment names should contain only alphanumeric and underscore
    pattern = r'^[a-zA-Z][a-zA-Z0-9_]*$'
    if not re.match(pattern, name):
        raise ValueError(f"Invalid environment name: {name}")
    
    if len(name) > 50:
        raise ValueError(f"Environment name too long: {name}")
    
    return name


def validate_class_name(name: str) -> str:
    """
    Validate a Puppet class name.
    """
    # Class names can have :: for namespacing
    pattern = r'^[a-zA-Z][a-zA-Z0-9_]*(::[a-zA-Z][a-zA-Z0-9_]*)*$'
    if not re.match(pattern, name):
        raise ValueError(f"Invalid class name: {name}")
    
    if len(name) > 100:
        raise ValueError(f"Class name too long: {name}")
    
    return name


def validate_yaml_content(content: str) -> dict:
    """
    Validate YAML content and return parsed data.
    """
    try:
        # Use safe_load to prevent arbitrary code execution
        data = yaml.safe_load(content)
        
        # Ensure it's a dictionary
        if not isinstance(data, dict):
            raise ValueError("YAML must contain a dictionary at the root level")
        
        return data
    except yaml.YAMLError as e:
        raise ValueError(f"Invalid YAML: {e}")


def validate_json_content(content: str) -> dict:
    """
    Validate JSON content and return parsed data.
    """
    try:
        data = json.loads(content)
        
        # Ensure it's a dictionary
        if not isinstance(data, dict):
            raise ValueError("JSON must contain an object at the root level")
        
        return data
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON: {e}")


def validate_pql_query(query: str) -> str:
    """
    Validate a PQL (Puppet Query Language) query.
    """
    # Basic length check
    if len(query) > 5000:
        raise ValueError("Query too long")
    
    # Check for common SQL injection patterns (even though PQL is not SQL)
    dangerous_patterns = [
        r';\s*(DROP|DELETE|INSERT|UPDATE|CREATE|ALTER|EXEC|EXECUTE)',
        r'--\s*$',  # SQL comments
        r'/\*.*\*/',  # C-style comments
    ]
    
    for pattern in dangerous_patterns:
        if re.search(pattern, query, re.IGNORECASE):
            raise ValueError("Query contains potentially dangerous patterns")
    
    return query


# ─── PQL interpolation values (srdevarch1 HP2) ─────────────────
# Single source for certname/status/env/package fragments embedded in PQL.
# Previously duplicated in routers/nodes.py, reports.py, performance.py.

SAFE_PQL_VALUE = re.compile(r"^[a-zA-Z0-9._-]+$")


def validate_pql_value(value: str, field_name: str = "value") -> str:
    """
    Validate a single token safe to interpolate into PuppetDB PQL.

    Rejects anything outside [A-Za-z0-9._-] so operators cannot inject
    PQL operators or quotes via path/query parameters.
    """
    if value is None:
        raise ValueError(f"Invalid {field_name}: empty")
    value = str(value).strip()
    if not value:
        raise ValueError(f"Invalid {field_name}: empty")
    if not SAFE_PQL_VALUE.match(value):
        raise ValueError(
            f"Invalid {field_name}: must match {SAFE_PQL_VALUE.pattern}"
        )
    return value


def validate_certname(certname: str) -> str:
    """Validate a Puppet certname for CA ops and PQL (alias of node name + PQL-safe)."""
    # Prefer FQDN-style node validation; fall back message aligns with CA routes.
    try:
        return validate_node_name(certname)
    except ValueError:
        # Some labs use short names; still enforce PQL-safe charset
        return validate_pql_value(certname, "certname")


def validate_package_name(name: str) -> str:
    """Package name fragment for inventory / PQL queries."""
    return validate_pql_value(name, "package name")


# Back-compat aliases used during migration from private router helpers
_SAFE_PQL_VALUE = SAFE_PQL_VALUE
_validate_pql_value = validate_pql_value


def validate_command(command: str, allowed_commands: Optional[List[str]] = None) -> str:
    """
    Validate a shell command for Bolt execution (denylist + optional allowlist).

    This is a defense-in-depth choke point (srdev1 S5), not a full shell parser.
    Operators still run arbitrary commands on targets by design; we block the
    most destructive / obviously hostile patterns and length abuse.
    """
    if command is None or not isinstance(command, str):
        raise ValueError("Command must be a non-empty string")
    command = command.strip()
    if not command:
        raise ValueError("Command must be a non-empty string")

    # Limit command length (slightly higher than legacy 1000 for real ops cmds)
    if len(command) > 2000:
        raise ValueError("Command too long")

    # Null bytes / control chars (except tab/newline which we reject entirely)
    if "\x00" in command or any(ord(c) < 32 and c not in "\t" for c in command):
        raise ValueError("Command contains invalid control characters")

    # If allowed commands list is provided, check first token (best-effort)
    if allowed_commands:
        try:
            import shlex
            cmd_parts = shlex.split(command, posix=True)
        except ValueError:
            cmd_parts = command.split()
        if cmd_parts and cmd_parts[0] not in allowed_commands:
            raise ValueError(f"Command not allowed: {cmd_parts[0]}")

    # Dangerous shell patterns (case-insensitive where useful)
    dangerous_patterns = [
        # Destructive rm (with or without leading separators)
        r'(^|[;&|]\s*)rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force\b)',
        r'(^|[;&|]\s*)rm\s+-rf\b',
        r'(^|[;&|]\s*)rm\s+-fr\b',
        r'\bsudo\s+rm\s+-r?f\b',
        r'>\s*/dev/sd',  # Writing to block devices
        r'>\s*/dev/nvme',
        r'\bmkfs(\.|$)',  # Filesystem formatting
        r'\bdd\s+if=',  # Dangerous dd usage
        r':\s*\(\s*\)\s*\{',  # Fork bomb
        r'\$\(',  # Command substitution $(...)
        r'\$\{',  # Parameter expansion often used in evasion
        r'`',  # Backticks
        r'\beval\b',
        r'\bbase64\b.*\|\s*(ba)?sh\b',
        r'\bpython[23]?\s+-c\b',
        r'\bperl\s+-e\b',
        r'\bruby\s+-e\b',
        r'&&\s*curl\b',
        r'&&\s*wget\b',
        r'(^|[;&|]\s*)(curl|wget)\b.*\|\s*(ba)?sh\b',
        r'\|\s*(ba)?sh\b',
        r'\|.*\bnc\s',  # Netcat pipes
        r'\|.*\bncat\b',
        r'\bchmod\s+(-R\s+)?777\b',
        r'\bchown\s+(-R\s+)?root\b.*/',
        r'\bshutdown\b',
        r'\breboot\b',
        r'\binit\s+0\b',
        r'\bmkfs\.',
        r'\bwipefs\b',
        r'\buserdel\b',
        r'(^|[;&|]\s*)passwd\b',
        r'>\s*/etc/(passwd|shadow|sudoers)',
        r'\biptables\s+-F\b',
        r'\bnft\s+flush\b',
    ]

    for pattern in dangerous_patterns:
        if re.search(pattern, command, re.IGNORECASE):
            raise ValueError("Command contains potentially dangerous patterns")

    return command


def validate_port(port: Any) -> int:
    """
    Validate a network port number.
    """
    try:
        port_num = int(port)
        if not 1 <= port_num <= 65535:
            raise ValueError(f"Port must be between 1 and 65535")
        return port_num
    except (TypeError, ValueError):
        raise ValueError(f"Invalid port: {port}")


def validate_ip_address(ip: str) -> str:
    """
    Validate an IP address (v4 or v6).
    """
    import ipaddress
    try:
        ipaddress.ip_address(ip)
        return ip
    except ValueError:
        raise ValueError(f"Invalid IP address: {ip}")


def validate_url(url: str) -> str:
    """
    Validate a URL.
    """
    from urllib.parse import urlparse
    
    try:
        result = urlparse(url)
        if not all([result.scheme, result.netloc]):
            raise ValueError("Invalid URL format")
        
        # Check for allowed schemes
        allowed_schemes = ['http', 'https']
        if result.scheme not in allowed_schemes:
            raise ValueError(f"URL scheme must be one of: {allowed_schemes}")
        
        return url
    except Exception as e:
        raise ValueError(f"Invalid URL: {e}")


def strip_ansi(text: str) -> str:
    """
    Strip ANSI escape codes from text (for safe display of command output, logs, etc.).
    This mitigates risks from terminal escape injection / ANSI smuggling attacks
    when rendering untrusted output (e.g., from Bolt commands on remote nodes).
    Uses a standard regex for CSI/OSC/etc. sequences.
    See: dgl.cx ANSI terminal security research, Doyensec ansi_up advisory.
    """
    import re
    ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
    return ansi_escape.sub('', text)