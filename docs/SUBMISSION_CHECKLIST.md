# Submission-day checklist

Use this page immediately before saving the final Monad Metropolis entry. It is
a verification checklist, not authorization to submit.

## Portal and copy

- [ ] Sign in at <https://hackathon.monad.xyz/> and reconfirm the current
  deadline, field limits, team membership, and account-specific project state.
- [ ] Project name is **OrderStorageKernel: Bounded FIFO Settlement for Monad
  Venues** and is at most 120 characters.
- [ ] One-line description is copied from `SUBMISSION_DRAFT.md` and is at most
  200 characters.
- [ ] Primary track is **Onchain Finance & Trading**.
- [ ] No bounty is selected unless its separate requirements have been read
  and satisfied.
- [ ] Repository URL is
  <https://github.com/0u-Y/monad-order-storage-kernel>.
- [ ] Replace `[DEMO_VIDEO_URL — REQUIRED BEFORE SUBMISSION]` with a publicly
  viewable video URL and open it in a signed-out browser.
- [ ] Paste the technical description without adding CLOB, Kuru-relative,
  production-readiness, TPS, fee-savings, page-locality-causation, or verified
  demand claims.

## Frozen identity

- [ ] Public v0.4.1 release exists:
  <https://github.com/0u-Y/monad-order-storage-kernel/releases/tag/v0.4.1>.
- [ ] `sha256sum order-storage-preview.tgz` equals
  `4fa0bd18bc5846313351d6fb4d79d6317ec4b7309180b86afee4916ec1b5012b`.
- [ ] Kernel SHA-256 remains
  `cce2e055fb84169e5d996c87edd99f116b3af60951f2ee48fd10aa74b630553e`.
- [ ] `git diff -- contracts/ benchmark/ examples/ scripts/ evidence/` shows
  no unintended submission-day source, runner, fixture, or evidence change.

## Five-minute public verification

Run from a new temporary directory, not a developer worktree:

```bash
git clone https://github.com/0u-Y/monad-order-storage-kernel.git
cd monad-order-storage-kernel
npm run judge
```

- [ ] Exit code is zero.
- [ ] Output includes the seven numbered scenes, not only a PASS marker.
- [ ] Output ends with `METROPOLIS TWO-MINUTE DEMO PASS` and
  `METROPOLIS RECORDED EVIDENCE AUDIT PASS`.
- [ ] The video follows `DEMO_SCRIPT.md` and its displayed observations match
  this fresh output.

Optional network check:

```bash
npm run replay:testnet
```

- [ ] If RPC is available, record the date and whether its narrow assertions
  passed: chain 10143, nonempty code, 19 receipt statuses/submitted limits,
  aggregate charge arithmetic, and current zero host balances.
- [ ] If RPC is unavailable, label the live replay **BLOCKED**. Do not merge it
  with the historical 19-receipt report or broaden its assertion scope.

## Evidence and links

- [ ] Open the repository, release, judge guide, raw evidence directory,
  testnet host, first take, and refresh links in `SUBMISSION_DRAFT.md` from a
  signed-out browser.
- [ ] Benchmark table uses only the five public fixtures and linked 2+2 is
  **235,023**, with historical **235,022** identified as a one-gas prior
  observation.
- [ ] Estimates, suggested/submitted limits, receipt `gasUsed`, and charged
  units are labeled separately.
- [ ] One-fill regression, active-256 1+1 regression, and stale-limit OOG are
  visible without expanding a footnote.
- [ ] If `npm run benchmark:judge` cannot access the pinned historical state,
  point judges to `evidence/judge-benchmark-20260926/` and call it stored raw
  evidence, not a fresh replay.

## Final human gate

- [ ] Video audio, captions, and screen contain no key, credential, private
  endpoint, or unrelated research path.
- [ ] External integration and demand remain **UNVERIFIED**.
- [ ] The portal preview renders Markdown/links correctly.
- [ ] Save once, reopen the project, and confirm the latest saved copy contains
  the intended repo and demo URLs.
- [ ] Only the account owner presses the final submit/save control. This
  repository preparation did not submit or contact anyone.
