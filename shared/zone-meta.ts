// Zone metadata: temperature bands, official USDA 2023 map colors, and rough
// frost-window estimates. Frost dates are horticultural rules of thumb, not
// PRISM data; they vary a lot by elevation, microclimate, and year.
export const ZONE_CODES = [
  "1a", "1b", "2a", "2b", "3a", "3b", "4a", "4b", "5a", "5b", "6a", "6b", "7a",
  "7b", "8a", "8b", "9a", "9b", "10a", "10b", "11a", "11b", "12a", "12b", "13a", "13b",
] as const;

export type ZoneCode = (typeof ZONE_CODES)[number];

export interface ZoneMeta {
  code: ZoneCode;
  zone: number;
  half: "a" | "b";
  minF: number;
  maxF: number;
  minC: number;
  maxC: number;
  color: string;
  /** Approximate typical last spring frost window (month/day), null if frost is rare. */
  lastFrost: { from: string; to: string } | null;
  /** Approximate typical first fall frost window. */
  firstFrost: { from: string; to: string } | null;
  /** Approximate frost-free growing season length in days. */
  seasonDays: number;
}

const COLORS: Record<ZoneCode, string> = {
  "1a": "#d6d6ff", "1b": "#c4c4f2", "2a": "#ababd9", "2b": "#ebc3ff", "3a": "#e3a1f0",
  "3b": "#cf82e2", "4a": "#a765d3", "4b": "#7a4fbd", "5a": "#6b8ad9", "5b": "#5b7dd1",
  "6a": "#4e9c3a", "6b": "#78b849", "7a": "#a2cf5f", "7b": "#c9df6f", "8a": "#e6e37e",
  "8b": "#f0d15a", "9a": "#f2b33d", "9b": "#f0902e", "10a": "#e6602e", "10b": "#e0402a",
  "11a": "#c62828", "11b": "#a51e1e", "12a": "#8b1a3a", "12b": "#6e1230", "13a": "#4a0f2a",
  "13b": "#2e0a1f",
};

// [lastFrostFrom, lastFrostTo, firstFrostFrom, firstFrostTo, seasonDays]
const FROST: Record<number, [string | null, string | null, string | null, string | null, number]> = {
  1: ["06-01", "06-30", "07-15", "08-15", 60],
  2: ["05-15", "06-15", "08-15", "09-01", 90],
  3: ["05-15", "06-01", "09-01", "09-15", 110],
  4: ["05-01", "05-31", "09-15", "10-01", 135],
  5: ["04-15", "05-15", "10-01", "10-15", 160],
  6: ["04-01", "04-30", "10-15", "10-31", 185],
  7: ["03-15", "04-15", "10-31", "11-15", 215],
  8: ["03-01", "03-30", "11-15", "11-30", 245],
  9: ["02-01", "02-28", "12-01", "12-15", 285],
  10: ["01-15", "01-31", "12-15", "12-31", 330],
  11: [null, null, null, null, 365],
  12: [null, null, null, null, 365],
  13: [null, null, null, null, 365],
};

export const ZONE_META: Record<ZoneCode, ZoneMeta> = Object.fromEntries(
  ZONE_CODES.map((code, i) => {
    const zone = Math.floor(i / 2) + 1;
    const half = i % 2 === 0 ? "a" : "b";
    const minF = -60 + i * 5;
    const maxF = minF + 5;
    const f = FROST[zone];
    return [
      code,
      {
        code,
        zone,
        half,
        minF,
        maxF,
        minC: Math.round(((minF - 32) * 5) / 9),
        maxC: Math.round(((maxF - 32) * 5) / 9),
        color: COLORS[code],
        lastFrost: f[0] ? { from: f[0]!, to: f[1]! } : null,
        firstFrost: f[2] ? { from: f[2]!, to: f[3]! } : null,
        seasonDays: f[4],
      } satisfies ZoneMeta,
    ];
  }),
) as Record<ZoneCode, ZoneMeta>;

export function isZoneCode(s: string): s is ZoneCode {
  return (ZONE_CODES as readonly string[]).includes(s);
}

export function normalizeZone(input: string): ZoneCode | null {
  const s = input.trim().toLowerCase().replace(/^zone\s*/, "");
  if (isZoneCode(s)) return s;
  // "7" -> "7a" (colder half, conservative)
  if (/^\d{1,2}$/.test(s) && isZoneCode(`${s}a`)) return `${s}a` as ZoneCode;
  return null;
}

export function zoneIndex(code: ZoneCode): number {
  return ZONE_CODES.indexOf(code);
}

export function describeZone(m: ZoneMeta): string {
  return `Zone ${m.code}: average annual extreme minimum temperature ${m.minF} to ${m.maxF} °F (${m.minC} to ${m.maxC} °C).`;
}
