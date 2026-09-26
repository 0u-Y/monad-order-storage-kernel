# Evidence map

This map keeps local correctness, fixed-block read-only estimates, public
testnet receipts, and fee calculations separate.

## Reproduction paths

```bash
# Local, no RPC: source identity + single-price demo + kernel invariants +
# multi-price demo/rollback + evidence calculation audit
npm test

# The presentation flow only
npm run demo:metropolis

# Audit hashes and arithmetic in the compact recorded evidence
npm run evidence:metropolis

# Optional read-only RPC check of the historical public testnet deployment
npm run replay:testnet
```

## Claim map

| Claim | Source and fixture | Public command | Public raw evidence | Scope and limit |
|---|---|---|---|---|
| FIFO storage and atomic `Fill[]` settlement work through a host | `contracts/OrderStorageKernel.sol`; `examples/multi-price/contracts/*`; ephemeral BASE18/QUOTE6 fixture | `npm test` or `npm run demo:metropolis` | Terminal JSON from `scripts/metropolis-demo.cjs`; assertions in `test/kernel.cjs` | Local correctness only; self-authored mock and no audit |
| Selected 2+2/5/32 states estimate below linked, while 1-fill and deep 1+1 regress | Research comparison intended the same host policy; linked source at `evidence/baselines/LinkedMultiPriceInventory.sol`; chain 143 block `0x6592850`; solc 0.8.30/viaIR/200/Shanghai | `npm run evidence:metropolis` | `evidence/metropolis_claims.json` → `fixedBlockReadOnly` | Command checks hashes and stored arithmetic only. It does not regenerate state overrides or independently prove linked semantic equivalence; no receipt or universal fee claim |
| Public eight-tick mock flow has accessible successful receipts and current zero host escrow | Chain 10143 host `0xF33F…8709`, 19 transaction hashes | `npm run replay:testnet` | `evidence/metropolis_claims.json` → `publicTestnetExecution`; explorer receipts | Checks nonempty code, receipt status/limits, aggregates, and current host balances. No runtime hash, immutables, event order, historical actor balances, or linked comparison |

## Negative-evidence map

| Counterexample | Evidence | Meaning |
|---|---|---|
| 1-fill: 267,063 contiguous vs 264,428 linked | `fixedBlockReadOnly.wholeHostComparisons` | The kernel is not uniformly cheaper |
| active-256 two-tick 1+1: 184,379 vs 179,395 | same | Small maker refresh can regress at deep active state |
| stale limit 310,000 or 323,000 vs required 359,548 | `staleLimitCounterexamples` | Same-state 15% limit policy is not safe after book mutation |
| 32-fill host bound | source `MAX_FILLS = 32`, local demo and evidence | Work is bounded; completion beyond the bound requires explicit progress policy |

## Evidence-class rules

- `estimate` means read-only execution requirement at a pinned state.
- `suggestedLimit` means a candidate submitted limit validated only in the
  named prestate.
- `receiptGasUsed` is a receipt field, not an estimate.
- `chargedWei` is `submitted gasLimit × effectiveGasPrice` for the historical
  Monad transaction.
- Equal submitted limits at equal gas price have equal charged fees regardless
  of different estimates.

## Research provenance

The compact JSON records SHA-256 identities of the larger research files:

| Research file | SHA-256 |
|---|---|
| `results/20260924T151451Z-multi-price-inventory/monad_results.json` | `ee3b0b522369b90ea48a0a986a6cef33b77c9af02b0f11c2156469dee61ff1e9` |
| `results/20260924T172504Z-multi-price-public-reference/adversarial_monad.json` | `4d9a6efa6a2313781aa57bd24f75f80ef696dd9f8f49a32e4a6e4a3979960893` |
| `results/20260924T172504Z-multi-price-public-reference/testnet_broadcast_manifest.json` | `54a0ae6de861315678f580ce6b75586dd7b38082b1c11d3505c29349b1a658f0` |
| `results/20260924T172504Z-multi-price-public-reference/testnet_replay.json` | `c418c22a431d8eda864054fa492bc534382ce3d0f72f67990b40c680a14bdc6c` |

Those full files are not copied into the public product repository. The
minimum selected rows, all public transaction hashes, source hashes, and
calculation rules are public in `evidence/metropolis_claims.json`.

## UNVERIFIED or intentionally excluded

- External integrator demand: **UNVERIFIED**.
- General ERC-20 compatibility and production custody: **UNVERIFIED**.
- Historical fixed-block estimates regenerated solely from the public repo:
  **NOT PROVIDED**; the research state-override harness has additional fixture
  dependencies and remote-call volume unsuitable for the 15-minute path.
- Historical native results as present MonadTen evidence: **EXCLUDED**.
