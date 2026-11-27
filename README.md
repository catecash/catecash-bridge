# Catecash bridge prototype

**Current direction:** [Native CATE ↔ Solana USDC system design](docs/solana-swap-system-design.md). It specifies the on-chain order book, server roles, Chrome wallet flow, and external Catecash swap client, with no wrapped CATE mint or Zebra node changes. This is a design, not a deployed service.

The agreed [six implementation steps and current progress](docs/solana-swap-implementation-steps.md) are tracked separately. Step 1 has an external, offline CATE HTLC script proof; the live devnet round trip is still open.

**Design decision (2026-11-26): The committee-minted wCATE route is rejected for public liquidity pools.** A signer threshold can authorize an unbacked mint, and the owner can raise the cap. Such tokens could be sold into a pool for its ETH, WETH, or WBNB. The Ethereum token and SmartCatecash escrow constructors now run only on Hardhat's local chain ID 31337. This code is retained for local threat-model tests, not deployment. See [bridge redesign](docs/bridge-redesign.md).

The previous route was **Catecash PoW → SmartCatecash native CATE → SmartCatecash wCAT → Ethereum wCATE**. It remains in this repository only as an isolated local prototype. No public route or redeemable mainnet wCATE exists.

## What this repo implements

- [`src/deposit-policy.js`](src/deposit-policy.js) verifies a proposed transparent Catecash PoW deposit against an independent chain adapter. It does not yet issue native SmartCatecash CATE.
- [`contracts/WrappedSmartCATE.sol`](contracts/WrappedSmartCATE.sol) wraps native SmartCatecash CATE into 8-decimal wCAT and unwraps it back to native CATE in exact PoW atom units.
- [`contracts/SmartCATEEscrow.sol`](contracts/SmartCATEEscrow.sol) locks SmartCatecash wCAT and releases it after committee attestation of a finalized Ethereum burn.
- [`contracts/WrappedCATE.sol`](contracts/WrappedCATE.sol) mints Ethereum wCATE only for a committee-attested SmartCatecash lock event. Its withdrawal burns wCATE to request release **on SmartCatecash**, not directly on the PoW chain.
- [`src/evm-policy.js`](src/evm-policy.js) checks chain identity, confirmations, canonical transaction receipts, exact bridge address, and event values before a test signer attests to either EVM hop.
- [`docs/bridge-spec.md`](docs/bridge-spec.md) defines both hops, their custody model, accounting, and unfinished production work. The [SmartCatecash launch plan](docs/smartcatecash-launch-plan.md) covers the proposed EVM L1 and later BNB Smart Chain and Robinhood Chain routes.

Both contracts use threshold EIP-712 attestations, source-bound identifiers, replay protection, owner pause, and committee epochs. These controls do **not** make the prototype trustless: a compromised signer threshold can issue an unbacked claim or release escrow improperly. The contracts and operations need independent review.

## Local checks

Use Node 22 or 24 LTS:

```sh
npm ci
npm run compile
npm test
```

The tests run on one local Hardhat chain with mocked cross-chain observations. They prove wrapper, escrow, token, and policy behavior at that boundary; they do not prove a live cross-chain bridge. No key or RPC URL is needed.

## Deployment status

The prior Sepolia deployment workflow is disabled because it implements the rejected committee-mint design. Do not deploy a liquidity pool or issue a public wCATE token from this code. A replacement design must prove that no operator or signer set can create unbacked pool-facing CATE before a deployment workflow is restored.

## Missing for a usable route

1. Decide whether SmartCatecash needs native gas CATE at all. An operator-controlled EVM chain plus a committee bridge does not provide the security needed for public CATE liquidity pools.
2. Implement persistent single-use PoW deposit intents, real Zebra RPC verification, custody signing, withdrawal ledger, reorg handling, and exact reserve accounting.
3. Run independent SmartCatecash and Ethereum observers/signers, finality watchers, transaction relayers, continuous reserve monitoring, and restart recovery.
4. Complete public testnet round trips, independent security review, and the source-chain launch gates before considering mainnet deployment.

The repository is MIT licensed. Keep live secrets in restricted host storage or read-only mounts outside build contexts.
