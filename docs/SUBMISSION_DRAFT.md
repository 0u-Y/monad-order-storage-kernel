# Monad Metropolis submission draft

> Submission copy only. This document does not change the frozen v0.4.1
> kernel or benchmark. Do not submit until every item in
> [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md) is resolved.

## Official form check

Checked **2026-09-26 20:50 KST** (**2026-09-26 11:50 UTC**) against the
[official Monad Metropolis portal](https://hackathon.monad.xyz/) and its current
project/submission UI.

| Official field or rule | Current requirement | This draft |
|---|---|---|
| Project name | required, at most 120 characters | supplied below |
| One-line description | required, at most 200 characters | supplied below |
| Description | at most 8,000 characters; portal checklist treats more than 80 characters as written | supplied below |
| Track or bounty | at least one selection; primary track is shown separately | **Onchain Finance & Trading**; no bounty selected |
| Repository URL | HTTP(S), at most 2,000 characters | public GitHub URL below |
| Demo link or evidence | required for submitted state; valid HTTP(S), at most 2,000 characters | **BLOCKED until the video URL is added** |
| Bounty requirements | required only for a selected bounty | N/A unless a bounty is later selected |

The portal currently says that every save is the entry and judges read the
latest saved copy. The published schedule opens submissions at
`2026-10-02T03:59:00Z` and closes them at `2026-10-14T03:59:00Z`
(October 13, 23:59 ET). Registration/sign-in and the account-specific project
state are not publicly inspectable, so field names, limits, deadline, team
membership, and final saved state must be reconfirmed after login immediately
before submission. No submission action was taken while preparing this file.

## Copy for the portal

### Project name

**OrderStorageKernel: Bounded FIFO Settlement for Monad Venues**

### One-line description

**A custody-free Solidity order-storage library that gives new Monad venues same-price FIFO, generation-safe handles, atomic cancel/repost, and bounded synchronous Fill[] settlement.**

### Primary track

**Onchain Finance & Trading**

### Short introduction

New onchain venues often own their pricing and asset policy but still need to
build the same difficult order-state machinery: FIFO within a price level,
arbitrary maker cancellation, safe slot reuse, atomic refresh, and an exact
list of makers to settle before a transaction ends. OrderStorageKernel isolates
that custody-free state machine: the kernel never transfers or holds tokens.
A separate one-sided, eight-tick mock-token reference host does hold escrow and
demonstrates how a venue supplies pricing, authentication, lot conversion, and
settlement without turning the kernel into a CLOB. The kernel itself is not
limited to the host's ask-only policy.

### Technical description

OrderStorageKernel stores queue metadata in a market namespace and places
two-slot order nodes in a contiguous, market-scoped region. A global per-market
free list reuses cancelled or consumed indices. Each reference is
`(hostAddress, marketId, generation:uint64 || index:uint32)`, so reuse changes
the generation and a stale handle cannot silently identify a replacement
order.

The key integration seam is `consumeUpToWithFills`. It performs bounded FIFO
mutation and synchronously returns `Fill[]` records containing the handle,
maker, filled quantity, and remainder. The host can use those records to move
assets in the same EVM transaction. If a late token transfer fails, both the
asset movements and queue mutation revert. The reference host caps work at 32
fills and implements an ask-only inventory market across eight configured
ticks. It is an integration example, not a general matching engine.

The public two-minute command asserts maker posts, a two-order atomic refresh,
generation change and stale-handle rejection, cheapest-tick traversal,
same-price FIFO, three synchronous fills, exact mock-token settlement, injected
late-transfer rollback, and final cancel/refund. A separate read-only benchmark
compares contiguous and functionally equivalent linked hosts under the same
compiler, host policy, calldata, token behavior, and five named fixtures.

At Monad mainnet block `0x6592850`, `eth_estimateGas` was lower for contiguous
in the 2+2 maker-refresh fixture (201,446 vs 235,023), five-fill take (359,880
vs 393,634), and 32-fill take (1,094,982 vs 1,373,872). It was higher for a
one-fill take (267,063 vs 264,428) and an active-256 1+1 refresh (184,379 vs
179,395). The current public rerun returned 235,023 for linked 2+2; the earlier
stored run returned 235,022. The one-gas node-result variation is preserved,
not edited away. These are state-specific read-only estimates, not receipts,
fees, TPS, or a universal advantage.

A stale-state counterexample is equally important: a 268,792 estimate produced
a 310,000 suggested limit, but after the book changed the same intended take
needed an estimated 359,548 and the old limit ran out of gas. The reference
therefore does not claim a universal percentage buffer. Under
[Monad's documented gas model](https://docs.monad.xyz/developer-essentials/gas-pricing),
the submitted gas limit, not receipt `gasUsed`, determines charged gas units.
A lower estimate only permits a lower charge if a caller can safely submit a
lower limit for the actual inclusion state.

The public Monad testnet deployment records 19 successful transactions for the
contiguous mock-token reference flow. It is not an onchain linked comparison,
production custody proof, security audit, or external-demand validation.
External venue integration remains **UNVERIFIED**.

### Why Monad

Monad makes bounded execution and gas-limit selection product concerns rather
than footnotes. A venue can bound synchronous maker settlement with `maxFills`,
while the submitted-limit fee rule makes honest worst-state handling essential.
The fixed-block MonadTen read-only results show that the storage choice can
matter for selected multi-order transactions, and also expose the conditions
where it loses. The project deliberately makes no current native TPS claim and
does not attribute the result solely to storage-page locality.

### Links and reproduction

- Repository: <https://github.com/0u-Y/monad-order-storage-kernel>
- Frozen v0.4.1 release: <https://github.com/0u-Y/monad-order-storage-kernel/releases/tag/v0.4.1>
- Judge guide: <https://github.com/0u-Y/monad-order-storage-kernel/blob/main/docs/JUDGE_GUIDE.md>
- Raw five-fixture evidence: <https://github.com/0u-Y/monad-order-storage-kernel/tree/main/evidence/judge-benchmark-20260926>
- Testnet host: <https://testnet.monadscan.com/address/0xF33Fe3D722d2Df7E07c053E83EAe270d38aF8709>
- First multi-maker take: <https://testnet.monadscan.com/tx/0x7c9648ba3fff8bbbab75e5005cc1cb0812e8c64a7b99d0b0c55a3c48036dd287>
- Atomic refresh: <https://testnet.monadscan.com/tx/0xecf9de77eb8b22020fe9c1c036cd210f86b2395ba740f34d09996b09060ddf1f>
- Demo video: **[DEMO_VIDEO_URL — REQUIRED BEFORE SUBMISSION]**

Fast local proof, with no RPC or key:

```bash
git clone https://github.com/0u-Y/monad-order-storage-kernel.git
cd monad-order-storage-kernel
npm run judge
```

Optional read-only testnet check:

```bash
npm run replay:testnet
```

Optional fixed-block comparison, requiring a chain-143 archival endpoint with
historical state, state overrides, and `debug_traceCall` support:

```bash
npm run benchmark:judge
```

If the RPC path is unavailable, the recorded requests, responses, compiler
input, fixture outputs, and summary remain under
`evidence/judge-benchmark-20260926/`. Stored evidence is inspectable provenance;
it is not a fresh RPC replay.

## Frozen identities

| Item | Value |
|---|---|
| Kernel SHA-256 | `cce2e055fb84169e5d996c87edd99f116b3af60951f2ee48fd10aa74b630553e` |
| v0.4.1 tarball SHA-256 | `4fa0bd18bc5846313351d6fb4d79d6317ec4b7309180b86afee4916ec1b5012b` |
| Solidity compiler | `0.8.30+commit.73712a01.Emscripten.clang` |
| Settings | optimizer 200, viaIR, Shanghai |
| Benchmark block | chain 143, block `0x6592850`, hash `0xa582f09dc794ea690aeac2a76ed76af5d1e6fad9e116e0414376fafbf0c25360` |

## Claims deliberately excluded

This submission does not claim to be a CLOB, a Kuru replacement, production
custody, a security audit, universally cheaper storage, a universal safe gas
limit, current native parallel speedup, TPS improvement, verified customer
demand, or an explanation based solely on page locality.
