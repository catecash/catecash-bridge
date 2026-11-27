const { Interface, isAddress, getAddress } = require("ethers");
const { mintDomain, mintTypes, signMint, releaseDomain, releaseTypes, signRelease } = require("./attestation");

const HASH = /^0x[0-9a-fA-F]{64}$/;
const smartEvents = new Interface([
  "event DepositLocked(uint256 indexed depositId,address indexed sender,address indexed ethereumRecipient,uint256 amountAtoms)",
]);
const ethereumEvents = new Interface([
  "event WithdrawalRequested(uint256 indexed withdrawalId,address indexed sender,address indexed smartRecipient,uint256 amount)",
]);

async function verifiedLog({ chain, observation, config, eventInterface, eventName }) {
  if (!HASH.test(config.genesis) || !HASH.test(observation.txHash) || !HASH.test(observation.blockHash)) {
    throw new Error("invalid hash");
  }
  if (!isAddress(config.contract) || !Number.isSafeInteger(config.chainId) || config.chainId < 1 ||
      !Number.isSafeInteger(config.confirmations) || config.confirmations < 1 || config.requireFinalized !== true) {
    throw new Error("invalid chain configuration");
  }
  if (!Number.isSafeInteger(observation.logIndex) || observation.logIndex < 0 || observation.logIndex > 0xffffffff ||
      !Number.isSafeInteger(observation.height) || observation.height < 1) {
    throw new Error("invalid log position");
  }
  if (Number(await chain.getChainId()) !== config.chainId ||
      (await chain.getGenesisHash()).toLowerCase() !== config.genesis.toLowerCase()) {
    throw new Error("wrong source chain");
  }
  const tip = await chain.getTipHeight();
  if (!Number.isSafeInteger(tip) || tip - observation.height + 1 < config.confirmations) {
    throw new Error("insufficient confirmations");
  }
  if ((await chain.getBlockHash(observation.height)).toLowerCase() !== observation.blockHash.toLowerCase()) {
    throw new Error("source block reorganized");
  }
  if (typeof chain.isFinalized !== "function" ||
      await chain.isFinalized(observation.height, observation.blockHash) !== true) {
    throw new Error("source block is not finalized");
  }
  const receipt = await chain.getTransactionReceipt(observation.txHash);
  if (!receipt || receipt.status !== 1 || receipt.blockNumber !== observation.height ||
      receipt.blockHash.toLowerCase() !== observation.blockHash.toLowerCase()) {
    throw new Error("transaction is not canonical and successful");
  }
  const log = receipt.logs.find((entry) => entry.index === observation.logIndex);
  if (!log || getAddress(log.address) !== getAddress(config.contract)) throw new Error("wrong bridge log");
  let parsed;
  try { parsed = eventInterface.parseLog(log); } catch { throw new Error("invalid bridge event"); }
  if (!parsed || parsed.name !== eventName) throw new Error("invalid bridge event");
  return parsed.args;
}

async function verifySmartDeposit({ chain, observation, config }) {
  const args = await verifiedLog({ chain, observation, config, eventInterface: smartEvents, eventName: "DepositLocked" });
  if (args.amountAtoms <= 0n || !isAddress(args.ethereumRecipient) || args.ethereumRecipient === "0x0000000000000000000000000000000000000000") {
    throw new Error("invalid SmartCatecash lock");
  }
  return { sourceTxHash: observation.txHash, logIndex: observation.logIndex,
    recipient: args.ethereumRecipient, amount: args.amountAtoms };
}

async function verifyEthereumWithdrawal({ chain, observation, config }) {
  const args = await verifiedLog({ chain, observation, config, eventInterface: ethereumEvents, eventName: "WithdrawalRequested" });
  if (args.amount <= 0n || !isAddress(args.smartRecipient) || args.smartRecipient === "0x0000000000000000000000000000000000000000") {
    throw new Error("invalid Ethereum withdrawal");
  }
  return { ethTxHash: observation.txHash, logIndex: observation.logIndex,
    withdrawalId: args.withdrawalId, recipient: args.smartRecipient, amount: args.amount };
}

function deadlineFromRequest(request, lifetime) {
  if (!Number.isSafeInteger(lifetime) || lifetime < 1) throw new Error("invalid attestation lifetime");
  const now = BigInt(Math.floor(Date.now() / 1000));
  const deadline = BigInt(request.deadline);
  if (deadline <= now || deadline > now + BigInt(lifetime)) throw new Error("invalid attestation deadline");
  return deadline;
}

async function attestSmartDeposit({ chain, observation, config, signer, ethereum, request }) {
  const deposit = await verifySmartDeposit({ chain, observation, config });
  const contract = ethereum.contract;
  if (!isAddress(config.wrappedToken) ||
      getAddress(await chain.getWrappedToken(config.contract)) !== getAddress(config.wrappedToken)) {
    throw new Error("SmartCatecash escrow bound to wrong wCAT token");
  }
  if (BigInt(await contract.sourceChainId()) !== BigInt(config.chainId) ||
      (await contract.smartcatecashGenesis()).toLowerCase() !== config.genesis.toLowerCase() ||
      getAddress(await contract.sourceBridge()) !== getAddress(config.contract)) {
    throw new Error("Ethereum token bound to wrong SmartCatecash source");
  }
  if (getAddress(await chain.getEthereumToken(config.contract)) !== getAddress(await contract.getAddress())) {
    throw new Error("SmartCatecash escrow bound to wrong Ethereum token");
  }
  const epoch = BigInt(request.committeeEpoch);
  if (epoch !== await contract.committeeEpoch()) throw new Error("stale committee");
  if (await contract.processedDeposit(await contract.depositId(deposit.sourceTxHash, deposit.logIndex))) {
    throw new Error("deposit already minted");
  }
  const mint = { ...deposit, deadline: deadlineFromRequest(request, config.attestationLifetimeSeconds), committeeEpoch: epoch };
  const domain = mintDomain(ethereum.chainId, await contract.getAddress());
  return { mint, domain, types: mintTypes, ...(await signMint(signer, domain, mint)) };
}

async function attestEthereumWithdrawal({ chain, observation, config, signer, smart, request }) {
  const withdrawal = await verifyEthereumWithdrawal({ chain, observation, config });
  const escrow = smart.contract;
  if (BigInt(await escrow.ethereumChainId()) !== BigInt(config.chainId) ||
      getAddress(await escrow.ethereumToken()) !== getAddress(config.contract)) {
    throw new Error("SmartCatecash escrow bound to wrong Ethereum token");
  }
  const epoch = BigInt(request.committeeEpoch);
  if (epoch !== await escrow.committeeEpoch()) throw new Error("stale committee");
  if (await escrow.processedRelease(await escrow.releaseId(withdrawal.ethTxHash, withdrawal.logIndex))) {
    throw new Error("withdrawal already released");
  }
  const release = { ...withdrawal, deadline: deadlineFromRequest(request, config.attestationLifetimeSeconds), committeeEpoch: epoch };
  const domain = releaseDomain(smart.chainId, await escrow.getAddress());
  return { release, domain, types: releaseTypes, ...(await signRelease(signer, domain, release)) };
}

module.exports = { verifySmartDeposit, verifyEthereumWithdrawal, attestSmartDeposit, attestEthereumWithdrawal };
