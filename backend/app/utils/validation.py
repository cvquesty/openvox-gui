"""
Input validation and sanitization utilities.
"""
import re
import html
from typing import Any, List, Optional
from pydantic import BaseModel, Field, validator
import yaml
import json


class SafeString(str):
    """A string that has been sanitized for safe display."""
    
    @classmethod
    def __get_validators__(cls):
        yield cls.validate
    
    @classmethod
    def validate(cls, v):
        if not isinstance(v, str):
            raise TypeError('string required')
        # Remove any HTML/script tags
        v = html.escape(v)
        # Remove any null bytes
        v = v.replace('\x00', '')
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


def validate_command(command: str, allowed_commands: Optional[List[str]] = None) -> str:
    """
    Validate a shell command for Bolt execution.
    """
    # If allowed commands list is provided, check against it
    if allowed_commands:
        cmd_parts = command.split()
        if cmd_parts and cmd_parts[0] not in allowed_commands:
            raise ValueError(f"Command not allowed: {cmd_parts[0]}")
    
    # Check for dangerous shell patterns
    dangerous_patterns = [
        r';\s*rm\s+-rf',  # Dangerous rm commands
        r'>\s*/dev/s',  # Writing to devices
        r'mkfs',  # Filesystem formatting
        r'dd\s+if=',  # Dangerous dd usage
        r':()\s*{',  # Fork bomb
        r'\$\(',  # Command substitution
        r'`',  # Backticks
        r'&&\s*curl',  # Chained curl commands
        r'&&\s*wget',  # Chained wget commands
        r'|.*nc\s',  # Netcat pipes
    ]
    
    for pattern in dangerous_patterns:
        if re.search(pattern, command, re.IGNORECASE):
            raise ValueError("Command contains potentially dangerous patterns")
    
    # Limit command length
    if len(command) > 1000:
        raise ValueError("Command too long")
    
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