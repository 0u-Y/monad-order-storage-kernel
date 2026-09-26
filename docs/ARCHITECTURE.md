# Architecture

## The module seam

The kernel is a deep storage module: hosts learn six mutation/view operations,
while the implementation owns FIFO links, arbitrary cancellation, free-list
reuse, generations, and deterministic namespaces.

```text
maker / matcher / taker
          |
          v
+-----------------------------------------+
| importing host                          |
| auth | price policy | custody | fees    |
| guards | settlement | recovery | events |
+-------------------+---------------------+
                    | internal calls and Fill[]
                    v
+-----------------------------------------+
| OrderStorageKernel                      |
| per-level FIFO | handles | slot reuse   |
| bounded fill records | read views       |
+-----------------------------------------+
```

The deletion test explains the seam: removing the kernel would force every
host to reimplement link maintenance, stale-handle rejection, reuse, and fill
enumeration. Removing the reference host does not change the kernel; a venue
replaces it with its own policy.

## Storage model

Each `marketId` derives one state slot and one aligned node region from domain-
separated hashes. A node occupies exactly two slots. Index zero is reserved.
The node region clears its lower 96 address bits before adding
`2 * (index - 1)`.

This avoids collision with ordinary declared host storage under the stated
cryptographic namespace assumption. It is not a formal proof against every
future manually assigned storage domain. Proxy upgrades and other unstructured
storage libraries must be reviewed together before deployment.

The default allocator is one global free list per market. The experimental
price-sharded allocator is intentionally excluded: prior native timing did not
justify making it the default.

## Atomic settlement

`consumeWithFills` and `consumeUpToWithFills` return makers and quantities to
the importing host before the external transaction completes. The host can
transfer assets after mutation; any later revert rolls back both storage and
token calls. The kernel does not make an external call itself.

Atomicity does not make unsafe host policy safe. A host still needs a
reentrancy guard, exact-transfer or explicitly supported token semantics,
price and deadline guards, bounded work, solvency accounting, and recovery.

## Versioning

`v0.4.1` exposes the same kernel bytes as the frozen v0.4 trial package. The
patch release changes distribution and documentation, not storage semantics.
Any future kernel source change requires a new source hash, compatibility
notes, and full host regression testing.
