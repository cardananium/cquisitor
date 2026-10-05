// Regenerate src/utils/protocols/sundae/v4Hashes.generated.ts from the live
// SundaeSwap GraphQL APIs.
//
//   bun scripts/refresh-sundae-v4-hashes.ts
//
// V4 is deployed per environment, and its validators are parameterized, so a
// hash is only meaningful against the deployment it belongs to. `v4Registry.ts`
// reads them from the API at runtime; this table is the synchronous fallback it
// starts from, so refresh it whenever V4 is redeployed.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const NETWORKS = ["mainnet", "preview", "preprod"] as const;
type Network = (typeof NETWORKS)[number];

const OUT = join(
  import.meta.dir,
  "..",
  "src",
  "utils",
  "protocols",
  "sundae",
  "v4Hashes.generated.ts",
);

const QUERY = `
  query Protocols {
    protocols {
      version
      blueprint { validators { title hash } }
    }
  }
`;

interface RawProtocol {
  version: string;
  blueprint: { validators: Array<{ title: string; hash: string }> | null } | null;
}

function endpointFor(network: Network): string {
  return network === "mainnet"
    ? "https://api.sundae.fi/graphql"
    : `https://api.${network}.sundae.fi/graphql`;
}

async function fetchValidators(network: Network): Promise<Record<string, string>> {
  const res = await fetch(endpointFor(network), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY }),
  });
  if (!res.ok) throw new Error(`${network}: HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: { protocols?: RawProtocol[] | null };
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) throw new Error(`${network}: ${json.errors[0].message}`);
  const v4 = (json.data?.protocols ?? []).find((p) => p.version === "V4");
  if (!v4) throw new Error(`${network}: no V4 protocol reported`);

  const table: Record<string, string> = {};
  for (const v of v4.blueprint?.validators ?? []) {
    if (v.title && v.hash) table[v.title] = v.hash.toLowerCase();
  }
  if (Object.keys(table).length === 0) {
    throw new Error(`${network}: V4 blueprint carries no validators`);
  }
  return table;
}

const tables: Record<string, Record<string, string>> = {};
for (const network of NETWORKS) {
  tables[network] = await fetchValidators(network);
  console.log(`${network}: ${Object.keys(tables[network]).length} validators`);
}

const body = NETWORKS.map((network) => {
  const rows = Object.entries(tables[network])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, hash]) => `    ${JSON.stringify(title)}: ${JSON.stringify(hash)},`)
    .join("\n");
  return `  ${network}: {\n${rows}\n  },`;
}).join("\n");

const today = new Date().toISOString().slice(0, 10);

writeFileSync(
  OUT,
  `// Snapshot of the deployed SundaeSwap V4 script hashes, per network.
//
// GENERATED — do not edit by hand. Refresh with:
//   bun scripts/refresh-sundae-v4-hashes.ts
//
// The authoritative source is the \`protocols\` query on the
// environment-specific GraphQL API (api.sundae.fi, api.preview.sundae.fi,
// api.preprod.sundae.fi). \`v4Registry.ts\` refreshes from there in the
// background; this table is the synchronous fallback so detection works
// offline and on first paint, and still resolves after a redeploy once the
// refresh lands.
//
// Validator titles are the API's own (\`blueprint.validators[].title\`), e.g.
// "order.spend", "pool.spend", "basic_order.withdraw". A ".supersededN"
// suffix marks a retired deployment the API still reports.
//
// Captured ${today}.

import type { V4ValidatorTable } from "./v4Registry";

export const V4_HASHES: Record<"mainnet" | "preview" | "preprod", V4ValidatorTable> = {
${body}
};
`,
);

console.log(`wrote ${OUT}`);
