// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Custody-free FIFO order-storage kernel. `price` is an opaque level ID and
/// `quantity` is an application-defined integer; neither has currency semantics.
/// The importing host owns authentication, matching policy, custody, and settlement.
library OrderStorageKernel {
    bytes32 private constant STATE_DOMAIN = keccak256("monad-ac.order-storage.state.v1");
    bytes32 private constant NODE_DOMAIN = keccak256("monad-ac.order-storage.nodes.v1");
    uint256 private constant LOW_96_MASK = type(uint96).max;

    struct Ends { uint32 head; uint32 tail; }
    struct State {
        bool initialized;
        uint32 highWater;
        uint32 freeHead;
        mapping(uint64 => Ends) levels;
    }
    // Exactly two storage slots: maker+quantity, then links+generation+price.
    struct Node {
        address maker;
        uint96 quantity;
        uint32 prev;
        uint32 next;
        uint64 generation;
        uint64 price;
    }
    struct Order {
        address maker;
        uint96 quantity;
        uint64 price;
        uint96 handle;
    }
    struct Fill {
        uint96 handle;
        address maker;
        uint96 quantity;
        uint96 remaining;
    }

    error AlreadyInitialized(bytes32 marketId);
    error NotInitialized(bytes32 marketId);
    error InvalidMaker();
    error InvalidPrice();
    error InvalidQuantity();
    error IndexExhausted();
    error GenerationExhausted(uint32 index);
    error StaleHandle(uint96 handle);
    error NotMaker(address expected, address actual);
    error InsufficientDepth(uint64 price, uint96 missing);
    error InvalidFillLimit();
    error FillLimitExceeded(uint32 maxFills, uint96 remaining);

    event KernelOrderConsumed(
        bytes32 indexed marketId,
        uint64 indexed price,
        uint96 indexed handle,
        address maker,
        uint96 filled,
        uint96 remaining
    );

    function initialize(bytes32 marketId) internal {
        State storage s = _state(marketId);
        if (s.initialized) revert AlreadyInitialized(marketId);
        s.initialized = true;
    }

    function post(bytes32 marketId, address maker, uint64 price, uint96 quantity)
        internal returns (uint96 handle)
    {
        if (maker == address(0)) revert InvalidMaker();
        if (price == 0) revert InvalidPrice();
        if (quantity == 0) revert InvalidQuantity();
        State storage s = _ready(marketId);
        uint32 index;
        if (s.freeHead != 0) {
            index = s.freeHead;
            s.freeHead = _node(marketId, index).next;
        } else {
            if (s.highWater == type(uint32).max) revert IndexExhausted();
            index = ++s.highWater;
        }

        Node storage n = _node(marketId, index);
        if (n.generation == type(uint64).max) revert GenerationExhausted(index);
        uint64 generation = ++n.generation;
        Ends storage level = s.levels[price];
        n.maker = maker;
        n.quantity = quantity;
        n.prev = level.tail;
        n.next = 0;
        n.price = price;
        if (level.tail == 0) level.head = index;
        else _node(marketId, level.tail).next = index;
        level.tail = index;
        handle = _handle(index, generation);
    }

    function cancel(bytes32 marketId, address maker, uint96 handle) internal returns (uint96 cancelled) {
        State storage s = _ready(marketId);
        (uint32 index, Node storage n) = _liveNode(marketId, handle);
        if (n.maker != maker) revert NotMaker(n.maker, maker);
        cancelled = n.quantity;
        _remove(marketId, s, index, n);
    }

    function consume(bytes32 marketId, uint64 price, uint96 quantity) internal {
        if (price == 0) revert InvalidPrice();
        if (quantity == 0) revert InvalidQuantity();
        State storage s = _ready(marketId);
        uint96 remaining = quantity;
        while (remaining != 0) {
            uint32 index = s.levels[price].head;
            if (index == 0) revert InsufficientDepth(price, remaining);
            Node storage n = _node(marketId, index);
            uint96 fill = remaining < n.quantity ? remaining : n.quantity;
            remaining -= fill;
            n.quantity -= fill;
            uint96 afterFill = n.quantity;
            uint96 handle = _handle(index, n.generation);
            address maker = n.maker;
            if (afterFill == 0) _remove(marketId, s, index, n);
            emit KernelOrderConsumed(marketId, price, handle, maker, fill, afterFill);
        }
    }

    /// Bounded settlement seam. The importing host receives every fill before
    /// this transaction returns, so later asset movement can atomically revert
    /// these storage mutations.
    function consumeWithFills(bytes32 marketId, uint64 price, uint96 quantity, uint32 maxFills)
        internal returns (Fill[] memory fills)
    {
        if (price == 0) revert InvalidPrice();
        if (quantity == 0) revert InvalidQuantity();
        if (maxFills == 0) revert InvalidFillLimit();
        State storage s = _ready(marketId);
        fills = new Fill[](maxFills);
        uint32 count;
        uint96 remaining = quantity;
        while (remaining != 0) {
            if (count == maxFills) revert FillLimitExceeded(maxFills, remaining);
            uint32 index = s.levels[price].head;
            if (index == 0) revert InsufficientDepth(price, remaining);
            Node storage n = _node(marketId, index);
            uint96 fill = remaining < n.quantity ? remaining : n.quantity;
            remaining -= fill;
            n.quantity -= fill;
            uint96 afterFill = n.quantity;
            uint96 handle = _handle(index, n.generation);
            address maker = n.maker;
            fills[count++] = Fill(handle, maker, fill, afterFill);
            if (afterFill == 0) _remove(marketId, s, index, n);
            emit KernelOrderConsumed(marketId, price, handle, maker, fill, afterFill);
        }
        assembly ("memory-safe") { mstore(fills, count) }
    }

    /// Bounded progress variant for settlement adapters. It consumes at most
    /// maxFills nodes and reports the actual quantity; the host decides whether
    /// that partial result satisfies its taker guard.
    function consumeUpToWithFills(bytes32 marketId, uint64 price, uint96 quantity, uint32 maxFills)
        internal returns (Fill[] memory fills, uint96 filled)
    {
        if (price == 0) revert InvalidPrice();
        if (quantity == 0) revert InvalidQuantity();
        if (maxFills == 0) revert InvalidFillLimit();
        State storage s = _ready(marketId);
        fills = new Fill[](maxFills);
        uint32 count;
        uint96 remaining = quantity;
        while (remaining != 0 && count != maxFills) {
            uint32 index = s.levels[price].head;
            if (index == 0) break;
            Node storage n = _node(marketId, index);
            uint96 fill = remaining < n.quantity ? remaining : n.quantity;
            remaining -= fill;
            filled += fill;
            n.quantity -= fill;
            uint96 afterFill = n.quantity;
            uint96 handle = _handle(index, n.generation);
            address maker = n.maker;
            fills[count++] = Fill(handle, maker, fill, afterFill);
            if (afterFill == 0) _remove(marketId, s, index, n);
            emit KernelOrderConsumed(marketId, price, handle, maker, fill, afterFill);
        }
        assembly ("memory-safe") { mstore(fills, count) }
    }

    function order(bytes32 marketId, uint96 handle) internal view returns (Order memory result) {
        _ready(marketId);
        (, Node storage n) = _liveNode(marketId, handle);
        result = Order(n.maker, n.quantity, n.price, handle);
    }

    function level(bytes32 marketId, uint64 price) internal view returns (uint96 head, uint96 tail) {
        State storage s = _ready(marketId);
        Ends storage ends = s.levels[price];
        if (ends.head != 0) {
            Node storage h = _node(marketId, ends.head);
            head = _handle(ends.head, h.generation);
        }
        if (ends.tail != 0) {
            Node storage t = _node(marketId, ends.tail);
            tail = _handle(ends.tail, t.generation);
        }
    }

    function allocator(bytes32 marketId) internal view returns (uint32 highWater, uint32 freeHead) {
        State storage s = _ready(marketId);
        return (s.highWater, s.freeHead);
    }

    function stateSlot(bytes32 marketId) internal pure returns (bytes32) { return _stateSlot(marketId); }
    function nodeBase(bytes32 marketId) internal pure returns (bytes32) { return bytes32(_nodeBase(marketId)); }
    function nodeSlot(bytes32 marketId, uint32 index) internal pure returns (bytes32) {
        if (index == 0) revert StaleHandle(0);
        return bytes32(_nodeBase(marketId) + (uint256(index) - 1) * 2);
    }

    function _ready(bytes32 marketId) private view returns (State storage s) {
        s = _state(marketId);
        if (!s.initialized) revert NotInitialized(marketId);
    }

    function _liveNode(bytes32 marketId, uint96 handle) private view returns (uint32 index, Node storage n) {
        index = uint32(handle);
        if (index == 0) revert StaleHandle(handle);
        n = _node(marketId, index);
        if (n.quantity == 0 || n.generation != uint64(handle >> 32)) {
            revert StaleHandle(handle);
        }
    }

    function _remove(bytes32 marketId, State storage s, uint32 index, Node storage n) private {
        Ends storage level = s.levels[n.price];
        if (n.prev == 0) level.head = n.next;
        else _node(marketId, n.prev).next = n.next;
        if (n.next == 0) level.tail = n.prev;
        else _node(marketId, n.next).prev = n.prev;
        n.maker = address(0);
        n.quantity = 0;
        n.prev = 0;
        n.price = 0;
        n.next = s.freeHead;
        s.freeHead = index;
    }

    function _state(bytes32 marketId) private pure returns (State storage s) {
        bytes32 slot = _stateSlot(marketId);
        assembly { s.slot := slot }
    }

    function _node(bytes32 marketId, uint32 index) private pure returns (Node storage n) {
        uint256 slot = _nodeBase(marketId) + (uint256(index) - 1) * 2;
        assembly { n.slot := slot }
    }

    function _stateSlot(bytes32 marketId) private pure returns (bytes32) {
        return keccak256(abi.encode(STATE_DOMAIN, marketId));
    }

    function _nodeBase(bytes32 marketId) private pure returns (uint256) {
        return uint256(keccak256(abi.encode(NODE_DOMAIN, marketId))) & ~LOW_96_MASK;
    }

    function _handle(uint32 index, uint64 generation) private pure returns (uint96) {
        return (uint96(generation) << 32) | index;
    }
}
