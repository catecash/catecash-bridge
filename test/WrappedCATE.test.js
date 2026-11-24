const assert = require("node:assert/strict");
const { ethers } = require("hardhat");
const { mintDomain, signMint, orderedSignatures } = require("../src/attestation");

const GENESIS = "0x" + "ab".repeat(32); // Test fixture only; no public Catecash genesis exists.
const TX_ID = "0x" + "cd".repeat(32);

describe("WrappedCATE testnet bridge", function () {
  async function fixture() {
    const [owner, signer1, signer2, signer3, user, other] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("WrappedCATE");
    const token = await factory.deploy(
      GENESIS, owner.address, [signer1.address, signer2.address, signer3.address], 2, 1_000_000_000n
    );
    await token.waitForDeployment();
    const network = await ethers.provider.getNetwork();
    const domain = mintDomain(network.chainId, await token.getAddress());
    const mint = {
      cateTxId: TX_ID, outputIndex: 1, recipient: user.address,
      amount: 50_000_000n, deadline: BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600),
      committeeEpoch: await token.committeeEpoch(),
    };
    async function signatures(payload = mint, selected = [signer1, signer2]) {
      return orderedSignatures(await Promise.all(selected.map((signer) => signMint(signer, domain, payload))));
    }
    return { token, owner, signer1, signer2, signer3, user, other, mint, signatures };
  }

  async function mintOnce(f) {
    const m = f.mint;
    return f.token.mintForDeposit(m.cateTxId, m.outputIndex, m.recipient, m.amount,
      m.deadline, m.committeeEpoch, await f.signatures());
  }

  it("mints once per confirmed Catecash output with threshold attestations", async function () {
    const f = await fixture();
    await mintOnce(f);
    assert.equal(await f.token.decimals(), 8n);
    assert.equal(await f.token.balanceOf(f.user.address), f.mint.amount);
    const id = await f.token.depositId(TX_ID, 1);
    assert.equal(await f.token.processedDeposit(id), true);
    await assert.rejects(mintOnce(f), /deposit processed/);
  });

  it("binds attestations to amount, recipient, contract, and current committee", async function () {
    const f = await fixture();
    const sigs = await f.signatures();
    await assert.rejects(
      f.token.mintForDeposit(TX_ID, 1, f.other.address, f.mint.amount, f.mint.deadline, 1, sigs),
      /unauthorized signer/
    );
    await assert.rejects(
      f.token.mintForDeposit(TX_ID, 1, f.user.address, f.mint.amount + 1n, f.mint.deadline, 1, sigs),
      /unauthorized signer/
    );
    await f.token.setCommittee([f.signer1.address, f.signer2.address], 2);
    await assert.rejects(mintOnce(f), /stale committee/);
  });

  it("rejects insufficient, duplicate, expired, and over-cap mints", async function () {
    const f = await fixture();
    const one = await f.signatures(f.mint, [f.signer1]);
    await assert.rejects(
      f.token.mintForDeposit(TX_ID, 1, f.user.address, f.mint.amount, f.mint.deadline, 1, one),
      /insufficient signatures/
    );
    const sig = one[0];
    await assert.rejects(
      f.token.mintForDeposit(TX_ID, 1, f.user.address, f.mint.amount, f.mint.deadline, 1, [sig, sig]),
      /signers not unique and sorted/
    );
    const expired = { ...f.mint, deadline: 1n };
    await assert.rejects(
      f.token.mintForDeposit(TX_ID, 1, f.user.address, f.mint.amount, expired.deadline, 1, await f.signatures(expired)),
      /attestation expired/
    );
    const overCap = { ...f.mint, amount: 1_000_000_001n };
    await assert.rejects(
      f.token.mintForDeposit(TX_ID, 1, f.user.address, overCap.amount, overCap.deadline, 1, await f.signatures(overCap)),
      /cap exceeded/
    );
  });

  it("burns wCATE and emits a unique native withdrawal request", async function () {
    const f = await fixture();
    await mintOnce(f);
    const tx = await f.token.connect(f.user).requestWithdrawal(20_000_000n, "cate-test-address");
    const receipt = await tx.wait();
    const event = receipt.logs.map((log) => {
      try { return f.token.interface.parseLog(log); } catch { return null; }
    }).find((log) => log?.name === "WithdrawalRequested");
    assert.equal(event.args.withdrawalId, 0n);
    assert.equal(event.args.amount, 20_000_000n);
    assert.equal(await f.token.balanceOf(f.user.address), 30_000_000n);
    assert.equal(await f.token.nextWithdrawalId(), 1n);
  });

  it("lets the owner pause deposits and withdrawals", async function () {
    const f = await fixture();
    await f.token.pause();
    await assert.rejects(mintOnce(f), /EnforcedPause/);
    await assert.rejects(f.token.connect(f.user).requestWithdrawal(1n, "cate-test-address"), /EnforcedPause/);
    await f.token.unpause();
    await mintOnce(f);
  });
});
