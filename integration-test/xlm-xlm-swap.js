import sdk from 'stellar-sdk'
import expect from 'expect'
import Promise from 'bluebird'

import Config from '../src/config'
import Trade from '../src/trade'
import Protocol from '../src/protocol'

import {newSecretHashPair} from '../src/utils'

/*
 * End-to-end swap of 100 XLM between locally hosted private clarity network
 * and remotely hosted private clarity network.
 */

/*
 * Stellar Accounts
 */
const AliceA = sdk.Keypair.random();
const BobB = sdk.Keypair.random();
const AliceEscrowA = sdk.Keypair.random();
const BobEscrowB = sdk.Keypair.random();
const AliceB = sdk.Keypair.random();
const BobA = sdk.Keypair.random();

/*
 * Hashlock preimage and hash for the trade
 */
const {secret: preImageStr, hash: hashXStr} = newSecretHashPair();

/*
 * Trade definition
 */
const aliceTrade = {
  initialSide: Protocol.TradeSide.STELLARA, // Need new protocol
  timelock: Date.now() + 120,
  commitment: hashXStr.substring(2), // slice off prefix '0x'
  originChain: {
    token: 'XLM',
    amount: 100.0,
    depositor: AliceA.publicKey(),
    withdrawer: BobA.publicKey()
  },
  xChain: {
    token: 'XLM',
    amount: 100.0,
    depositor: BobB.publicKey(),
    withdrawer: AliceB.publicKey()
  }
};

const bobTrade = {
  initialSide: Protocol.TradeSide.STELLARB, // Need new protocol
  timelock: Date.now() + 60,
  commitment: hashXStr.substring(2), // slice off prefix '0x'
  originChain: {
    token: 'XLM',
    amount: 100.0,
    depositor: BobB.publicKey(),
    withdrawer: AliceB.publicKey()
  },
  xChain: {
    token: 'XLM',
    amount: 100.0,
    depositor: AliceA.publicKey(),
    withdrawer: BobB.publicKey()
  }
};

/*
 * Config for each party
 */

// Alice: giving on chain A, receiving on chain B
const configAlice = {
  originChain: 'Clarity Chain A ; localhost',
  originSecret: AliceA.secret(),
  xChainAccount: AliceB.publicKey()
};

// Bob: giving on chain B, receiving on chain A
const configBob = {
  originChain: 'Clarity Chain B ; remote servers',
  originSecret: BobB.secret(),
  xChainAccount: BobA.publicKey()
};

const main = async () => {
  /*
   * Alice initiates trade setting up the holding account on chain A
   */
  const config1 = new Config(configAlice);
  let trade1 = new Trade(aliceTrade);
  const protocol1 = new Protocol(config1, trade1);
  expect(await protocol1.status()).toEqual(Protocol.Status.INIT);

  trade1 = await protocol1.stellarPrepare();
  console.log(`trade id generated: ${trade1.id}`);
  console.log(`Alice created holding account: ${protocol1.trade.stellar.holdingAccount}`);
  expect(await protocol1.status()).toEqual(Protocol.Status.STELLAR_HOLDING_ACCOUNT);

  /*
   * Bob receives the trade file and checks the status
   */
  let trade2 = trade1; // Alice sends trade def to Bob
  const config2 = new Config(configBob);
  const protocol2 = new Protocol(config2, trade2);
  expect(await protocol2.status()).toEqual(Protocol.Status.STELLAR_HOLDING_ACCOUNT);
  console.log(`Bob imported and checked the trade status`);

  /*
   * Bob generates the refund tx envelope for Alice
   */
  trade2.stellar.refundTx = await protocol2.stellarRefundTx();
  expect(await protocol2.status()).toEqual(Protocol.Status.STELLAR_REFUND_TX);
  console.log(`Bob created refund tx for Alice: [${trade2.stellar.refundTx}]`);

  /*
   * Alice receives the refund tx then deposits XLM into holding account
   */
  trade1.stellar.refundTx = trade2.stellar.refundTx; // Bob sends refund tx to Alice
  expect(await protocol1.status()).toEqual(Protocol.Status.STELLAR_REFUND_TX);
  // TODO: protocol.validate the refundtx !
  await protocol1.stellarDeposit();
  expect(await protocol1.status()).toEqual(Protocol.Status.STELLAR_DEPOSIT);
  expect(await protocol2.status()).toEqual(Protocol.Status.STELLAR_DEPOSIT);
  console.log(`Alice deposited XLM to escrow account on chain A`);

//  MAKING IT UP FROM HERE!!


  /*
   * Bob creates a holding account on chain B and deposits to that account
   */
  await protocol2.stellarDeposit();
  log(`htlc created: ${htlcId}`)
  expect(await protocol2.status()).toEqual(Protocol.Status.ETHEREUM_HTLC)
  expect(await protocol1.status()).toEqual(Protocol.Status.ETHEREUM_HTLC)

  /*
   * Alice withdraws from holding account on chain B revealing the preimage secret
   */
  const ethWithdrawTxHash = await protocol1.ethereumFulfill(preImageStr)
  log(`ETH withdrawn (tx:${ethWithdrawTxHash}`)
  expect(await protocol1.status()).toEqual(Protocol.Status.ETHEREUM_WITHDRAW)
  expect(await protocol2.status()).toEqual(Protocol.Status.ETHEREUM_WITHDRAW)

  /*
   * Bob withdraws from holding account on chain A with the revealed preimage secret
   */
  // TODO: pull the preimage from the events log ...
  //        for now cheat and just plug it in ..
  const stellarWithdrawTxHash = await protocol2.stellarFulfill(preImageStr)
  log(`XLM withdrawn (tx:${stellarWithdrawTxHash}`)
  expect(await protocol2.status()).toEqual(Protocol.Status.FINALISED)
  expect(await protocol1.status()).toEqual(Protocol.Status.FINALISED)

  log(`FINALISED!`)
}

/*
 * Main - give both stellar accounts some Lumens then run main()
 */
const stellar = new sdk.Server('http://localhost:8000', {allowHttp: true})
Promise.all([
  stellar.friendbot(sBuyerKP.publicKey()).call(),
  stellar.friendbot(sSellerKP.publicKey()).call(),
]).then(main)
