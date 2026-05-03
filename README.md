# CQUISITOR

A browser-based investigator for [CBOR](https://cbor.io) and [Cardano](https://cardano.org) data. Paste a hex blob, get a structured view, and figure out what's actually in it — no node, no SDK, no shell required.

> **Live:** <https://cardananium.github.io/cquisitor/>

## Why you'd use it

- **A transaction won't submit and you don't know why.** Paste the CBOR into the Transaction Validator, plug in a Koios API key, and the tool fetches the on-chain context (input UTxOs, protocol params, dRep / pool / committee state, governance actions) and runs Phase 1 & 2 checks. Failures are pinned to the exact field that broke them.
- **You have an opaque CBOR blob and need to know what it is.** The Cardano CBOR tab decodes any of the well-known Cardano types (Transaction, NativeScript, PlutusScript, PlutusData, …) into a readable JSON tree, with CardanoScan links and address/key hashing for context.
- **You're poking at a non-Cardano CBOR.** General CBOR is a schema-agnostic explorer: a hex editor on one side, a structural tree on the other, no Cardano assumptions in the way.
- **You're writing or debugging a CDDL schema.** The CDDL Validator lets you edit a schema next to a CBOR blob, mapping parse and match errors onto both at the same time. The current Conway-era Cardano CDDL is preloaded.
- **You want to share a debugging session.** Most tabs have a Share button that bakes the current input into a URL.

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

### CDDL Validator (`#cddl-validator`)
1. Top-left: a CDDL schema editor (Conway-era Cardano CDDL is preloaded — you can replace it).
2. Top-right: a CBOR hex editor.
3. Bottom: three output tabs — **Validation** (CDDL parse errors + CBOR-against-schema diagnostics), **Decoded** (the schema-mapped JSON tree), **Tree** (raw CBOR structure).
4. Right-click on any panel to pin a node; the corresponding location is highlighted across the other panels.

All decoding, schema parsing, and validation runs entirely in the browser via the [`@cardananium/cquisitor-lib`](https://github.com/cardananium/cquisitor-lib) WASM bindings. The only network call is the Koios fetch in the Transaction Validator — see [SECURITY.md](./SECURITY.md) for details.

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

[Apache 2.0](./LICENSE). CQUISITOR is provided **AS IS**, with no warranty and no liability — see the LICENSE for details and [SECURITY.md](./SECURITY.md#disclaimer) for usage caveats.
