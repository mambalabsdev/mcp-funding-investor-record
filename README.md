# Funding Investor Record MCP Server

[![Smithery](https://smithery.ai/badge/mambabuilt/mcp-funding-investor-record)](https://smithery.ai/servers/mambabuilt/mcp-funding-investor-record) [![Glama score](https://glama.ai/mcp/servers/mambalabsdev/mcp-funding-investor-record/badges/score.svg)](https://glama.ai/mcp/servers/mambalabsdev/mcp-funding-investor-record) [![MCP Registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.modelcontextprotocol.io%2Fv0%2Fservers%3Fsearch%3Dcom.mambabuilt%252Fmcp-funding-investor-record%26limit%3D1&query=%24.servers%5B0%5D._meta%5B%22io.modelcontextprotocol.registry%2Fofficial%22%5D.status&label=mcp%20registry&color=blue)](https://registry.modelcontextprotocol.io/v0/servers?search=com.mambabuilt/mcp-funding-investor-record&limit=1) [![npm version](https://img.shields.io/npm/v/@mambalabsdev/mcp-funding-investor-record)](https://www.npmjs.com/package/@mambalabsdev/mcp-funding-investor-record) [![npm downloads](https://img.shields.io/npm/dm/@mambalabsdev/mcp-funding-investor-record)](https://www.npmjs.com/package/@mambalabsdev/mcp-funding-investor-record) [![license](https://img.shields.io/github/license/mambalabsdev/mcp-funding-investor-record)](https://github.com/mambalabsdev/mcp-funding-investor-record/blob/main/LICENSE) [![mcpservers.org](https://img.shields.io/badge/mcpservers.org-listed-blue)](https://mcpservers.org/servers/mambalabsdev/mcp-funding-investor-record)

An MCP server that returns a company funding record from SEC Form D, Companies House and press, each labeled with the source it came from. It wraps the Mamba Labs Funding Record from SEC and Companies House actor on Apify and returns a Clay-ready flat JSON row to any MCP client.

## What's Inside

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Prerequisites](#prerequisites)
- [Example prompts](#example-prompts)
- [Inputs](#inputs)
- [Output](#output)
- [Example output](#example-output)
- [Features](#features)
- [Full actor documentation](#full-actor-documentation)
- [Mamba Labs GTM Suite](#mamba-labs-gtm-suite)
- [License](#license)

## What it does

Give it a company name and domain and it reads primary sources and returns a funding record: SEC EDGAR Form D amounts, UK Companies House registration details, and press coverage of funding rounds. One flat row per company.

Every number travels with a `source_of_record` saying whether it came from a legal filing or from a press release, because those are not the same kind of fact and merging them is the defect this tool exists to prevent. Only an exact entity match, after corporate suffixes are stripped, populates an amount. A near match such as a differently named subsidiary goes to separate `related_entity` columns as a named lead and can never be summed into a total. This is not Crunchbase and not a resold database, so it returns less than a database would and what it returns has a filing behind it.

All of the lookup runs on Apify. This package is a thin client that calls the actor and hands back the result unchanged.

## Quick start

You need Node.js 18 or newer and an Apify account with an API token.

Add this to your Claude Desktop config:

```json
{
  "mcpServers": {
    "mamba-funding-investor-record": {
      "command": "npx",
      "args": ["-y", "@mambalabsdev/mcp-funding-investor-record"],
      "env": {
        "APIFY_TOKEN": "your-apify-token"
      }
    }
  }
}
```

Get your token at https://console.apify.com/account/integrations, paste it in, and restart Claude Desktop. The `get_company_funding_record` tool will be available.

## Prerequisites

- Node.js 18 or newer
- An Apify account with an API token
- Optional: your own Companies House REST API key, free at developer.company-information.service.gov.uk, if you want the UK columns populated

## Example prompts

- "Get the funding record for Anthropic at anthropic.com."
- "Has Notion filed a Form D in the last 24 months? Regulatory sources only."
- "Look up funding for this UK company and flag anything above 10 million dollars."
- "Show me press reported funding for figma.com and keep it separate from any filing."

## Inputs

- `company_domain` (optional): bare company domain, for example `notion.com`. Used to derive a company name when none is given, and carried on the row as the join key.
- `company_name` (optional but strongly recommended): every source here is searched by name rather than by domain, and the name is what the entity gate compares a filing against. A wrong or missing name is the largest source of wrong rows.
- `sources` (optional): which sources to query. One of `all`, `regulatory`, `sec_only`, `uk_only` or `press_only`. Regulatory sources are filings and are authoritative; press is the most recent and least verified. Choose `regulatory` when a number has to be defensible and `all` when recency matters more.
- `lookbackMonths` (optional): how far back to consider a filing. One of `12`, `24`, `36`, `60` or `120`, with 36 months the default. A Form D from six years ago is a real filing and usually not a current signal, and this is where you say which you mean.
- `minAmountUsd` (optional): one of `none`, `1000000`, `5000000`, `10000000` or `50000000`. It sets `amount_meets_threshold` on the row so you can filter to material raises without writing the comparison yourself. It never drops a row and never changes the amount returned.
- `companiesHouseApiKey` (optional): your own Companies House REST API key, free at developer.company-information.service.gov.uk. Without one the UK columns report `skipped` rather than guessing, and the SEC and press sources still run.
- `skipCache` (optional): when false (the default) a successful lookup is cached for seven days and reused. Set true to force a fresh fetch.

## Output

The tool returns the actor's flat JSON row for the company, with 32 snake_case fields and no nested objects. `source_of_record` says where a number came from, `form_d_entity_match` and `uk_entity_match` record how strict the entity match was, and `filings_rejected` counts what the entity gate turned away. See the Apify Store page for the full output schema.

## Example output

```json
{
  "degraded": false,
  "degradation_reason": null,
  "company_domain": "anthropic.com",
  "company_name": "Anthropic",
  "source_of_record": "multiple",
  "form_d_filed": true,
  "form_d_date": "2026-06-01",
  "form_d_entity_name": "WU Anthropic LP",
  "form_d_entity_match": "exact",
  "form_d_accession": "0002109576-26-000001",
  "filings_rejected": 56,
  "uk_company_number": "14604577",
  "uk_company_name": "ANTHROPIC LIMITED",
  "uk_company_status": "active",
  "uk_entity_match": "exact",
  "uk_incorporation_date": "2023-01-19",
  "press_amount": 65000000000,
  "press_currency": "$",
  "press_url": "https://techcrunch.com/2026/05/28/anthropic-raises-65-billion-nears-1t-valuation-ahead-of-ipo/",
  "related_entity_name": null,
  "amount_meets_threshold": null,
  "sources_queried": "sec_form_d, companies_house, press",
  "coverage": 0.9,
  "fetch_status": "ok",
  "run_date": "2026-08-23T09:56:16.906Z"
}
```

## Features

- SEC Form D filings, returned with the accession number
- UK Companies House registration details, with your own key
- Press coverage labeled as press and never merged with a filing
- Primary sources only, not a resold database
- Entity identity gate, so a near name match is rejected and recorded
- Rejection accounting in `filings_rejected` and `related_entity_note`
- 32 flat snake_case fields, one row per company

## Full actor documentation

This server is a thin client and holds no lookup logic. For the complete input and output reference, pricing, and run history, see the Apify Store page:

https://apify.com/mambalabs/funding-investor-record

---

## Mamba Labs GTM Suite

This server is one of the Mamba Labs GTM Suite MCP servers. Every actor in the suite takes a domain or a company and returns one flat row, so they stack in the same Clay table without reshaping anything. The actor behind this server is the Funding Record from SEC and Companies House, immutable Apify actor ID `OFS4Mt1gyYNtGfUbE`.

> Built by [Mamba Labs](https://github.com/mambalabsdev) | [npm](https://www.npmjs.com/org/mambalabsdev) | [Apify Store](https://apify.com/mambalabs)

## License

MIT

Built by Mamba Labs. https://apify.com/mambalabs
