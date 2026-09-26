// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract StrictMockERC20 {
    string public constant name="Mock";string public constant symbol="MOCK";uint8 public immutable decimals;
    mapping(address=>uint256)public balanceOf;mapping(address=>mapping(address=>uint256))public allowance;
    address public failRecipient;uint256 public feeBps;bool public malformedReturn;address public callbackTarget;bytes public callbackData;bool public bubbleCallbackFailure;bool public lastCallbackSuccess;
    constructor(uint8 d){decimals=d;}function mint(address to,uint256 amount)external{balanceOf[to]+=amount;}function approve(address s,uint256 a)external returns(bool){allowance[msg.sender][s]=a;return true;}
    function configureFailure(address to)external{failRecipient=to;}function configureFeeBps(uint256 b)external{feeBps=b;}function configureMalformedReturn(bool b)external{malformedReturn=b;}function configureCallback(address t,bytes calldata d,bool bubble)external{callbackTarget=t;callbackData=d;bubbleCallbackFailure=bubble;}
    function transfer(address to,uint256 a)external returns(bool){bool ok=_move(msg.sender,to,a);if(malformedReturn)assembly{mstore(0,1)return(31,1)}return ok;}function transferFrom(address f,address t,uint256 a)external returns(bool){uint256 x=allowance[f][msg.sender];require(x>=a,"allowance");if(x!=type(uint256).max)allowance[f][msg.sender]=x-a;bool ok=_move(f,t,a);if(malformedReturn)assembly{mstore(0,1)return(31,1)}return ok;}
    function _move(address f,address t,uint256 a)private returns(bool){if(t==failRecipient)return false;require(balanceOf[f]>=a,"balance");uint256 fee=a*feeBps/10000;balanceOf[f]-=a;balanceOf[t]+=a-fee;if(callbackTarget!=address(0)){(bool ok,)=callbackTarget.call(callbackData);lastCallbackSuccess=ok;if(!ok&&bubbleCallbackFailure)revert("callback");}return true;}
}
