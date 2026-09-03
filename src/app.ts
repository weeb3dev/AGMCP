// Application actions shared by the human UI and the WebMCP tools, so both
// operate on the same state and the same visible page.
import { lookupZip, nearestZips, coordsForZip, type GeoData, type ZipLookup } from "../shared/zones";
import { ZONE_META, describeZone, type ZoneCode } from "../shared/zone-meta";
import { getPlant, fitForZone, plantingCalendar, PLANTS, type Plant } from "../shared/plants";
import { state, update, type PlanItem } from "./store";

export class AppError extends Error {}

let geoPromise: Promise<GeoData> | null = null;
export function loadGeo(): Promise<GeoData> {
  geoPromise ??= fetch("/data/zip-geo.json").then((r) => {
    if (!r.ok) throw new AppError("Could not load ZIP coordinate data.");
    return r.json() as Promise<GeoData>;
  });
  return geoPromise;
}

export function zoneSummary(l: ZipLookup) {
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
    typicalLastSpringFrost: m.lastFrost ? `${m.lastFrost.from} to ${m.lastFrost.to} (MM-DD, estimate)` : "rare or none",
    typicalFirstFallFrost: m.firstFrost ? `${m.firstFrost.from} to ${m.firstFrost.to} (MM-DD, estimate)` : "rare or none",
    approxFrostFreeDays: m.seasonDays,
    dataSource: "USDA ARS / PRISM Group 2023 PHZM; frost windows are horticultural estimates",
  };
}

export function setLocation(zipInput: string, opts: { by?: "human" | "agent" } = {}) {
  const l = lookupZip(zipInput);
  if (!l) {
    const zip = String(zipInput).trim();
    throw new AppError(
      /^\d{5}$/.test(zip)
        ? `ZIP ${zip} is not in the 2023 USDA dataset (PO-box-only and some new ZIPs are missing). Try a nearby ZIP.`
        : `"${zipInput}" is not a 5-digit US ZIP code.`,
    );
  }
  update({ zip: l.zip, zone: l.zone });
  const url = new URL(location.href);
  url.searchParams.set("zip", l.zip);
  history.replaceState(null, "", url);
  document.title = `Zone ${l.zone} — ZIP ${l.zip} · AGMCP`;
  return { ...zoneSummary(l), setBy: opts.by ?? "human" };
}

export async function locateByCoordinates(lat: number, lon: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new AppError("Latitude/longitude out of range.");
  }
  const geo = await loadGeo();
  const near = nearestZips(geo, lat, lon, 3);
  if (near.length === 0) throw new AppError("No ZIP codes with hardiness data near those coordinates.");
  return near.map((n) => {
    const l = lookupZip(n.zip)!;
    return { ...n, zone: l.zone, tempRangeF: `${l.meta.minF} to ${l.meta.maxF}` };
  });
}

export function useMyLocation(): Promise<ReturnType<typeof setLocation>> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new AppError("Geolocation is not available in this browser."));
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const near = await locateByCoordinates(pos.coords.latitude, pos.coords.longitude);
          resolve({ ...setLocation(near[0].zip, { by: "human" }), distanceKm: near[0].distanceKm } as never);
        } catch (e) {
          reject(e);
        }
      },
      (err) => reject(new AppError(`Location permission was not granted (${err.message}). Enter a ZIP instead.`)),
      { timeout: 15000, maximumAge: 600000 },
    );
  });
}

export async function coordsFor(zip: string) {
  const geo = await loadGeo();
  return coordsForZip(geo, zip);
}

export function requireZone(): ZoneCode {
  if (!state.zone) throw new AppError("No location selected yet. Call set_location with a ZIP first (or ask the user for their ZIP).");
  return state.zone;
}

export function resolvePlant(idOrName: string): Plant {
  const p = getPlant(idOrName);
  if (!p) {
    throw new AppError(`Unknown plant "${idOrName}". Known plants: ${PLANTS.map((x) => x.slug).join(", ")}.`);
  }
  return p;
}

export function addToPlan(idOrName: string, quantity = 1, notes = "", by: "human" | "agent" = "human") {
  const p = resolvePlant(idOrName);
  const existing = state.plan.find((i) => i.slug === p.slug);
  const qty = Math.max(1, Math.min(999, Math.round(quantity || 1)));
  let plan: PlanItem[];
  if (existing) {
    plan = state.plan.map((i) => (i.slug === p.slug ? { ...i, quantity: i.quantity + qty, notes: notes || i.notes } : i));
  } else {
    plan = [...state.plan, { slug: p.slug, quantity: qty, notes, addedBy: by }];
  }
  update({ plan });
  const fit = state.zone ? fitForZone(p, state.zone) : null;
  return {
    added: p.name,
    quantity: plan.find((i) => i.slug === p.slug)!.quantity,
    fitForCurrentZone: fit ? { zone: state.zone, fit: fit.fit, reason: fit.reason, perennialHere: fit.perennialHere } : "no zone selected",
    planSize: plan.length,
  };
}

export function updatePlanItem(idOrName: string, patch: { quantity?: number; notes?: string }) {
  const p = resolvePlant(idOrName);
  if (!state.plan.some((i) => i.slug === p.slug)) throw new AppError(`${p.name} is not in the plan.`);
  const plan = state.plan.map((i) =>
    i.slug === p.slug
      ? {
          ...i,
          quantity: patch.quantity != null ? Math.max(1, Math.min(999, Math.round(patch.quantity))) : i.quantity,
          notes: patch.notes ?? i.notes,
        }
      : i,
  );
  update({ plan });
  return plan.find((i) => i.slug === p.slug)!;
}

export function removeFromPlan(idOrName: string) {
  const p = resolvePlant(idOrName);
  if (!state.plan.some((i) => i.slug === p.slug)) throw new AppError(`${p.name} is not in the plan.`);
  update({ plan: state.plan.filter((i) => i.slug !== p.slug) });
  return { removed: p.name, planSize: state.plan.length };
}

/** Human-in-the-loop: destructive action requires the user to click Confirm. */
export function confirmDialog(title: string, body: string): Promise<boolean> {
  const dlg = document.getElementById("confirm-dialog") as HTMLDialogElement;
  (document.getElementById("confirm-title") as HTMLElement).textContent = title;
  (document.getElementById("confirm-body") as HTMLElement).textContent = body;
  return new Promise((resolve) => {
    const onClose = () => {
      dlg.removeEventListener("close", onClose);
      resolve(dlg.returnValue === "confirm");
    };
    dlg.addEventListener("close", onClose);
    dlg.returnValue = "";
    dlg.showModal();
  });
}

export async function clearPlan(requireConfirm = true) {
  if (state.plan.length === 0) return { cleared: 0 };
  if (requireConfirm) {
    const ok = await confirmDialog("Clear garden plan?", `This removes all ${state.plan.length} plants from the plan on this page.`);
    if (!ok) throw new AppError("The user declined to clear the plan.");
  }
  const n = state.plan.length;
  update({ plan: [] });
  return { cleared: n };
}

export function planDetails() {
  return state.plan.map((i) => {
    const p = getPlant(i.slug)!;
    const fit = state.zone ? fitForZone(p, state.zone) : null;
    return {
      plant: p.name,
      slug: p.slug,
      quantity: i.quantity,
      notes: i.notes,
      addedBy: i.addedBy,
      category: p.category,
      lifecycle: p.lifecycle,
      fit: fit?.fit ?? null,
      perennialHere: fit?.perennialHere ?? null,
    };
  });
}

export function exportPlan(format: "markdown" | "json" = "markdown") {
  const items = planDetails();
  if (format === "json") return JSON.stringify({ zip: state.zip, zone: state.zone, plan: items }, null, 2);
  const head = state.zone ? `# Garden plan — ZIP ${state.zip}, USDA zone ${state.zone}\n\n` : `# Garden plan\n\n`;
  if (items.length === 0) return head + "_No plants yet._\n";
  const cal = state.zone ? plantingCalendar(state.zone, items.map((i) => getPlant(i.slug)!)) : null;
  const rows = items.map((i) => {
    const c = cal?.entries.find((e) => e.slug === i.slug);
    const timing = c
      ? [c.startIndoors && `start indoors ${c.startIndoors}`, c.transplantOutdoors && `transplant ${c.transplantOutdoors}`, c.directSow && `direct sow ${c.directSow}`]
          .filter(Boolean)
          .join("; ")
      : "";
    return `| ${i.plant} | ${i.quantity} | ${i.fit ?? "-"} | ${timing || "-"} | ${i.notes || ""} |`;
  });
  return (
    head +
    (cal?.lastFrostEstimate ? `Estimated last spring frost: ${cal.lastFrostEstimate}\n\n` : "") +
    "| Plant | Qty | Fit | Timing (estimates) | Notes |\n|---|---|---|---|---|\n" +
    rows.join("\n") +
    "\n\n_Zone data: USDA ARS / PRISM Group 2023. Planting dates are rules of thumb._\n"
  );
}

export function currentContext() {
  const l = state.zip ? lookupZip(state.zip) : null;
  return {
    location: l ? zoneSummary(l) : null,
    plantFilter: { category: state.category, query: state.query },
    gardenPlan: planDetails(),
    hints: l
      ? "Use list_plants to see what fits this zone, add_to_garden_plan to add items the user can see, get_planting_calendar for dates."
      : "No location yet. Ask the user for a ZIP or call use_my_location (prompts the user for permission).",
  };
}

export { ZONE_META };
