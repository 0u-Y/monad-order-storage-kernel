# OrderStorageKernel v0.4.1 judge benchmark report

Date: 2026-09-26  
Public repository: <https://github.com/0u-Y/monad-order-storage-kernel>  
Benchmark implementation commit: `1c642032bdc1dfae2c6fe6d77339a2e81a53f932`

## Executive result

The public repository now contains one clean-clone command that compares the
contiguous OrderStorageKernel host with a functionally equivalent linked host:

```bash
git clone https://github.com/0u-Y/monad-order-storage-kernel.git
cd monad-order-storage-kernel
npm run benchmark:judge
```

The command passed from a new GitHub clone. It verified five local
contiguous/linked equivalence fixtures, regenerated the selected MonadTen
fixed-block read-only estimates, reproduced the stale-preflight OOG
counterexample, and sent no transaction.

The result is conditional rather than universal: contiguous was lower in the
2+2 maker-refresh and 5/32-fill fixtures, but higher in the one-fill and
active-256 1+1 fixtures.

## Frozen identity and environment

| Item | Frozen value |
|---|---|
| Kernel SHA-256 | `cce2e055fb84169e5d996c87edd99f116b3af60951f2ee48fd10aa74b630553e` |
| Tarball SHA-256 | `4fa0bd18bc5846313351d6fb4d79d6317ec4b7309180b86afee4916ec1b5012b` |
| Solidity compiler | `0.8.30+commit.73712a01.Emscripten.clang` |
| Optimizer | enabled, 200 runs |
| viaIR | enabled |
| EVM target | Shanghai |
| Monad chain/block | chain 143, block `0x6592850` |
| Block hash | `0xa582f09dc794ea690aeac2a76ed76af5d1e6fad9e116e0414376fafbf0c25360` |
| Local clean-clone environment | Node 22.22.2, npm 10.9.7, Linux x86-64 |

The frozen v0.4.1 kernel and package hashes did not change. C, Morpho, and the
experimental sharded allocator were not modified.

## What is compared

Both layouts use the same multi-price host policy, public function selectors,
event topics, maker authentication, exact-transfer mock tokens, lot and price
configuration, settlement loop, errors, calldata, and initial logical state.
The storage implementation is the intended difference.

For each fixture, local assertions compare:

- unauthorized maker cancellation rejection;
- generation-safe stale-handle rejection where cancellation/reuse occurs;
- token balances and allowances;
- maker and taker asset deltas against a separately implemented JS model;
- host and kernel events;
- returned bounded fill records;
- level head/tail, live order views, and model queue state;
- identical logical calldata and postconditions between layouts.

The frozen linked baseline uses different JSON ABI input labels for
`KernelOrderConsumed`, but its event topic and positional values match. The
comparison therefore normalizes that event positionally. The JS oracle is
self-authored and is not an independent security audit.

## Reproduced results

These are whole-host, read-only `eth_estimateGas` results at the pinned Monad
block. They are not receipts or actual fees.

| Fixture | Equivalence | Contiguous estimate | Linked estimate | Result |
|---|---|---:|---:|---|
| Multi-price maker refresh 2 cancel + 2 post, active 64 | PASS | 201,446 | 235,023 | contiguous 14.28% lower |
| Taker, 5 fills, active 33 | PASS | 359,880 | 393,634 | contiguous 8.57% lower |
| Taker, 32 fills, active 33 | PASS | 1,094,982 | 1,373,872 | contiguous 20.29% lower |
| Taker, 1 fill, active 33 | PASS | 267,063 | 264,428 | **contiguous 0.99% higher** |
| Maker refresh 1 cancel + 1 post, active 256 | PASS | 184,379 | 179,395 | **contiguous 2.77% higher** |

The historical linked 2+2 value was 235,022. The public rerun returned
235,023. The one-gas difference is preserved rather than rewritten to match the
old record. The other four estimates matched their historical recorded values.

## Stale-preflight counterexample

The public runner also restored the split-head counterexample:

| Measurement | Value |
|---|---:|
| Quote-state estimate | 268,792 |
| Quote-state suggested limit | 310,000 |
| Estimate after the book changed | 359,548 |
| Old 310,000 limit at changed state | OOG |

The suggested limit is `ceil(estimate × 1.15 / 1000) × 1000` and passed only
against the identical prestate. This counterexample rejects any claim that a
single 15% buffer is a universal safe gas-limit policy.

## Metric boundaries

| Metric | Meaning in this report |
|---|---|
| Read-only estimate | `eth_estimateGas` at the pinned block with an explicit state override |
| Minimum successful limit | Not searched; `N/A` |
| Suggested limit | Buffered limit checked by `eth_call` only at the same prestate |
| Actual submitted limit | `N/A`; no transaction was submitted |
| Receipt gasUsed | `N/A`; no receipt was created |
| Actual charge or fee | `N/A`; no transaction was submitted |

Monad charges the submitted gas limit rather than actual gas used. Therefore a
lower estimate does not itself prove a lower paid fee, and equal submitted
limits at the same gas price produce the same charge.

## Public testnet and source regression

The existing source identity and public testnet evidence were rechecked:

- source/package identity: PASS;
- complete local project test: PASS;
- stored public-testnet receipt invariants: 19/19 PASS;
- live keyless replay: chain 10143, nonempty host/token code, 19/19 receipt
  status and submitted-limit checks, aggregate charge arithmetic, and current
  zero host balances: PASS.

The keyless replay does not verify runtime bytecode hashes, immutable tick
configuration, historical event FIFO, or historical actor balances. The public
testnet deployment contains only the contiguous host and therefore is not an
onchain contiguous/linked comparison.

## Reproduction cost

The final public commit completed from a clean GitHub clone in 176 seconds on
the recorded workstation. A separate empty-cache measurement produced:

- npm-cache footprint: 95,430,237 bytes;
- installed `benchmark/node_modules`: 350,700,652 bytes.

The cache footprint is a download-size proxy, not an exact count of HTTP wire
bytes. Ganache fell back from its unavailable native µWS binding to its JS
implementation; the tests still passed. The wrapper uses a locked
`npm install --ignore-scripts` path because npm 10 `ci` rejects Ganache's
bundled macOS-only `fsevents` entry on Linux. The clean run left the lockfile
unchanged.

## Raw evidence

| File | Purpose |
|---|---|
| [`summary.json`](../evidence/judge-benchmark-20260926/summary.json) | Machine-readable status, table, metric boundaries, and frozen identity |
| [`local.json`](../evidence/judge-benchmark-20260926/local.json) | Local fixtures, calldata, balances, events, order views, and equivalence assertions |
| [`compiler-input.json`](../evidence/judge-benchmark-20260926/compiler-input.json) | Exact Solidity standard JSON compiler input |
| [`monad-ten.json`](../evidence/judge-benchmark-20260926/monad-ten.json) | Fixed-block estimates, limits, hashes, and stale-state result |
| [`rpc-raw.json`](../evidence/judge-benchmark-20260926/rpc-raw.json) | Read-only RPC requests, state overrides, and responses |

The runner allowlists only `eth_chainId`, `eth_getBlockByNumber`,
`debug_traceCall`, `eth_call`, and `eth_estimateGas`. Its default public endpoint
is `https://rpc.monad.xyz`; `MONAD_RPC_URL` may select another compatible
chain-143 archival endpoint. Unsupported trace or missing historical state is a
blocker and must not be replaced with stored numbers.

## Claims excluded

This result does not establish:

- a page-locality-only causal explanation;
- superiority over Kuru;
- Monad TPS or native parallel-execution improvement;
- lower actual receipt fees;
- a universal safe gas limit;
- correctness for arbitrary ERC-20 behavior;
- production custody readiness or an independent audit;
- external developer adoption or product demand.

## Final assessment

The public repository now provides a reproducible and balanced comparison:
the same command displays the workloads where contiguous is lower and the two
required regressions where it is higher. Functional-equivalence assertions pass
for all five selected fixtures, while the stale-state experiment demonstrates
that estimate-derived limits remain state-specific. This supports a narrow
claim about selected multi-order fixtures, not a universal performance or fee
advantage.
