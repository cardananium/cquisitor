# CQUISITOR

A browser-based investigator for [CBOR](https://cbor.io) and [Cardano](https://cardano.org) data. Paste a hex blob, get a structured view, and figure out what's actually in it — no node, no SDK, no shell required.

> **Live:** <https://cardananium.github.io/cquisitor/>

## Why you'd use it

- **A transaction won't submit and you don't know why.** Paste the CBOR into the Transaction Validator, plug in a Koios API key, and the tool fetches the on-chain context (input UTxOs, protocol params, dRep / pool / committee state, governance actions) and runs Phase 1 & 2 checks. Failures are pinned to the exact field that broke them.
- **You have an opaque CBOR blob and need to know what it is.** The Cardano CBOR tab decodes any of the well-known Cardano types (Transaction, NativeScript, PlutusScript, PlutusData, …) into a readable JSON tree, with CardanoScan links and address/key hashing for context.
- **You're poking at a non-Cardano CBOR.** General CBOR is a schema-agnostic explorer: a hex editor on one side, a structural tree on the other, no Cardano assumptions in the way.
- **You're writing or debugging a CDDL schema.** The CDDL Tool lets you edit a schema next to a CBOR blob, mapping parse and match errors onto both at the same time. All six Cardano ledger era schemas are one pick away; the Conway one ships with the app, so it needs no download at all.
- **You want to share a debugging session.** Most tabs have a Share button that bakes the current input into a URL.
- **You need to know whose address a transaction pays.** The address book names the addresses you trust, and flags an address that only looks like one of them — see [Address book](#address-book).

## How to use it

The app is a single page with four hash-routed tabs:

### Transaction Validator (`#transaction-validator`)
1. Paste a transaction CBOR (hex or base64) into the left panel.
2. Enter your [Koios API key](https://koios.rest/pricing/Pricing.html). The key is stored in `localStorage` and only ever sent to Koios.
3. Pick the network (mainnet / preprod / preview) and click **Validate**. The tool fetches the necessary on-chain state and runs Phase 1 & 2 validation.
4. Errors and warnings appear inline on the decoded JSON. Click any diagnostic to jump to the offending field; click the Share button to encode the current state into a URL.

### Cardano CBOR (`#cardano-cbor`)
1. Paste any Cardano CBOR (hex or base64).
2. The tool offers the candidate Cardano types it can decode the blob as. Pick one (Transaction, NativeScript, PlutusScript, PlutusData, …).
3. Inspect the decoded JSON. Known fields (transaction hashes, addresses, vkey hashes) get CardanoScan links and computed-hash sidecars where useful.

### General CBOR (`#general-cbor`)
1. Paste raw CBOR into the hex editor on the left.
2. The right panel renders a structural CBOR tree (maps, arrays, tags, primitives, indefinite-length items, oddities like non-canonical encoding).
3. Edit the hex; the tree re-renders live. Use this when you don't care about Cardano semantics and just want to see the bytes.

### CDDL Tool (`#cddl-validator`)
1. Four panels — **CDDL schema**, **CBOR hex**, **Decoded JSON**, **CBOR tree** — docked in a workspace: drag a tab onto another group or use its `⋮` menu to rearrange, pick a preset layout, or reset. The arrangement is remembered in the browser.
2. Edit the schema and the CBOR; mismatches show in red in the hex and on the tree rows, with the list behind the `✗ N mismatches` chip. Schema errors sit under the editor's toolbar. If the CBOR fits another root rule of the schema, that rule is picked for you, or you are asked which.
3. The **cardano** picker loads any ledger era schema (Shelley … Conway); Conway ships with the app, the rest download from `raw.githubusercontent.com`.
4. Hover a node in any panel to see it in the other three; right-click to pin it there.
5. **Share** puts the schema, the root rule and the CBOR into the URL.

### Address book

Every address a transaction shows carries a `+` button. Name an address once and it carries that name, and a green check, wherever it appears again.

- **Green check** — an address you saved. A contract address matches on its payment script, so one entry covers every address that contract uses.
- **Blue tag** — a script the [eternl Cardano registry](https://github.com/Tastenkunst/eternl-cardano-registry) names, e.g. `SundaeSwap · Liquidity Pool`. It is a third-party claim, not a check you made, and the badge says so. One click promotes it into your own book.
- **Amber warning** — the address is in neither list, and its first or last characters agree with one that is. That is what address poisoning looks like: an attacker grinds a key until the two ends of the string read like an address you trust. The tooltip shows both strings with the matching characters marked.

The **Addresses** button in the header opens the book: edit a label, delete an entry, export or import the list as JSON, and decide where the registry data comes from. The book lives in this browser's `localStorage` and goes nowhere else.

The registry ships with the app as a generated snapshot (`src/utils/addressbook/eternlRegistry.generated.ts`, refreshed with `bun scripts/refresh-eternl-registry.ts`), so a first visit needs no network call. It is then refreshed from `raw.githubusercontent.com` once a day, which keeps a newly classified contract named without a release; turn that off in the panel to use the snapshot alone. A reply that does not parse, or that carries too few scripts, is dropped and the snapshot stands.

All decoding, schema parsing, and validation runs entirely in the browser via the [`@cardananium/cquisitor-lib`](https://github.com/cardananium/cquisitor-lib) WASM bindings. The network is used for the Koios fetch in the Transaction Validator, for the CDDL Tool's era schemas, which come from `raw.githubusercontent.com` on a preset pick (Conway is bundled), and for the address book's daily registry refresh from the same host — see [SECURITY.md](./SECURITY.md) for details.

## Run locally

Requires [Bun](https://bun.sh) (`npm` works too).

```bash
bun install
bun run dev          # http://localhost:3000
bun run build        # production build
```

## Contributing

PRs are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for setup and conventions.

## Security

Found a vulnerability? Please **don't** open a public issue — follow [SECURITY.md](./SECURITY.md) for private reporting.

## License

[Apache 2.0](./LICENSE). CQUISITOR is provided **AS IS**, with no warranty and no liability for any use of it or its output — see [DISCLAIMER.md](./DISCLAIMER.md), and [SECURITY.md](./SECURITY.md#disclaimer) for usage caveats.

The Conway-era CDDL bundled with the CDDL Tool (`src/app/cddl-validator/conwaySchema.ts`) is a verbatim copy of `eras/conway/impl/cddl/data/conway.cddl` from [IntersectMBO/cardano-ledger](https://github.com/IntersectMBO/cardano-ledger), copyright 2018-2023 Input Output Global Inc (IOG), also under Apache 2.0.
