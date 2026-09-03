# AGMCP

USDA Agriculture Plant Hardiness Zone MCP server.

AGMCP is a [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes USDA Plant Hardiness Zone lookups to MCP-compatible clients (Claude
Desktop, Cursor, etc.). Zone data comes from the free
[phzmapi.org](https://phzmapi.org) service, keyed by US ZIP code.

## Tools

| Tool | Description |
| --- | --- |
| `get_hardiness_zone` | Look up the USDA hardiness zone for a single 5-digit ZIP code. |
| `compare_hardiness_zones` | Look up and compare zones for multiple ZIP codes at once. |

Each result includes the zone (e.g. `10b`), the average annual extreme minimum
temperature range in °F, and the ZIP centroid coordinates.

## Requirements

- Node.js >= 18 (developed against Node 22)

## Setup

```bash
npm ci
npm run build
```

## Run

The server speaks MCP over stdio:

```bash
npm start
# or, after building:
node build/index.js
```

## Develop

```bash
npm run dev        # tsc --watch
npm run typecheck  # type-check without emitting
npm test           # build first, then run the smoke tests
```

## MCP client config

Add to your MCP client (e.g. Cursor `mcp.json` / Claude Desktop config):

```json
{
  "mcpServers": {
    "agmcp": {
      "command": "node",
      "args": ["/absolute/path/to/AGMCP/build/index.js"]
    }
  }
}
```

## Cloud Agent environment

`.cursor/environment.json` runs `npm ci && npm run build` on setup, producing the
runnable server at `build/index.js`.

## License

MIT
