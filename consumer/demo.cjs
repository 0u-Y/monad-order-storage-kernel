const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const solc = require('solc');
const ganache = require('ganache');
const {ethers} = require('ethers');

const root = __dirname;
const sourceNames = ['StrictMockERC20.sol','DirectTakerEscrowOrderBookBase.sol','DirectTakerContiguousOrderBook.sol'];
const sources = Object.fromEntries(sourceNames.map(name => [`contracts/${name}`, {content: fs.readFileSync(path.join(root,'contracts',name),'utf8')}]));
function imports(name) {
  const packagePrefix='@monad-ac/order-storage-preview/';
  const file=name.startsWith(packagePrefix)?path.join(root,'node_modules','@monad-ac','order-storage-preview',name.slice(packagePrefix.length)):path.join(root,'contracts',path.basename(name));
  return fs.existsSync(file)?{contents:fs.readFileSync(file,'utf8')}:{error:`missing import ${name}`};
}
const settings={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}};
const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings}),{import:imports}));
const errors=(output.errors||[]).filter(row=>row.severity==='error'); if(errors.length)throw new Error(JSON.stringify(errors,null,2));
const artifact=(file,name)=>output.contracts[`contracts/${file}`][name];
const tokenArtifact=artifact('StrictMockERC20.sol','StrictMockERC20');
const hostArtifact=artifact('DirectTakerContiguousOrderBook.sol','DirectTakerContiguousOrderBook');
const MARKET=ethers.id('HANDOFF-BASE18-QUOTE6'), TICK=100n, BASE_PER_LOT=10n**16n, QUOTE_PER_LOT=10n**4n;
const json=value=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item,2);
async function sent(promise){return(await promise).wait()}
(async()=>{
  const chain=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai'},wallet:{deterministic:true,totalAccounts:5}});
  const provider=new ethers.BrowserProvider(chain);provider.pollingInterval=10;
  const [owner,makerA,makerB,taker]=await Promise.all([0,1,2,3].map(index=>provider.getSigner(index)));
  const tokenFactory=new ethers.ContractFactory(tokenArtifact.abi,tokenArtifact.evm.bytecode.object,owner);
  const base=await tokenFactory.deploy(18),quote=await tokenFactory.deploy(6);await Promise.all([base.waitForDeployment(),quote.waitForDeployment()]);
  const hostFactory=new ethers.ContractFactory(hostArtifact.abi,hostArtifact.evm.bytecode.object,owner);
  const host=await hostFactory.deploy(await base.getAddress(),await quote.getAddress(),await owner.getAddress(),MARKET,TICK,BASE_PER_LOT,QUOTE_PER_LOT,2,2,18,6);await host.waitForDeployment();
  const hostAddress=await host.getAddress(),a=await makerA.getAddress(),b=await makerB.getAddress(),t=await taker.getAddress();
  await sent(base.mint(a,4n*BASE_PER_LOT));await sent(base.mint(b,6n*BASE_PER_LOT));await sent(quote.mint(t,5n*QUOTE_PER_LOT));
  await sent(base.connect(makerA).approve(hostAddress,4n*BASE_PER_LOT));await sent(base.connect(makerB).approve(hostAddress,6n*BASE_PER_LOT));await sent(quote.connect(taker).approve(hostAddress,5n*QUOTE_PER_LOT));
  const h1=await host.connect(makerA).post.staticCall(MARKET,4);await sent(host.connect(makerA).post(MARKET,4));
  const h2=await host.connect(makerB).post.staticCall(MARKET,6);await sent(host.connect(makerB).post(MARKET,6));
  const receipts=await host.connect(taker).take.staticCall(MARKET,5,2,5n*QUOTE_PER_LOT,5,ethers.MaxUint256);
  assert.deepEqual(receipts.map(row=>[row.handle,row.lots,row.remainingLots]),[[h1,4n,0n],[h2,1n,5n]]);
  await sent(host.connect(taker).take(MARKET,5,2,5n*QUOTE_PER_LOT,5,ethers.MaxUint256));
  await sent(host.connect(makerB).cancel(MARKET,h2));
  assert.deepEqual([...(await host.level(MARKET))],[0n,0n]);assert.equal(await host.lockedBaseRaw(),0n);
  assert.equal(await base.balanceOf(hostAddress),0n);assert.equal(await quote.balanceOf(hostAddress),0n);
  assert.equal(await quote.balanceOf(a),4n*QUOTE_PER_LOT);assert.equal(await quote.balanceOf(b),1n*QUOTE_PER_LOT);
  assert.equal(await base.balanceOf(t),5n*BASE_PER_LOT);assert.equal(await base.balanceOf(b),5n*BASE_PER_LOT);
  assert.equal(await base.allowance(a,hostAddress),0n);assert.equal(await base.allowance(b,hostAddress),0n);assert.equal(await quote.allowance(t,hostAddress),0n);
  console.log('ORDER STORAGE HANDOFF DEMO PASS');console.log(json({marketId:MARKET,handles:[h1,h2],fills:receipts.map(row=>({handle:row.handle,maker:row.maker,lots:row.lots,remainingLots:row.remainingLots})),final:{head:'0',tail:'0',lockedBaseRaw:'0',hostBaseRaw:'0',hostQuoteRaw:'0'}}));
  await chain.disconnect();
})().catch(error=>{console.error(error.stack||error);process.exit(1)});
