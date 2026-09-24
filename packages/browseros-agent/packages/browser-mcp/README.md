# @browseros/browser-mcp

BrowserOS MCP (Model Context Protocol) server and tool definitions for browser automation.

## Tools

- **Core**: `tabs`, `tab_groups`, `history`, `navigate`, `snapshot`, `diff`
- **Actions**: `semantic_action`, `act`, `download`, `upload`, `read`, `grep`, `screenshot`, `pdf`, `wait`, `windows`, `evaluate`, `run`
- **Navigation**: `navigate`, `navigate-macros`

## Quick Start

```bash
cd packages/browseros-agent
bun run start:server
```

The MCP server runs on `http://127.0.0.1:9105/mcp` by default.

## Semantic Action Tool

See [semantic-action.md](./docs/semantic-action.md) for full documentation on the `semantic_action` tool, which uses the local Laya browser checkpoint to rank browser operations and targets.

### Quick Example

```bash
# Get page ID
mcp call tabs '{ "action": "list" }'

# Choose and execute semantic actions until the goal completes
mcp call semantic_action '{
  "page": 1,
  "goal": "Click the login button"
}'

# Or return one advisory decision without changing the page
mcp call semantic_action '{
  "page": 1,
  "goal": "Click the login button",
  "execute": false
}'
```

## Configuration

Create `config.dev.json` in `packages/browseros-agent/`:

```json
{
  "ports": { "server": 9105, "cdp": 9005 },
  "directories": { "resources": "./resources", "execution": "./out" },
  "flags": { "allow_remote_in_mcp": false }
}
```

### Laya Configuration (Optional)

```bash
export BROWSEROS_LAYA_PYTHON="$HOME/Development/v_env/bin/python"
export BROWSEROS_LAYA_DEVICE="mps" # optional
```

## Testing

```bash
# All tests
bun run test

# Semantic action unit tests
bun test packages/browser-mcp/src/tools/semantic-action.test.ts
bun test packages/browser-mcp/src/tools/laya-client.test.ts

# Integration tests (harness starts BrowserOS and server; requires Laya runtime)
BROWSEROS_LAYA_PYTHON=... bun test apps/server/tests/semantic-action.integration.test.ts
```

## Development

```bash
# Type checking
bun run typecheck

# Linting
bunx @biomejs/biome check packages/browser-mcp/src/tools/

# Format
bunx @biomejs/biome check --write packages/browser-mcp/src/tools/
```