# AGMCP — USDA Hardiness Zones for people and agents

**Live:** [https://agmcp.shogun-0a9.workers.dev](https://agmcp.shogun-0a9.workers.dev) · try `/?zip=80301`, [`/api/v1/zone/97330`](https://agmcp.shogun-0a9.workers.dev/api/v1/zone/97330), [`/llms.txt`](https://agmcp.shogun-0a9.workers.dev/llms.txt)

The 2023 USDA Plant Hardiness Zone Map for every US ZIP code (50 states, DC, Puerto Rico), turned into a primitive that agents can use directly:

- **A website for humans**: look up a ZIP, see the zone, browse 50+ vegetables/herbs/peppers/fruit rated for that zone, and build a garden plan.
- **18 WebMCP tools for agents** registered on the same page via `document.modelContext.registerTool()`, so an agent in the ChatGPT desktop browser (or Chrome with WebMCP) can look up zones, compare locations, filter plants, and add to the garden plan the human is looking at.
- **A plain JSON API** (`/api/v1/*`, OpenAPI, `llms.txt`) so backend agents and other apps can compose hardiness zones with weather, sun-position, or planting tools.

Built for the [WebMCP Challenge](https://webmcp.devpost.com). Vanilla TypeScript + Vite, deployed as a Cloudflare Worker with static assets. No API keys, no secrets, no tracking.

## Why WebMCP fits

Hardiness zones are the first question in every gardening conversation, and today agents answer it from memory (often wrong, and always without the map). Putting the authoritative dataset *on the page* means:

- The agent gets exact answers (`lookup_hardiness_zone`, `compare_locations`, `find_zone_by_coordinates`) instead of guessing.
- The human sees what the agent is doing. `set_location` updates the zone card and URL; `add_to_garden_plan` puts plants in a list the human can edit; every call streams into the **Agent activity** panel.
- Shared state goes both ways. The human picks a ZIP or adds a plant; the agent calls `get_current_context` and reasons about the same plan.
- Consequential actions stay human-in-the-loop. `clear_garden_plan` opens a native `<dialog>` and fails if the user cancels; `use_my_location` needs the browser's geolocation permission.
- It composes. Coordinates in, zones out; zones in, plant fit and planting dates out. Pair it with a weather or sun tool and you have the start of a garden planner.

## Tools

| Tool | Kind | What it does |
| --- | --- | --- |
| `lookup_hardiness_zone` | read | Zone, temp band (°F/°C), estimated frost windows for a ZIP |
| `get_zone_details` | read | Zone facts, neighbors, ZIP count and share, sample ZIPs, map color |
| `compare_locations` | read | 2–10 ZIPs: zones, warmest/coldest, half-zone and °F deltas |
| `find_zips_in_zone` | read | ZIPs in a zone, optional prefix filter |
| `find_zone_by_coordinates` | read | Nearest ZIPs and zones to a lat/lon |
| `get_zip_coordinates` | read | Census ZCTA centroid for a ZIP (for chaining into weather tools) |
| `list_plants` | read | Plants rated `great` / `stretch` / `not-recommended` for a zone |
| `get_plant_details` | read | Full growing profile + fit for the current zone |
| `get_planting_calendar` | read | Start-indoors / transplant / sow / harvest dates from the zone's typical last frost |
| `get_current_context` | read | What the human sees: ZIP, zone, filters, garden plan |
| `export_garden_plan` | read | Markdown (with dates) or JSON |
| `set_location` | write | Sets the page's ZIP; updates card, scale, plant ratings, URL |
| `use_my_location` | write | Browser geolocation prompt → nearest ZIP (human-in-the-loop) |
| `filter_plants` | write | Sets category/search so the human sees the same list |
| `add_to_garden_plan` | write | Adds a plant (returns its fit so the agent can warn) |
| `update_garden_plan_item` | write | Change quantity/notes |
| `remove_from_garden_plan` | write | Remove a plant |
| `clear_garden_plan` | write | Destructive; requires the user to confirm a dialog |

Plus a declarative tool: the ZIP search `<form toolname="search_zip_form" toolautosubmit>` answers with `respondWith()` in Chrome.

## How WebMCP is implemented

- [`src/webmcp.ts`](src/webmcp.ts): tool definitions with JSON Schema inputs, `readOnlyHint` annotations, and a `wrap()` that logs every call to the Agent activity panel and converts app errors into MCP-style `{ isError: true }` results instead of throwing.
- [`src/app.ts`](src/app.ts): the actions both the UI and the tools call. Nothing is agent-only; tools reuse the same code paths as buttons.
- [`src/store.ts`](src/store.ts): tiny pub/sub state (location, plan, activity) persisted to `localStorage`; the UI rerenders inside `document.startViewTransition`.
- Feature detection: `document.modelContext ?? navigator.modelContext` (Chrome < 150 shipped it on `navigator`). Without WebMCP the page shows a banner and works normally.
- Deep links: `/?zip=97330`.

## API

```
GET /api/v1/zone/{zip}                      # zone summary for a ZIP
GET /api/v1/zone?zips=97330,80301           # batch (≤50)
GET /api/v1/compare?zips=97330,80301        # 2–10 ZIPs
GET /api/v1/zones                           # all 26 half-zones with ZIP counts
GET /api/v1/zones/{zone}?prefix=972&limit=25
GET /api/v1/nearest?lat=44.56&lon=-123.26
GET /api/v1/plants?zone=7b&category=pepper  # &q=..., &all=1 to include not-recommended
GET /api/v1/plants/{slug}?zone=7b
GET /api/v1/calendar?zone=7b&plants=tomato,jalapeno
GET /api/v1/openapi.json
GET /llms.txt
```

CORS is open; responses are cacheable.

## Run it

```bash
npm install
npm run data      # builds src/generated + public/data from data/raw
npm run dev       # Vite dev server (site only, no /api)
npm run build     # typecheck + vite build
npm run preview   # wrangler dev: site + API at http://localhost:8787
```

### Deploy to Cloudflare

The live site is deployed with [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/): every push to `main` runs `npm run build` then `npx wrangler deploy`. To deploy your own copy manually:

```bash
npx wrangler login
npm run deploy    # build + wrangler deploy
```

No secrets are needed. `wrangler.jsonc` serves `dist/` as static assets with the Worker handling `/api/*` and `/llms.txt`.

### Test the WebMCP tools

- **ChatGPT desktop app**: open [https://agmcp.shogun-0a9.workers.dev](https://agmcp.shogun-0a9.workers.dev) in the built-in browser and ask ChatGPT Work or Codex, e.g. *"What zone is 80301? Plan a salsa garden for it."* Click **Site tools** in the address bar to inspect the tools.
- **Chrome**: enable `chrome://flags/#enable-webmcp-testing`, reload, then in DevTools:

```js
await navigator.modelContextTesting.listTools();
await navigator.modelContextTesting.executeTool("set_location", JSON.stringify({ zip: "97330" }));
await navigator.modelContextTesting.executeTool("list_plants", JSON.stringify({ category: "pepper" }));
```

Or install Chrome's [Model Context Tool Inspector](https://developer.chrome.com/docs/ai/webmcp) extension and chat with the page.

## Project layout

```
data/raw/            PRISM 2023 ZIP→zone CSVs (US, AK, HI, PR) + Census ZCTA centroids
scripts/build-data.mjs  → src/generated/zones.json (1 char per ZIP, ~100 KB) and public/data/zip-geo.json
shared/              zone-meta.ts, zones.ts, plants.ts — pure logic shared by site and Worker
src/                 main.ts, app.ts, store.ts, ui.ts, webmcp.ts, style.css, data/plants.json
worker/index.ts      Cloudflare Worker: JSON API, OpenAPI, llms.txt, asset fallback
public/_headers      Origin-Agent-Cluster: ?1 and security headers
```

## Data and attribution

- Zones: [USDA Agricultural Research Service Plant Hardiness Zone Map (2023)](https://planthardiness.ars.usda.gov/), ZIP-code listing prepared by the [PRISM Group, Oregon State University](https://prism.oregonstate.edu/phzm/).
- ZIP centroids: [US Census Bureau 2024 ZCTA Gazetteer](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html) (public domain).
- Plant zone ranges, days to maturity, and frost windows in `src/data/plants.json` and `shared/zone-meta.ts` are curated horticultural rules of thumb, not USDA data. Treat dates as estimates.

Not every ZIP is in the PRISM dataset (PO-box-only and very new ZIPs are missing); the tools say so and suggest a neighbor.

## License

MIT. See [LICENSE](LICENSE).
