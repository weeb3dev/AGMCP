import zonesData from "../src/generated/zones.json";
import { ZONE_META, ZONE_CODES, zoneIndex, type ZoneCode, type ZoneMeta } from "./zone-meta";

const ALPHABET: string = zonesData.alphabet;
const ZIPS: string = zonesData.zips;

export const DATA_VERSION = zonesData.version;
export const DATA_SOURCE = zonesData.source;

export interface ZipLookup {
  zip: string;
  zone: ZoneCode;
  meta: ZoneMeta;
}

export function normalizeZip(input: string | number): string | null {
  const s = String(input).trim().match(/\d{5}/)?.[0];
  return s ?? null;
}

export function lookupZip(input: string | number): ZipLookup | null {
  const zip = normalizeZip(input);
  if (!zip) return null;
  const ch = ZIPS[Number(zip)];
  if (!ch || ch === ".") return null;
  const zone = ZONE_CODES[ALPHABET.indexOf(ch)];
  return { zip, zone, meta: ZONE_META[zone] };
}

export function zipsInZone(zone: ZoneCode, opts: { prefix?: string; limit?: number } = {}): { zips: string[]; total: number } {
  const ch = ALPHABET[zoneIndex(zone)];
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 500));
  const prefix = opts.prefix?.replace(/\D/g, "") ?? "";
  const out: string[] = [];
  let total = 0;
  let i = ZIPS.indexOf(ch);
  while (i !== -1) {
    const zip = String(i).padStart(5, "0");
    if (!prefix || zip.startsWith(prefix)) {
      total++;
      if (out.length < limit) out.push(zip);
    }
    i = ZIPS.indexOf(ch, i + 1);
  }
  return { zips: out, total };
}

let zoneCounts: Record<ZoneCode, number> | null = null;
export function countByZone(): Record<ZoneCode, number> {
  if (zoneCounts) return zoneCounts;
  const counts = Object.fromEntries(ZONE_CODES.map((z) => [z, 0])) as Record<ZoneCode, number>;
  for (let i = 0; i < ZIPS.length; i++) {
    const ch = ZIPS[i];
    if (ch !== ".") counts[ZONE_CODES[ALPHABET.indexOf(ch)]]++;
  }
  zoneCounts = counts;
  return counts;
}

export function totalZips(): number {
  return Object.values(countByZone()).reduce((a, b) => a + b, 0);
}

export function compareZones(a: ZoneCode, b: ZoneCode) {
  const steps = zoneIndex(b) - zoneIndex(a);
  return {
    halfZoneSteps: steps,
    degreesF: steps * 5,
    relation: steps === 0 ? "same" : steps > 0 ? "warmer" : "colder",
  } as const;
}

// Geo (lazy-loaded on the client, bundled in the worker)
export interface GeoData {
  zips: string[];
  lat: number[];
  lon: number[];
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function nearestZips(geo: GeoData, lat: number, lon: number, limit = 3): { zip: string; distanceKm: number }[] {
  const best: { zip: string; distanceKm: number }[] = [];
  for (let i = 0; i < geo.zips.length; i++) {
    // Cheap bounding box prefilter (~2 degrees) before haversine.
    if (Math.abs(geo.lat[i] - lat) > 2 || Math.abs(geo.lon[i] - lon) > 2) continue;
    const d = haversineKm(lat, lon, geo.lat[i], geo.lon[i]);
    if (best.length < limit || d < best[best.length - 1].distanceKm) {
      best.push({ zip: geo.zips[i], distanceKm: d });
      best.sort((x, y) => x.distanceKm - y.distanceKm);
      if (best.length > limit) best.pop();
    }
  }
  if (best.length === 0) {
    // Fall back to a full scan when nothing is within the box (remote areas).
    for (let i = 0; i < geo.zips.length; i++) {
      const d = haversineKm(lat, lon, geo.lat[i], geo.lon[i]);
      if (best.length < limit || d < best[best.length - 1].distanceKm) {
        best.push({ zip: geo.zips[i], distanceKm: d });
        best.sort((x, y) => x.distanceKm - y.distanceKm);
        if (best.length > limit) best.pop();
      }
    }
  }
  return best.map((b) => ({ zip: b.zip, distanceKm: Math.round(b.distanceKm * 10) / 10 }));
}

export function coordsForZip(geo: GeoData, zip: string): { lat: number; lon: number } | null {
  const i = geo.zips.indexOf(zip);
  return i === -1 ? null : { lat: geo.lat[i], lon: geo.lon[i] };
}
