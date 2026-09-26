# Interface reference

The module interface is the internal Solidity library in
`contracts/OrderStorageKernel.sol`. The importing host exposes any external
interface and remains responsible for authorization and settlement.

## Types and units

| Type | Meaning |
|---|---|
| `bytes32 marketId` | Host-chosen storage namespace; must be initialized once |
| `uint64 price` | Opaque FIFO level identifier, not an exchange rate |
| `uint96 quantity` | Host-defined integer unit, commonly lots |
| `uint96 handle` | `generation:uint64 || index:uint32` |
| `Order` | Live maker, remaining quantity, level, and handle |
| `Fill` | Handle, maker, filled quantity, and remaining quantity |

The portable order reference is `(host address, marketId, handle)`. Reusing a
freed index increments its generation, so an old handle reverts with
`StaleHandle`. Equal numeric handles can exist in different markets or hosts.

## Mutations

### `initialize(marketId)`

Initializes one market namespace. A second call reverts. Initialization is a
host deployment/configuration responsibility.

### `post(marketId, maker, price, quantity) -> handle`

Appends a nonzero maker and quantity to the tail of one nonzero price level.
It reuses `freeHead` when available, otherwise increments `highWater`.

The kernel does not authenticate `maker`. An external host should normally
derive it from `msg.sender` or a separately verified authorization.

### `cancel(marketId, maker, handle) -> cancelled`

Removes an arbitrary live order after checking the supplied maker against the
stored maker. It returns the remaining quantity for host-side refunds. A stale
generation, empty slot, zero index, or wrong market fails closed.

### `consume(marketId, price, quantity)`

Consumes exactly `quantity` from one level in FIFO order and reverts on
insufficient depth. It only emits kernel events; it does not return settlement
records and is unsuitable for a host that must pay each maker from returned
data.

### `consumeWithFills(marketId, price, quantity, maxFills) -> Fill[]`

Consumes exactly the requested quantity and returns every touched maker. It
reverts if depth is insufficient or more than `maxFills` nodes are required.
Use when the requested amount must be all-or-nothing.

### `consumeUpToWithFills(...) -> (Fill[], filled)`

Consumes up to the requested quantity and at most `maxFills` nodes. It can
return zero or partial progress. The host must enforce `minReceived`, residual,
price, deadline, and settlement guards before returning. A later revert in the
same transaction restores the kernel state.

## Views

- `order(marketId, handle)` returns one live order or reverts on a stale handle.
- `level(marketId, price)` returns generation-bearing head and tail handles;
  both are zero for an empty level.
- `allocator(marketId)` exposes `highWater` and the current free-list head for
  diagnostics, not business logic.
- `stateSlot`, `nodeBase`, and `nodeSlot` expose deterministic addressing for
  integration diagnostics. Callers must not write those slots directly.

## Events

`KernelOrderConsumed` is emitted once per fill. Host events remain canonical
for financial settlement because only the host knows asset units and payment
results. Indexers should key orders by host, market, and handle and tolerate
transaction rollback and chain reorganization.

## Errors

Configuration and input failures include `AlreadyInitialized`,
`NotInitialized`, `InvalidMaker`, `InvalidPrice`, `InvalidQuantity`, and
`InvalidFillLimit`. Liveness failures include `InsufficientDepth` and
`FillLimitExceeded`. Identity failures include `StaleHandle` and `NotMaker`.
Allocator exhaustion errors are explicit and are not recoverable by silently
wrapping an index or generation.
