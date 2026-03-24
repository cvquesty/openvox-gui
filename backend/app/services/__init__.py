"""
Services Package

This package contains business logic and external service client implementations.
Services encapsulate interactions with external systems (PuppetDB, PuppetServer)
and implement complex business logic (hierarchical ENC resolution).

**Service Classes:**
- PuppetDBService - Async HTTP client for PuppetDB REST API
  - Query facts, reports, nodes, resources
  - Execute PQL queries
  - Connection pooling and error handling
  
- PuppetServerService - Client for PuppetServer CA operations
  - Certificate signing, revocation, cleanup
  - CA info retrieval via puppetserver ca CLI
  - SSL certificate management

- HierarchicalENCService - External Node Classifier implementation
  - Hierarchical classification (Common → Environment → Group → Node)
  - Deep merge resolution for node classification
  - ENC endpoint for Puppet agent requests

**Design Principles:**
- Services are stateless singletons (instantiated once, reused)
- All external calls are async to avoid blocking the event loop
- Connection pooling is used for HTTP clients
- Errors are logged with context for debugging
"""

from .puppetdb import PuppetDBService
from .puppetserver import PuppetServerService
from .enc import HierarchicalENCService as ENCService
