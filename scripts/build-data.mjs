// Builds compact lookup data from the PRISM 2023 ZIP-code hardiness files and
// the US Census ZCTA gazetteer. Output is consumed by both the site and the Worker.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const raw = resolve(root, "data/raw");
const outDir = resolve(root, "src/generated");
const publicDir = resolve(root, "public/data");
mkdirSync(outDir, { recursive: true });
mkdirSync(publicDir, { recursive: true });

export const ZONES = [
  "1a", "1b", "2a", "2b", "3a", "3b", "4a", "4b", "5a", "5b", "6a", "6b", "7a",
  "7b", "8a", "8b", "9a", "9b", "10a", "10b", "11a", "11b", "12a", "12b", "13a", "13b",
];
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NONE = ".";

const files = ["us", "ak", "hi", "pr"].map((r) => `phzm_${r}_zipcode_2023.csv`);
const zipZone = new Map();
for (const f of files) {
  const p = resolve(raw, f);
  if (!existsSync(p)) {
    console.warn(`missing ${f}, skipping`);
    continue;
  }
  const lines = readFileSync(p, "utf8").trim().split(/\r?\n/).slice(1);
  for (const line of lines) {
    const [zip, zone] = line.split(",");
    if (!/^\d{5}$/.test(zip)) continue;
    const idx = ZONES.indexOf(zone.trim());
    if (idx < 0) throw new Error(`unknown zone ${zone} for ${zip}`);
    zipZone.set(zip, idx);
  }
}

// 100,000 chars, one per possible 5-digit ZIP. Index = numeric ZIP, char = zone.
const chars = new Array(100000).fill(NONE);
for (const [zip, idx] of zipZone) chars[Number(zip)] = ALPHABET[idx];
const zips = chars.join("");

writeFileSync(
  resolve(outDir, "zones.json"),
  JSON.stringify({ version: "2023", source: "USDA ARS / PRISM Group, Oregon State University", zones: ZONES, alphabet: ALPHABET, zips }),
);

// Gazetteer: tab-separated, GEOID INTPTLAT INTPTLONG. Keep only ZIPs that have a zone.
const gazPath = resolve(raw, "zcta_centroids_2024.csv");
const geo = { zips: [], lat: [], lon: [] };
if (existsSync(gazPath)) {
  const lines = readFileSync(gazPath, "utf8").trim().split(/\r?\n/).slice(1);
  for (const line of lines) {
    const [zip, lat, lon] = line.split(",");
    if (!zipZone.has(zip)) continue;
    geo.zips.push(zip);
    geo.lat.push(Number(lat));
    geo.lon.push(Number(lon));
  }
} else {
  console.warn("missing zcta_centroids_2024.csv; geo lookups will be empty");
}
writeFileSync(resolve(publicDir, "zip-geo.json"), JSON.stringify(geo));
writeFileSync(resolve(outDir, "zip-geo.json"), JSON.stringify(geo));

console.log(`zones: ${zipZone.size} ZIPs, geo: ${geo.zips.length} ZIPs with coordinates`);
