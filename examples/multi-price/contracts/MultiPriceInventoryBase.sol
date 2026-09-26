// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMultiPriceAsset {
    function balanceOf(address) external view returns (uint256);
    function transfer(address,uint256) external returns (bool);
    function transferFrom(address,address,uint256) external returns (bool);
}

/// Reference application: a one-sided BASE inventory market over exactly eight
/// configured price levels. It is not a bid book, route aggregator, or CLOB.
abstract contract MultiPriceInventoryBase {
    uint32 public constant MAX_FILLS = 32;
    uint8 public constant TICK_COUNT = 8;
    struct OrderView { address maker; uint96 lots; uint64 priceTick; uint96 handle; }
    struct KernelFill { uint96 handle; address maker; uint96 lots; uint96 remainingLots; }
    struct FillReceipt { bytes32 marketId; uint64 priceTick; uint96 handle; address maker; uint96 lots; uint256 baseRaw; uint256 quoteRaw; uint96 remainingLots; }

    address public immutable baseToken;
    address public immutable quoteToken;
    address public immutable surplusRecipient;
    bytes32 public immutable marketId;
    uint256 public immutable baseRawPerLot;
    uint96 public immutable minimumOrderLots;
    uint96 public immutable minimumResidualLots;
    uint8 public immutable baseDecimals;
    uint8 public immutable quoteDecimals;
    uint64[8] internal configuredTicks;
    uint256[8] internal configuredQuoteRawPerLot;
    mapping(uint64 => uint8) internal tickIndexPlusOne;
    uint256 public lockedBaseRaw;
    uint256 private entered = 1;

    error WrongMarket(bytes32 supplied);
    error InvalidConfiguration();
    error UnsupportedTick(uint64 priceTick);
    error InvalidLots(uint96 lots);
    error LengthMismatch();
    error InvalidFillBound(uint32 maxFills);
    error MinimumLots(uint96 actual,uint96 minimum);
    error QuoteLimit(uint256 actual,uint256 maximum);
    error Expired(uint256 current,uint256 deadline);
    error ResidualBelowMinimum(uint96 residual,uint96 minimum);
    error TransferFailed(address token);
    error TokenDeltaMismatch(address token,address account,uint256 expected,uint256 actual);
    error Reentered();
    error SurplusTouchesEscrow(uint256 requested,uint256 available);

    event OrderPosted(bytes32 indexed marketId,uint64 indexed priceTick,uint96 indexed handle,address maker,uint96 lots,uint256 baseRaw,uint256 quoteRawPerLot);
    event OrderCancelled(bytes32 indexed marketId,uint64 indexed priceTick,uint96 indexed handle,address maker,uint96 lots,uint256 refundedBaseRaw);
    event OrderRefreshed(bytes32 indexed marketId,address indexed maker,uint96 cancelledLots,uint96 postedLots,uint256 refundedBaseRaw,uint256 escrowedBaseRaw);
    event TradeSettled(bytes32 indexed marketId,uint64 indexed priceTick,uint96 indexed handle,address maker,address taker,uint96 lots,uint256 baseRaw,uint256 quoteRaw,uint96 remainingLots);
    event SurplusRecovered(address indexed token,uint256 amount,address indexed recipient);

    modifier nonReentrant(){if(entered!=1)revert Reentered();entered=2;_;entered=1;}

    constructor(address base_,address quote_,address surplus_,bytes32 market_,uint256 basePerLot_,uint64[8] memory ticks_,uint256[8] memory quotePerLot_,uint96 minOrder_,uint96 minResidual_,uint8 baseDecimals_,uint8 quoteDecimals_){
        if(base_==address(0)||quote_==address(0)||base_==quote_||surplus_==address(0)||market_==bytes32(0)||basePerLot_==0||minOrder_==0||minResidual_==0)revert InvalidConfiguration();
        uint256 priorQuote;
        for(uint8 i;i<TICK_COUNT;++i){
            if(ticks_[i]==0||quotePerLot_[i]==0||quotePerLot_[i]<=priorQuote||tickIndexPlusOne[ticks_[i]]!=0)revert InvalidConfiguration();
            configuredTicks[i]=ticks_[i];configuredQuoteRawPerLot[i]=quotePerLot_[i];tickIndexPlusOne[ticks_[i]]=i+1;priorQuote=quotePerLot_[i];
        }
        baseToken=base_;quoteToken=quote_;surplusRecipient=surplus_;marketId=market_;baseRawPerLot=basePerLot_;minimumOrderLots=minOrder_;minimumResidualLots=minResidual_;baseDecimals=baseDecimals_;quoteDecimals=quoteDecimals_;_initializeKernel(market_);
    }

    function _initializeKernel(bytes32) internal virtual;
    function _post(bytes32,address,uint64,uint96) internal virtual returns(uint96);
    function _cancel(bytes32,address,uint96) internal virtual returns(uint96,uint64);
    function _consumeUpTo(bytes32,uint64,uint96,uint32) internal virtual returns(KernelFill[] memory,uint96);
    function _order(bytes32,uint96) internal view virtual returns(OrderView memory);
    function _level(bytes32,uint64) internal view virtual returns(uint96,uint96);
    function _allocator(bytes32) internal view virtual returns(uint32,uint32);

    function tick(uint8 index) external view returns(uint64 priceTick,uint256 quoteRawPerLot){if(index>=TICK_COUNT)revert InvalidConfiguration();return(configuredTicks[index],configuredQuoteRawPerLot[index]);}
    function quotePerLot(uint64 priceTick) public view returns(uint256){uint8 p=tickIndexPlusOne[priceTick];if(p==0)revert UnsupportedTick(priceTick);return configuredQuoteRawPerLot[p-1];}
    function _requireMarket(bytes32 supplied) internal view {if(supplied!=marketId)revert WrongMarket(supplied);}
    function _validateLots(uint96 lots) internal view {if(lots<minimumOrderLots)revert InvalidLots(lots);}
    function _baseRaw(uint256 lots) internal view returns(uint256){return lots*baseRawPerLot;}
    function _quoteRaw(uint64 priceTick,uint256 lots) internal view returns(uint256){return lots*quotePerLot(priceTick);}
    function _callToken(address token,bytes memory data) private { (bool ok,bytes memory ret)=token.call(data);if(!ok||ret.length!=32||!abi.decode(ret,(bool)))revert TransferFailed(token); }
    function _pullExact(address token,address from,uint256 amount) internal {uint256 beforeBalance=IMultiPriceAsset(token).balanceOf(address(this));_callToken(token,abi.encodeCall(IMultiPriceAsset.transferFrom,(from,address(this),amount)));uint256 afterBalance=IMultiPriceAsset(token).balanceOf(address(this));if(afterBalance!=beforeBalance+amount)revert TokenDeltaMismatch(token,address(this),beforeBalance+amount,afterBalance);}
    function _pushExact(address token,address to,uint256 amount) internal {uint256 beforeHost=IMultiPriceAsset(token).balanceOf(address(this));uint256 beforeRecipient=IMultiPriceAsset(token).balanceOf(to);_callToken(token,abi.encodeCall(IMultiPriceAsset.transfer,(to,amount)));uint256 afterHost=IMultiPriceAsset(token).balanceOf(address(this));uint256 afterRecipient=IMultiPriceAsset(token).balanceOf(to);if(afterHost+amount!=beforeHost)revert TokenDeltaMismatch(token,address(this),beforeHost-amount,afterHost);if(afterRecipient!=beforeRecipient+amount)revert TokenDeltaMismatch(token,to,beforeRecipient+amount,afterRecipient);}
    function _checkEscrow() internal view {uint256 actual=IMultiPriceAsset(baseToken).balanceOf(address(this));if(actual<lockedBaseRaw)revert TokenDeltaMismatch(baseToken,address(this),lockedBaseRaw,actual);}

    function post(bytes32 supplied,uint64 priceTick,uint96 lots) external nonReentrant returns(uint96 handle){_requireMarket(supplied);_validateLots(lots);uint256 baseRaw=_baseRaw(lots);_pullExact(baseToken,msg.sender,baseRaw);handle=_post(marketId,msg.sender,priceTick,lots);lockedBaseRaw+=baseRaw;_checkEscrow();emit OrderPosted(marketId,priceTick,handle,msg.sender,lots,baseRaw,quotePerLot(priceTick));}
    function cancel(bytes32 supplied,uint96 handle) external nonReentrant {_requireMarket(supplied);(uint96 lots,uint64 priceTick)=_cancel(marketId,msg.sender,handle);uint256 baseRaw=_baseRaw(lots);lockedBaseRaw-=baseRaw;_pushExact(baseToken,msg.sender,baseRaw);_checkEscrow();emit OrderCancelled(marketId,priceTick,handle,msg.sender,lots,baseRaw);}
    function refresh(bytes32 supplied,uint96[] calldata cancelHandles,uint64[] calldata postTicks,uint96[] calldata postLots) external nonReentrant returns(uint96[] memory handles){
        _requireMarket(supplied);if(postTicks.length!=postLots.length)revert LengthMismatch();uint256 postedLots;
        for(uint256 i;i<postLots.length;++i){_validateLots(postLots[i]);quotePerLot(postTicks[i]);postedLots+=postLots[i];}
        uint256 escrowed=_baseRaw(postedLots);if(escrowed!=0)_pullExact(baseToken,msg.sender,escrowed);uint256 cancelledLots;
        for(uint256 i;i<cancelHandles.length;++i){(uint96 lots,uint64 p)=_cancel(marketId,msg.sender,cancelHandles[i]);cancelledLots+=lots;emit OrderCancelled(marketId,p,cancelHandles[i],msg.sender,lots,_baseRaw(lots));}
        handles=new uint96[](postLots.length);for(uint256 i;i<postLots.length;++i){handles[i]=_post(marketId,msg.sender,postTicks[i],postLots[i]);emit OrderPosted(marketId,postTicks[i],handles[i],msg.sender,postLots[i],_baseRaw(postLots[i]),quotePerLot(postTicks[i]));}
        uint256 refunded=_baseRaw(cancelledLots);lockedBaseRaw=lockedBaseRaw+escrowed-refunded;if(refunded!=0)_pushExact(baseToken,msg.sender,refunded);_checkEscrow();emit OrderRefreshed(marketId,msg.sender,uint96(cancelledLots),uint96(postedLots),refunded,escrowed);
    }

    function take(bytes32 supplied,uint96 maxLots,uint32 maxFills,uint256 maxQuoteRaw,uint96 minLotsReceived,uint256 deadline) external nonReentrant returns(FillReceipt[] memory receipts){
        _requireMarket(supplied);if(maxLots==0||minLotsReceived==0||minLotsReceived>maxLots)revert InvalidLots(maxLots);if(maxFills==0||maxFills>MAX_FILLS)revert InvalidFillBound(maxFills);if(block.timestamp>deadline)revert Expired(block.timestamp,deadline);
        receipts=new FillReceipt[](maxFills);uint32 count;uint96 actualLots;uint256 actualQuoteRaw;
        for(uint8 levelIndex;levelIndex<TICK_COUNT&&actualLots<maxLots&&count<maxFills;++levelIndex){uint64 p=configuredTicks[levelIndex];(KernelFill[] memory fills,uint96 levelLots)=_consumeUpTo(marketId,p,maxLots-actualLots,maxFills-count);actualLots+=levelLots;for(uint256 j;j<fills.length;++j){if(fills[j].remainingLots!=0&&fills[j].remainingLots<minimumResidualLots)revert ResidualBelowMinimum(fills[j].remainingLots,minimumResidualLots);uint256 baseRaw=_baseRaw(fills[j].lots);uint256 quoteRaw=_quoteRaw(p,fills[j].lots);actualQuoteRaw+=quoteRaw;receipts[count++]=FillReceipt(marketId,p,fills[j].handle,fills[j].maker,fills[j].lots,baseRaw,quoteRaw,fills[j].remainingLots);}}
        if(actualLots<minLotsReceived)revert MinimumLots(actualLots,minLotsReceived);if(actualQuoteRaw>maxQuoteRaw)revert QuoteLimit(actualQuoteRaw,maxQuoteRaw);uint256 actualBaseRaw=_baseRaw(actualLots);_pullExact(quoteToken,msg.sender,actualQuoteRaw);lockedBaseRaw-=actualBaseRaw;
        for(uint32 i;i<count;++i){_pushExact(quoteToken,receipts[i].maker,receipts[i].quoteRaw);emit TradeSettled(marketId,receipts[i].priceTick,receipts[i].handle,receipts[i].maker,msg.sender,receipts[i].lots,receipts[i].baseRaw,receipts[i].quoteRaw,receipts[i].remainingLots);}
        _pushExact(baseToken,msg.sender,actualBaseRaw);_checkEscrow();assembly("memory-safe"){mstore(receipts,count)}
    }
    function order(bytes32 supplied,uint96 handle) external view returns(OrderView memory){_requireMarket(supplied);return _order(marketId,handle);}
    function level(bytes32 supplied,uint64 priceTick) external view returns(uint96,uint96){_requireMarket(supplied);quotePerLot(priceTick);return _level(marketId,priceTick);}
    function allocator(bytes32 supplied) external view returns(uint32,uint32){_requireMarket(supplied);return _allocator(marketId);}
    function recoverSurplus(address token,uint256 amount) external nonReentrant {if(msg.sender!=surplusRecipient)revert TransferFailed(token);if(token!=baseToken&&token!=quoteToken)revert TransferFailed(token);uint256 available=IMultiPriceAsset(token).balanceOf(address(this));if(token==baseToken){if(available<lockedBaseRaw||amount>available-lockedBaseRaw)revert SurplusTouchesEscrow(amount,available-lockedBaseRaw);}else if(amount>available)revert SurplusTouchesEscrow(amount,available);_pushExact(token,surplusRecipient,amount);emit SurplusRecovered(token,amount,surplusRecipient);}
}
