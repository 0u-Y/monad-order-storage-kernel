// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/OrderStorageKernel.sol";

contract KernelHarness {
    using OrderStorageKernel for bytes32;

    error ForcedRollback();

    function initialize(bytes32 marketId) external { marketId.initialize(); }

    function post(bytes32 marketId, uint64 priceTick, uint96 quantity)
        external returns (uint96)
    {
        return marketId.post(msg.sender, priceTick, quantity);
    }

    function cancel(bytes32 marketId, uint96 handle) external returns (uint96) {
        return marketId.cancel(msg.sender, handle);
    }

    function consume(bytes32 marketId, uint64 priceTick, uint96 quantity, uint32 maxFills)
        external returns (OrderStorageKernel.Fill[] memory fills, uint96 filled)
    {
        return marketId.consumeUpToWithFills(priceTick, quantity, maxFills);
    }

    function consumeExact(bytes32 marketId, uint64 priceTick, uint96 quantity, uint32 maxFills)
        external returns (OrderStorageKernel.Fill[] memory)
    {
        return marketId.consumeWithFills(priceTick, quantity, maxFills);
    }

    function consumeThenRevert(bytes32 marketId, uint64 priceTick, uint96 quantity, uint32 maxFills)
        external
    {
        marketId.consumeUpToWithFills(priceTick, quantity, maxFills);
        revert ForcedRollback();
    }

    function order(bytes32 marketId, uint96 handle)
        external view returns (OrderStorageKernel.Order memory)
    {
        return marketId.order(handle);
    }

    function level(bytes32 marketId, uint64 priceTick)
        external view returns (uint96 head, uint96 tail)
    {
        return marketId.level(priceTick);
    }
}
