const { getAddress } = require("ethers");

const mintTypes = {
  Mint: [
    { name: "sourceTxHash", type: "bytes32" },
    { name: "logIndex", type: "uint32" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "committeeEpoch", type: "uint256" },
  ],
};

const releaseTypes = {
  Release: [
    { name: "ethTxHash", type: "bytes32" },
    { name: "logIndex", type: "uint32" },
    { name: "withdrawalId", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "committeeEpoch", type: "uint256" },
  ],
};

function mintDomain(chainId, verifyingContract) {
  return {
    name: "Wrapped Catecash",
    version: "1",
    chainId,
    verifyingContract: getAddress(verifyingContract),
  };
}

function releaseDomain(chainId, verifyingContract) {
  return { name: "SmartCatecash Escrow", version: "1", chainId,
    verifyingContract: getAddress(verifyingContract) };
}

async function signMint(signer, domain, mint) {
  return { signer: await signer.getAddress(), signature: await signer.signTypedData(domain, mintTypes, mint) };
}

async function signRelease(signer, domain, release) {
  return { signer: await signer.getAddress(), signature: await signer.signTypedData(domain, releaseTypes, release) };
}

function orderedSignatures(attestations) {
  const sorted = [...attestations].sort((a, b) =>
    a.signer.toLowerCase().localeCompare(b.signer.toLowerCase())
  );
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].signer.toLowerCase() === sorted[i].signer.toLowerCase()) {
      throw new Error("duplicate signer");
    }
  }
  return sorted.map(({ signature }) => signature);
}

module.exports = { mintTypes, mintDomain, signMint, releaseTypes, releaseDomain, signRelease, orderedSignatures };
