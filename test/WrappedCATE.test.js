const assert = require("node:assert/strict");
const { ethers } = require("hardhat");
const { orderedSignatures } = require("../src/attestation");
const { attestSmartDeposit, attestEthereumWithdrawal } = require("../src/evm-policy");

describe("SmartCatecash ↔ Ethereum CATE testnet route", function () {
  async function fixture() {
    const [owner, signer1, signer2, signer3, user, other] = await ethers.getSigners();
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const genesis = (await ethers.provider.getBlock(0)).hash;
    const wcat = await ethers.deployContract("WrappedSmartCATE");
    await wcat.waitForDeployment();
    const escrow = await ethers.deployContract("SmartCATEEscrow", [chainId, await wcat.getAddress(), owner.address,
      [signer1.address, signer2.address, signer3.address], 2]);
    await escrow.waitForDeployment();
    const token = await ethers.deployContract("WrappedCATE", [genesis, chainId,
      await escrow.getAddress(), owner.address, [signer1.address, signer2.address, signer3.address], 2, 1_000_000_000n]);
    await token.waitForDeployment();
    await escrow.bindEthereumToken(await token.getAddress());
    const chain = {
      getChainId: async () => chainId,
      getGenesisHash: async () => genesis,
      getTipHeight: async () => ethers.provider.getBlockNumber(),
      getBlockHash: async (height) => (await ethers.provider.getBlock(height)).hash,
      isFinalized: async () => true, // Local test adapter; production must query consensus finality.
      getTransactionReceipt: async (hash) => ethers.provider.getTransactionReceipt(hash),
      getEthereumToken: async () => escrow.ethereumToken(),
      getWrappedToken: async () => escrow.wrappedSmartCate(),
    };
    const smartConfig = { genesis, chainId, contract: await escrow.getAddress(),
      wrappedToken: await wcat.getAddress(), confirmations: 1, requireFinalized: true, attestationLifetimeSeconds: 3600 };
    const ethConfig = { genesis, chainId, contract: await token.getAddress(),
      confirmations: 1, requireFinalized: true, attestationLifetimeSeconds: 3600 };
    async function observe(tx, eventName, contract) {
      const receipt = await tx.wait();
      const log = receipt.logs.find((entry) => {
        try { return contract.interface.parseLog(entry)?.name === eventName; } catch { return false; }
      });
      return { txHash: receipt.hash, logIndex: log.index, height: receipt.blockNumber,
        blockHash: receipt.blockHash };
    }
    async function request(contract) {
      return { deadline: BigInt((await ethers.provider.getBlock("latest")).timestamp + 1800),
        committeeEpoch: await contract.committeeEpoch() };
    }
    return { owner, signer1, signer2, signer3, user, other, chainId, genesis,
      escrow, wcat, token, chain, smartConfig, ethConfig, observe, request };
  }

  async function mintFromLock(f, amountAtoms = 50_000_000n) {
    await f.wcat.connect(f.user).deposit({ value: amountAtoms * 10n ** 10n });
    await f.wcat.connect(f.user).approve(await f.escrow.getAddress(), amountAtoms);
    const tx = await f.escrow.connect(f.user).lockForEthereum(amountAtoms, f.user.address);
    const observation = await f.observe(tx, "DepositLocked", f.escrow);
    const request = await f.request(f.token);
    const attestations = await Promise.all([f.signer1, f.signer2].map((signer) =>
      attestSmartDeposit({ chain: f.chain, observation, config: f.smartConfig,
        signer, ethereum: { chainId: f.chainId, contract: f.token }, request })));
    const mint = attestations[0].mint;
    await f.token.mintForDeposit(mint.sourceTxHash, mint.logIndex, mint.recipient, mint.amount,
      mint.deadline, mint.committeeEpoch, orderedSignatures(attestations));
    return { observation, mint, attestations };
  }

  it("wraps native CATE, locks wCAT, mints wCATE, burns, and releases wCAT once", async function () {
    const f = await fixture();
    const { mint, attestations } = await mintFromLock(f);
    assert.equal(await f.token.decimals(), 8n);
    assert.equal(await f.token.balanceOf(f.user.address), 50_000_000n);
    assert.equal(await f.wcat.balanceOf(f.escrow.getAddress()), 50_000_000n);
    assert.equal(await ethers.provider.getBalance(f.wcat.getAddress()), 50_000_000n * 10n ** 10n);
    await assert.rejects(f.token.mintForDeposit(mint.sourceTxHash, mint.logIndex, mint.recipient,
      mint.amount, mint.deadline, mint.committeeEpoch, orderedSignatures(attestations)), /deposit processed/);

    const burnTx = await f.token.connect(f.user).requestWithdrawal(20_000_000n, f.other.address);
    const observation = await f.observe(burnTx, "WithdrawalRequested", f.token);
    const request = await f.request(f.escrow);
    const releases = await Promise.all([f.signer1, f.signer2].map((signer) =>
      attestEthereumWithdrawal({ chain: f.chain, observation, config: f.ethConfig,
        signer, smart: { chainId: f.chainId, contract: f.escrow }, request })));
    const release = releases[0].release;
    const before = await f.wcat.balanceOf(f.other.address);
    await assert.rejects(f.escrow.releaseFromEthereum(release.ethTxHash, release.logIndex, release.withdrawalId,
      release.recipient, release.amount + 1n, release.deadline, release.committeeEpoch, orderedSignatures(releases)), /invalid signer order/);
    await f.escrow.releaseFromEthereum(release.ethTxHash, release.logIndex, release.withdrawalId,
      release.recipient, release.amount, release.deadline, release.committeeEpoch, orderedSignatures(releases));
    assert.equal(await f.wcat.balanceOf(f.other.address) - before, 20_000_000n);
    await f.wcat.connect(f.other).withdraw(20_000_000n);
    assert.equal(await f.wcat.balanceOf(f.other.address), 0n);
    assert.equal(await f.token.balanceOf(f.user.address), 30_000_000n);
    assert.equal(await f.wcat.totalSupply(), 30_000_000n);
    assert.equal(await f.wcat.balanceOf(f.escrow.getAddress()), await f.token.totalSupply());
    assert.equal(await ethers.provider.getBalance(f.wcat.getAddress()), 30_000_000n * 10n ** 10n);
    await assert.rejects(f.escrow.releaseFromEthereum(release.ethTxHash, release.logIndex, release.withdrawalId,
      release.recipient, release.amount, release.deadline, release.committeeEpoch, orderedSignatures(releases)), /release processed/);
  });

  it("rejects fractional native atoms, bad attestations, and wrong source identity", async function () {
    const f = await fixture();
    await assert.rejects(f.wcat.connect(f.user).deposit({ value: 1n }), /non-atomic amount/);
    await mintFromLock(f);
    await f.wcat.connect(f.user).deposit({ value: 10n ** 10n });
    await f.wcat.connect(f.user).approve(await f.escrow.getAddress(), 1n);
    const second = await f.escrow.connect(f.user).lockForEthereum(1n, f.user.address);
    const observation = await f.observe(second, "DepositLocked", f.escrow);
    f.chain.isFinalized = async () => false;
    await assert.rejects(attestSmartDeposit({ chain: f.chain, observation,
      config: f.smartConfig, signer: f.signer1,
      ethereum: { chainId: f.chainId, contract: f.token }, request: await f.request(f.token) }), /not finalized/);
    f.chain.isFinalized = async () => true;
    await assert.rejects(attestSmartDeposit({ chain: f.chain, observation,
      config: { ...f.smartConfig, confirmations: 2 }, signer: f.signer1,
      ethereum: { chainId: f.chainId, contract: f.token }, request: await f.request(f.token) }), /insufficient confirmations/);
    await assert.rejects(attestSmartDeposit({ chain: f.chain, observation,
      config: { ...f.smartConfig, contract: f.other.address }, signer: f.signer1,
      ethereum: { chainId: f.chainId, contract: f.token }, request: await f.request(f.token) }), /wrong bridge log/);
    await assert.rejects(attestSmartDeposit({ chain: f.chain, observation,
      config: { ...f.smartConfig, genesis: "0x" + "11".repeat(32) }, signer: f.signer1,
      ethereum: { chainId: f.chainId, contract: f.token }, request: await f.request(f.token) }), /wrong source chain/);
    const request = await f.request(f.token);
    const attestations = await Promise.all([f.signer1, f.signer2].map((signer) =>
      attestSmartDeposit({ chain: f.chain, observation, config: f.smartConfig,
        signer, ethereum: { chainId: f.chainId, contract: f.token }, request })));
    const mint = attestations[0].mint;
    await assert.rejects(f.token.mintForDeposit(mint.sourceTxHash, mint.logIndex, f.other.address,
      mint.amount, mint.deadline, mint.committeeEpoch, orderedSignatures(attestations)), /unauthorized signer/);
    await f.token.pause();
    await assert.rejects(f.token.connect(f.user).requestWithdrawal(1n, f.other.address), /EnforcedPause/);
    await f.escrow.pause();
    await assert.rejects(f.escrow.connect(f.user).lockForEthereum(1n, f.user.address), /EnforcedPause/);
  });
});
