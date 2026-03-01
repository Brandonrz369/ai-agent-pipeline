# pipeline-context MCP Server -- Test Suite

Tests for the `pipeline-context` MCP server, which provides AI agents with
read-only access to pipeline worker reports via the Model Context Protocol.

## Parent Module Architecture

```
src/mcp-servers/pipeline-context/
|-- index.ts     # Data layer -- report listing, search, and retrieval
|-- server.ts    # MCP server -- tool registration and request routing
+-- __tests__/
    +-- README.md
```

### `index.ts` -- Data Layer

Exports three async functions that operate on the `reports/` directory:

| Function | Purpose |
|---|---|
| `listReports()` | Returns filenames of all `.md` and `.json` reports |
| `searchReports(query)` | Case-insensitive keyword search; returns matching `ReportEntry[]` sorted descending |
| `getReport(id)` | Full content of a single report; returns `ReportEntry` or `null` |

Key type:

```ts
interface ReportEntry {
  id: string;
  type: 'markdown' | 'json';
  path: string;
  content: string;
  timestamp: string;
}
```

### `server.ts` -- MCP Server

Registers three MCP tools over stdio transport using `@modelcontextprotocol/sdk`:

| MCP Tool | Maps To | Input |
|---|---|---|
| `list_reports` | `listReports()` | (none) |
| `search_reports` | `searchReports(query)` | `{ query: string }` |
| `get_report_details` | `getReport(id)` | `{ id: string }` |

All responses are returned as text content blocks (JSON-serialized for list/search).

## Test Strategy

Tests should follow the patterns from
`src/mcp-servers/brain-context/__tests__/brain-context.test.ts`:

- **Framework:** Vitest (`describe` / `it` / `expect`)
- **Mocking:** `vi.mock('node:fs/promises')` for filesystem isolation
- **Scope:** Unit tests for data layer; integration tests for MCP dispatch

### Recommended Coverage

#### Data layer (`index.ts`)

- `listReports` -- returns filtered file list; handles empty dir; handles readdir errors
- `searchReports` -- matches case-insensitively; truncates to 5 KB; returns empty on no match
- `getReport` -- returns full ReportEntry; returns null on missing file

#### Server layer (`server.ts`)

- ListToolsRequestSchema handler returns all three tool definitions
- CallToolRequestSchema routes to correct function per tool name
- Unknown tool name returns isError: true
- get_report_details with missing report returns isError: true

## Running Tests

```bash
npx vitest run src/mcp-servers/pipeline-context/__tests__/
```
