# Native CATE ↔ Solana USDC swap: system design

**Status (2026-11-26): proposed, not deployed.** This is the current design for a first market between native transparent CATE and Solana USDC. It creates no SmartCatecash chain, wrapped CATE, liquidity pool, or bridge mint. Zebra source and consensus stay unchanged. The earlier committee-minted bridge is rejected.

## What runs where

| Component | Location and operator | Authority |
| --- | --- | --- |
| Catecash chain | Existing Zebra nodes and miners | Validate ordinary transparent transactions, including P2SH scripts and lock times. Zebra knows nothing about Solana or orders. |
| Catecash wallet gateway | Existing `wallet.catecash.com` gateway for the current network; test gateway on its current host | Read chain data and broadcast **already signed** CATE transactions. It has no swap signing key or settlement decision. Add narrowly scoped read endpoints only if the client cannot obtain required UTXO/transaction data through existing routes. Do not expose general Zebra RPC. |
| Solana order book and USDC escrow | New audited Solana program, executed by Solana validators | Hold actual USDC in a program controlled token account; enforce orders, acceptance, claim, cancellation, and refund. This is the authoritative book. It cannot release USDC because a server reports a Catecash fill. |
| Swap UI, indexer, notifier | For isolated testing, extend the existing status-only `swap-test.catecash.com` container on the Catecash web host. For production, provision a dedicated `swap.catecash.com` app host, separate from miners and the wallet gateway. | Cache public order/chain data, serve the companion UI, and alert both parties. No CATE or USDC custody, no fill authority. Users must be able to verify chain state directly if this service is down or dishonest. |
| Chrome wallet extension | User's browser; current `catecash-chrome-wallet` | Hold the user's CATE keys, build and sign the CATE lock and refund transactions locally, display trades, and verify the Solana order/fill before funding CATE. |
| Solana wallet | User's chosen Solana wallet, connected to the companion page | Sign funded USDC order posting for makers or order acceptance for takers. It receives USDC according to the on-chain fill. The Catecash extension does not import its seed. |

The current `catecash-relay` deployment is a **status-only shell**. Its old Ethereum market-maker path is not a settlement component for this design. All app services run as containers. Application runtimes do not run as host services. Any optional fee-payer key for permissionless relaying is kept in restricted host storage and mounted read-only outside the image build context; it never controls escrow. The first version can omit this relayer entirely.

## First market and order flow

The first book consists of **funded bids to buy CATE with Solana USDC**. A maker deposits the exact USDC amount into the Solana program and posts a price and CATE quantity. A taker selling native CATE accepts one whole order. The book is on-chain; the indexer only sorts and displays it. There are no partial fills, shared secrets across orders, or unfunded CATE asks in version 1.

Every order fixes the Solana cluster, exact approved USDC mint, token base-unit amount, CATE network/genesis, CATE atom amount, price/rounding rule, maker's CATE claim key, fresh SHA-256 secret hash `H`, expiry, and unique order ID. The maker keeps secret `s` private. The taker acceptance is a **Solana wallet-signed** transaction that reserves the order and fixes the taker's USDC recipient and CATE refund key. Duplicate or expired accepts fail. The maker may cancel and retrieve USDC only while the order is unmatched.

1. The taker reviews the on-chain funded bid and accepts it with a Solana wallet via the companion page. The Catecash extension verifies the resulting on-chain fill, exact mint, quantity, hash, recipient, and chain identities before offering a CATE lock.
2. The extension builds and locally signs a transparent CATE P2SH output. The claim branch requires `s` **and the maker's CATE signature**; the refund branch requires the taker's CATE signature after the shorter Catecash lock time. The wallet records the exact redeem script, funding outpoint, order ID, refund data, and deadlines **before** broadcasting the signed transaction through the existing gateway.
3. The maker independently checks the accepted Solana fill and confirmed CATE lock against the exact script, amount, and network. Only then does the maker claim CATE. That spend reveals `s` on Catecash.
4. The taker or any observer submits `s` to the Solana program. It checks `SHA256(s) == H`, the fill state, and the deadline, then sends exactly the escrowed USDC to the recipient fixed at acceptance. No server chooses the recipient.
5. If the maker never claims CATE, the taker signs and broadcasts the CATE refund after its lock time. If USDC remains unclaimed, the maker can recover it only after the **later** Solana refund deadline. Each claim or refund is single use.

Solana's deadline must exceed the Catecash deadline by a tested margin for confirmations, reorgs, observation, Solana finality, and retries. The maker must claim early enough for the taker to see the revealed secret and claim USDC. Exact timeout values and fee rules are release parameters, not guesses in the UI. A taker must never lock CATE merely because the indexer says an order was accepted. If the wallet or indexer is offline, a user must be able to reconstruct and submit a refund from their saved wallet data and public chain data.

## Solana program boundary

The program needs `postFundedOrder`, `cancelUnmatchedOrder`, `acceptOrder`, `claimUsdc`, and `refundUsdc`. It owns the escrow token account through a program-derived address. Maker and taker signatures authorize their respective order actions; a valid preimage and fixed destination authorize USDC claim. The program has no administrator payout, arbitrary recipient change, or mint instruction. Upgrades are an explicit launch decision: publish the program ID, upgrade authority policy, and audit result before public funds. Order account data and token balances, not API responses, determine available liquidity.

This is an atomic swap with an **operational timing assumption**, not a direct Solana proof of Catecash settlement. The maker protects itself by verifying the Catecash lock before revealing `s`; the taker protects itself with the USDC escrow and later Solana deadline. Both need monitoring or a reliable delegate until their claim/refund window closes. A matching service cannot fabricate a fill and take escrow, but a poorly chosen deadline or unusable refund path can still lose funds.

## Chrome wallet UI change

Version 1 adds **Trade** to the extension's home actions and a Trade view reachable from its navigation. It retains the existing CATE account, backup, auto-lock, and local signing model.

| View | User sees and does |
| --- | --- |
| Order book | Funded CATE buy bids, price in USDC per CATE, available size, expiry, chain/network labels, and fresh chain status. Stale cached orders cannot be accepted. |
| Order review | Exact CATE to lock, USDC to receive, Solana USDC mint, both destinations, estimated chain fees, confirmation requirement, and both refund deadlines. State clearly that CATE is transparent in this first version. |
| Solana acceptance | Open the companion page at a specific order ID; connect a Solana wallet and sign `acceptOrder`. Return to the extension by order ID; the extension verifies the fill on-chain before enabling CATE funding. No Solana seed enters the Catecash extension. |
| CATE lock review | Show the exact HTLC amount and refund deadline; require the ordinary local CATE signing approval. Persist recovery data before broadcast. |
| My trades | Show chain-derived stages: accepted, USDC escrowed, CATE locking/confirmed, maker claim/secret revealed, USDC paid, refunded, or action needed. Offer claim/refund actions and countdowns where applicable. Keep records across restarts and backup restore. |

The extension does not silently spend shielded CATE. A shielded balance can be shown, but the user must explicitly move funds into a transparent balance through the existing wallet flow before trading. A future integrated Solana account is a separate decision after this flow works. The companion page is a signing surface for the user's Solana wallet, not a custodian.

## Work required outside Zebra

- Implement and audit the Solana order/escrow program and its client. Use exact USDC mint allowlisting and integer accounting.
- Add a Catecash swap transaction builder/signer to the wallet's existing local WASM or worker code. Its ordinary transparent send path currently does not build or spend HTLC P2SH outputs. Implement both claim and refund branches, fee estimation, replacement/retry behavior where supported, and recovery serialization.
- Add the extension Trade views and companion Solana signing page. Add only the required host permissions and narrowly scoped gateway/indexer reads; verify chain state rather than trusting the indexer.
- Run the indexer/notifier in containers. Keep its cache rebuildable from both chains and its API free of custody or settlement privileges.

## Gates before real funds

1. On an isolated Catecash network using **unchanged Zebra**, prove both P2SH spend branches, wrong-secret rejection, early-refund rejection, exact network binding, double-spend behavior, fee estimation, and restart recovery.
2. On a Solana local validator, prove funded posting, signed acceptance, exact mint/amount/recipient enforcement, duplicate and race rejection, wrong preimage rejection, cancellation, claim, refund, and lack of administrator diversion.
3. Run both directions of the **claim/refund outcome** end to end, including stopped indexer, stopped gateway, chain reorg, delayed confirmation, browser restart, and a party going offline. Derive and publish safe deadlines from measured behavior.
4. Obtain independent reviews of the Solana program, Catecash script/transaction builder, and wallet recovery flow. Public Catecash network readiness and Solana program governance must also pass their own launch gates.

No public swap is live under this design. The existing bridge contracts and `catecash-relay` market-maker code must not be repurposed as the swap settlement path.
