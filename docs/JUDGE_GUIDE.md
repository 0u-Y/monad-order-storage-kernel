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
filled. The kernel owns only that state machine. The separate eight-tick,
ask-only BASE inventory reference owns mock-token escrow, lowest-quote-price
traversal, lot conversion, and settlement. A production venue must still own
authentication, custody,
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

Two clean Linux clones on 2026-09-26 completed in 16.63 and 17.45 seconds with
network and npm cache available. Installation time varies by environment.

The command compiles with solc 0.8.30, optimizer 200, viaIR, and Shanghai,
then runs the contracts on an in-process Ganache EVM. Its final markers are
`METROPOLIS TWO-MINUTE DEMO PASS` and
`METROPOLIS RECORDED EVIDENCE AUDIT PASS`.

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
the linked baseline semantically equivalent. That slower check is deliberately
separate:

```bash
npm run benchmark:judge
```

Run `npm run judge` first for the product flow, then the benchmark only if the
comparison claim matters. The benchmark compiles the contiguous host and the
public linked baseline with the same solc 0.8.30/optimizer-200/viaIR/Shanghai
input. It executes five local differential fixtures against an independent JS
queue/balance model, then uses read-only `eth_call`, `debug_traceCall`, and
`eth_estimateGas` at chain 143 block `0x6592850`. It makes 63 RPC calls and no
transactions in the recorded run. A warm-dependency run took about 160 seconds
on the submission workstation; `benchmark/node_modules` occupied about 351 MB.
Network transfer varies with the npm cache and is not reported as an exact
download-byte claim. Generated raw files go to `benchmark/output/`.

What that command verifies: matching public function selectors and event
topics, maker-only cancellation, stale-handle rejection, calldata, exact-token
balance/allowance deltas, host events, bounded fills, and final FIFO state for
the five named fixtures; same-prestate suggested-limit execution; and one
stale-preflight OOG counterexample. The frozen linked event uses different JSON
ABI argument labels for `KernelOrderConsumed`, so the comparison normalizes its
identical topic and positional values. What it does not verify: minimum
successful gas, a submitted transaction, a receipt or fee, arbitrary tokens,
Kuru-relative performance, TPS, page locality as the sole cause, or a universal
safe limit.

Optional live, read-only testnet check:

```bash
npm run replay:testnet
```

Clean-clone optional replays completed in 5.40–5.85 seconds; RPC availability
and latency can change.

This checks chain 10143, nonempty code at the three recorded addresses, all 19
receipt statuses and submitted limits, aggregate receipt gas fields and charge,
and the host's current zero `lockedBaseRaw`, BASE balance, and QUOTE balance.
It does not check
runtime bytecode hashes, immutable ticks, event FIFO order, or historical actor
balances. This public command's claim is deliberately narrow.

## How it works

- State and level metadata live under `keccak256(STATE_DOMAIN, marketId)`.
- Contiguous nodes start at a `keccak256(NODE_DOMAIN, marketId)` base with its
  low 96 bits cleared and use two slots per index.
- A global per-market free list reuses cancelled or consumed indices.
- A handle is `generation:uint64 || index:uint32`; reuse increments generation,
  so a stale handle cannot address the new order.
- `consumeUpToWithFills` bounds synchronous work and returns the records needed
  by host settlement. It can return partial progress at the bound; the host
  enforces its minimum-received guard. The reference host uses integer lots,
  caps `maxFills` at 32, and rejects a nonzero remainder below two lots.

The kernel accepts a maker argument but does not authenticate callers. The
reference host derives the maker from `msg.sender`, applies a reentrancy guard,
mutates the queue first, then makes settlement transfers; any later revert in
that EVM transaction restores both state and transfers. Cancel/repost loses
the old FIFO position and appends the replacement at its level tail.

This design is not proven faster because of page locality, and historical
native results are not current MonadTen TPS evidence.

## What the evidence says, including losses

The comparison rows below are reproducible Monad mainnet chain-143
`eth_estimateGas` results at block `0x6592850`, using solc 0.8.30, optimizer
200, viaIR, and Shanghai. `active` means live orders immediately before the
measured call. `npm run benchmark:judge` now regenerates the explicit state
overrides and calls; `npm run evidence:metropolis` still checks only the stored
hashes and arithmetic.

| Whole-host fixture | contiguous estimate | linked estimate | result |
|---|---:|---:|---|
| maker two-tick 2+2, active 64 | 201,446 | 235,023 | 14.28% lower |
| taker 5 fills, active 33 | 359,880 | 393,634 | 8.57% lower |
| taker 32 fills, active 33 | 1,094,982 | 1,373,872 | 20.29% lower |
| taker 1 fill, active 33 | 267,063 | 264,428 | **0.99% higher** |
| maker two-tick 1+1, active 256 | 184,379 | 179,395 | **2.77% higher** |

The 2026-09-26 rerun changed the linked 2+2 estimate from the historical
235,022 to 235,023; all other estimates above matched the frozen record. An
estimate is a node result, not receipt gas, so both values are retained rather
than edited to agree. Local differential assertions passed all five fixtures.

Two recorded state changes also broke limits derived from preflight estimate
plus 15%: limits 310,000 and 323,000 each needed 359,548 gas after the book
changed and ran out of gas. There is no universal safe percentage claim.

Monad evidence terms remain separate:

- **estimate:** read-only execution requirement at a named state;
- **suggested/submitted limit:** transaction limit chosen by a client;
- **receipt `gasUsed`:** a receipt field;
- **charge:** submitted gas limit multiplied by effective gas price under the
  [official Monad fee model](https://docs.monad.xyz/developer-essentials/gas-pricing).

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

Detailed types, errors, overflow behavior, and namespace rules are in the
[API reference](API.md); host and threat boundaries are in
[`SECURITY.md`](../SECURITY.md). The local demo and comparison fixtures remain
self-authored evidence, not an independent audit.

## Claim matrix: what each public command actually verifies

| Claim | Public command | Actual assertions | Not verified by that command |
|---|---|---|---|
| Frozen kernel/package identity | `npm run test:source` | tarball hash, unpacked kernel hash, public source hash and packaged file lock | audit, provenance outside recorded artifact |
| FIFO/generation/`Fill[]`/rollback through reference host | `npm run judge` | local contract calls, exact fill order and values, balances, escrow, stale rejection, injected rollback, source hashes, stored evidence arithmetic | arbitrary ERC-20, production security, external integration |
| Recorded fixed-block comparison and counterexamples are internally consistent | `npm run evidence:metropolis` | four source hashes, stored percentage arithmetic, OOG inequalities, recorded charge arithmetic | historical RPC regeneration, linked semantic equivalence, current chain state |
| Five functional-equivalence fixtures and current pinned-block estimates | `npm run benchmark:judge` | wire ABI selectors/topics, auth rejection, exact-token deltas, events, JS FIFO/balance model, calldata/prestate, fixed-block read-only estimates, same-state suggested limits, stale-limit OOG | minimum gas search, receipts/fees, arbitrary ERC-20, independent audit, universal limit |
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
