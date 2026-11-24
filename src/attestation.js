const { getAddress } = require("ethers");

const mintTypes = {
  Mint: [
    { name: "cateTxId", type: "bytes32" },
    { name: "outputIndex", type: "uint32" },
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

async function signMint(signer, domain, mint) {
  return { signer: await signer.getAddress(), signature: await signer.signTypedData(domain, mintTypes, mint) };
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

module.exports = { mintTypes, mintDomain, signMint, orderedSignatures };
