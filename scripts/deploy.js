const { ethers } = require("hardhat");
const fs = require("node:fs");

async function main() {
  const config = process.env.BRIDGE_DEPLOY_CONFIG
    ? JSON.parse(fs.readFileSync(process.env.BRIDGE_DEPLOY_CONFIG, "utf8"))
    : {
        genesis: process.env.CATE_GENESIS,
        owner: process.env.BRIDGE_OWNER,
        signers: (process.env.BRIDGE_SIGNERS || "").split(",").filter(Boolean),
        threshold: process.env.BRIDGE_THRESHOLD,
        capAtoms: process.env.BRIDGE_CAP_ATOMS,
      };
  const { genesis, owner, signers } = config;
  const threshold = Number(config.threshold);
  const cap = BigInt(config.capAtoms || "0");

  if (!/^0x[0-9a-fA-F]{64}$/.test(genesis || "")) throw new Error("CATE_GENESIS must be a bytes32 hex hash");
  if (!ethers.isAddress(owner)) throw new Error("BRIDGE_OWNER must be an Ethereum address");
  if (!signers.length || signers.some((s) => !ethers.isAddress(s))) throw new Error("BRIDGE_SIGNERS must be comma-separated Ethereum addresses");
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > signers.length) throw new Error("invalid BRIDGE_THRESHOLD");
  if (cap <= 0n) throw new Error("BRIDGE_CAP_ATOMS must be positive");

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 11155111n) throw new Error("deployment script is Sepolia-only");

  const factory = await ethers.getContractFactory("WrappedCATE");
  const token = await factory.deploy(genesis, owner, signers, threshold, cap);
  await token.waitForDeployment();
  const receipt = await token.deploymentTransaction().wait();
  if (receipt.status !== 1 || await token.catecashGenesis() !== genesis ||
      await token.owner() !== owner || await token.signerThreshold() !== BigInt(threshold) ||
      await token.maxOutstanding() !== cap || await token.decimals() !== 8n) {
    throw new Error("deployed contract verification failed");
  }
  console.log(JSON.stringify({
    chainId: network.chainId.toString(),
    contract: await token.getAddress(),
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    catecashGenesis: genesis,
    owner,
    signers,
    threshold,
    maxOutstandingAtoms: cap.toString(),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
