# Security policy

## Supported status

`v0.4.1` is a public source preview and has not received an independent
security audit. It is not approved for production custody. Security reports
should be submitted through GitHub's private vulnerability reporting feature;
do not include private keys, live funds, or sensitive deployment credentials.

## Kernel threat model

The kernel assumes that the importing host:

- authenticates the maker and any matcher/consumer authority;
- validates market, level, quantity, fill bound, deadline, and economic guards;
- owns all token calls and protects them against reentrancy;
- settles every returned fill or reverts the transaction;
- treats `(host, marketId, handle)` as the order identity;
- does not write the kernel's derived storage slots directly;
- reviews every other unstructured-storage namespace for collision;
- prevents unsupported upgrades from changing storage meaning.

The kernel protects FIFO links, generation-safe reuse, maker equality on
cancel, initialization, bounds, and stale handles. It cannot protect prices,
solvency, custody, token semantics, oracle freshness, permissions, or recovery
because those facts are outside its interface.

## Unsupported without host-specific review

- fee-on-transfer, rebasing, callback, malformed-return, or nonstandard tokens
- delegatecall/proxy upgrades
- unbounded fills or a gas limit reused after state changes
- treating `priceTick` as a currency ratio
- treating a handle as globally unique
- using kernel events alone as proof of asset settlement

## Operational secrets

No key, mnemonic, keystore, password, signed raw transaction, or RPC credential
belongs in this repository, an issue, CI output, or a release asset.
