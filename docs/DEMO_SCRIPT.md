# Two-minute demo script

This is the recording script for the judge video. It uses only scenes asserted
by the public `npm run judge` command. Record the local command live; show the
stored benchmark table rather than running the three-minute RPC benchmark in
the two-minute video.

## Before recording

Use a clean clone and a terminal large enough to show the `observed:` lines.
Node.js 20+, npm, `tar`, and `sha256sum` are required. No wallet, private key,
Docker, Foundry, or RPC is required.

```bash
git clone https://github.com/0u-Y/monad-order-storage-kernel.git
cd monad-order-storage-kernel
npm run judge
```

The command normally finishes in about 17 seconds on the recorded workstation
with network/cache available. Installation time varies.

## Shot list and narration

| Time | Screen | Narration and required observation |
|---:|---|---|
| 0:00–0:15 | Repository README, then `docs/JUDGE_GUIDE.md` heading | “This is a storage library, not a full DEX. It is for a new Monad venue that already owns pricing and settlement policy but needs same-price FIFO, safe cancel/repost, and bounded multi-maker settlement. The kernel holds no tokens; the separate eight-tick mock host escrows assets for the integration example.” |
| 0:15–0:25 | Run `npm run judge` | “This clean-clone command verifies the frozen source, compiles the public reference, and runs it locally. It needs no wallet or RPC.” |
| 0:25–0:39 | `[1/7 POST]` and `[2/7 ATOMIC REFRESH]` | “Maker A posts at tick 102, maker B posts three lots at tick 101, then maker A posts five lots behind B at tick 101. Maker A atomically replaces its two orders with three lots at 103 and four lots at 101. The output shows old and replacement handles.” |
| 0:39–0:50 | `[3/7 GENERATION HANDLE]` | “The reused index receives a new generation. Cancelling the old numeric reference reverts, so stale state cannot silently target the replacement.” Point to `stale_cancel_reverted=true`. |
| 0:50–1:08 | `[4/7 BOUNDED FILLS]` | “The taker requests eight lots with `maxFills=3`. `Fill[]` returns maker B's three lots at tick 101, then maker A's four lots at tick 101, then one of maker A's three lots at tick 103. B was posted first at tick 101, so this is cheapest tick first and FIFO within that tick; two lots remain at 103.” |
| 1:08–1:22 | `[5/7 SAME-TX SETTLEMENT]` | “The host uses those three records before the transaction ends. Maker B gets 3 × 10,000 = 30,000 QUOTE raw. Maker A gets 4 × 10,000 plus 1 × 10,400 = 50,400. The taker gets eight lots, or 0.08 BASE, host QUOTE returns to zero, and the two unfilled lots remain locked.” |
| 1:22–1:36 | `[6/7 ROLLBACK INJECTION (LOCAL ONLY)]` | “Next, the exact mock token injects a failure on the final BASE payment. The transaction reverts and the order, maker and taker balances, host balances, and escrow snapshot all match the pre-call state.” Point to `reverted=true; snapshots_equal=true`. Say “local-only”; do not imply this failure was sent to testnet. |
| 1:36–1:44 | `[7/7 CANCEL / REFUND]` and final PASS | “Maker A cancels the residual. Locked BASE and both host token balances return to zero.” Point to the three zeros and `METROPOLIS TWO-MINUTE DEMO PASS`. |
| 1:44–1:57 | Open `docs/JUDGE_BENCHMARK_REPORT.md`, reproduced-results table | “The result is conditional. At one frozen MonadTen block, contiguous estimates are 14.28% lower for 2+2 refresh, 8.57% lower for five fills, and 20.29% lower for 32 fills. But it is 0.99% higher for one fill and 2.77% higher for active-256 1+1.” |
| 1:57–2:00 | Stale-preflight row directly below the table | “And a book change made a previously buffered 310,000 limit run out of gas, so this is not a universal gas or fee claim.” |

## Exact benchmark card shown on screen

These are whole-host read-only `eth_estimateGas` results for the contiguous
kernel against a functionally equivalent ordinary linked implementation at
chain 143 block `0x6592850`. Both use the same host policy, compiler, calldata,
mock-token behavior, and logical prestate. They are not receipts, submitted
limits, fees, or TPS.

| Whole-host fixture | contiguous | linked | observation |
|---|---:|---:|---|
| maker refresh 2+2, active 64 | 201,446 | 235,023 | contiguous 14.28% lower |
| taker 5 fills, active 33 | 359,880 | 393,634 | contiguous 8.57% lower |
| taker 32 fills, active 33 | 1,094,982 | 1,373,872 | contiguous 20.29% lower |
| taker 1 fill, active 33 | 267,063 | 264,428 | contiguous **0.99% higher** |
| maker refresh 1+1, active 256 | 184,379 | 179,395 | contiguous **2.77% higher** |

The public rerun produced linked 2+2 = 235,023. The prior stored observation
was 235,022. Keep both in the video notes as a one-gas node-result variation;
do not round the current result back to the historical value.

## What not to show or say

- Do not call the local Ganache flow a testnet transaction.
- Do not say the public evidence audit regenerates historical RPC results; it
  checks stored hashes and arithmetic.
- Do not call estimates actual gas paid or fee savings. Monad charge is based
  on submitted gas limit times effective gas price.
- Do not claim a universal advantage, CLOB functionality, Kuru superiority,
  page-locality causation, native TPS, production readiness, or user demand.
- Do not claim the current keyless replay verifies historical FIFO events,
  actor balances, runtime hashes, or immutable tick configuration.

## Optional post-video links

- Quick proof: `npm run judge`
- Read-only public deployment check: `npm run replay:testnet`
- Full five-fixture RPC benchmark: `npm run benchmark:judge`
- Stored raw evidence: `evidence/judge-benchmark-20260926/`
