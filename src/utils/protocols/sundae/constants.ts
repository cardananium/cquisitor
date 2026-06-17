// Known SundaeSwap protocol script hashes by network and protocol version.
// Covers V3 mainnet, Stableswap mainnet, preview, and the V1 mainnet escrow.
//
// A future enhancement is to refresh these from https://api.sundae.fi/graphql
// at runtime so we stay in sync with redeploys.

export type SundaeProtocol = "V1" | "V3" | "Stableswap";

export type SundaeRole = "order" | "pool";

export interface SundaeScriptEntry {
  protocol: SundaeProtocol;
  role: SundaeRole;
  hash: string;
}

export interface SundaeRegistry {
  mainnet: SundaeScriptEntry[];
  preview: SundaeScriptEntry[];
}

// V1 mainnet script hashes for the addresses:
//   addr1wxaptpmxcxawvr3pzlhgnpmzz3ql43n2tc8mn3av5kx0yzs09tqh8 (escrow)
//   addr1w9qzpelu9hn45pefc0xr4ac4kdxeswq7pndul2vuj59u8tqaxdznu (pool)
const V1_MAINNET_ESCROW_HASH = "ba158766c1bae60e2117ee8987621441fac66a5e0fb9c7aca58cf20a";
const V1_MAINNET_POOL_HASH = "4020e7fc2de75a0729c3cc3af715b34d98381e0cdbcfa99c950bc3ac";

export const SUNDAE_REGISTRY: SundaeRegistry = {
  mainnet: [
    { protocol: "V1", role: "order", hash: V1_MAINNET_ESCROW_HASH },
    { protocol: "V1", role: "pool", hash: V1_MAINNET_POOL_HASH },
    { protocol: "V3", role: "order", hash: "fa6a58bbe2d0ff05534431c8e2f0ef2cbdc1602a8456e4b13c8f3077" },
    { protocol: "V3", role: "pool", hash: "e0302560ced2fdcbfcb2602697df970cd0d6a38f94b32703f51c312b" },
    { protocol: "Stableswap", role: "order", hash: "6ab62945d0d8d6288e243b3b6437ff9c099a38e088288f5a6b7c5e8b" },
    { protocol: "Stableswap", role: "pool", hash: "4de79a0c17180030bff4c36825cb6e99caa007bc632f789561a26d56" },
  ],
  preview: [
    { protocol: "V1", role: "order", hash: "730e7d146ad7427a23a885d2141b245d3f8ccd416b5322a31719977e" },
    { protocol: "V1", role: "pool", hash: "4f5cdaf2c324f68d275ae1ae1e984ecf475fad86d52fe90e3c63db78" },
    { protocol: "V3", role: "order", hash: "cfad1914b599d18bffd14d2bbd696019c2899cbdd6a03325cdf680bc" },
    { protocol: "V3", role: "pool", hash: "44a1eb2d9f58add4eb1932bd0048e6a1947e85e3fe4f32956a110414" },
  ],
};

export function lookupSundaeScript(
  hash: string,
  network: "mainnet" | "preview" | "preprod" | undefined,
): SundaeScriptEntry | null {
  const lower = hash.toLowerCase();
  // We only have mainnet + preview entries; preprod falls back to preview shape
  // when we add it. For now, search both lists so we still detect when network
  // is unknown.
  const tables: SundaeScriptEntry[][] = [];
  if (network === "mainnet") tables.push(SUNDAE_REGISTRY.mainnet);
  else if (network === "preview" || network === "preprod") tables.push(SUNDAE_REGISTRY.preview);
  else {
    tables.push(SUNDAE_REGISTRY.mainnet, SUNDAE_REGISTRY.preview);
  }
  for (const table of tables) {
    const match = table.find((e) => e.hash === lower);
    if (match) return match;
  }
  return null;
}
