// Importing this module registers every protocol adapter via its self-
// registering side effect. Import it once near the transaction card view so all
// adapters are available before detection runs. Registration is idempotent.

// DEX (swaps)
import "@/utils/protocols/minswap";
import "@/utils/protocols/wingriders";
import "@/utils/protocols/splash";
import "@/utils/protocols/muesliswap";
import "@/utils/protocols/geniusyield";
import "@/utils/protocols/danogo";
import "@/utils/protocols/vyfinance";
import "@/utils/protocols/saturnswap";
import "@/utils/protocols/cswap";
import "@/utils/protocols/chakra";
import "@/utils/protocols/chadswap";
import "@/utils/protocols/snekfun";
// SundaeSwap V3 outputs are decoded separately (detectSundaeOutput), but its
// withdraw-zero scooper is recognized through the DEX-withdrawal registry.
import "@/utils/protocols/sundae/batcher";
// Aggregator-coverage gaps still NOT added (no distinct decodable on-chain
// contract): Axo (closed-source "xlang" swaps, protocol/front-end offline — no
// discoverable script hash) and Shadow Book (a virtual/off-chain order book that
// settles through other DEXes). SnekFun's post-graduation pools are Splash
// pools, decoded by the Splash adapter; the SnekFun adapter above covers the
// bonding-curve phase.
// DexHunter advanced orders: UNRESOLVED — only Minswap routing artifacts are
// present, not DexHunter's own DCA validator. DexHunter instant swaps already
// decode for free via the underlying DEX adapters above.

// Lending / borrowing
import "@/utils/protocols/liqwid";
import "@/utils/protocols/lenfi";
import "@/utils/protocols/fluidtokens";
import "@/utils/protocols/levvy";

// CDP / synthetics
import "@/utils/protocols/indigo";
import "@/utils/protocols/butane";
import "@/utils/protocols/djed";

// Liquid staking / derivatives
import "@/utils/protocols/optim";
import "@/utils/protocols/strike";

// Oracles
import "@/utils/protocols/charli3";
import "@/utils/protocols/orcfax";

// NFT marketplace
import "@/utils/protocols/jpgstore";

// Airdrop / token distribution (config datum + distribution lockbox)
import "@/utils/protocols/midnight";
