// WebMCP tool registration. Every tool reuses the app's own actions so agents
// and humans act on the same page state. Tools are feature-detected and are a
// no-op in browsers without document.modelContext.
import { lookupZip, zipsInZone, countByZone, compareZones, totalZips, DATA_VERSION } from "../shared/zones";
import { ZONE_CODES, ZONE_META, normalizeZone, describeZone, zoneIndex } from "../shared/zone-meta";
import { PLANTS, CATEGORIES, plantsForZone, fitForZone, plantingCalendar } from "../shared/plants";
import {
  AppError,
  addToPlan,
  clearPlan,
  currentContext,
  exportPlan,
  locateByCoordinates,
  removeFromPlan,
  requireZone,
  resolvePlant,
  setLocation,
  updatePlanItem,
  useMyLocation,
  zoneSummary,
  coordsFor,
} from "./app";
import { logActivity, state, update } from "./store";

type ToolDef = WebMCP.ModelContextTool;

const zoneEnum = [...ZONE_CODES];
const plantSlugs = PLANTS.map((p) => p.slug);

function summarize(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 140);
  try {
    const s = JSON.stringify(result);
    return s.length > 140 ? s.slice(0, 137) + "…" : s;
  } catch {
    return String(result);
  }
}

/** Wraps execute: logs to the on-page activity panel and converts errors into MCP-style error results. */
function wrap(tool: ToolDef): ToolDef {
  const inner = tool.execute;
  return {
    ...tool,
    async execute(input, options) {
      try {
        const result = await inner(input ?? {}, options);
        logActivity({ tool: tool.name, input, ok: true, summary: summarize(result) });
        return result;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logActivity({ tool: tool.name, input, ok: false, summary: message });
        if (e instanceof AppError) {
          return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
        }
        throw e;
      }
    },
  };
}

export const TOOLS: ToolDef[] = [
  {
    name: "lookup_hardiness_zone",
    description:
      "Look up the 2023 USDA Plant Hardiness Zone for a 5-digit US ZIP code (50 states, DC, Puerto Rico). Returns the half-zone (e.g. 7b), the average annual extreme minimum temperature band in °F and °C, and estimated frost windows. Read-only; does not change the page. Use set_location to also show it to the user.",
    inputSchema: {
      type: "object",
      properties: { zip: { type: "string", description: "5-digit US ZIP code, e.g. \"97330\"", pattern: "^\\d{5}$" } },
      required: ["zip"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: ({ zip }) => {
      const l = lookupZip(String(zip));
      if (!l) throw new AppError(`ZIP ${zip} is not in the 2023 USDA dataset. It may be a PO-box-only or new ZIP; try a neighboring ZIP.`);
      return zoneSummary(l);
    },
  },
  {
    name: "get_zone_details",
    description:
      "Get details for a USDA hardiness zone (1a through 13b): temperature band, adjacent zones, how many US ZIP codes fall in it, estimated frost windows, and a few sample ZIPs. Accepts \"7b\", \"zone 7b\", or \"7\" (treated as 7a).",
    inputSchema: {
      type: "object",
      properties: { zone: { type: "string", description: "Zone code such as 7b", enum: zoneEnum } },
      required: ["zone"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: ({ zone }) => {
      const z = normalizeZone(String(zone));
      if (!z) throw new AppError(`Unknown zone "${zone}". Valid zones: ${zoneEnum.join(", ")}.`);
      const m = ZONE_META[z];
      const i = zoneIndex(z);
      const counts = countByZone();
      return {
        zone: z,
        description: describeZone(m),
        minTempF: m.minF,
        maxTempF: m.maxF,
        minTempC: m.minC,
        maxTempC: m.maxC,
        colderNeighbor: ZONE_CODES[i - 1] ?? null,
        warmerNeighbor: ZONE_CODES[i + 1] ?? null,
        typicalLastSpringFrost: m.lastFrost ?? "rare or none",
        typicalFirstFallFrost: m.firstFrost ?? "rare or none",
        approxFrostFreeDays: m.seasonDays,
        zipCodeCount: counts[z],
        shareOfUsZips: `${((counts[z] / totalZips()) * 100).toFixed(1)}%`,
        sampleZips: zipsInZone(z, { limit: 8 }).zips,
        mapColor: m.color,
      };
    },
  },
  {
    name: "compare_locations",
    description:
      "Compare the hardiness zones of 2 to 10 US ZIP codes. Returns each ZIP's zone and temperature band, the warmest and coldest, and the half-zone / °F difference of each relative to the first ZIP. Useful for 'is it colder where my parents live', moving, or picking where a plant will survive.",
    inputSchema: {
      type: "object",
      properties: {
        zips: { type: "array", description: "2 to 10 five-digit ZIP codes", items: { type: "string", pattern: "^\\d{5}$" }, minItems: 2, maxItems: 10 },
      },
      required: ["zips"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: ({ zips }) => {
      const list = (zips as string[]).map((z) => {
        const l = lookupZip(z);
        if (!l) throw new AppError(`ZIP ${z} not found in the dataset.`);
        return l;
      });
      const base = list[0];
      const rows = list.map((l) => ({
        zip: l.zip,
        zone: l.zone,
        tempRangeF: `${l.meta.minF} to ${l.meta.maxF}`,
        vsFirst: compareZones(base.zone, l.zone),
      }));
      const sorted = [...list].sort((a, b) => zoneIndex(a.zone) - zoneIndex(b.zone));
      return { locations: rows, coldest: { zip: sorted[0].zip, zone: sorted[0].zone }, warmest: { zip: sorted.at(-1)!.zip, zone: sorted.at(-1)!.zone } };
    },
  },
  {
    name: "find_zips_in_zone",
    description:
      "List US ZIP codes that fall in a given hardiness zone, optionally restricted to a ZIP prefix (e.g. \"972\" for the Portland, OR area, or \"9\" for the West). Returns up to `limit` ZIPs plus the total count. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        zone: { type: "string", enum: zoneEnum, description: "Zone code such as 8b" },
        zip_prefix: { type: "string", description: "Optional 1-4 digit ZIP prefix to narrow the region" },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 25 },
      },
      required: ["zone"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: ({ zone, zip_prefix, limit }) => {
      const z = normalizeZone(String(zone));
      if (!z) throw new AppError(`Unknown zone "${zone}".`);
      const r = zipsInZone(z, { prefix: zip_prefix ? String(zip_prefix) : undefined, limit: Number(limit) || 25 });
      return { zone: z, zipPrefix: zip_prefix ?? null, total: r.total, zips: r.zips };
    },
  },
  {
    name: "find_zone_by_coordinates",
    description:
      "Find the nearest US ZIP codes (by ZIP centroid) to a latitude/longitude and return their hardiness zones and distance in km. Use when you have coordinates from another tool (weather, maps) instead of a ZIP. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        latitude: { type: "number", minimum: -90, maximum: 90 },
        longitude: { type: "number", minimum: -180, maximum: 180 },
      },
      required: ["latitude", "longitude"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async ({ latitude, longitude }) => ({ nearest: await locateByCoordinates(Number(latitude), Number(longitude)) }),
  },
  {
    name: "get_zip_coordinates",
    description: "Get the approximate latitude/longitude centroid of a US ZIP code (Census ZCTA). Handy for chaining into weather or sun-position tools. Read-only.",
    inputSchema: {
      type: "object",
      properties: { zip: { type: "string", pattern: "^\\d{5}$" } },
      required: ["zip"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async ({ zip }) => {
      const l = lookupZip(String(zip));
      if (!l) throw new AppError(`ZIP ${zip} not found.`);
      const c = await coordsFor(l.zip);
      if (!c) throw new AppError(`No centroid available for ZIP ${zip}.`);
      return { zip: l.zip, zone: l.zone, latitude: c.lat, longitude: c.lon, source: "US Census Bureau 2024 ZCTA gazetteer" };
    },
  },
  {
    name: "list_plants",
    description:
      "List common garden plants (vegetables, herbs, peppers, fruit) with a fit rating for a hardiness zone: 'great', 'stretch' (edge of range), or 'not-recommended'. Defaults to the zone currently selected on the page; pass `zone` to override. Filter by category or free-text query. Plant ranges are curated horticultural estimates.",
    inputSchema: {
      type: "object",
      properties: {
        zone: { type: "string", enum: zoneEnum, description: "Optional zone; defaults to the page's selected zone" },
        category: { type: "string", enum: CATEGORIES },
        query: { type: "string", description: "Free-text filter on name or notes, e.g. \"pepper\" or \"perennial\"" },
        include_not_recommended: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: ({ zone, category, query, include_not_recommended }) => {
      const z = zone ? normalizeZone(String(zone)) : requireZone();
      if (!z) throw new AppError(`Unknown zone "${zone}".`);
      const rows = plantsForZone(z, {
        category: category as never,
        query: query ? String(query) : undefined,
        includeNotRecommended: Boolean(include_not_recommended),
      });
      return {
        zone: z,
        count: rows.length,
        plants: rows.map((r) => ({
          slug: r.plant.slug,
          name: r.plant.name,
          category: r.plant.category,
          lifecycle: r.plant.lifecycle,
          fit: r.fit,
          perennialHere: r.perennialHere,
          daysToMaturity: r.plant.daysToMaturity,
          reason: r.reason,
        })),
      };
    },
  },
  {
    name: "get_plant_details",
    description: "Full growing profile for one plant: zone ranges, days to maturity, when to start indoors / transplant / direct sow relative to last frost, sun, spacing, notes, and its fit for the page's current zone.",
    inputSchema: {
      type: "object",
      properties: { plant: { type: "string", description: "Plant slug or name", enum: plantSlugs } },
      required: ["plant"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: ({ plant }) => {
      const p = resolvePlant(String(plant));
      return { ...p, fitForCurrentZone: state.zone ? fitForZone(p, state.zone) : null };
    },
  },
  {
    name: "get_planting_calendar",
    description:
      "Estimated planting dates (start indoors, transplant, direct sow, first harvest) for plants in a zone, derived from the zone's typical last spring frost. Defaults to the page's selected zone and the plants in the garden plan; pass `plants` to choose specific ones. Dates are estimates; local frost dates vary.",
    inputSchema: {
      type: "object",
      properties: {
        zone: { type: "string", enum: zoneEnum },
        plants: { type: "array", items: { type: "string", enum: plantSlugs }, description: "Plant slugs; defaults to the garden plan" },
        year: { type: "integer", minimum: 2024, maximum: 2100 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: ({ zone, plants, year }) => {
      const z = zone ? normalizeZone(String(zone)) : requireZone();
      if (!z) throw new AppError(`Unknown zone "${zone}".`);
      const list = plants && (plants as string[]).length ? (plants as string[]).map(resolvePlant) : state.plan.map((i) => resolvePlant(i.slug));
      if (list.length === 0) throw new AppError("No plants given and the garden plan is empty. Pass `plants` or add items first.");
      return plantingCalendar(z, list, year ? Number(year) : undefined);
    },
  },
  {
    name: "get_current_context",
    description: "Read what the user currently sees: selected ZIP and zone, active plant filters, and the full garden plan with fit ratings. Call this first to sync with the human's view of the page.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: () => currentContext(),
  },
  // ---- write tools: change what the user sees ----
  {
    name: "set_location",
    description:
      "Set the page's location to a ZIP code. Updates the zone card, zone scale, plant fit ratings, and the URL so the user sees the same zone you are reasoning about. Returns the zone summary.",
    inputSchema: {
      type: "object",
      properties: { zip: { type: "string", pattern: "^\\d{5}$" } },
      required: ["zip"],
      additionalProperties: false,
    },
    execute: ({ zip }) => setLocation(String(zip), { by: "agent" }),
  },
  {
    name: "use_my_location",
    description:
      "Ask the browser for the user's current position (the user sees a permission prompt and must accept), then set the page's location to the nearest ZIP with hardiness data. Human-in-the-loop; fails if permission is denied.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => useMyLocation(),
  },
  {
    name: "filter_plants",
    description: "Change the plant category filter and search text shown in the Plants section so the user sees the same list you are discussing.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["all", ...CATEGORIES] },
        query: { type: "string" },
      },
      additionalProperties: false,
    },
    execute: ({ category, query }) => {
      update({ category: (category as never) ?? state.category, query: query != null ? String(query) : state.query });
      document.getElementById("plants")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return { category: state.category, query: state.query };
    },
  },
  {
    name: "add_to_garden_plan",
    description:
      "Add a plant to the shared garden plan shown on the page (merges quantity if already present). Returns the plant's fit for the current zone so you can warn the user if it is a stretch or not recommended.",
    inputSchema: {
      type: "object",
      properties: {
        plant: { type: "string", enum: plantSlugs, description: "Plant slug" },
        quantity: { type: "integer", minimum: 1, maximum: 999, default: 1 },
        notes: { type: "string", description: "Short note, e.g. variety or where it goes in the bed" },
      },
      required: ["plant"],
      additionalProperties: false,
    },
    execute: ({ plant, quantity, notes }) => addToPlan(String(plant), Number(quantity) || 1, notes ? String(notes) : "", "agent"),
  },
  {
    name: "update_garden_plan_item",
    description: "Change the quantity and/or notes of a plant already in the garden plan.",
    inputSchema: {
      type: "object",
      properties: {
        plant: { type: "string", enum: plantSlugs },
        quantity: { type: "integer", minimum: 1, maximum: 999 },
        notes: { type: "string" },
      },
      required: ["plant"],
      additionalProperties: false,
    },
    execute: ({ plant, quantity, notes }) =>
      updatePlanItem(String(plant), { quantity: quantity != null ? Number(quantity) : undefined, notes: notes != null ? String(notes) : undefined }),
  },
  {
    name: "remove_from_garden_plan",
    description: "Remove one plant from the garden plan.",
    inputSchema: {
      type: "object",
      properties: { plant: { type: "string", enum: plantSlugs } },
      required: ["plant"],
      additionalProperties: false,
    },
    execute: ({ plant }) => removeFromPlan(String(plant)),
  },
  {
    name: "clear_garden_plan",
    description: "Remove every plant from the garden plan. Destructive: opens a confirmation dialog the user must accept on the page; returns an error if they cancel.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => clearPlan(true),
  },
  {
    name: "export_garden_plan",
    description: "Export the garden plan as Markdown (with estimated planting dates) or JSON. Read-only.",
    inputSchema: {
      type: "object",
      properties: { format: { type: "string", enum: ["markdown", "json"], default: "markdown" } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: ({ format }) => exportPlan((format as "markdown" | "json") ?? "markdown"),
  },
];

export interface WebMcpStatus {
  supported: boolean;
  registered: number;
  error: string | null;
}

export async function registerWebMcpTools(): Promise<WebMcpStatus> {
  const mc = document.modelContext;
  if (!mc || typeof mc.registerTool !== "function") return { supported: false, registered: 0, error: null };
  let registered = 0;
  let error: string | null = null;
  for (const tool of TOOLS) {
    try {
      await mc.registerTool(wrap(tool));
      registered++;
    } catch (e) {
      error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.warn("WebMCP registerTool failed", tool.name, e);
    }
  }
  return { supported: true, registered, error };
}

/** The declarative <form toolname> gets a structured response in Chrome via respondWith(). */
export function wireDeclarativeForm(form: HTMLFormElement, onSubmit: (zip: string) => unknown) {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const zip = String(new FormData(form).get("zip") ?? "");
    const agent = (e as SubmitEvent & { agentInvoked?: boolean; respondWith?: (p: Promise<unknown>) => void }).agentInvoked;
    const run = async () => {
      try {
        const r = onSubmit(zip);
        logActivity({ tool: "search_zip_form (declarative)", input: { zip }, ok: true, summary: summarize(r) });
        return r;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (agent) logActivity({ tool: "search_zip_form (declarative)", input: { zip }, ok: false, summary: message });
        return { error: message };
      }
    };
    const evt = e as SubmitEvent & { respondWith?: (p: Promise<unknown>) => void };
    if (agent && typeof evt.respondWith === "function") evt.respondWith(run());
    else void run();
  });
}

export const DATASET_VERSION = DATA_VERSION;
