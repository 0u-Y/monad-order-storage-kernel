# OrderStorageKernel v0.4 developer handoff

Status: **public integration-trial source, not registry-published**. The canonical repository is
`https://github.com/0u-Y/monad-order-storage-kernel`; use its tagged release asset and verify the
hash rather than substituting a package with the same name from an unverified registry.

Start with [`INTEGRATION_GUIDE.md`](INTEGRATION_GUIDE.md) and run:

```bash
bash verify_and_run.sh
```

The frozen identities are in [`SOURCE_LOCK.json`](SOURCE_LOCK.json). Trial success is defined in
[`ACCEPTANCE.md`](ACCEPTANCE.md), and findings belong in
[`FEEDBACK_TEMPLATE.md`](FEEDBACK_TEMPLATE.md). The short introduction in
[`OUTREACH_DRAFT.md`](OUTREACH_DRAFT.md) is deliberately unsent.

## What belongs where

| Kernel responsibility | Reference-host responsibility |
|---|---|
| FIFO links within one `priceTick` | Token escrow and exact-delta transfers |
| Generation handles and stale-handle rejection | Maker/taker authentication and allowances |
| Global slot reuse | Lot conversion and token decimals |
| Bounded synchronous fill records | `maxQuoteRaw`, `minLotsReceived`, deadline and residual policy |
| Market-scoped storage namespace | Price choice, settlement and surplus recovery |

The kernel is custody-free and treats `priceTick` as an opaque level ID. It is not a CLOB,
best-price router, exchange, custody system or pricing oracle. The included host is a single-market,
single-tick mock-token reference application.

## 10–15-minute local check

Requirements: Node.js 20+ and npm. Docker, Foundry, a private key and an RPC are not required.

```bash
bash verify_and_run.sh
```

The consumer imports `@monad-ac/order-storage-preview` only from
`../order-storage-preview.tgz`. It deploys mock BASE18/QUOTE6 and a contiguous reference host to an
ephemeral Ganache chain, posts two maker orders, takes across both orders in FIFO order, cancels the
residual, and checks balances, allowances, escrow and the empty queue.

Expected terminal line:

```text
ORDER STORAGE HANDOFF DEMO PASS
```

For a host integration, copy the Solidity library import and replace the reference host's token,
lot and settlement policy with your own reviewed policy. An order reference is
`(hostAddress, marketId, handle)`, not a globally unique numeric handle.

## Three integration questions

1. Can your host map its authenticated maker and market namespace to `post`, maker-only `cancel`, and `(hostAddress, marketId, handle)` without weakening authorization?
2. Does the bounded synchronous fill array contain every maker and quantity field your settlement must consume atomically, and what is your defensible `maxFills` bound?
3. Do your token, lot, residual, price-protection and recovery policies satisfy the host responsibilities above without treating `priceTick` as a monetary ratio?

Actual external-developer feedback remains `NOT_RUN`.
