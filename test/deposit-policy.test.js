const assert = require("node:assert/strict");
const { verifyDeposit } = require("../src/deposit-policy");

const genesis = "0x" + "ab".repeat(32);
const txId = "0x" + "cd".repeat(32);
const blockHash = "0x" + "ef".repeat(32);

describe("Catecash deposit signer policy", function () {
  function fixture() {
    const chain = {
      getGenesisHash: async () => genesis,
      getTipHeight: async () => 120,
      getBlockHash: async () => blockHash,
      getTransaction: async () => ({
        blockHash, coinbase: false,
        outputs: [{ address: "other", amount: 1n }, { address: "one-time-escrow-address", amount: 50_000_000n }],
      }),
    };
    const intent = { recipient: "0x" + "12".repeat(20), depositAddress: "one-time-escrow-address", expiresAtHeight: 200, used: false };
    const observation = { txId, outputIndex: 1, blockHash, height: 100 };
    const config = { genesis, confirmations: 20 };
    return { chain, intent, observation, config };
  }

  it("accepts a canonical sufficiently confirmed output to a one-time escrow address", async function () {
    const f = fixture();
    assert.deepEqual(await verifyDeposit(f), {
      cateTxId: txId, outputIndex: 1, recipient: f.intent.recipient, amount: 50_000_000n,
    });
  });

  it("rejects wrong chain, shallow confirmations, reorganizations, and wrong outputs", async function () {
    const f = fixture();
    f.chain.getGenesisHash = async () => "0x" + "11".repeat(32);
    await assert.rejects(verifyDeposit(f), /wrong Catecash network/);
    f.chain.getGenesisHash = async () => genesis;
    f.chain.getTipHeight = async () => 105;
    await assert.rejects(verifyDeposit(f), /insufficient confirmations/);
    f.chain.getTipHeight = async () => 120;
    f.chain.getBlockHash = async () => "0x" + "11".repeat(32);
    await assert.rejects(verifyDeposit(f), /reorganized/);
    f.chain.getBlockHash = async () => blockHash;
    f.observation.outputIndex = 0;
    await assert.rejects(verifyDeposit(f), /does not match intent/);
    f.observation.outputIndex = 1;
    f.intent.used = true;
    await assert.rejects(verifyDeposit(f), /consumed deposit intent/);
  });
});
