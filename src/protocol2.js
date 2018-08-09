import sdk from 'stellar-sdk'
import Promise from 'bluebird'
import has from 'lodash/has'

import Stellar from './stellar'
import TradeDB from './trade-db'
import {isClassWithName} from './utils'

const Status = Object.freeze({
  INIT: 0,
  CHAIN_A_HOLDING_ACCOUNT: 1,
  CHAIN_A_REFUND_TX: 2,
  CHAIN_A_DEPOSIT: 3,
  CHAIN_A_WITHDRAW: 4,
  CHAIN_B_HOLDING_ACCOUNT: 5,
  CHAIN_B_REFUND_TX: 6,
  CHAIN_B_DEPOSIT: 7,
  CHAIN_B_WITHDRAW: 8,
  EXPIRED: 9,
  FINALISED: 10,
  ERROR: 99,
  key: value => Object.keys(Status).filter(k => Status[k] === value)[0],
});

const TradeSide = Object.freeze({
  CHAIN_A: 'chainA',
  CHAIN_B: 'chainB',
});

class Protocol {
  /**
   * Create a new protocol instance given local user Config and a Trade.
   *
   * After the instance is created status() should be called to determine the
   * state of the trade and the position in the protocol.
   *
   * @param config Config instance
   * @param trade Trade instance
   */
  constructor(config, trade) {
    if (!isClassWithName(config, 'Config')) {
      throw new Error('instance of Config required');
    }
    if (!isClassWithName(trade, 'Trade')) {
      throw new Error('instance of Trade required');
    }

    this.config = config;
    this.trade = trade;
    this.tradeDB = new TradeDB();
    this.chainA = new Stellar(sdk, config.chainANetwork); // Need new config
    this.chainB = new Stellar(sdk, config.chainBNetwork); // Need new config

    // trade has an id but it's not in the database (most likely from an import)
    if (has(trade, 'id') && this.tradeDB.get(trade.id) === undefined) {
      this.tradeDB.save(trade)
    }
  }

  /**
   * Prepare the chain A side of the trade by creating the holding account.
   * @return updated trade instance that now has 'chainA.holdingAccount' and
   *            if newly created an 'id' as well.
   */
  chainAPrepare() {
    const newAccKeypair = sdk.Keypair.random();
    return this.chainA
      .createHoldingAccount(
        newAccKeypair,
        this.stellarKeypair(),
        this.trade.chainA.withdrawer, // Need to update trade.js
        this.trade.commitment
      )
      .then(() => {
        this.trade.chainA.holdingAccount = newAccKeypair.publicKey();
        if (
          // TODO Replace these conditions according to new trade.js spec
          !has(this.trade, 'initialSide') &&
          !has(this.trade.chainB, 'NOTSURE')
        ) {
          this.trade.initialSide = TradeSide.CHAIN_A;
        }
        this.trade = this.tradeDB.save(this.trade);
        return this.trade
      })
  }

  async chainADeposit() {
    if (!this.isChainADepositor()) {
      throw new Error('Only the trade chain A depositor can call chainADeposit()');
    }
    const sellerKeypair = this.stellarKeypair();

    const holdingAccountPublicAddr = this.trade.chainA.holdingAccount;
    const holdingAccountBalance = await this.chainA.getBalance(
      holdingAccountPublicAddr
    );

    // deposit the difference - transfer to counterparty will be an account merge so the total will transfer
    const amount = this.trade.chainA.amount - holdingAccountBalance;
    return this.chainA.sellerDeposit(
      sellerKeypair,
      holdingAccountPublicAddr,
      amount
    );
  }

  /**
   * Prepare the chain B side of the trade by creating the holding account.
   * @return updated trade instance that now has 'chainB.holdingAccount' and
   *            (if newly created) an 'id' as well.
   */
  chainBPrepare() {
    const newAccKeypair = sdk.Keypair.random();
    return this.chainB
      .createHoldingAccount(
        newAccKeypair,
        this.stellarKeypair(),
        this.trade.chainB.withdrawer, // Need to update trade.js
        this.trade.commitment
      )
      .then(() => {
        this.trade.chainB.holdingAccount = newAccKeypair.publicKey();
        if (
        // TODO Replace these conditions according to new trade.js spec
        // !has(this.trade, 'initialSide') &&
        // !has(this.trade.ethereum, 'htlcContractId')
        ) {
          this.trade.initialSide = TradeSide.CHAIN_B;
        }
        this.trade = this.tradeDB.save(this.trade);
        return this.trade
      })
  }
 // TODO Should 'seller' -> 'buyer' or similar?
  async chainBDeposit() {
    if (!this.isChainBDepositor()) {
      throw new Error('Only the trade chain B depositor can call chainBDeposit()');
    }
    const sellerKeypair = this.stellarKeypair();

    const holdingAccountPublicAddr = this.trade.chainB.holdingAccount;
    const holdingAccountBalance = await this.chainB.getBalance(
      holdingAccountPublicAddr
    );

    // deposit the difference - transfer to counterparty will be an account merge so the total will transfer
    const amount = this.trade.chainB.amount - holdingAccountBalance;
    return this.chainB.sellerDeposit(
      sellerKeypair,
      holdingAccountPublicAddr,
      amount
    );
  }

  async chainARefundTx() {
    // TODO: check the status

    this.trade.chainA.refundTx = await this.chainA.sellerRefundTxEnvelope(
      this.trade.chainA.holdingAccount,
      this.stellarKeypair(),
      this.trade.chainA.depositor,
      this.trade.timelock,
      this.trade.chainA.amount
    );
    this.tradeDB.save(this.trade);

    return this.trade.chainA.refundTx;
  }

  async chainBRefundTx() {
    // TODO: check the status

    this.trade.chainB.refundTx = await this.chainB.sellerRefundTxEnvelope(
      this.trade.chainB.holdingAccount,
      this.stellarKeypair(),
      this.trade.chainB.depositor,
      this.trade.timelock,
      this.trade.chainB.amount
    );
    this.tradeDB.save(this.trade);

    return this.trade.chainB.refundTx;
  }

  /**
   * Fulfill the chain A side by having the withdrawer reveal hash(x) and get
   * their XLM.
   * @return Promise resolving to txHash of the fulfill transaction OR throws
   *    an error on failure
   */
  chainAFulfill(preimage) {
    return this.chainA.buyerWithdraw(
      this.trade.chainA.holdingAccount,
      this.stellarKeypair(),
      preimage,
      this.trade.chainA.amount
    )
  }

  /**
   * Trade protocol status is at a place where we are waiting for the
   * counterparty to take the next step.
   * @return bool
   */
  waitingForCounterparty() {}

  /**
   * Trade protocol status is at a place where we are waiting on the local party
   * to take the next step.
   * @return bool
   */
  waitingForMe() {}

  /**
   * Progress to the next state if possible.
   */
  next() {
    switch (this.status) {
      case Status.FINALISED:
        break;
      default:
        console.error(`unknown status [${this.status}]`)
        break
    }
  }

  /**
   * Subscribe to counterparty events. Required when this local party is waiting
   * for the next step to be completed by the counterparty.
   */
  subscribe() {
    // // get all events
    // const getPastEvents = Promise.promisify(this.eth.htlc.getPastEvents)
    // this.htlcEvents = await getPastEvents('allEvents')
    // this.eth.htlc.events.allEvents(this.ethereumEventHandlerHTLC)
    // // subscribe to events
    //
    // this.localParty = 'stellar'
    // this.status = Status.ETHEREUM_PREPARE
  }

  /**
   * Determine the Status of the trade by querying the chains.
   *
   * This functions as a verify up to the point of the returned status.
   *
   * @return Status reflecting the current state
   * @throw Error trade record has bad addresses or doesn't reflect ledger state
   *          eg. holding account defined in trade does not exist on chain
   */
  async status() {
    if (!has(this.trade, 'initialSide') || !this.trade.initialSide) {
      return Status.INIT;
    }
    return this.trade.initialSide === TradeSide.CHAIN_A
      ? this.statusStellarInitiatedTrade()
      : this.statusEthereumInitiatedTrade()
  }

  async statusStellarInitiatedTrade() {
    if (!has(this.trade.chainA, 'holdingAccount')) {return Status.INIT;}

    const validHoldingAccount = await this.chainA.isValidHoldingAccount(
      this.trade.chainA.holdingAccount,
      this.trade.chainA.withdrawer,
      this.trade.commitment
    );
    const accountMerged = await this.chainA.holdingAccountMerged(
      this.trade.chainA.holdingAccount,
      this.trade.chainA.withdrawer
    );

    if (validHoldingAccount === false && accountMerged === false) {
      return Status.INIT;
    }

    // TODO Review status measures
    if (validHoldingAccount === true) {
      if ((await this.stellarRefundTxCreated()) === false)
        {return Status.CHAIN_A_HOLDING_ACCOUNT;}
      if ((await this.stellarFundsDeposited()) === false)
        {return Status.CHAIN_A_REFUND_TX;}
      if ((await this.isChainBPrepared()) === false)
        {return Status.CHAIN_A_DEPOSIT;}
      if ((await this.isChainBFulfilled()) === false)
        {return Status.CHAIN_B_HOLDING_ACCOUNT;}
      if ((await this.isStellarFulfilled()) === false)
        {return Status.CHAIN_B_WITHDRAW;}
    }

    return Status.FINALISED
  }

  async statusEthereumInitiatedTrade() {
    throw new Error('statusEthereumInitiatedTrade not yet implemented')
  }

  stellarRefundTxCreated() {
    const st = this.trade.chainA;
    return Promise.resolve(
      has(st, 'refundTx') &&
        typeof st.refundTx === 'string' &&
        st.refundTx.length > 0
    )

    // TODO: validate the contents of the envelope
  }

  stellarFundsDeposited() {
    return this.chainA
      .getBalance(this.trade.chainA.holdingAccount)
      .then(balance => balance === this.trade.chainA.amount)
  }

// Not sure about this one...
  async isChainBPrepared() {
    let prepared = false;
    if (has(this.trade.chainB, 'refundTx') && this.trade.chainB.refundTx.length > 0) {
      prepared = true;
    }
    return prepared
  }

  isStellarFulfilled() {
    return this.chainA
      .getBalance(this.trade.chainA.holdingAccount)
      .then(balance => balance === 0)
  }

  isChainBFulfilled() {
    return this.chainB
      .getBalance(this.trade.chainB.holdingAccount)
      .then(balance => balance === 0)
  }

  isChainADepositor() {
    return this.trade.chainA.depositor === this.stellarPublicAddress();
  }

  isChainAWithdrawer() {
    return this.trade.chainA.withdrawer === this.stellarPublicAddress();
  }

  isChainBDepositor() {
    return this.trade.chainB.depositor === this.stellarPublicAddress();
  }

  isChainBWithdrawer() {
    return this.trade.chainB.withdrawer === this.stellarPublicAddress();
  }

  stellarKeypair() {
    return sdk.Keypair.fromSecret(this.config.stellarAccountSecret)
  }

  stellarPublicAddress() {
    return this.stellarKeypair().publicKey()
  }

}

Protocol.Status = Status;
Protocol.TradeSide = TradeSide;

export default Protocol
