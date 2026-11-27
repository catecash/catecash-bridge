# Solana order book for native CATE ↔ USDC

**Status:** initial sketch. The [system design](solana-swap-system-design.md) is the current specification for server roles, signed acceptance, wallet UI, and release gates. No Solana program, Catecash swap client, or live swap exists. This design does not change Zebra or create a CATE token on Solana.

## Chain boundary

- **Catecash:** native CATE is locked in a transparent P2SH hash/time-lock script. A separate client constructs and signs funding, claim, and refund transactions. Zebra validates the script and broadcasts signed transactions through its existing `sendrawtransaction` RPC; it does not know about Solana or orders.
- **Solana:** an on-chain program stores USDC-funded sell orders, matches a single taker per order initially, escrows USDC in a program-derived token account, and releases or refunds it under the fill's hash/time-lock rules. The program does not mint CATE or treat a relayer's assertion as proof of a Catecash payment.
- **Observers:** anyone may monitor both chains, display progress, and submit already-authorized transactions. No observer or matching operator can release escrow by declaring a fill complete.

The first market is **native CATE for Solana USDC**. One posted order is one full fill; partial fills and reverse-side orders are deferred until the full round trip and both refunds work. Orders must name the exact Catecash genesis/network, Solana USDC mint, maker/taker destinations, integer amounts, expiry, and unique order ID. A rate is USDC base units per CATE atom, with rounding and fees fixed in the order before acceptance.

## One-fill claim order

The maker sells USDC for CATE and privately chooses a fresh random secret `s`, publishing only `H = SHA256(s)` in the order. The maker funds the corresponding USDC escrow on Solana. The Solana program records the price, amounts, recipient constraints, `H`, and a **longer** USDC refund deadline.

1. The taker accepts the on-chain order. The Solana program reserves its USDC for this taker and records the taker's USDC destination. This action alone cannot release USDC.
2. The taker funds a Catecash transparent P2SH output whose claim branch pays the maker only upon revealing `s` and whose refund branch returns CATE to the taker after a **shorter** Catecash deadline. The exact script bytes, outpoint, amount, and network must match the accepted fill. The maker independently verifies the funding transaction and its confirmation depth.
3. The maker claims CATE on Catecash, revealing `s` in the transparent spend. The taker or any relayer submits `s` to the Solana program; it verifies `SHA256(s) == H` and transfers the reserved USDC only to the recorded taker destination.
4. If the maker does not claim CATE, the taker refunds CATE after its deadline. If USDC remains unclaimed, the maker refunds USDC after the later Solana deadline. Time buffers must cover Catecash confirmations, Solana finality, monitoring, and transaction submission.

The maker must never reveal `s` before the Catecash lock is confirmed, and the taker must not know `s` while USDC is merely reserved. A fresh secret is required per fill. Reusing one hash for partial fills would cross-link and potentially release more than one order.

## On-chain order and fill state

The Solana program needs `postFundedOrder`, `cancelUnmatchedOrder`, `acceptOrder`, `claimUsdc(secret)`, and `refundUsdc` transitions. Each transition must check the expected order state, exact USDC mint and token account, maker/taker signatures where required, amount, deadline, and one-time fill ID. The USDC vault is controlled by a program-derived address, not a service key. No administrator release instruction is permitted. Upgrade authority and program immutability are public launch decisions.

Only the matched USDC is escrowed; there is no Solana CATE token and no Meteora CATE/USDC pool. Order prices are fixed by makers, not derived from an AMM. A public UI can index on-chain order accounts, but the chain state is authoritative.

## Evidence before funding real orders

1. On an isolated Catecash network, build and spend the exact P2SH script through both the maker-claim and taker-refund branches using an external client and existing Zebra RPC. Confirm rejection of wrong secret, early refund, wrong network, altered recipient, and double spend. Do not change Zebra consensus or RPC for this test.
2. On a Solana local validator, test funded orders, matching, duplicate accepts, exact USDC transfers, correct claim, wrong secret, deadlines, cancellation, refund, and attempted vault diversion.
3. Run end-to-end swaps with independent observers, chain reorganizations, failed broadcasts, delayed claims, restarts, and both parties going offline. Publish the timeout derivation and fee/rounding rules.
4. Obtain independent review of the Catecash script/transaction builder and Solana program before public use. The current Catecash public-network checklist is still NO-GO.

This first version uses **transparent** CATE. Shielded/adaptor-signature settlement is a separate research track and cannot be substituted without its own proof and review.
