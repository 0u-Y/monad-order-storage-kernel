# Integration and release operations

## Before integration

1. Pin a commit or release asset and record its SHA-256.
2. Read `docs/API.md`, `docs/LIMITS.md`, and `SECURITY.md`.
3. Define units for `quantity` and every `priceTick` in the host.
4. Derive makers from authenticated callers; never trust an arbitrary maker
   calldata field without separate authorization.
5. Define who can consume, the maximum fills, progress rules, and all taker
   guards.
6. Build host-level accounting invariants for escrow, liabilities, fees,
   surplus, refunds, and recovery.

## Required test classes

- FIFO with multiple makers at one level
- partial head consumption and full head removal
- arbitrary maker-owned cancellation
- slot reuse and rejection of the previous generation handle
- market namespace isolation
- empty level and insufficient depth
- fill-bound exhaustion and allowed bounded progress
- wrong maker, wrong market, expired deadline, and settlement guard failures
- failure on an intermediate maker payment and final taker payment
- callback reentrancy and complete transaction rollback
- token behavior actually supported by the host

## Deployment gate

The repository is a public preview, not deployment authorization. Before real
funds, require an independent audit of the exact host, immutable/configuration
review, testnet rehearsal, verified source, monitoring/indexing, an incident
runbook, and a documented pause/migration/recovery design. The kernel itself
contains no owner, pause switch, or asset recovery operation.

## Release identity

The source compiler fixture used by the references is Solidity 0.8.30,
optimizer 200 runs, via-IR enabled, EVM target Shanghai. A venue may choose a
different supported compiler configuration, but it must rebuild and re-run its
own bytecode and gas evidence rather than inherit the recorded numbers.

For the frozen v0.4 trial:

```bash
sha256sum order-storage-preview.tgz
node scripts/verify-source-lock.cjs
```

`npm test` performs the identity check and the local end-to-end settlement
demo. CI runs the same command from a clean GitHub runner.
