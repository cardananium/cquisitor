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
