#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getHardinessZone, type HardinessZoneResult } from "./phzm.js";

const server = new McpServer({
  name: "agmcp",
  version: "0.1.0",
});

const zoneShape = {
  zipcode: z.string(),
  zone: z.string(),
  temperature_range: z.string(),
  coordinates: z.object({ lat: z.string(), lon: z.string() }),
};
const zoneObject = z.object(zoneShape);

function formatZone(r: HardinessZoneResult): string {
  return [
    `ZIP code: ${r.zipcode}`,
    `USDA hardiness zone: ${r.zone}`,
    `Average annual extreme minimum temperature: ${r.temperature_range} °F`,
    `Coordinates: ${r.coordinates.lat}, ${r.coordinates.lon}`,
  ].join("\n");
}

server.registerTool(
  "get_hardiness_zone",
  {
    title: "Get USDA hardiness zone",
    description:
      "Look up the USDA Plant Hardiness Zone for a US ZIP code. Returns the " +
      "zone (e.g. '10b'), the average annual extreme minimum temperature range " +
      "in °F, and the ZIP centroid coordinates.",
    inputSchema: {
      zipcode: z
        .string()
        .describe("A 5-digit US ZIP code, e.g. '90210'."),
    },
    outputSchema: zoneShape,
  },
  async ({ zipcode }) => {
    try {
      const result = await getHardinessZone(zipcode);
      return {
        content: [{ type: "text", text: formatZone(result) }],
        structuredContent: { ...result },
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          { type: "text", text: err instanceof Error ? err.message : String(err) },
        ],
      };
    }
  },
);

server.registerTool(
  "compare_hardiness_zones",
  {
    title: "Compare USDA hardiness zones",
    description:
      "Look up and compare USDA Plant Hardiness Zones for multiple US ZIP codes " +
      "at once. Useful for deciding where a given plant will overwinter.",
    inputSchema: {
      zipcodes: z
        .array(z.string())
        .min(1)
        .max(25)
        .describe("A list of 5-digit US ZIP codes to compare."),
    },
    outputSchema: {
      zones: z.array(zoneObject),
      errors: z.array(z.object({ zipcode: z.string(), error: z.string() })),
    },
  },
  async ({ zipcodes }) => {
    const results = await Promise.all(
      zipcodes.map(async (zipcode) => {
        try {
          return { ok: true as const, value: await getHardinessZone(zipcode) };
        } catch (err) {
          return {
            ok: false as const,
            zipcode,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    const lines = results.map((r) =>
      r.ok
        ? `${r.value.zipcode}: zone ${r.value.zone} (${r.value.temperature_range} °F)`
        : `${r.zipcode}: error — ${r.error}`,
    );

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: {
        zones: results.flatMap((r) => (r.ok ? [{ ...r.value }] : [])),
        errors: results.flatMap((r) =>
          r.ok ? [] : [{ zipcode: r.zipcode, error: r.error }],
        ),
      },
    };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("agmcp MCP server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
