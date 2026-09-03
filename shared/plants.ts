import plantsData from "../src/data/plants.json";
import { ZONE_META, type ZoneCode } from "./zone-meta";

export type PlantCategory = "vegetable" | "herb" | "pepper" | "fruit";
export type Lifecycle = "annual" | "biennial" | "perennial";

export interface Plant {
  slug: string;
  name: string;
  category: PlantCategory;
  lifecycle: Lifecycle;
  /** Whole-number zone range where the plant can be grown in season. */
  growZones: [number, number];
  /** Zone range where it survives winter outdoors, null if grown only as an annual. */
  hardyZones: [number, number] | null;
  daysToMaturity: number;
  /** Weeks before last frost to start seed indoors. */
  startIndoors: number | null;
  /** Weeks relative to last frost to transplant outdoors (negative = before). */
  transplant: number | null;
  /** Weeks relative to last frost to direct sow (negative = before). */
  directSow: number | null;
  sun: "full" | "partial";
  spacingIn: number;
  notes: string;
}

export const PLANTS: Plant[] = plantsData as Plant[];
export const CATEGORIES: PlantCategory[] = ["vegetable", "herb", "pepper", "fruit"];

export type Fit = "great" | "stretch" | "not-recommended";

export interface PlantFit {
  plant: Plant;
  fit: Fit;
  perennialHere: boolean;
  reason: string;
}

export function getPlant(idOrName: string): Plant | null {
  const q = idOrName.trim().toLowerCase();
  return (
    PLANTS.find((p) => p.slug === q) ??
    PLANTS.find((p) => p.name.toLowerCase() === q) ??
    PLANTS.find((p) => p.name.toLowerCase().includes(q) || p.slug.includes(q.replace(/\s+/g, "-"))) ??
    null
  );
}

export function fitForZone(plant: Plant, zone: ZoneCode): PlantFit {
  const z = ZONE_META[zone].zone;
  const [gMin, gMax] = plant.growZones;
  const perennialHere = !!plant.hardyZones && z >= plant.hardyZones[0] && z <= plant.hardyZones[1];
  if (z < gMin || z > gMax) {
    const why = z < gMin ? "the season is too short or too cold" : "it is too hot or lacks winter chill";
    return { plant, fit: "not-recommended", perennialHere, reason: `Outside its range (zones ${gMin}-${gMax}): ${why}.` };
  }
  const nearEdge = z === gMin || z === gMax;
  if (nearEdge) {
    return { plant, fit: "stretch", perennialHere, reason: `At the edge of its range (zones ${gMin}-${gMax}); pick early varieties or protect.` };
  }
  return {
    plant,
    fit: "great",
    perennialHere,
    reason: perennialHere ? `Well within range and perennial in zone ${zone}.` : `Well within its range (zones ${gMin}-${gMax}).`,
  };
}

export function plantsForZone(zone: ZoneCode, opts: { category?: PlantCategory; query?: string; includeNotRecommended?: boolean } = {}): PlantFit[] {
  const q = opts.query?.trim().toLowerCase();
  return PLANTS.filter((p) => !opts.category || p.category === opts.category)
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.notes.toLowerCase().includes(q) || p.slug.includes(q))
    .map((p) => fitForZone(p, zone))
    .filter((f) => opts.includeNotRecommended || f.fit !== "not-recommended")
    .sort((a, b) => rank(a.fit) - rank(b.fit) || a.plant.name.localeCompare(b.plant.name));
}

function rank(f: Fit) {
  return f === "great" ? 0 : f === "stretch" ? 1 : 2;
}

// Planting calendar: dates relative to the zone's typical last spring frost.
export interface CalendarEntry {
  plant: string;
  slug: string;
  fit: Fit;
  startIndoors: string | null;
  transplantOutdoors: string | null;
  directSow: string | null;
  estimatedFirstHarvest: string | null;
  note: string;
}

function mmdd(year: number, mmddStr: string): Date {
  const [m, d] = mmddStr.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1, d));
}

function addWeeks(d: Date, weeks: number): Date {
  return new Date(d.getTime() + weeks * 7 * 86400000);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000);
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function plantingCalendar(zone: ZoneCode, plants: Plant[], year = new Date().getUTCFullYear()): { zone: ZoneCode; lastFrostEstimate: string | null; entries: CalendarEntry[] } {
  const meta = ZONE_META[zone];
  if (!meta.lastFrost) {
    return {
      zone,
      lastFrostEstimate: null,
      entries: plants.map((p) => ({
        plant: p.name,
        slug: p.slug,
        fit: fitForZone(p, zone).fit,
        startIndoors: null,
        transplantOutdoors: null,
        directSow: null,
        estimatedFirstHarvest: null,
        note: `Zone ${zone} is essentially frost-free; plant warm-season crops year-round and cool-season crops in the coolest months. ${p.notes}`,
      })),
    };
  }
  // Use the midpoint of the typical last-frost window.
  const a = mmdd(year, meta.lastFrost.from);
  const b = mmdd(year, meta.lastFrost.to);
  const lastFrost = new Date((a.getTime() + b.getTime()) / 2);
  const entries = plants.map((p) => {
    const start = p.startIndoors != null ? addWeeks(lastFrost, -p.startIndoors) : null;
    const transplant = p.transplant != null ? addWeeks(lastFrost, p.transplant) : null;
    const sow = p.directSow != null ? addWeeks(lastFrost, p.directSow) : null;
    const outdoors = transplant ?? sow;
    const harvest = outdoors && p.daysToMaturity < 365 ? addDays(outdoors, p.daysToMaturity) : null;
    return {
      plant: p.name,
      slug: p.slug,
      fit: fitForZone(p, zone).fit,
      startIndoors: start ? fmt(start) : null,
      transplantOutdoors: transplant ? fmt(transplant) : null,
      directSow: sow ? fmt(sow) : null,
      estimatedFirstHarvest: harvest ? fmt(harvest) : null,
      note: p.notes,
    };
  });
  return { zone, lastFrostEstimate: fmt(lastFrost), entries };
}
