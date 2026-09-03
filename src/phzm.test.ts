import { test } from "node:test";
import assert from "node:assert/strict";
import { assertValidZipcode, getHardinessZone } from "./phzm.js";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response) as unknown as typeof fetch;
}

test("rejects malformed ZIP codes", () => {
  assert.throws(() => assertValidZipcode("abc"));
  assert.throws(() => assertValidZipcode("1234"));
  assert.doesNotThrow(() => assertValidZipcode("90210"));
});

test("parses a successful response", async () => {
  const fetchImpl = fakeFetch(200, {
    zone: "10b",
    temperature_range: "35 to 40",
    coordinates: { lat: "34.088808", lon: "-118.40612" },
  });
  const result = await getHardinessZone("90210", fetchImpl);
  assert.equal(result.zipcode, "90210");
  assert.equal(result.zone, "10b");
  assert.equal(result.temperature_range, "35 to 40");
});

test("maps 404 to a friendly error", async () => {
  const fetchImpl = fakeFetch(404, {});
  await assert.rejects(
    () => getHardinessZone("00000", fetchImpl),
    /No hardiness zone found/,
  );
});
