// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "./MultiPriceInventoryBase.sol";
contract LinkedMultiPriceInventory is MultiPriceInventoryBase {
    struct Ends{uint32 head;uint32 tail;} struct Node{address maker;uint96 lots;uint32 prev;uint32 next;uint64 generation;uint64 priceTick;}
    mapping(uint64=>Ends)private levels;mapping(uint32=>Node)private nodes;uint32 private highWater;uint32 private freeHead;
    error InvalidNode();error IndexExhausted();error GenerationExhausted(uint32);error StaleHandle(uint96);error NotMaker(address,address);
    event KernelOrderConsumed(bytes32 indexed marketId,uint64 indexed priceTick,uint96 indexed handle,address maker,uint96 fillQuantity,uint96 remainingQuantity);
    constructor(address b,address q,address s,bytes32 m,uint256 r,uint64[8] memory t,uint256[8] memory p,uint96 o,uint96 x,uint8 bd,uint8 qd) MultiPriceInventoryBase(b,q,s,m,r,t,p,o,x,bd,qd){}
    function _initializeKernel(bytes32)internal override{}
    function _handle(uint32 i,uint64 g)private pure returns(uint96){return uint96((uint256(g)<<32)|i);}
    function _live(uint96 h)private view returns(uint32 i,Node storage n){i=uint32(h);n=nodes[i];if(i==0||n.lots==0||n.generation!=uint64(h>>32))revert StaleHandle(h);}
    function _remove(uint32 i,Node storage n)private{Ends storage e=levels[n.priceTick];if(n.prev==0)e.head=n.next;else nodes[n.prev].next=n.next;if(n.next==0)e.tail=n.prev;else nodes[n.next].prev=n.prev;n.maker=address(0);n.lots=0;n.prev=0;n.priceTick=0;n.next=freeHead;freeHead=i;}
    function _post(bytes32,address maker,uint64 p,uint96 q)internal override returns(uint96){if(maker==address(0)||p==0||q==0)revert InvalidNode();uint32 i;if(freeHead!=0){i=freeHead;freeHead=nodes[i].next;}else{if(highWater==type(uint32).max)revert IndexExhausted();i=++highWater;}Node storage n=nodes[i];if(n.generation==type(uint64).max)revert GenerationExhausted(i);uint64 g=++n.generation;Ends storage e=levels[p];n.maker=maker;n.lots=q;n.prev=e.tail;n.next=0;n.priceTick=p;if(e.tail==0)e.head=i;else nodes[e.tail].next=i;e.tail=i;return _handle(i,g);}
    function _cancel(bytes32,address maker,uint96 h)internal override returns(uint96 q,uint64 p){(uint32 i,Node storage n)=_live(h);if(n.maker!=maker)revert NotMaker(n.maker,maker);q=n.lots;p=n.priceTick;_remove(i,n);}
    function _consumeUpTo(bytes32 id,uint64 p,uint96 q,uint32 n)internal override returns(KernelFill[] memory out,uint96 filled){out=new KernelFill[](n);uint32 count;while(q!=0&&count!=n){uint32 i=levels[p].head;if(i==0)break;Node storage x=nodes[i];uint96 a=q<x.lots?q:x.lots;q-=a;filled+=a;x.lots-=a;uint96 h=_handle(i,x.generation);out[count++]=KernelFill(h,x.maker,a,x.lots);emit KernelOrderConsumed(id,p,h,x.maker,a,x.lots);if(x.lots==0)_remove(i,x);}assembly("memory-safe"){mstore(out,count)}}
    function _order(bytes32,uint96 h)internal view override returns(OrderView memory){(,Node storage n)=_live(h);return OrderView(n.maker,n.lots,n.priceTick,h);}
    function _level(bytes32,uint64 p)internal view override returns(uint96 h,uint96 t){Ends storage e=levels[p];if(e.head!=0)h=_handle(e.head,nodes[e.head].generation);if(e.tail!=0)t=_handle(e.tail,nodes[e.tail].generation);}
    function _allocator(bytes32)internal view override returns(uint32,uint32){return(highWater,freeHead);}
}
