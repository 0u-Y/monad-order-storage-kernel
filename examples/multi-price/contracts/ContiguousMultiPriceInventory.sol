// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@monad-ac/order-storage-preview/contracts/OrderStorageKernel.sol";
import "./MultiPriceInventoryBase.sol";
contract ContiguousMultiPriceInventory is MultiPriceInventoryBase {
    using OrderStorageKernel for bytes32;
    constructor(address b,address q,address s,bytes32 m,uint256 r,uint64[8] memory t,uint256[8] memory p,uint96 o,uint96 x,uint8 bd,uint8 qd) MultiPriceInventoryBase(b,q,s,m,r,t,p,o,x,bd,qd){}
    function _initializeKernel(bytes32 id)internal override{id.initialize();}
    function _post(bytes32 id,address maker,uint64 p,uint96 q)internal override returns(uint96){return id.post(maker,p,q);}
    function _cancel(bytes32 id,address maker,uint96 h)internal override returns(uint96 q,uint64 p){OrderStorageKernel.Order memory o=id.order(h);p=o.price;q=id.cancel(maker,h);}
    function _consumeUpTo(bytes32 id,uint64 p,uint96 q,uint32 n)internal override returns(KernelFill[] memory out,uint96 filled){(OrderStorageKernel.Fill[] memory f,uint96 z)=id.consumeUpToWithFills(p,q,n);filled=z;out=new KernelFill[](f.length);for(uint i;i<f.length;++i)out[i]=KernelFill(f[i].handle,f[i].maker,f[i].quantity,f[i].remaining);}
    function _order(bytes32 id,uint96 h)internal view override returns(OrderView memory){OrderStorageKernel.Order memory o=id.order(h);return OrderView(o.maker,o.quantity,o.price,o.handle);}
    function _level(bytes32 id,uint64 p)internal view override returns(uint96,uint96){return id.level(p);}
    function _allocator(bytes32 id)internal view override returns(uint32,uint32){return id.allocator();}
}
