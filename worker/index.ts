// Cloudflare Worker: serves the static site and a small JSON API so backend
// agents and other apps can use hardiness zones as a primitive.
import geo from "../src/generated/zip-geo.json";
import { lookupZip, zipsInZone, countByZone, totalZips, nearestZips, coordsForZip, compareZones, DATA_VERSION, type GeoData } from "../shared/zones";
import { ZONE_CODES, ZONE_META, normalizeZone, describeZone, zoneIndex } from "../shared/zone-meta";
import { PLANTS, CATEGORIES, plantsForZone, getPlant, fitForZone, plantingCalendar, type PlantCategory } from "../shared/plants";

interface Env {
  ASSETS: Fetcher;
}

const GEO = geo as GeoData;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(body: unknown, status = 200, cache = "public, max-age=3600, s-maxage=86400"): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache, ...CORS },
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status, "no-store");
}

function zoneSummary(zip: string) {
  const l = lookupZip(zip);
  if (!l) return null;
  const m = l.meta;
  return {
    zip: l.zip,
    zone: l.zone,
    zoneNumber: m.zone,
    halfZone: m.half,
    minTempF: m.minF,
    maxTempF: m.maxF,
    minTempC: m.minC,
    maxTempC: m.maxC,
    description: describeZone(m),
    typicalLastSpringFrost: m.lastFrost,
    typicalFirstFallFrost: m.firstFrost,
    approxFrostFreeDays: m.seasonDays,
    coordinates: coordsForZip(GEO, l.zip),
    source: "USDA ARS / PRISM Group, Oregon State University, 2023 PHZM",
  };
}

function handleApi(url: URL): Response {
  const path = url.pathname.replace(/\/+$/, "");
  const q = url.searchParams;

  let m: RegExpMatchArray | null;

  if (path === "/api/v1/openapi.json") return json(openapi(url.origin), 200, "public, max-age=86400");

  if ((m = path.match(/^\/api\/v1\/zone\/(\d{5})$/))) {
    const s = zoneSummary(m[1]);
    return s ? json(s) : error(`ZIP ${m[1]} not in the 2023 dataset`, 404);
  }

  if (path === "/api/v1/zone") {
    const zips = (q.get("zips") ?? q.get("zip") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (zips.length === 0) return error("Provide ?zips=97330,80301 (up to 50)");
    if (zips.length > 50) return error("Max 50 ZIPs per request");
    const results = zips.map((z) => zoneSummary(z) ?? { zip: z, error: "not found" });
    return json({ count: results.length, results });
  }

  if (path === "/api/v1/compare") {
    const zips = (q.get("zips") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (zips.length < 2 || zips.length > 10) return error("Provide 2-10 ZIPs: ?zips=97330,80301");
    const list = zips.map((z) => lookupZip(z));
    const missing = zips.filter((_, i) => !list[i]);
    if (missing.length) return error(`ZIPs not found: ${missing.join(", ")}`, 404);
    const base = list[0]!;
    const rows = list.map((l) => ({ zip: l!.zip, zone: l!.zone, tempRangeF: `${l!.meta.minF} to ${l!.meta.maxF}`, vsFirst: compareZones(base.zone, l!.zone) }));
    const sorted = [...list].sort((a, b) => zoneIndex(a!.zone) - zoneIndex(b!.zone));
    return json({ locations: rows, coldest: sorted[0]!.zip, warmest: sorted.at(-1)!.zip });
  }

  if (path === "/api/v1/zones") {
    const counts = countByZone();
    const total = totalZips();
    return json({
      version: DATA_VERSION,
      totalZips: total,
      zones: ZONE_CODES.map((z) => ({ zone: z, minTempF: ZONE_META[z].minF, maxTempF: ZONE_META[z].maxF, zipCount: counts[z], color: ZONE_META[z].color })),
    });
  }

  if ((m = path.match(/^\/api\/v1\/zones\/([^/]+)$/))) {
    const z = normalizeZone(decodeURIComponent(m[1]));
    if (!z) return error(`Unknown zone. Valid: ${ZONE_CODES.join(", ")}`, 404);
    const meta = ZONE_META[z];
    const i = zoneIndex(z);
    const limit = Math.min(Number(q.get("limit") ?? 25) || 25, 500);
    const r = zipsInZone(z, { prefix: q.get("prefix") ?? undefined, limit });
    return json({
      zone: z,
      description: describeZone(meta),
      minTempF: meta.minF,
      maxTempF: meta.maxF,
      minTempC: meta.minC,
      maxTempC: meta.maxC,
      colderNeighbor: ZONE_CODES[i - 1] ?? null,
      warmerNeighbor: ZONE_CODES[i + 1] ?? null,
      typicalLastSpringFrost: meta.lastFrost,
      typicalFirstFallFrost: meta.firstFrost,
      approxFrostFreeDays: meta.seasonDays,
      color: meta.color,
      zipCount: r.total,
      zips: r.zips,
    });
  }

  if (path === "/api/v1/nearest") {
    const lat = Number(q.get("lat"));
    const lon = Number(q.get("lon") ?? q.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return error("Provide ?lat=44.56&lon=-123.26");
    const limit = Math.min(Number(q.get("limit") ?? 3) || 3, 10);
    const near = nearestZips(GEO, lat, lon, limit).map((n) => ({ ...n, ...zoneSummary(n.zip) }));
    return json({ query: { lat, lon }, nearest: near });
  }

  if (path === "/api/v1/plants") {
    const zoneParam = q.get("zone") ?? (q.get("zip") ? lookupZip(q.get("zip")!)?.zone : undefined);
    const category = q.get("category") as PlantCategory | null;
    if (category && !CATEGORIES.includes(category)) return error(`category must be one of ${CATEGORIES.join(", ")}`);
    if (!zoneParam) {
      return json({ count: PLANTS.length, plants: PLANTS });
    }
    const z = normalizeZone(zoneParam);
    if (!z) return error("Unknown zone", 404);
    const rows = plantsForZone(z, { category: category ?? undefined, query: q.get("q") ?? undefined, includeNotRecommended: q.get("all") === "1" });
    return json({
      zone: z,
      count: rows.length,
      plants: rows.map((r) => ({ ...r.plant, fit: r.fit, perennialHere: r.perennialHere, reason: r.reason })),
    });
  }

  if ((m = path.match(/^\/api\/v1\/plants\/([^/]+)$/))) {
    const p = getPlant(decodeURIComponent(m[1]));
    if (!p) return error("Unknown plant", 404);
    const zoneParam = q.get("zone");
    const z = zoneParam ? normalizeZone(zoneParam) : null;
    return json({ ...p, fit: z ? fitForZone(p, z) : undefined });
  }

  if (path === "/api/v1/calendar") {
    const zoneParam = q.get("zone") ?? (q.get("zip") ? lookupZip(q.get("zip")!)?.zone : undefined);
    const z = zoneParam ? normalizeZone(zoneParam) : null;
    if (!z) return error("Provide ?zone=7b or ?zip=97330");
    const slugs = (q.get("plants") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const plants = slugs.length ? slugs.map((s) => getPlant(s)).filter((p): p is NonNullable<typeof p> => !!p) : PLANTS;
    if (plants.length === 0) return error("No known plants in ?plants=", 404);
    const year = q.get("year") ? Number(q.get("year")) : undefined;
    return json(plantingCalendar(z, plants, year));
  }

  return error("Not found. See /api/v1/openapi.json", 404);
}

function openapi(origin: string) {
  const zoneParam = { name: "zone", in: "query", schema: { type: "string", enum: ZONE_CODES } };
  return {
    openapi: "3.1.0",
    info: {
      title: "AGMCP Hardiness Zone API",
      version: "1.0.0",
      description: "2023 USDA Plant Hardiness Zones by US ZIP code, plus curated plant fit ratings and planting calendars. Zone data: USDA ARS / PRISM Group (OSU). ZIP centroids: US Census ZCTA gazetteer. Plant data and frost dates are horticultural estimates.",
      license: { name: "MIT" },
    },
    servers: [{ url: origin }],
    paths: {
      "/api/v1/zone/{zip}": { get: { summary: "Zone for a ZIP", parameters: [{ name: "zip", in: "path", required: true, schema: { type: "string", pattern: "^\\d{5}$" } }], responses: { "200": { description: "Zone summary" }, "404": { description: "ZIP not in dataset" } } } },
      "/api/v1/zone": { get: { summary: "Zones for up to 50 ZIPs", parameters: [{ name: "zips", in: "query", required: true, schema: { type: "string" }, description: "Comma-separated ZIPs" }], responses: { "200": { description: "Results" } } } },
      "/api/v1/compare": { get: { summary: "Compare 2-10 ZIPs", parameters: [{ name: "zips", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "Comparison" } } } },
      "/api/v1/zones": { get: { summary: "All zones with ZIP counts", responses: { "200": { description: "Zones" } } } },
      "/api/v1/zones/{zone}": { get: { summary: "Zone details and sample ZIPs", parameters: [{ name: "zone", in: "path", required: true, schema: { type: "string" } }, { name: "prefix", in: "query", schema: { type: "string" } }, { name: "limit", in: "query", schema: { type: "integer", maximum: 500 } }], responses: { "200": { description: "Zone" } } } },
      "/api/v1/nearest": { get: { summary: "Nearest ZIPs and zones to coordinates", parameters: [{ name: "lat", in: "query", required: true, schema: { type: "number" } }, { name: "lon", in: "query", required: true, schema: { type: "number" } }, { name: "limit", in: "query", schema: { type: "integer", maximum: 10 } }], responses: { "200": { description: "Nearest" } } } },
      "/api/v1/plants": { get: { summary: "Plants rated for a zone", parameters: [zoneParam, { name: "zip", in: "query", schema: { type: "string" } }, { name: "category", in: "query", schema: { type: "string", enum: CATEGORIES } }, { name: "q", in: "query", schema: { type: "string" } }, { name: "all", in: "query", schema: { type: "string", enum: ["1"] }, description: "Include not-recommended" }], responses: { "200": { description: "Plants" } } } },
      "/api/v1/plants/{slug}": { get: { summary: "Plant details", parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string", enum: PLANTS.map((p) => p.slug) } }, zoneParam], responses: { "200": { description: "Plant" } } } },
      "/api/v1/calendar": { get: { summary: "Estimated planting calendar", parameters: [zoneParam, { name: "zip", in: "query", schema: { type: "string" } }, { name: "plants", in: "query", schema: { type: "string" }, description: "Comma-separated slugs" }, { name: "year", in: "query", schema: { type: "integer" } }], responses: { "200": { description: "Calendar" } } } },
    },
  };
}

function llmsTxt(origin: string): Response {
  const body = `# AGMCP — USDA Plant Hardiness Zones for people and agents

> ${origin} turns the 2023 USDA Plant Hardiness Zone Map (every US ZIP code) into structured tools.

## In-browser (WebMCP)
Open ${origin} in a WebMCP-capable browser (ChatGPT desktop app browser, or Chrome with chrome://flags/#enable-webmcp-testing).
The page registers tools via document.modelContext.registerTool(): lookup_hardiness_zone, get_zone_details,
compare_locations, find_zips_in_zone, find_zone_by_coordinates, get_zip_coordinates, list_plants, get_plant_details,
get_planting_calendar, get_current_context, set_location, use_my_location, filter_plants, add_to_garden_plan,
update_garden_plan_item, remove_from_garden_plan, clear_garden_plan (requires user confirmation), export_garden_plan.
Deep link a location with ${origin}/?zip=97330

## HTTP API (for backend agents)
- ${origin}/api/v1/zone/{zip}
- ${origin}/api/v1/zone?zips=97330,80301
- ${origin}/api/v1/compare?zips=97330,80301
- ${origin}/api/v1/zones
- ${origin}/api/v1/zones/{zone}?prefix=972&limit=25
- ${origin}/api/v1/nearest?lat=44.56&lon=-123.26
- ${origin}/api/v1/plants?zone=7b&category=pepper
- ${origin}/api/v1/plants/{slug}?zone=7b
- ${origin}/api/v1/calendar?zone=7b&plants=tomato,jalapeno
- ${origin}/api/v1/openapi.json

## Data
Zones: USDA ARS / PRISM Group, Oregon State University (2023 PHZM). ZIP centroids: US Census Bureau 2024 ZCTA gazetteer.
Plant fit ratings and frost windows are curated horticultural estimates, not USDA data.
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400", ...CORS } });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/llms.txt") return llmsTxt(url.origin);
    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "GET") return error("Method not allowed", 405);
      try {
        return handleApi(url);
      } catch (e) {
        return error(e instanceof Error ? e.message : "Internal error", 500);
      }
    }
    // Static assets are normally served before the Worker runs; this is the
    // fallback for anything that reaches us. Headers live in public/_headers.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
