# Catecash Bridge

Testnet prototype for locking native Catecash (CATE) and issuing redeemable wrapped CATE (wCATE) on Ethereum. **No public Catecash network or redeemable mainnet wCATE exists yet. Do not deploy this prototype with real funds.**

## Current scope

- `docs/bridge-spec.md` defines the deposit, mint, burn, payout, custody, and recovery rules.
- `contracts/WrappedCATE.sol` is an 8-decimal ERC-20 with committee-authorized minting, one-time deposit IDs, a supply cap, burn-to-withdraw events, and an owner pause.
- `src/deposit-policy.js` checks a proposed deposit against an independent Catecash chain adapter before a signer attests to it. The adapter is mocked in tests; a production Catecash RPC implementation is pending.
- Tests exercise mint replay protection, committee signatures, caps, burns, pauses, chain identity, confirmations, and reorganizations.

The ERC-20 contract **does not hold or release native CATE**. The Catecash custody wallet and payout service remain to be built after the chain's wallet and RPC interfaces are finalized. The prototype does not provide a usable bridge UI or a live route.

## Local development

Use a supported Node.js LTS release (Node 22 or 24), then:

```sh
npm ci
npm run compile
npm test
```

No key or RPC URL is needed for local tests. The test suite uses a local Ethereum chain and mocked Catecash responses.

For a Sepolia deployment, set `ETH_RPC_URL` and either `DEPLOYER_PRIVATE_KEY`
or `BRIDGE_WALLET_REF` (a local JSON file naming a restricted seed file and
derivation path). Set `CATE_GENESIS`, `BRIDGE_OWNER`, `BRIDGE_SIGNERS`
(comma-separated addresses), `BRIDGE_THRESHOLD`, and `BRIDGE_CAP_ATOMS`
(integer base units). Alternatively, set `BRIDGE_DEPLOY_CONFIG` to a local JSON
file with `genesis`, `owner`, `signers`, `threshold`, and `capAtoms`. Then run
`npx hardhat run scripts/deploy.js --network sepolia`. The script refuses any
chain other than Sepolia (11155111) and verifies the deployed parameters. Use
a Catecash **testnet** genesis and test-only keys. It does not create Catecash
custody or a payout service.

## Implementation milestones

1. Finalize the public Catecash network, address encodings, transparent multisignature custody capability, and indexed transaction/wallet RPCs.
2. Implement a persistent one-time deposit intent service and a Catecash RPC adapter; independently run the policy on each signer.
3. Implement an Ethereum finalized-log watcher and durable, idempotent native withdrawal executor. Test chain reorganizations and crash recovery end to end.
4. Deploy on public testnets with independent operators, reconcile reserves continuously, and commission an independent security review before any mainnet deployment.

This repo is MIT licensed. See `docs/bridge-spec.md` for the trust model and unresolved parameters.
