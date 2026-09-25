// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract StrictMockERC20 {
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public failRecipient;
    address public callbackTarget;
    bytes public callbackData;
    bool public bubbleCallbackFailure;
    bool public lastCallbackSuccess;
    uint16 public feeBps;
    bool public malformedReturn;

    constructor(uint8 decimals_) { decimals = decimals_; }

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function configureFailure(address recipient) external { failRecipient = recipient; }
    function configureCallback(address target, bytes calldata data, bool bubble) external { callbackTarget=target; callbackData=data; bubbleCallbackFailure=bubble; }
    function configureFeeBps(uint16 value) external { require(value <= 10_000, "fee"); feeBps=value; }
    function configureMalformedReturn(bool value) external { malformedReturn=value; }
    function transfer(address to, uint256 amount) external returns (bool) { bool ok=_transfer(msg.sender,to,amount);if(malformedReturn)assembly{mstore(0,1)return(31,1)}return ok; }
    function transferFrom(address from,address to,uint256 amount) external returns (bool) { uint256 allowed=allowance[from][msg.sender];require(allowed>=amount,"allowance");if(allowed!=type(uint256).max)allowance[from][msg.sender]=allowed-amount;bool ok=_transfer(from,to,amount);if(malformedReturn)assembly{mstore(0,1)return(31,1)}return ok; }
    function _transfer(address from,address to,uint256 amount) private returns(bool){if(to==failRecipient)return false;require(balanceOf[from]>=amount,"balance");uint256 fee=amount*feeBps/10_000;balanceOf[from]-=amount;balanceOf[to]+=amount-fee;if(callbackTarget!=address(0)){(bool ok,)=callbackTarget.call(callbackData);lastCallbackSuccess=ok;if(!ok&&bubbleCallbackFailure)revert("callback");}return true;}
}
