# Unsent integrator note

Status: **DRAFT — NOT SENT**

OrderStorageKernel v0.4 is a storage-only Solidity library for a new Monad venue that already owns
its pricing, custody, and settlement rules. It provides market-scoped same-level FIFO, maker-only
cancel, atomic cancel/repost, generation-safe reusable handles, and bounded synchronous `Fill[]`
records that a host can settle before the transaction returns. The attached kit installs from a
locked local tarball and runs a mock-asset post → partial fill → cancel/refund flow without a key or
RPC. A separate eight-tick reference shows cheapest-ask traversal, but it is not part of the kernel
and this is not a CLOB, router, or production custody system.

The trial is deliberately narrow. The supplied download/hash/demo should take about 10–15 minutes;
allow 60–90 minutes to connect maker authentication, units, and the first `Fill[]` settlement in a
throwaway version of your host. Rollback injection and comparison with your current implementation
can be a follow-up. Missing 60 minutes alone is not an API-failure verdict. We want disconfirming
feedback as much as a successful compile.

1. How many files/lines and which policy wrappers did you need beyond replacing the supplied host's
   authentication, price, and settlement choices?
2. Which existing or missing API contract blocked or complicated `post`, maker cancel/refresh, or
   atomic settlement of `consumeUpToWithFills`?
3. After custody and settlement were included, what concrete advantage remained versus your current
   queue/storage implementation? `NONE` is a useful answer.

Please use `FEEDBACK_TEMPLATE.md`; do not send keys, production credentials, proprietary code, or
funds. No message has been sent by this project.
