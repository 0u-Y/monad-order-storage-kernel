# OrderStorageKernel: two-minute judge guide

## One sentence

OrderStorageKernel is a custody-free Solidity library for a new Monad venue
that already owns pricing and settlement, but needs same-price FIFO,
generation-safe cancel/repost, and a bounded `Fill[]` that its host can settle
atomically before the transaction ends.

## The problem in 30 seconds

A venue with resting maker inventory repeatedly has to link orders at each
price, preserve FIFO, cancel arbitrary maker orders, reuse storage without
reviving stale identifiers, and tell settlement exactly which makers were
filled. The kernel owns only that state machine. The separate eight-tick
reference owns mock-token escrow, cheapest-price traversal, lot conversion,
and settlement. A production venue must still own authentication, custody,
fees, risk controls, recovery, indexing, and its gas policy.

The technical seam is synchronous `Fill[]`: the host receives each `handle`,
`maker`, filled quantity, and remainder in the same call that mutates the
queue. It can transfer assets for every fill and let any later failure revert
both the transfers and kernel state. Events alone cannot provide that
same-transaction settlement input.

## Run the two-minute local proof

Requirements: Node.js 20+, npm, `tar`, and `sha256sum`. No key, RPC, Docker,
Foundry, or root `npm ci` is needed. The repository intentionally has no root
`package-lock.json`; the command installs only the locked `consumer/`
dependencies.

```bash
git clone https://github.com/0u-Y/monad-order-storage-kernel.git
cd monad-order-storage-kernel
npm run judge
```

Observed on a clean Linux clone on 2026-09-26: about 21 seconds with network
and npm cache available. Installation time varies by environment.

The output walks through these asserted scenes rather than printing only a
PASS marker:

1. maker A and B escrow BASE and post at ticks 101 and 102;
2. maker A atomically cancels two orders and reposts at ticks 101 and 103;
3. reused indices receive a new generation and an old handle is rejected;
4. a bounded three-row `Fill[]` shows tick 101 maker B, tick 101 maker A, then
   tick 103 maker A: cheapest tick first and FIFO within tick 101;
5. maker A receives 50,400 QUOTE raw, maker B receives 30,000, the taker
   receives 0.08 BASE (18 decimals), and transient host QUOTE is 0;
6. a local-only late BASE transfer failure leaves the order, maker/taker
   balances, host balances, and locked escrow equal to the pre-call snapshot;
7. maker A cancels the residual, leaving host BASE, QUOTE, and locked escrow 0.

The final evidence step checks hashes and arithmetic in the frozen public JSON.
It does **not** rerun the historical mainnet RPC fixture or independently prove
the linked baseline semantically equivalent.

Optional live, read-only testnet check:

```bash
npm run replay:testnet
```

This checks chain 10143, nonempty code at the three recorded addresses, all 19
receipt statuses and submitted limits, aggregate receipt gas fields and charge,
and the host's current zero locked BASE/BASE/QUOTE balances. It does not check
runtime bytecode hashes, immutable ticks, event FIFO order, or historical actor
balances. Earlier research replay covered more fields; this public command's
claim is deliberately narrower.

## How it works

- State and level metadata live under `keccak256(STATE_DOMAIN, marketId)`.
- Contiguous nodes start at a `keccak256(NODE_DOMAIN, marketId)` base with its
  low 96 bits cleared and use two slots per index.
- A global per-market free list reuses cancelled or consumed indices.
- A handle is `generation:uint64 || index:uint32`; reuse increments generation,
  so a stale handle cannot address the new order.
- `consumeUpToWithFills` bounds synchronous work and returns the records needed
  by host settlement. The reference host additionally caps `maxFills` at 32.

This design is not proven faster because of page locality, and historical
native results are not current MonadTen TPS evidence.

## What the evidence says, including losses

The comparison rows below are recorded chain-143 `eth_estimateGas` results at
block `0x6592850`. The public audit command verifies source hashes and stored
arithmetic; it does not regenerate the remote state override.

| Whole-host fixture | contiguous estimate | linked estimate | result |
|---|---:|---:|---|
| maker two-tick 2+2, active 64 | 201,446 | 235,022 | 14.28% lower |
| taker 5 fills, active 33 | 359,880 | 393,634 | 8.57% lower |
| taker 32 fills, active 33 | 1,094,982 | 1,373,872 | 20.29% lower |
| taker 1 fill, active 33 | 267,063 | 264,428 | **0.99% higher** |
| maker two-tick 1+1, active 256 | 184,379 | 179,395 | **2.77% higher** |

The linked source is public and the research fixture intended the same host
policy, but `npm run evidence:metropolis` does not execute a differential
linked correctness test. Treat semantic equivalence as historical research
provenance, not a fresh public-command assertion.

Two recorded state changes also broke limits derived from preflight estimate
plus 15%: limits 310,000 and 323,000 each needed 359,548 gas after the book
changed and ran out of gas. There is no universal safe percentage claim.

Monad evidence terms remain separate:

- **estimate:** read-only execution requirement at a named state;
- **suggested/submitted limit:** transaction limit chosen by a client;
- **receipt `gasUsed`:** a receipt field;
- **charge:** submitted gas limit multiplied by effective gas price under the
  documented Monad fee model.

A lower estimate is not itself a lower fee. Equal submitted limits at equal
gas price produce equal charges.

## Public proof and links

- [Repository](https://github.com/0u-Y/monad-order-storage-kernel)
- [v0.4.1 frozen source release](https://github.com/0u-Y/monad-order-storage-kernel/releases/tag/v0.4.1)
- [Evidence scope and commands](EVIDENCE_MAP.md)
- [Full five-minute case](METROPOLIS_CASE.md)
- [Host `0xF33F…8709`](https://testnet.monadscan.com/address/0xF33Fe3D722d2Df7E07c053E83EAe270d38aF8709)
- [First multi-maker take](https://testnet.monadscan.com/tx/0x7c9648ba3fff8bbbab75e5005cc1cb0812e8c64a7b99d0b0c55a3c48036dd287)
- [Atomic refresh](https://testnet.monadscan.com/tx/0xecf9de77eb8b22020fe9c1c036cd210f86b2395ba740f34d09996b09060ddf1f)

The public deployment is contiguous-only and uses mock assets. It proves the
reference flow executed, not linked onchain savings, production custody,
external demand, or audit readiness.

## Claim matrix: what each public command actually verifies

| Claim | Public command | Actual assertions | Not verified by that command |
|---|---|---|---|
| Frozen kernel/package identity | `npm run test:source` | tarball hash, unpacked kernel hash, public source hash and packaged file lock | audit, provenance outside recorded artifact |
| FIFO/generation/`Fill[]`/rollback through reference host | `npm run judge` | local contract calls, exact fill order and values, balances, escrow, stale rejection, injected rollback, source hashes, stored evidence arithmetic | arbitrary ERC-20, production security, external integration |
| Recorded fixed-block comparison and counterexamples are internally consistent | `npm run evidence:metropolis` | four source hashes, stored percentage arithmetic, OOG inequalities, recorded charge arithmetic | historical RPC regeneration, linked semantic equivalence, current chain state |
| Historical public deployment still has accessible successful receipts | `npm run replay:testnet` | chain ID, nonempty code, 19 statuses and limits, aggregate gas/charge, current zero host balances | runtime hash, constructor immutables, event order, historical actor balances, linked comparison |

## Limits a judge should remember

- The product is a storage library plus a separate one-sided reference, not a
  CLOB, Kuru replacement, router, price oracle, or custodian.
- One-fill and deep 1+1 fixtures regress; the advantage is not universal.
- The host's 32-fill cap bounds a transaction but does not guarantee complete
  execution through arbitrary dust or depth.
- State drift can make a previously validated gas limit fail OOG, and an OOG
  transaction does not escape submitted-limit charging.
- External venue integration and customer demand remain **UNVERIFIED**.

## Next gate: one independent venue integration

No outreach was sent. The prepared note is in
[`OUTREACH_DRAFT.md`](../OUTREACH_DRAFT.md), and the evidence gate is in
[`ACCEPTANCE.md`](../ACCEPTANCE.md). The three questions are:

1. How many files/lines and policy wrappers were required to connect the
   developer's authenticated maker and market to `post`, cancel/refresh, and
   the first `Fill[]` settlement?
2. Which existing or missing API contract blocked or complicated that work?
3. After custody and settlement were included, what concrete benefit remained
   versus the venue's current queue/storage implementation? `NONE` is valid.

Acceptance requires a developer who is independent of this project to install
the frozen artifact without repository-internal imports, compile their own
throwaway host, settle every returned fill atomically, reproduce FIFO,
generation/stale-handle and rollback behavior, and report code changes plus a
comparison with their current implementation. This project's own consumer is
not evidence of external adoption.
