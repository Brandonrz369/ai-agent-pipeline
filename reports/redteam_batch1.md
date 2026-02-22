# RED TEAM REVIEW -- BATCH 1
## Reviewer: Node 5 (Adversarial)
## Timestamp: 2026-02-22

## VERDICT: CONDITIONAL

## SUMMARY
Batch 1 outputs are substantive and well-structured. The six phase docs, three schemas, two templates, four workflow JSONs, and three security docs form a coherent, usable implementation guide that accurately reflects the ARCHITECTURE.md source. However, there are field-name mismatches between the report schema and the architecture's stated report fields, a missing workflow (E: HITL Gate), and several minor cross-reference inconsistencies that should be corrected before publication.

---

## CRITICAL ISSUES (blocks release)

None.

---

## MAJOR ISSUES (must fix)

1. **Report schema field names do not match ARCHITECTURE.md required_fields.** ARCHITECTURE.md (line 134) specifies `required_fields: ["status", "files_changed", "tests_added", "issues_found"]` in the task blueprint output block. The actual `schemas/report.schema.json` uses `changes_made` (not `files_changed`), `new_issues` (not `issues_found`), and has no `tests_added` field at all. These naming discrepancies mean that a report validated against the schema will not satisfy the field names the architecture document promises. Either the schema field names should be aligned with the architecture, or the architecture's example should be updated. Since the schema is the machine-authoritative artifact, the recommended fix is to update the ARCHITECTURE.md example to match the schema or add aliases.

2. **ARCHITECTURE.md task blueprint example includes `narrative_check` and `cross_stream_alerts` in `constraints` and `output` respectively, but `schemas/task-blueprint.schema.json` does not define these fields.** The `narrative_check: false` field appears in the ARCHITECTURE.md example (line 141) under `constraints`, and `cross_stream_alerts: []` appears under `output` (line 135), but neither exists in the actual schema. This means the canonical example in ARCHITECTURE.md would technically pass validation (JSON Schema allows additional properties by default), but it sets a misleading expectation. Fix: either add these fields to the schema or remove them from the ARCHITECTURE.md example.

3. **Workflow E (HITL Gate) is specified in ARCHITECTURE.md Section 3.1 but was not produced.** ARCHITECTURE.md describes five workflows (A through E). Only four were created. The N5 worker report acknowledges this and recommends a follow-up batch, which is reasonable, but the README repo structure (line 77-80) lists only four workflow files so there is no mismatch there. However, `docs/phase3-n8n-orchestration.md` documents Workflow E in full detail (Section "Workflow E: HITL Gate"), implying it exists as an implemented workflow. A reader following the docs would expect to find a corresponding JSON file. Fix: either create the workflow in a follow-up batch (with a note in the docs that it is pending), or add a clear "Not Yet Implemented" marker in the docs.

4. **`docs/phase6-security.md` adds `deploy/` to the HITL `file_destinations` list, which is not in ARCHITECTURE.md.** ARCHITECTURE.md (line 532) defines `file_destinations: ["external/", "outbox/"]`. The phase6 doc (line 227) expands this to `["external/", "outbox/", "deploy/"]`. While `deploy/` is a sensible addition, this is an undocumented deviation from the source architecture. The `security/hitl-gates.md` does not use `file_destinations` at all -- it uses individual HITL gate entries (HITL-006, HITL-007) instead. Fix: reconcile all three locations (ARCHITECTURE.md, docs/phase6-security.md, security/hitl-gates.md) to use a consistent definition.

5. **Worker report format in `templates/worker-prompt.md` uses `### CHANGES MADE` with `- [file]: [description]` syntax, but N8n workflows parse with inconsistent regex patterns.** The delegation chain workflow (`n8n-delegation-chain.json`) parses `### CHANGES MADE` looking for `- [filename]: description` entries with a regex `- \[?([^\]\n]+?)\]?:?\s`. The audit trail workflow (`n8n-audit-trail.json`) uses a similar but slightly different regex `^\s*-\s*\[?([^\]:\n]+?)\]?\s*:`. Meanwhile, actual Node 1 report format uses backtick-wrapped paths (`- \`docs/phase1-deep-research.md\``), and Node 5 report uses bracket-wrapped paths (`- [workflows/n8n-fanout-fanin.json]:`). These format variations will cause parsing failures in the N8n workflows. Fix: standardize the report format for the CHANGES MADE section and ensure all workers follow it exactly, or make the parsers more resilient.

---

## MINOR ISSUES (note for polish)

1. **`config/required-caches.yaml` referenced by `docs/phase3-n8n-orchestration.md` (Section "Workflow C: Cache Monitor") and the cache monitor workflow does not exist.** The directory `config/` does not exist at all. The cache monitor workflow hardcodes `['project-kb', 'project-deliverables']` as required cache names, which is functional but not configurable via the referenced YAML file.

2. **`scripts/rebuild-cache.sh` and `scripts/refresh-cache.sh` referenced by the cache monitor workflow (`n8n-cache-monitor.json`) do not exist.** The workflow gracefully handles this (logs a WARN), but these scripts should be created in a future batch.

3. **`security/approved-digests.yaml` referenced in both `security/threat-model.md` and `security/rbac-config.md` does not exist.** Acknowledged as a future deployment task by Node 4, but worth tracking.

4. **No `package.json` exists for schema validation.** ARCHITECTURE.md references `npx ajv validate` and Node 2's report flags this. The project has no Node.js initialization. This is a deployment concern, not a documentation issue.

5. **The README says `routing-config.schema.json` is for "Model routing configuration" but does not mention it defines `cost_limits`.** The schema adds budget guardrails (`daily_budget_usd`, `alert_threshold_percent`) that are not described in the README or ARCHITECTURE.md. This is a good addition but should be documented.

6. **ARCHITECTURE.md RBAC example uses `.yaml` extension (`rbac-config.yaml`) but the Batch 1 output is `security/rbac-config.md` (markdown).** The README repo structure also lists it as `rbac-config.md`. Similarly, ARCHITECTURE.md references `hitl-gates.yaml` but the file is `security/hitl-gates.md`. The markdown files contain embedded YAML blocks, which is reasonable for documentation, but the extension mismatch may confuse automated tooling expecting `.yaml` files.

7. **Delegation chain workflow regex expects report filenames matching `n{digit}_{taskname}_batch{digit}.md` but actual Batch 1 reports use the format `n1_docs_batch1.md`, `n2_schemas_batch1.md`.** These happen to match, but the naming convention is not formally documented. If a future report uses a different separator or word format, the delegation chain will skip it.

8. **Fan-out workflow uses `SplitInBatches` which is sequential in N8n, not truly parallel.** Node 5's report correctly flags this. For a pipeline that advertises "3-6x parallel throughput" (ARCHITECTURE.md Performance Benchmarks), the actual implementation is sequential dispatch via HTTP. This is a known limitation, not a documentation error.

9. **The `redteam-prompt.md` report output filename convention (`reports/n5_redteam_batch[BATCH NUMBER].md`) differs from the fan-out workflow's Red Team file convention (`reports/redteam_batch{N}.md`).** The redteam prompt uses `n5_` prefix; the fan-out workflow's generated JSON uses no `n5_` prefix. This mismatch means the delegation chain workflow (which watches for `n[2-5]_*` patterns) would catch the `n5_redteam_*` version but not the `redteam_batch*` version.

10. **`docs/phase4-model-routing.md` lists specific 2026 model pricing that will quickly become stale.** The prices listed (Opus at $15/$75, Sonnet at $3/$15, Haiku at $0.80/$4.00) are presented as facts. A note indicating these are approximate and subject to change would prevent them from becoming misleading.

11. **ARCHITECTURE.md routing logic example (Section 4.2) returns string values (`'tier1'`, `'tier2'`, `'tier3'`) while `docs/phase4-model-routing.md` returns integers (`1`, `2`, `3`).** The routing-config schema uses integers for tier values. The ARCHITECTURE.md example is inconsistent with both the docs and the schema.

---

## CROSS-REFERENCE ERRORS

| Source File | Reference | Expected Target | Actual Status |
|---|---|---|---|
| `docs/phase3-n8n-orchestration.md` | `config/required-caches.yaml` | Config file for cache names/TTLs | MISSING (directory does not exist) |
| `n8n-cache-monitor.json` | `scripts/rebuild-cache.sh` | Cache rebuild shell script | MISSING (directory does not exist) |
| `n8n-cache-monitor.json` | `scripts/refresh-cache.sh` | Cache refresh shell script | MISSING (directory does not exist) |
| `security/threat-model.md` | `security/approved-digests.yaml` | MCP server digest inventory | MISSING |
| `docs/phase3-n8n-orchestration.md` | Workflow E: HITL Gate | `workflows/n8n-hitl-gate.json` | MISSING (not created in Batch 1) |
| ARCHITECTURE.md line 134 | `required_fields: ["files_changed", "tests_added", "issues_found"]` | Matching fields in `report.schema.json` | MISMATCH (schema uses `changes_made`, `new_issues`, no `tests_added`) |
| ARCHITECTURE.md line 141 | `narrative_check: false` in constraints | Field in `task-blueprint.schema.json` | MISSING from schema |
| ARCHITECTURE.md line 135 | `cross_stream_alerts: []` in output | Field in `task-blueprint.schema.json` | MISSING from schema |
| ARCHITECTURE.md line 489-509 | RBAC as `rbac-config.yaml` | `security/rbac-config.yaml` | EXISTS as `security/rbac-config.md` (extension mismatch) |
| ARCHITECTURE.md line 523-540 | HITL as `hitl-gates.yaml` | `security/hitl-gates.yaml` | EXISTS as `security/hitl-gates.md` (extension mismatch) |
| `templates/redteam-prompt.md` | Output: `reports/n5_redteam_batch[N].md` | Consistent filename across system | CONFLICT (fan-out workflow writes `reports/redteam_batch{N}.md` without `n5_` prefix) |
| ARCHITECTURE.md Section 4.2 | `routeTask` returns `'tier1'`/`'tier2'`/`'tier3'` (strings) | Consistent with schema tier type | MISMATCH (schema and phase4 doc use integers `1`/`2`/`3`) |

---

## CROSS-STREAM CONFLICTS

1. **Node 1 (Docs) vs Node 5 (Workflows) -- Report filename convention.** `docs/phase3-n8n-orchestration.md` (produced by Node 1) documents Workflow B as watching `reports/` for `n[2-5]_*.md`. The actual `n8n-delegation-chain.json` (produced by Node 5) uses regex `^n(\d+)_(.+)_batch(\d+)\.md$` which is more specific and requires the `_batch{N}` suffix. These are compatible but not identical -- a report named `n2_schemas.md` (without `_batch1`) would match the docs description but fail the workflow regex.

2. **Node 1 (Docs) vs Node 4 (Security) -- HITL file_destinations.** `docs/phase6-security.md` lists `file_destinations: ["external/", "outbox/", "deploy/"]` while ARCHITECTURE.md lists only `["external/", "outbox/"]`. The `security/hitl-gates.md` (Node 4) does not use `file_destinations` at all, instead implementing these as individual gate entries (HITL-006 for external, HITL-007 for outbox). The three sources disagree on how file destination restrictions are expressed. Not contradictory per se, but the inconsistency could cause confusion about the authoritative source.

3. **Node 2 (Schemas) vs ARCHITECTURE.md -- Report field naming.** As documented in Major Issue 1, the report schema uses different field names than the architecture example. Any downstream tooling or documentation referencing `files_changed` will not find that field in a schema-compliant report.

---

## POSITIVE FINDINGS

1. **Outstanding documentation quality.** The six phase docs (Node 1) are thorough, well-organized, and contain practical implementation details that go beyond restating the architecture. The good-vs-bad task decomposition examples in phase2 are particularly valuable.

2. **Thoughtful schema design.** The report schema's conditional enforcement of `blocked_on` when status is BLOCKED (Node 2) is a smart addition not specified in the architecture but clearly needed. The routing-config schema's `cost_limits` and `$ref` definitions pattern shows good engineering.

3. **Production-ready N8n workflows.** All four workflow JSONs (Node 5) are valid, well-structured, use real N8n node types with correct `typeVersion` values, include graceful error handling (`continueOnFail`), and properly document all placeholder values needing replacement. The audit trail workflow's commit message formatting is particularly thorough.

4. **Comprehensive security documentation.** Node 4's threat model goes well beyond the six threats in ARCHITECTURE.md, adding four additional threat vectors (data exfiltration, privilege escalation, cache poisoning, DoS). The RBAC config includes four enforcement layers (Docker, MCP, system prompt, N8n) which is more granular than the architecture specified. The HITL gates doc expands from a few patterns to 12 named gates with individual timeout and escalation configurations.

5. **Excellent cross-stream awareness.** Every worker report includes relevant cross-stream alerts that identify dependencies between workstreams. Node 1 flagging missing files, Node 2 noting the shared regex pattern, Node 3 noting naming convention dependencies, Node 4 identifying enforcement gaps, and Node 5 documenting all placeholder values all demonstrate pipeline-aware thinking.

6. **The redteam-prompt.md closely matches the style of orchestrator-prompt.md and worker-prompt.md.** Same bracket-placeholder convention, same section structure (ROLE, SCOPE, MEMORY LAYER, PROTOCOL, REPORT FORMAT, SECURITY NOTICE, WHAT YOU NEVER DO), and appropriate additions for the adversarial role (severity classification, verdict rules, injection detection).

7. **The task-file.md template maps cleanly to task-blueprint.schema.json.** Every schema field has a corresponding template section, the JSON-to-markdown relationship is clearly documented, and the template correctly notes that the JSON is machine-authoritative.

---

## CONDITIONAL REQUIREMENTS

Before this batch should be considered complete, the following must be addressed:

- [ ] **Reconcile report schema field names with ARCHITECTURE.md** (Major Issue 1). Either update `report.schema.json` to use `files_changed`/`tests_added`/`issues_found`, or update ARCHITECTURE.md to match the schema's `changes_made`/`new_issues` naming.
- [ ] **Decide on `narrative_check` and `cross_stream_alerts`** (Major Issue 2). Add them to the task blueprint schema or remove them from the ARCHITECTURE.md example.
- [ ] **Add "Not Yet Implemented" note for Workflow E** (Major Issue 3). Annotate `docs/phase3-n8n-orchestration.md` to indicate Workflow E does not have a corresponding JSON file yet.
- [ ] **Reconcile HITL `file_destinations` across all three locations** (Major Issue 4).
- [ ] **Standardize the CHANGES MADE report format** (Major Issue 5). Define one canonical format (e.g., `- [filepath]: description` or `- \`filepath\` (detail): description`) and ensure worker reports and N8n parsers agree.
