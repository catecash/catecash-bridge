const { isAddress } = require("ethers");

const HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * This is the signer policy boundary. Each signer must query its own Catecash
 * node, rather than accepting a relayer's unverified deposit description.
 * Amounts are integer CATE base units (8 decimals), never floating point.
 */
async function verifyPowDeposit({ chain, intent, observation, config }) {
  if (!HASH.test(config.genesis) || !HASH.test(observation.txId) || !HASH.test(observation.blockHash)) {
    throw new Error("invalid hash");
  }
  if (!Number.isSafeInteger(observation.outputIndex) || observation.outputIndex < 0 || observation.outputIndex > 0xffffffff) {
    throw new Error("invalid output index");
  }
  if (!Number.isSafeInteger(observation.height) || observation.height < 1) {
    throw new Error("invalid block height");
  }
  if (!Number.isSafeInteger(config.confirmations) || config.confirmations < 1) {
    throw new Error("invalid confirmation policy");
  }
  if (!isAddress(intent.recipient) || !intent.depositAddress || intent.used) {
    throw new Error("invalid or consumed deposit intent");
  }
  if (!Number.isSafeInteger(intent.expiresAtHeight) || observation.height > intent.expiresAtHeight) {
    throw new Error("deposit intent expired");
  }
  if ((await chain.getGenesisHash()).toLowerCase() !== config.genesis.toLowerCase()) {
    throw new Error("wrong Catecash network");
  }
  const tip = await chain.getTipHeight();
  if (!Number.isSafeInteger(tip) || tip - observation.height + 1 < config.confirmations) {
    throw new Error("insufficient confirmations");
  }
  if ((await chain.getBlockHash(observation.height)).toLowerCase() !== observation.blockHash.toLowerCase()) {
    throw new Error("deposit block reorganized");
  }
  const transaction = await chain.getTransaction(observation.txId);
  if (!transaction || transaction.coinbase || transaction.blockHash.toLowerCase() !== observation.blockHash.toLowerCase()) {
    throw new Error("transaction is not a canonical user deposit");
  }
  const output = transaction.outputs[observation.outputIndex];
  if (!output || output.address !== intent.depositAddress || typeof output.amount !== "bigint" || output.amount <= 0n) {
    throw new Error("deposit output does not match intent");
  }
  return {
    cateTxId: observation.txId,
    outputIndex: observation.outputIndex,
    recipient: intent.recipient,
    amount: output.amount,
  };
}

module.exports = { verifyPowDeposit };
