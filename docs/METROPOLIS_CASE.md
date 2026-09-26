# Metropolis case: bounded FIFO storage for new Monad venues

## One sentence

OrderStorageKernel is a custody-free Solidity storage module for developers
building a new Monad venue that already owns its pricing and settlement policy
but needs same-price FIFO, generation-safe cancellation/reposting, and bounded
multi-maker fill records in one atomic transaction.

It is not a general CLOB, a Kuru extension, a router, or a custody product.
External demand remains **UNVERIFIED**.

## The developer and the repeated problem

The target is a developer building a new onchain venue with resting maker
inventory. The venue has its own rules for prices, assets, permissions, fees,
and taker protection. Its recurring implementation burden is narrower:

1. maintain FIFO links independently at each price level;
2. cancel an arbitrary maker order and atomically repost several replacements;
3. reject a stale handle after a freed slot is reused;
4. return every maker and filled quantity before the transaction ends so the
   host can settle multiple makers or revert everything;
5. bound synchronous work without silently skipping an earlier cheap/FIFO
   order.

If a venue has no resting maker orders or same-price FIFO requirement, an AMM,
RFQ/offchain-order design, or ordinary mapping is likely a better fit.

## Three layers, three responsibilities

| Layer | What it does | What it does not do |
|---|---|---|
| `OrderStorageKernel` | Per-level FIFO, arbitrary cancel, global slot reuse, generation handles, `Fill[]`, head/tail/order views | Tokens, prices, fees, custody, matcher permission, best execution |
| Eight-tick reference host | One-sided BASE escrow, eight fixed tick prices, cheapest-first traversal, same-tick FIFO, atomic refresh, exact mock-token settlement, max 32 fills | Bids, dynamic levels, routing, production token support, upgrades, production recovery |
| A real venue | Maker/matcher authentication, custody, decimals/lots, price selection, guards, fees, solvency, pause/migration/recovery, indexer, gas policy | It must not assume the kernel supplies any of these policies |

The order identity is `(hostAddress, marketId, handle)`. `handle` is
`generation:uint64 || index:uint32`; it is not globally unique. `priceTick` is
an opaque level ID, not a currency ratio.

## Two-minute local demo

After the initial install, run:

```bash
npm run demo:metropolis
```

The current executable demo performs these scenes:

1. maker A posts at ticks 101 and 102; maker B joins tick 101 behind/alongside
   the same level inventory;
2. maker A atomically cancels both live handles and reposts at ticks 101 and
   103; the old generation is rejected;
3. the taker buys 8 lots, receiving three `Fill[]` rows in order: maker B at
   101, maker A at 101, then maker A at 103;
4. the script checks exact BASE18/QUOTE6 balances, per-maker QUOTE receipts,
   zero transient host QUOTE, and remaining locked BASE;
5. the mock BASE token rejects the final taker payment after kernel mutation
   and maker payment would have started; the transaction reverts and the
   script proves the order, maker/taker balances, host balances, and escrow are
   unchanged;
6. maker A cancels the residual and receives its refund.

Expected line: `METROPOLIS TWO-MINUTE DEMO PASS`.

No additional implementation is required for this local scene. The existing
public testnet deployment contains the successful multi-price flow, but no
deliberately failing rollback transaction was broadcast; rollback is local
evidence only.

## Three verifiable claims

### 1. The module exposes a usable atomic-settlement seam

`consumeUpToWithFills` returns handle, maker, filled quantity, and remaining
quantity in the same call. Local tests execute FIFO, partial/full consumption,
maker cancellation, slot reuse, stale-handle rejection, market isolation,
bounded exact-consume rollback, multi-price settlement, and a late-payment
rollback.

```bash
npm test
```

Scope: local Ganache correctness with exact mock tokens. This is not a security
audit or arbitrary ERC-20 proof.

### 2. Selected multi-order states had lower read-only estimates than linked

At Monad chain 143 block `0x6592850`, with the same eight-tick host policy and
registered prestate:

| Whole-host workload | contiguous estimate | linked estimate | difference |
|---|---:|---:|---:|
| maker two-tick 2+2, active 64 | 201,446 | 235,022 | 14.28% lower |
| taker 5 fills, active 33 | 359,880 | 393,634 | 8.57% lower |
| taker 32 fills, active 33 | 1,094,982 | 1,373,872 | 20.29% lower |
| taker 1 fill, active 33 | 267,063 | 264,428 | **0.99% higher** |
| maker two-tick 1+1, active 256 | 184,379 | 179,395 | **2.77% higher** |

These are `eth_estimateGas` results plus separately recorded, same-prestate
`eth_call` limit checks. They are not receipts or actual fee savings. The
compact public evidence and calculation audit run with:

```bash
npm run evidence:metropolis
```

The full state-override RPC runner remains in the research repository; the
public command verifies the selected raw rows, source hashes, calculations,
and evidence classes, but does not regenerate the historical estimates.

### 3. The contiguous reference executed publicly with mock assets

Monad testnet chain 10143 contains the exact eight-tick reference flow. All 19
recorded receipts succeeded. Their submitted limits total 7,221,000 units at
102 gwei, giving a historical charged amount of 0.736542 MON. In this run the
receipt `gasUsed` fields also equal the submitted limits, but the fields remain
conceptually distinct.

```bash
npm run replay:testnet
```

This read-only replay checks chain ID, deployed code, all 19 receipt statuses
and limits, the charged amount, and final zero host escrow/balances. It does not
compare linked onchain because only the contiguous host was deployed.

- [host](https://testnet.monadscan.com/address/0xF33Fe3D722d2Df7E07c053E83EAe270d38aF8709)
- [first multi-maker take](https://testnet.monadscan.com/tx/0x7c9648ba3fff8bbbab75e5005cc1cb0812e8c64a7b99d0b0c55a3c48036dd287)
- [atomic refresh](https://testnet.monadscan.com/tx/0xecf9de77eb8b22020fe9c1c036cd210f86b2395ba740f34d09996b09060ddf1f)

## Counterexamples are part of the case

A fresh estimate is state-dependent. Two registered state changes invalidated
the earlier 15%-margin candidate:

| State drift | candidate limit | required gas | result |
|---|---:|---:|---|
| one 10-lot head becomes five 2-lot heads | 310,000 | 359,548 | OOG |
| five cheaper heads appear before the quoted head | 323,000 | 359,548 | OOG |

An OOG revert restores state but does not refund Monad's submitted-limit fee.
There is no onchain book-version guard in the current host. Re-estimation and
fresh simulation are required; no universal safe percentage is claimed.

## What is not claimed

- Kuru integration or performance superiority
- a general or bidirectional CLOB
- production custody or audit readiness
- page locality as the sole cause of measured differences
- current MonadTen native parallel speedup or TPS
- external adoption, user demand, or universal lower fees

Historical pre-MonadTen native results are excluded from the three claims.
