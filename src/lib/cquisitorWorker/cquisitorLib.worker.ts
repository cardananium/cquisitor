// Worker that owns the page's wasm instance. One instance, one call at a time,
// so the schema cache is shared. The library serves its own protocol; this file
// only names the module and the port.

import { serveWasm, type PortSource } from "@cardananium/cquisitor-lib/worker";

serveWasm(import("@cardananium/cquisitor-lib/wasm"), self as unknown as PortSource);
