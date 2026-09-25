# OrderStorageKernel v0.4: 60-minute integration guide

Use this kit only when you are building a **new venue** that already owns its price selection,
custody, and settlement policy and needs resting maker orders with same-level FIFO plus atomic
cancel/repost. If an AMM, RFQ, offchain order service, or simple mapping meets the product need,
this kernel is not a fit.

The frozen tarball is not published to a registry. Work from this directory and verify it first:

```bash
sha256sum order-storage-preview.tgz
# 4fa0bd18bc5846313351d6fb4d79d6317ec4b7309180b86afee4916ec1b5012b
bash verify_and_run.sh
```

Requirements: a shell environment with Node.js 20+, npm, `tar`, and `sha256sum`. The demo uses a local
Ganache process and mock assets. It needs no key, RPC, Docker, or remote transaction.

## Suggested trial path

| Time | Action | Evidence |
|---|---|---|
| 0–15 min | Download the release, verify hashes, run `verify_and_run.sh` | `ORDER STORAGE HANDOFF DEMO PASS` and `INTEGRATOR KIT PASS` |
| 15–30 min | Read the API/unit table and the two host contracts | Identify maker auth, units, and settlement loop |
| 30–60 min | Map the kernel seam into a throwaway version of the developer's host | Adapter compiles against the tarball import |
| 60–90 min | Connect maker auth and units, then settle the first returned `Fill[]` | Own host runs post → bounded partial consume → cancel/refund |
| Follow-up | Inject settlement failure; compare code delta and benefit with the current implementation | Rollback evidence and completed `FEEDBACK_TEMPLATE.md` |

Finishing only the supplied demo in 15 minutes is not host integration. Conversely, taking longer
than 60 minutes to connect an unfamiliar host is not by itself evidence that the API is unsuitable;
record the blocking boundary and continue to the 90-minute checkpoint or follow-up review.

## Install and import

The example's `consumer/package.json` uses only the local artifact:

```json
"@monad-ac/order-storage-preview": "file:../order-storage-preview.tgz"
```

Import the library, initialize each market once, and bind maker identity in the host. Kernel calls
are internal library calls, not permissioned external entrypoints.

```solidity
import "@monad-ac/order-storage-preview/contracts/OrderStorageKernel.sol";

contract VenueHost {
    using OrderStorageKernel for bytes32;
    bytes32 public immutable marketId;

    constructor(bytes32 marketId_) {
        marketId = marketId_;
        marketId_.initialize();
    }

    function _post(uint64 levelId, uint96 lots) internal returns (uint96 handle) {
        // Host must authenticate msg.sender and escrow/validate assets first.
        handle = marketId.post(msg.sender, levelId, lots);
    }

    function _cancel(uint96 handle) internal returns (uint96 cancelledLots) {
        // Passing msg.sender makes kernel cancellation maker-only.
        cancelledLots = marketId.cancel(msg.sender, handle);
    }
}
```

## Exact API and units

| Call/result | Type and unit | Contract |
|---|---|---|
| `marketId` | `bytes32`; host-defined market namespace | Must be initialized once; include it in every order reference |
| `maker` | `address`; authenticated owner | Host supplies it; never trust arbitrary calldata as maker identity |
| `price` | nonzero `uint64`; opaque level ID | Not a monetary ratio and never multiplied by quantity |
| `quantity` | nonzero `uint96`; host-defined integer | Demo defines it as lots; kernel has no decimals |
| `handle` | `uint96 = generation << 32 \| index` | Reference is `(hostAddress, marketId, handle)`, not handle alone |
| `post(maker, price, quantity)` | returns live handle | Appends at the selected level's FIFO tail |
| `cancel(maker, handle)` | returns remaining quantity | Rejects foreign and stale handles; frees the slot |
| `consumeUpToWithFills(price, quantity, maxFills)` | returns `(Fill[], filled)` | Stops at requested quantity, empty level, or `maxFills` |
| `Fill.handle` | `uint96` | Generation-safe order identity for this market/host |
| `Fill.maker` | `address` | Settlement recipient selected from stored order, not calldata |
| `Fill.quantity` | host quantity units filled now | Demo: integer lots |
| `Fill.remaining` | same units left on that order | Zero means the node was removed and its index may later be reused |

`consumeWithFills` instead requires the full requested quantity and reverts on insufficient depth or
too many nodes. `consumeUpToWithFills` is the bounded-progress seam; the host must enforce its own
minimum received, maximum payment, deadline, residual, and `maxFills` cap.

## Atomic settlement seam

The runnable implementation is
[`consumer/contracts/DirectTakerContiguousOrderBook.sol`](consumer/contracts/DirectTakerContiguousOrderBook.sol).
Its essential ordering is:

```solidity
(OrderStorageKernel.Fill[] memory fills, uint96 actualLots) =
    marketId.consumeUpToWithFills(priceTick, maxLots, maxFills);

// Host guards are checked in the same transaction.
if (actualLots < minLotsReceived) revert MinimumLots(actualLots, minLotsReceived);
uint256 actualQuoteRaw = _quoteRaw(actualLots);
if (actualQuoteRaw > maxQuoteRaw) revert QuoteLimit(actualQuoteRaw, maxQuoteRaw);

_pullExact(quoteToken, msg.sender, actualQuoteRaw);
for (uint256 i; i < fills.length; ++i) {
    // Pricing and token units are host policy, not kernel policy.
    _pushExact(quoteToken, fills[i].maker, _quoteRaw(fills[i].quantity));
}
_pushExact(baseToken, msg.sender, _baseRaw(actualLots));
```

Any later revert rolls back the earlier kernel mutation and every token movement because they occur
in one EVM transaction. The example additionally checks exact token balance deltas and uses a
reentrancy guard. Those are reference-host choices, not kernel guarantees.

For the runnable reference, public quantities are integer lots:

```text
BASE raw  = lots × baseRawPerLot
QUOTE raw = lots × quoteRawPerLot
```

The fixture uses BASE 18 decimals, QUOTE 6 decimals, `baseRawPerLot = 10^16`,
`quoteRawPerLot = 10^4`, `minimumOrderLots = 2`, `minimumResidualLots = 2`, and one opaque tick
`100`. The separate 8-tick application extends price traversal; it is not part of the v0.4 tarball.

## Host obligations and stop conditions

The host must implement maker and matcher/taker authorization, asset custody, transfer semantics,
price selection, lot/decimal conversion, guards, fees, recovery, events/indexing, and a defensible
fill bound. Do not proceed if the product does not need onchain resting FIFO, cannot bound synchronous
settlement, needs proxy/delegatecall support, or uses tokens whose transfer behavior the host cannot
account for exactly.

The demo is self-authored evidence that the handoff can run. It is **not** independent adoption.
Use `ACCEPTANCE.md` for the trial gate and return findings in `FEEDBACK_TEMPLATE.md`.
