import { z } from "zod";

/**
 * Client for phzmapi.org, a free API that serves USDA Plant Hardiness Zone
 * data keyed by US ZIP code. No API key required.
 */

const PHZM_BASE_URL = "https://phzmapi.org";

export const HardinessZoneSchema = z.object({
  zone: z.string(),
  temperature_range: z.string(),
  coordinates: z.object({
    lat: z.string(),
    lon: z.string(),
  }),
});

export type HardinessZone = z.infer<typeof HardinessZoneSchema>;

export interface HardinessZoneResult extends HardinessZone {
  zipcode: string;
}

const ZIPCODE_RE = /^\d{5}$/;

export function assertValidZipcode(zipcode: string): void {
  if (!ZIPCODE_RE.test(zipcode)) {
    throw new Error(
      `Invalid ZIP code "${zipcode}". Expected a 5-digit US ZIP code, e.g. "90210".`,
    );
  }
}

/**
 * Look up the USDA hardiness zone for a single 5-digit US ZIP code.
 * `fetchImpl` is injectable so the logic can be tested without network access.
 */
export async function getHardinessZone(
  zipcode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HardinessZoneResult> {
  assertValidZipcode(zipcode);

  const res = await fetchImpl(`${PHZM_BASE_URL}/${zipcode}.json`);
  if (res.status === 404) {
    throw new Error(`No hardiness zone found for ZIP code "${zipcode}".`);
  }
  if (!res.ok) {
    throw new Error(
      `phzmapi.org returned HTTP ${res.status} for ZIP code "${zipcode}".`,
    );
  }

  const data = HardinessZoneSchema.parse(await res.json());
  return { zipcode, ...data };
}
