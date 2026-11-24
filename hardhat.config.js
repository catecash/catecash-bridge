require("@nomicfoundation/hardhat-ethers");
const fs = require("node:fs");
const { HDNodeWallet, Mnemonic, getIndexedAccountPath } = require("ethers");

function deploymentKey() {
  if (process.env.DEPLOYER_PRIVATE_KEY) return process.env.DEPLOYER_PRIVATE_KEY;
  const referencePath = process.env.BRIDGE_WALLET_REF;
  if (!referencePath) return undefined;
  const ref = JSON.parse(fs.readFileSync(referencePath, "utf8"));
  const info = fs.lstatSync(ref.seedFile);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error("seed file must be a private regular file");
  }
  const phrases = fs.readFileSync(ref.seedFile, "utf8").split(/\r?\n/)
    .map((line) => line.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean);
  if (!Number.isInteger(ref.phraseIndex) || ref.phraseIndex < 1 || ref.phraseIndex > phrases.length ||
      !Number.isInteger(ref.addressIndex) || ref.addressIndex < 0 || ref.addressIndex > 1000) {
    throw new Error("invalid wallet derivation reference");
  }
  const phrase = phrases[ref.phraseIndex - 1];
  if (!Mnemonic.isValidMnemonic(phrase)) throw new Error("invalid seed phrase");
  const wallet = HDNodeWallet.fromPhrase(phrase, "", getIndexedAccountPath(ref.addressIndex));
  if (wallet.address.toLowerCase() !== ref.expectedAddress.toLowerCase()) {
    throw new Error("wallet reference does not match expected address");
  }
  return wallet.privateKey;
}

const key = process.env.ETH_RPC_URL ? deploymentKey() : undefined;

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { evmVersion: "cancun", optimizer: { enabled: true, runs: 200 } },
  },
  networks: process.env.ETH_RPC_URL && key ? {
    sepolia: {
      url: process.env.ETH_RPC_URL,
      chainId: 11155111,
      accounts: [key],
    },
  } : {},
};
