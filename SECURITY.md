# Security Policy

## Supported versions

CQUISITOR is a single-page application served as a static site. Only the latest deployment at <https://cardananium.github.io/cquisitor/> and the current `main` branch receive security fixes.

## Reporting a vulnerability

If you believe you have found a security issue, **please do not open a public GitHub issue**. Instead, report it privately:

- Use GitHub's [private vulnerability reporting](https://github.com/cardananium/cquisitor/security/advisories/new) on this repository, **or**
- Email the maintainers via the contact listed on the [cardananium GitHub organization](https://github.com/cardananium).

Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce, ideally with a minimal CBOR hex / CDDL snippet or HTTP request.
- The affected route (e.g. `/cardano-cbor`, `/cddl-validator`) and browser, if relevant.

We will look into reports as time allows. Coordinated disclosure is appreciated.

## Scope

In scope:

- The CQUISITOR web app (this repository) and its handling of user-supplied CBOR / CDDL input.
- Dependencies pinned in `package.json` when the issue manifests through CQUISITOR.

Out of scope (please report upstream instead):

- Vulnerabilities in [`@cardananium/cquisitor-lib`](https://github.com/cardananium/cquisitor-lib) — the WASM library — should be reported on that repository.
- Issues in third-party libraries that do not affect CQUISITOR's behavior.
- Findings that require a malicious or compromised browser extension to exploit.

## Safe testing

CQUISITOR is a client-side tool with no backend of its own — all CBOR / CDDL parsing, decoding, and schema validation happens locally in the browser. Some features additionally call public third-party APIs (e.g. on-chain context providers for transaction validation, DEX/protocol metadata lookups for richer transaction views); the exact set evolves over time. In every case the request carries only what that specific feature needs (an identifier, a hash, an offset — never raw transaction hex or arbitrary user input), and any keys you enter are kept in `localStorage` and sent only to the service you registered them with. If you'd rather avoid all third-party calls, run a local copy with `bun run dev` and don't trigger features that explicitly need external data. When testing on the public deployment, please avoid pasting sensitive data (e.g. mainnet keys).

## Safe harbor

We will not pursue legal action against, or ask law-enforcement to investigate, anyone conducting good-faith security research against CQUISITOR — provided that you:

- Make a reasonable effort to avoid privacy violations, data destruction, and service interruption for other users.
- Use only your own data (or test fixtures) when probing for vulnerabilities.
- Give us a reasonable opportunity to respond before public disclosure.
- Do not exploit a vulnerability beyond what is necessary to confirm it.

If you act in good faith and follow this policy, we will treat your report as authorised research.

## Disclaimer

CQUISITOR is provided "AS IS" with no warranty and no liability — see [LICENSE](./LICENSE), Sections 7 (Disclaimer of Warranty) and 8 (Limitation of Liability). Use at your own risk.

A couple of practical notes worth highlighting:

- Decoded structures, validation verdicts, and any data fetched from third-party APIs or supplied via shared URLs are **for informational purposes only**. They may be incomplete, out of date, or wrong.
- Do **not** treat CQUISITOR's output as authoritative when deciding whether to sign, submit, or rely on a transaction. Always cross-check critical information against an independent source (your wallet, a node you control, the relevant Cardano specs) before acting on it.
