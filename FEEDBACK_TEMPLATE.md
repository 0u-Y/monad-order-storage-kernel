# OrderStorageKernel external trial record

Do not include private keys, production credentials, proprietary source, or user funds.

## Identity and timing

- Trial ID:
- Developer/project (optional):
- Started/finished UTC:
- Elapsed minutes:
- OS, Node, npm, Solidity toolchain:
- Package SHA-256 observed:
- Kernel source SHA-256 observed:
- Own venue or throwaway adapter:

## Outcome

- Status: `SUCCESS` / `BLOCKED` / `NOT_A_FIT` / `INCOMPLETE`
- First failing command or call:
- Minimal error/revert:
- Reproduction using public/non-secret inputs:

## Classification

Choose exactly one primary owner. Do not label every problem a kernel defect.

- `KIT_TOOLING`: archive, install, compiler, or runner problem introduced by this kit
- `EXAMPLE_POLICY`: supplied escrow/lot/token policy is wrong or misleading, kernel unaffected
- `KERNEL_API`: frozen library interface or semantics block the integration
- `INTEGRATOR_POLICY`: venue-specific price/custody/settlement choice not supplied by the kernel
- `UNSUPPORTED_USE_CASE`: no real need for resting same-price FIFO and atomic maker refresh
- `ENVIRONMENT`: network, registry, OS, compiler availability, or unrelated failure

## Integration diff

- Files changed / approximate lines added and removed:
- Functions wrapping `post`, `cancel`, `refresh`, `consumeUpToWithFills`:
- Authentication mapping:
- `price` unit:
- `quantity` unit:
- `maxFills` and why it is safe for this venue:
- Settlement performed for each `Fill`:
- Rollback injection and observed pre/post balances/state:

## Three required answers

1. What exact code change was required beyond replacing the reference host's policy?
2. Which API or missing contract caused the most friction, and what is the smallest compatible fix?
3. Compared with your current queue/storage path, what concrete benefit remained after custody and
   settlement were included? If none, write `NONE`.

## Evidence and disposition

- Commit/diff or patch (optional public-safe reference):
- Logs/tests:
- Finding applies to: `KIT` / `EXAMPLE` / `KERNEL` / `VENUE_POLICY` / `UNKNOWN`
- Suggested disposition: `DOC_FIX` / `EXAMPLE_FIX` / `API_REVIEW` / `NO_CHANGE` / `NOT_A_FIT`
- Reproduced by project maintainers: `YES` / `NO` / `NOT_RUN`

Maintainer note: preserve this record unchanged. Any project-side reproduction or fix gets a
separate linked record so external evidence is not merged with a self-authored example result.
