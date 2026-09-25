// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDirectAsset {
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/// Single-market settlement policy for a FIFO kernel whose quantities are lots.
abstract contract DirectTakerEscrowOrderBookBase {
    address public immutable baseToken;
    address public immutable quoteToken;
    address public immutable surplusRecipient;
    bytes32 public immutable marketId;
    uint64 public immutable priceTick;
    uint256 public immutable baseRawPerLot;
    uint256 public immutable quoteRawPerLot;
    uint96 public immutable minimumOrderLots;
    uint96 public immutable minimumResidualLots;
    uint8 public immutable baseDecimals;
    uint8 public immutable quoteDecimals;
    uint32 public constant MAX_FILLS = 32;
    uint256 public lockedBaseRaw;
    uint256 private entered = 1;

    struct FillReceipt {
        bytes32 marketId;
        uint64 priceTick;
        uint96 handle;
        address maker;
        uint96 lots;
        uint256 baseRaw;
        uint256 quoteRaw;
        uint96 remainingLots;
    }

    error WrongMarket(bytes32 supplied);
    error InvalidConfiguration();
    error InvalidLots(uint96 supplied);
    error OrderBelowMinimum(uint96 supplied, uint96 minimum);
    error ResidualBelowMinimum(uint96 residual, uint96 minimum);
    error InvalidFillBound(uint32 supplied);
    error InvalidTakerGuard();
    error Expired(uint256 currentTimestamp, uint256 deadline);
    error QuoteLimit(uint256 actual, uint256 maximum);
    error MinimumLots(uint96 actual, uint96 minimum);
    error AmountOverflow(uint256 lots, uint256 rawPerLot);
    error ReentrantCall();
    error TokenCallFailed(address token);
    error TokenDeltaMismatch(address token, address account, uint256 expected, uint256 actual);
    error TokenDecimalsMismatch(address token, uint8 actual, uint8 expected);
    error EscrowInvariant(uint256 balanceRaw, uint256 lockedRaw);
    error UnauthorizedRecovery(address caller);

    event OrderPosted(bytes32 indexed marketId,uint96 indexed handle,address indexed maker,uint96 lots,uint256 baseRaw);
    event OrderCancelled(bytes32 indexed marketId,uint96 indexed handle,address indexed maker,uint96 lots,uint256 baseRaw);
    event OrderRefreshed(bytes32 indexed marketId,address indexed maker,uint96 cancelledLots,uint96 postedLots,uint256 refundedBaseRaw,uint256 escrowedBaseRaw);
    event TradeSettled(bytes32 indexed marketId,uint96 indexed handle,address indexed maker,address taker,uint64 priceTick,uint96 lots,uint256 baseRaw,uint256 quoteRaw,uint96 remainingLots);
    event SurplusRecovered(address indexed recipient,uint256 baseRaw,uint256 quoteRaw);

    constructor(
        address base_,address quote_,address surplusRecipient_,bytes32 marketId_,uint64 priceTick_,
        uint256 baseRawPerLot_,uint256 quoteRawPerLot_,uint96 minimumOrderLots_,uint96 minimumResidualLots_,
        uint8 expectedBaseDecimals_,uint8 expectedQuoteDecimals_
    ) {
        if(base_==address(0)||quote_==address(0)||surplusRecipient_==address(0)||base_==quote_||marketId_==bytes32(0)||priceTick_==0||baseRawPerLot_==0||quoteRawPerLot_==0||minimumOrderLots_==0||minimumResidualLots_==0)revert InvalidConfiguration();
        uint8 actualBase=IDirectAsset(base_).decimals();uint8 actualQuote=IDirectAsset(quote_).decimals();
        if(actualBase!=expectedBaseDecimals_)revert TokenDecimalsMismatch(base_,actualBase,expectedBaseDecimals_);
        if(actualQuote!=expectedQuoteDecimals_)revert TokenDecimalsMismatch(quote_,actualQuote,expectedQuoteDecimals_);
        baseToken=base_;quoteToken=quote_;surplusRecipient=surplusRecipient_;marketId=marketId_;priceTick=priceTick_;
        baseRawPerLot=baseRawPerLot_;quoteRawPerLot=quoteRawPerLot_;minimumOrderLots=minimumOrderLots_;minimumResidualLots=minimumResidualLots_;
        baseDecimals=actualBase;quoteDecimals=actualQuote;
    }

    modifier nonReentrant(){if(entered!=1)revert ReentrantCall();entered=2;_;entered=1;}
    function _requireMarket(bytes32 supplied)internal view{if(supplied!=marketId)revert WrongMarket(supplied);}
    function _validatePostLots(uint96 lots)internal view{if(lots==0)revert InvalidLots(lots);if(lots<minimumOrderLots)revert OrderBelowMinimum(lots,minimumOrderLots);}
    function _validateTake(uint96 maxLots,uint32 maxFills,uint256 maxQuoteRaw,uint96 minLotsReceived,uint256 deadline)internal view{
        if(maxLots==0||minLotsReceived==0||minLotsReceived>maxLots)revert InvalidTakerGuard();
        if(maxFills==0||maxFills>MAX_FILLS)revert InvalidFillBound(maxFills);
        if(block.timestamp>deadline)revert Expired(block.timestamp,deadline);
        uint256 minimumQuote=_quoteRaw(minLotsReceived);if(minimumQuote>maxQuoteRaw)revert QuoteLimit(minimumQuote,maxQuoteRaw);
    }
    function _baseRaw(uint256 lots)internal view returns(uint256){return _multiply(lots,baseRawPerLot);}
    function _quoteRaw(uint256 lots)internal view returns(uint256){return _multiply(lots,quoteRawPerLot);}
    function _multiply(uint256 lots,uint256 rawPerLot)private pure returns(uint256){if(lots!=0&&rawPerLot>type(uint256).max/lots)revert AmountOverflow(lots,rawPerLot);return lots*rawPerLot;}
    function _pullExact(address token,address from,uint256 amount)internal{uint256 beforeBalance=IDirectAsset(token).balanceOf(address(this));_tokenCall(token,abi.encodeWithSignature("transferFrom(address,address,uint256)",from,address(this),amount));uint256 afterBalance=IDirectAsset(token).balanceOf(address(this));uint256 actual=afterBalance>=beforeBalance?afterBalance-beforeBalance:type(uint256).max;if(actual!=amount)revert TokenDeltaMismatch(token,address(this),amount,actual);}
    function _pushExact(address token,address to,uint256 amount)internal{if(amount==0)return;uint256 senderBefore=IDirectAsset(token).balanceOf(address(this));uint256 receiverBefore=IDirectAsset(token).balanceOf(to);_tokenCall(token,abi.encodeWithSignature("transfer(address,uint256)",to,amount));uint256 senderAfter=IDirectAsset(token).balanceOf(address(this));uint256 receiverAfter=IDirectAsset(token).balanceOf(to);uint256 sent=senderBefore>=senderAfter?senderBefore-senderAfter:type(uint256).max;uint256 received=receiverAfter>=receiverBefore?receiverAfter-receiverBefore:type(uint256).max;if(sent!=amount)revert TokenDeltaMismatch(token,address(this),amount,sent);if(received!=amount)revert TokenDeltaMismatch(token,to,amount,received);}
    function _tokenCall(address token,bytes memory data)private{(bool ok,bytes memory result)=token.call(data);if(!ok||(result.length!=0&&(result.length!=32||!abi.decode(result,(bool)))))revert TokenCallFailed(token);}
    function _checkEscrow()internal view{uint256 balance=IDirectAsset(baseToken).balanceOf(address(this));if(balance<lockedBaseRaw)revert EscrowInvariant(balance,lockedBaseRaw);}
    function recoverSurplus()external nonReentrant returns(uint256 baseRaw,uint256 quoteRaw){if(msg.sender!=surplusRecipient)revert UnauthorizedRecovery(msg.sender);uint256 balance=IDirectAsset(baseToken).balanceOf(address(this));if(balance<lockedBaseRaw)revert EscrowInvariant(balance,lockedBaseRaw);baseRaw=balance-lockedBaseRaw;quoteRaw=IDirectAsset(quoteToken).balanceOf(address(this));_pushExact(baseToken,surplusRecipient,baseRaw);_pushExact(quoteToken,surplusRecipient,quoteRaw);_checkEscrow();emit SurplusRecovered(surplusRecipient,baseRaw,quoteRaw);}
}
