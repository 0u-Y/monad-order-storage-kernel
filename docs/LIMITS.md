# Known limits and negative evidence

This file is part of the interface. Integrators should treat each item as a
design constraint, not a future-performance promise.

## Scope

- Same-price FIFO storage only. Multi-price priority is host policy.
- No bids, custody, settlement, oracle, matching engine, fee system, or router.
- `uint32` physical index, `uint64` generation, `uint64` level ID, and `uint96`
  quantity/handle.
- No supported proxy/upgrade pattern has been security-audited.
- No arbitrary ERC-20 compatibility claim. The reference host tests exact-
  delta transfers with mock tokens.

## Bounded fills

The kernel accepts a caller-selected positive `maxFills`; the reference host
caps it at 32. `consumeUpToWithFills` provides bounded work, not guaranteed
completion. A queue of more small heads can require multiple transactions.
Hosts must make their progress promise explicit and must not silently skip a
cheap or earlier FIFO head.

## Gas limits and Monad fees

Gas use depends on live state: new slot vs reuse, full vs partial head, number
of makers paid, tick transitions, and token storage transitions. A previously
estimated transaction was reproduced running out of gas after the book changed
from one large head to several smaller heads.

Therefore:

1. estimate and simulate against the freshest available state;
2. bind any SDK policy to explicit state/workload assumptions;
3. fail closed or re-estimate when those assumptions change;
4. do not call a universal percentage margin safe.

On Monad, submitted gas limit and execution gas are distinct fields. The
submitted limit participates in charging under Monad's fee rules. An
`eth_estimateGas` value is neither a receipt's `gasUsed` nor an actual fee.

## Performance applicability

The contiguous layout showed benefits in selected multi-order workloads, but
the result is not monotonic:

- one-fill paths can lose to a conventional linked implementation;
- a tested 256-active `1 cancel + 1 post` whole-host path regressed;
- larger `2+2`, `5+`, and 32-fill cases can benefit under measured fixtures.

No claim is made that storage-page locality alone caused these observations,
that the kernel is faster than Kuru, or that it improves Monad TPS. External
demand and independent integration remain unverified.
