# External integration trial acceptance

This is a trial gate, not an adoption claim. A self-authored consumer does not satisfy it.

An external venue developer succeeds only if, without repository-internal imports, they can:

1. verify and install the locked tarball;
2. compile a host that maps its authenticated maker and market to kernel `post` and maker-only
   `cancel`;
3. call `consumeUpToWithFills`, apply its own maximum-payment/minimum-receipt/deadline policy, and
   settle every returned `Fill` in the same transaction;
4. demonstrate FIFO partial fill, cancel/refund, slot reuse with a new generation, stale-handle
   rejection, and full rollback after an injected final settlement failure;
5. identify the order reference as `(hostAddress, marketId, handle)` and keep `price`/`quantity`
   application-defined rather than treating them as a currency formula; and
6. report actual code changes, a blocking or awkward API if any, and one measured or architectural
   benefit relative to their current implementation.

The timing checkpoints are separate: download/hash/demo should target 10–15 minutes; connecting
maker authentication, units, and a first `Fill[]` settlement in the developer's own throwaway host
targets 60–90 minutes; rollback and current-implementation comparison are follow-up review. Missing
the 60-minute mark is data, not an automatic API failure. Record whether the cause is package/tooling,
unclear documentation, the supplied example, the kernel API, the venue's own policy, or an
unsupported use case. External demand and adoption remain `UNVERIFIED` until a real developer
returns this evidence.
