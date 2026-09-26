# Eight-tick inventory reference

This directory preserves the exact Solidity sources used by the public Monad
testnet reference. It is a one-sided BASE-sale inventory market over eight
constructor-configured ticks, not a CLOB or production venue.

The host imports the frozen package path so its source remains identical to the
verified deployment:

```solidity
import "@monad-ac/order-storage-preview/contracts/OrderStorageKernel.sol";
```

For a new integration, use the directly visible
`../../contracts/OrderStorageKernel.sol` from a pinned commit and provide your
own reviewed host policy.

## Units and flow

```text
BASE raw  = lots * baseRawPerLot
QUOTE raw = lots * quoteRawPerLot[priceTick]
```

The host escrows maker BASE, visits configured ticks by increasing
`quoteRawPerLot`, preserves FIFO within a tick, settles returned fills in the
same transaction, and caps a call at 32 fills. It rejects an intermediate
residual below the configured minimum rather than skipping to a more expensive
tick.

## Public evidence

Chain: Monad testnet `10143`

| Contract | Address |
|---|---|
| Contiguous host | [`0xF33Fe3D722d2Df7E07c053E83EAe270d38aF8709`](https://testnet.monadscan.com/address/0xF33Fe3D722d2Df7E07c053E83EAe270d38aF8709) |
| Mock BASE18 | [`0x0a876472e0C136baf7DDb8b21C7c992E36ecd7B4`](https://testnet.monadscan.com/address/0x0a876472e0C136baf7DDb8b21C7c992E36ecd7B4) |
| Mock QUOTE6 | [`0xD599C4a2C4599E2Eb46607A253a94d0F8AC96BD5`](https://testnet.monadscan.com/address/0xD599C4a2C4599E2Eb46607A253a94d0F8AC96BD5) |

Compiler: Solidity `0.8.30`, optimizer 200 runs, via-IR, EVM Shanghai.

Source SHA-256:

```text
cdd20709810dbf2e37eb53950ef41ca88dd1aee26b770d5e5dcdf927a493efd2  MultiPriceInventoryBase.sol
af3c597c790c8317a2d6386179880ff53afe14724560cfee8d8efd53a6c26a96  ContiguousMultiPriceInventory.sol
02a0f26c1046b64aefa82b93645bf979af90f92719760466fa0cefc7fc6674cd  StrictMockERC20.sol
```

This evidence demonstrates a mock-asset reference execution only. It is not a
security audit, production deployment, user-demand signal, or universal gas
claim.
