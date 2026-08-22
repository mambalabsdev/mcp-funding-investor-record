#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(here, "..", "package.json"), "utf8"),
) as { version: string; name: string };

// Distinctive UA so Apify run meta.userAgent marks MCP-originated runs.
const USER_AGENT = `mambalabs-mcp ${pkg.name}@${pkg.version}`;

const APIFY_TOKEN = process.env.APIFY_TOKEN;

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
};

// Drop undefined values so optional inputs are not sent to the actor at all.
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// The actor types its switches as strings ("true"/"false") for Clay
// compatibility, because Clay sends every input as a string and a boolean typed
// field silently receives "false" and reads it as truthy. The model gets a real
// boolean and the actor gets the string it validates.
function boolToString(v: boolean | undefined): string | undefined {
  return v === undefined ? undefined : v ? "true" : "false";
}

// actorPath is the actor's IMMUTABLE Apify actor id, not its slug, so a Store
// rename never breaks these calls.
async function runActor(
  actorPath: string,
  actorLabel: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  if (!APIFY_TOKEN) {
    return { isError: true, content: [{ type: "text", text: "APIFY_TOKEN is not set. Create a token at https://console.apify.com/account/integrations and set it as the APIFY_TOKEN environment variable." }] };
  }

  // memory=512 is deliberate and matches the actor's declared
  // defaultRunOptions.memoryMbytes. run-sync-get-dataset-items runs at 2048 MB
  // unless told otherwise, and `apify-actor-start` bills once per GB with a
  // minimum of one, so leaving the default in place would charge the caller
  // more start events per run than the actor asks for. Keep this in step with
  // the actor's defaultRunOptions.
  const url = `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items?timeout=300&memory=512`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${APIFY_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(input),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not reach the Apify API: ${message}` }] };
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = ` ${body.error.message}`;
    } catch {
      detail = "";
    }

    let message: string;
    switch (response.status) {
      case 401:
        message = "Invalid Apify token. Check your APIFY_TOKEN environment variable.";
        break;
      case 402:
        message = "Insufficient Apify credits. Check your account balance at https://console.apify.com/billing";
        break;
      case 408:
        message = `The ${actorLabel} run timed out after 300 seconds. Try again, or run the actor on Apify directly for longer jobs.`;
        break;
      default:
        message = `Apify request to ${actorLabel} failed with status ${response.status}.${detail}`;
    }
    return { isError: true, content: [{ type: "text", text: message }] };
  }

  // A 2xx normally carries the dataset array. Pass actor output through
  // unchanged: the wrapper must never reinterpret a status field, because
  // not_extractable, blocked and not_found are different answers and collapsing
  // them is exactly the defect the actor was built to avoid.
  const items = await response.json();
  return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
}

const server = new McpServer({
  name: "mamba-funding-investor-record",
  version: pkg.version,
});

// Funding Record from SEC and Companies House (immutable actor ID OFS4Mt1gyYNtGfUbE)
server.registerTool(
  "get_company_funding_record",
  {
    title: "Get Company Funding Record",
    description:
      "Return a company's funding record from PRIMARY sources: SEC EDGAR Form D filings, UK Companies House registrations and press coverage. Returns one flat Clay ready row in which every number carries a source_of_record saying whether it came from a legal filing or a press release, because those are not the same kind of fact and merging them is the defect this tool exists to prevent. Only an EXACT entity match after corporate suffixes are stripped populates an amount; a near match such as a differently named subsidiary goes to separate related_entity columns as a named lead and can never be summed into a total. Not Crunchbase and not a resold database. Read only; requires an APIFY_TOKEN and consumes Apify credits per call.",
    annotations: {
      title: "Get Company Funding Record",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      company_domain: z.string()
        .optional()
        .describe("Bare company domain, for example notion.com. Used to derive a company name when none is given, and carried on the row as the join key."),
      company_name: z.string()
        .optional()
        .describe("Strongly recommended here. Every source in this actor is searched by NAME, not by domain, and the name is what the entity gate compares a filing against. A wrong or missing name is the single largest source of wrong rows."),
      sources: z.enum(["all", "regulatory", "sec_only", "uk_only", "press_only"])
        .optional()
        .describe("Which sources to query. Regulatory sources are filings and are authoritative; press is the most recent and least verified. Choose \"regulatory\" when a number has to be defensible and \"all\" when recency matters more. Sent as a string for Clay compatibility."),
      lookbackMonths: z.enum(["12", "24", "36", "60", "120"])
        .optional()
        .describe("How far back to consider a filing. 36 months by default. A Form D from six years ago is a real filing and usually not a current signal, and this is where you say which you mean. Sent as a string for Clay compatibility."),
      minAmountUsd: z.enum(["none", "1000000", "5000000", "10000000", "50000000"])
        .optional()
        .describe("Sets amount_meets_threshold on the row so you can filter to material raises without writing the comparison yourself. It never drops a row and never changes the amount returned. Sent as a string for Clay compatibility."),
      companiesHouseApiKey: z.string()
        .optional()
        .describe("YOUR OWN Companies House REST API key, free at developer.company-information.service.gov.uk. OPTIONAL: without one the UK columns report skipped rather than guessing, and the SEC and press sources still run. Marked secret, so the value never renders on this page."),
      skipCache: z.boolean()
        .optional()
        .describe("When \"false\" (default) a successful lookup is cached for seven days and reused, which costs you nothing on a repeated run. Set \"true\" to force a fresh fetch. Sent as a string for Clay compatibility."),
    },
  },
  async ({ company_domain, company_name, sources, lookbackMonths, minAmountUsd, companiesHouseApiKey, skipCache }) => {
    return runActor(
      "OFS4Mt1gyYNtGfUbE",
      "Funding Record from SEC and Companies House",
      compact({
        company_domain,
        company_name,
        sources,
        lookbackMonths,
        minAmountUsd,
        companiesHouseApiKey,
        skipCache: boolToString(skipCache),
      }),
    );
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
