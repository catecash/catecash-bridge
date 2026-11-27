require("@nomicfoundation/hardhat-ethers");

// Local-only prototype. No remote RPC or deployment key is loaded.
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { evmVersion: "cancun", optimizer: { enabled: true, runs: 200 } },
  },
};
