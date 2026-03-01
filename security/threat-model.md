# Threat Model: Multi-Agent Pipeline (Phase 6)
## Scope: Distributed Scaling & Advanced Orchestration
## Date: 2026-03-01

---

## 1. Overview
The AI Agent Pipeline has evolved from a single-machine script to a distributed cluster coordinating via a shared SQLite backend. This expansion introduces new attack surfaces where the compromise of a single worker node or an adversarial prompt could propagate across the entire workstream.

## 2. Key Attack Surfaces

### 2.1 Prompt Injection Propagation
- **Threat:** Malicious instructions in a research report or task definition.
- **Impact:** An agent in EXECUTE mode could be "brainwashed" to ignore constraints, exfiltrate data via the GitHub MCP, or corrupt the shared database.
- **Mitigation:** Strict system prompt isolation, mandatory "Security Notice" injection, and Red Team review of all worker outputs.

### 2.2 Tool Permission Escalation (Confused Deputy)
- **Threat:** An agent with `bash` access uses it to modify its own `approved_digest` or RBAC configuration.
- **Impact:** Permanent bypass of all security controls.
- **Mitigation:** Read-only config files for agent users, containerized sandboxing (where possible), and kernel-level filesystem restrictions.

### 2.3 Shared Database Corruption
- **Threat:** A compromised process writes malicious state to `pipeline.db`.
- **Impact:** Disrupts the Registry, DLQ, or Task state for all other nodes.
- **Mitigation:** Application-level schema validation and mandatory HMAC signatures for critical state entries (e.g. Audit Log).

### 2.4 Supply Chain Injection (MCP)
- **Threat:** A community MCP server is updated with a backdoor.
- **Impact:** Full compromise of any node executing the tool.
- **Mitigation:** **Pinned MCP Digests (T37 - SECURED)** — mandatory SHA-256 verification before execution.

## 3. Trust Boundaries

| Boundary | Logic | Security Level |
|----------|-------|----------------|
| **User ↔ Gateway** | Ingress channels (Discord/Telegram) | MEDIUM (Token-based) |
| **Orchestrator ↔ Shared DB** | SQLite File Permissions | HIGH (OS-level) |
| **Agent ↔ MCP Tools** | Digest Pins + RBAC Matrix | CRITICAL (Integrity-checked) |
| **Worker ↔ Worker** | Shared State (Backflow Detection) | HIGH (Cryptographic hashes) |

## 4. Remediation Roadmap

1. **RBAC Enforcement (T39):** Transition from a "suggested" access matrix to hard enforcement in the executor layer.
2. **HITL Gates (T40):** Block all irreversible actions (git push, data deletion) until a human provides a cryptographic signature via Discord.
3. **Audit Hardening:** Implement HMAC-SHA256 logging for all database writes to detect tampering.
