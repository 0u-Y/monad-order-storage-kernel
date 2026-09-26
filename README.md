# OrderStorageKernel

`OrderStorageKernel` is a custody-free Solidity library for venue developers
who need same-price FIFO, maker-owned cancellation, generation-safe handles,
slot reuse, and bounded synchronous fill receipts.

It deliberately does **not** choose prices, custody tokens, authenticate a
matcher, charge fees, or settle trades. Those policies belong to the importing
host. The repository includes a reference host and mock assets to demonstrate
that seam; it is not a production exchange or a CLOB.

## Status

- Public source preview: `v0.4.1`
- License: MIT
- Audit: **none**; do not place production funds at risk without an independent
  security review and a host-specific invariant suite
- Registry publication: none; install from a pinned Git commit or release asset
- Default allocator: contiguous/global
- Experimental sharded allocator: not included in this product repository

## Five-minute check

Requirements: Node.js 20+, npm, `tar`, and `sha256sum`. No key, RPC, Docker, or
Foundry is required.

```bash
git clone https://github.com/0u-Y/monad-order-storage-kernel.git
cd monad-order-storage-kernel
npm test
```

Expected terminal lines:

```text
SOURCE DISTRIBUTION PASS
ORDER STORAGE HANDOFF DEMO PASS
INTEGRATOR KIT PASS
KERNEL INVARIANT SMOKE PASS
```

The test deploys mock BASE18/QUOTE6 and a reference host to an ephemeral local
chain, posts two makers in FIFO order, consumes across both, cancels the
residual, and checks allowances, balances, escrow, and the empty queue.

## Use from Solidity

Pin the repository commit in your dependency process, then import:

```solidity
import "monad-order-storage-kernel/contracts/OrderStorageKernel.sol";

contract VenueStorage {
    using OrderStorageKernel for bytes32;

    function post(bytes32 marketId, uint64 priceTick, uint96 quantity)
        external returns (uint96 handle)
    {
        return marketId.post(msg.sender, priceTick, quantity);
    }
}
```

The settlement seam is:

```solidity
(OrderStorageKernel.Fill[] memory fills, uint96 filled) =
    marketId.consumeUpToWithFills(priceTick, requested, maxFills);

// Validate taker guards and settle every fill here. A later revert rolls the
// kernel mutations back with the host's asset transfers.
```

An order reference is `(hostAddress, marketId, handle)`. A numeric handle is
only market-scoped; it is not globally unique. `priceTick` is an opaque level
identifier and `quantity` has no currency unit until the host assigns one.

## Repository map

| Path | Purpose |
|---|---|
| [`contracts/OrderStorageKernel.sol`](contracts/OrderStorageKernel.sol) | Directly reviewable kernel source |
| [`docs/API.md`](docs/API.md) | Complete interface, handles, errors, and invariants |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Kernel/host seam and storage model |
| [`SECURITY.md`](SECURITY.md) | Threat model, unsupported configurations, disclosure |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Integration and release checklist |
| [`consumer/`](consumer/) | Exact-transfer single-price settlement reference |
| [`examples/multi-price/`](examples/multi-price/) | Exact source of the public eight-tick testnet reference |
| [`order-storage-preview.tgz`](order-storage-preview.tgz) | Frozen v0.4 trial package retained for reproducibility |

## Evidence, not marketing

The public Monad testnet reference is a separate eight-tick, one-sided mock
inventory application:

- Host: [`0xF33F…8709`](https://testnet.monadscan.com/address/0xF33Fe3D722d2Df7E07c053E83EAe270d38aF8709)
- Mock BASE: [`0x0a87…d7B4`](https://testnet.monadscan.com/address/0x0a876472e0C136baf7DDb8b21C7c992E36ecd7B4)
- Mock QUOTE: [`0xD599…6BD5`](https://testnet.monadscan.com/address/0xD599C4a2C4599E2Eb46607A253a94d0F8AC96BD5)

It proves that the reference flow executed with mock assets. It does not prove
production custody, demand, universal gas savings, or safe use with arbitrary
ERC-20 tokens. Known negative results are part of the product contract:

- a one-fill path can cost more than a conventional linked implementation;
- a 256-active-order `1 cancel + 1 post` whole-host path regressed in a tested
  fixture;
- a host-level 32-fill cap bounds work but can return only bounded progress;
- a gas limit derived before book mutation can become stale and run out of gas;
- Monad charges using the submitted gas limit under the documented fee model,
  so `eth_estimateGas` is not a receipt fee.

See [LIMITS.md](docs/LIMITS.md) before integrating.

## What a host must own

Authentication, price selection, token custody, settlement, fees, minimum
order and residual rules, `maxFills`, reentrancy protection, recovery, pausing,
upgrades, indexer semantics, and gas-limit policy all remain host
responsibilities. If your application does not need resting same-price FIFO
orders and atomic cancel/repost, a mapping, AMM, or off-chain order system is
probably simpler.

## Frozen trial artifact

The original external-trial tarball remains byte-for-byte frozen:

```text
order-storage-preview.tgz
SHA-256 4fa0bd18bc5846313351d6fb4d79d6317ec4b7309180b86afee4916ec1b5012b
kernel SHA-256 cce2e055fb84169e5d996c87edd99f116b3af60951f2ee48fd10aa74b630553e
```

The unpacked `contracts/OrderStorageKernel.sol` must match that kernel hash.
CI enforces this identity.

## License

MIT. See [LICENSE](LICENSE). Third-party dependencies keep their own licenses.
