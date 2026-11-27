# Bridge redesign decision: no committee-minted pool token

**Decision:** 2026-11-26. The existing threshold-signed wCATE mint path is rejected for public liquidity pools. The prototype is restricted to a local Hardhat chain, its remote deployment script is disabled, and no Ethereum, Robinhood Chain, or BNB Smart Chain pool should be funded with its token.

## Why the prior route fails the pool test

`WrappedCATE.mintForDeposit` accepts a threshold of bridge signatures as evidence of a SmartCatecash lock. The Ethereum contract cannot verify the remote lock itself. A compromised or colluding threshold can sign a nonexistent deposit and mint wCATE up to `maxOutstanding`. The owner can raise that cap. An attacker could sell unbacked wCATE into a funded pool and withdraw the paired asset. A reserve dashboard, audit, multisignature wallet, rate limit, or cap may reduce or reveal the loss; none removes the mint authority. The same issue exists one hop earlier if Catecash-operated SmartCatecash nodes or signers can issue native gas CATE without independently verifiable PoW backing.

Running every SmartCatecash validator gives Catecash operational control of that EVM L1; it does not make cross-chain claims independently verifiable on Ethereum. The economic supply across the PoW chain, SmartCatecash, and external pools must be proven at each edge, not asserted by the operator.

## Replacement criteria

Before any CATE token is paired with ETH, WETH, or WBNB in a public pool, the design must demonstrate all of these properties:

1. No administrator, signer committee, validator operator, upgrade key, or token owner can unilaterally or collectively create additional pool-facing CATE without the corresponding source asset being locked or removed under rules that the destination can verify.
2. Every token has a specific source and a redeemable return path. Token supply and every bridge escrow balance can be reconciled from public chain data, including pending withdrawals and reorganizations.
3. A compromised bridge actor cannot drain the paired pool asset by minting or releasing unbacked CATE. The maximum loss from every remaining privileged action is bounded and disclosed.
4. The exact PoW chain identity, SmartCatecash chain ID and genesis, bridge code, token code, and upgrade powers are fixed and independently reviewed before deployment. The live design survives a validator or bridge operator outage without silent inflation.

These are acceptance tests, not properties of the current code.

## Paths to evaluate

| Path | Pool implication | Remaining trust or feasibility question |
| --- | --- | --- |
| Verifiable bridge | Could support a redeemable wCATE pool if Ethereum can verify the required Catecash PoW and SmartCatecash state proofs, and the return custody path is enforceable. | Proving PoW deposits, finality, and withdrawal custody across these chains is substantial research and engineering. Operator control of SmartCatecash must not let it fabricate backing. |
| Fixed-supply, non-mintable token backed by published reserves | Prevents *new* tokens being minted into a pool after issuance. A capped, pre-funded inventory could be traded. | Custody and redemption remain trusted; holders and LPs can still lose backing. This is not an automatic bridge for newly mined CATE. |
| Direct cross-chain trades without a wrapped pool token | Avoids the specific unbacked-token mint path. | Requires a separately proven swap or liquidity protocol on the Catecash PoW chain and the destination; it does not create a CATE/ETH on-chain pool. |

Do not select a path based only on its ability to pass local contract tests. Establish the trust model and independent security review first. The pools on Ethereum, Robinhood Chain, and BNB Smart Chain remain proposed destinations, not launch commitments.
