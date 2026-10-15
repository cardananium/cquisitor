// Regenerate src/utils/addressbook/eternlRegistry.generated.ts from the
// eternl Cardano registry.
//
//   bun scripts/refresh-eternl-registry.ts
//
// The registry names the scripts behind the addresses a transaction pays to.
// `registry.ts` refreshes the same file over the network at runtime; this
// snapshot is what the address book starts from, so a first visit needs no
// network call and no third party decides what the labels say.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE =
  "https://raw.githubusercontent.com/Tastenkunst/eternl-cardano-registry/main/registry/scripts/script-index.json";

const OUT = join(
  import.meta.dir,
  "..",
  "src",
  "utils",
  "addressbook",
  "eternlRegistry.generated.ts",
);

// A registry key is a payment script hash (28 bytes), or that hash followed by
// a stake credential hash when the entry names one address instead of a
// credential.
const HASH_PATTERN = /^([0-9a-f]{56}|[0-9a-f]{112})$/;

interface RawScript {
  projectId?: unknown;
  name?: unknown;
  purpose?: unknown;
}

interface RawProject {
  label?: unknown;
  category?: unknown;
  subCategory?: unknown;
  link?: unknown;
}

interface RawIndex {
  metadata?: { generatedAt?: unknown; scriptCount?: unknown; projectCount?: unknown };
  scripts?: Record<string, RawScript>;
  projects?: Record<string, RawProject>;
}

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`HTTP ${res.status} for ${SOURCE}`);
const index = (await res.json()) as RawIndex;

const usable = Object.entries(index.scripts ?? {})
  .map(([hash, row]) => [hash.toLowerCase(), row] as const)
  .filter(
    ([hash, row]) =>
      HASH_PATTERN.test(hash) &&
      typeof row?.projectId === "string" &&
      typeof row?.name === "string",
  );

// The registry repeats most address keys (payment hash + stake hash) under the
// payment hash alone. A reader that falls back to the payment hash gets the
// same answer from the shorter row, so the longer one is only kept when it
// says something the shorter one does not.
const byPayment = new Map<string, RawScript>();
for (const [hash, row] of usable) {
  if (hash.length === 56) byPayment.set(hash, row);
}
const scripts = usable
  .filter(([hash, row]) => {
    if (hash.length === 56) return true;
    const shorter = byPayment.get(hash.slice(0, 56));
    return !shorter || shorter.projectId !== row.projectId || shorter.name !== row.name;
  })
  .sort(([a], [b]) => a.localeCompare(b));

const projects = Object.entries(index.projects ?? {})
  .filter(([, row]) => typeof row?.label === "string")
  .sort(([a], [b]) => a.localeCompare(b));

if (scripts.length === 0) throw new Error("the index carries no usable scripts");
const dropped = Object.keys(index.scripts ?? {}).length - scripts.length;
console.log(
  `${scripts.length} scripts, ${projects.length} projects, ${dropped} rows dropped (unusable or repeated)`,
);

const str = (value: unknown): string => JSON.stringify(String(value));

const projectRows = projects
  .map(([id, row]) => {
    const fields = [`label: ${str(row.label)}`];
    if (typeof row.category === "string") fields.push(`category: ${str(row.category)}`);
    if (typeof row.subCategory === "string") fields.push(`subCategory: ${str(row.subCategory)}`);
    if (typeof row.link === "string") fields.push(`link: ${str(row.link)}`);
    return `    ${str(id)}: { ${fields.join(", ")} },`;
  })
  .join("\n");

// One script is one tuple: [projectId, name, purpose?]. The upstream file also
// carries the script type and the Plutus version, which no label needs.
const scriptRows = scripts
  .map(([hash, row]) => {
    const fields = [str(row.projectId), str(row.name)];
    if (typeof row.purpose === "string") fields.push(str(row.purpose));
    return `    ${str(hash)}: [${fields.join(", ")}],`;
  })
  .join("\n");

const generatedAt =
  typeof index.metadata?.generatedAt === "string" ? index.metadata.generatedAt : null;
const today = new Date().toISOString().slice(0, 10);

writeFileSync(
  OUT,
  `// Snapshot of the eternl Cardano registry's script index.
//
// GENERATED — do not edit by hand. Refresh with:
//   bun scripts/refresh-eternl-registry.ts
//
// Source: https://github.com/Tastenkunst/eternl-cardano-registry
//   registry/scripts/script-index.json
//
// A script row is [projectId, name, purpose?]; the reader in registryData.ts
// takes this shape and the upstream object shape alike. The address book reads
// the snapshot first, then replaces it with a fresh copy over the network when
// the viewer leaves that setting on.
//
// ${scripts.length} scripts, ${projects.length} projects.
// Upstream generated it ${generatedAt ?? "at an unreported time"}; captured ${today}.

export const ETERNL_REGISTRY_CAPTURED_AT = ${str(today)};

export const ETERNL_SCRIPT_INDEX = {
  metadata: { generatedAt: ${generatedAt === null ? "null" : str(generatedAt)} },
  projects: {
${projectRows}
  },
  scripts: {
${scriptRows}
  },
} as const;
`,
);

console.log(`wrote ${OUT}`);
