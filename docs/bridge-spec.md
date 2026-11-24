# CATE ↔ wCATE bridge specification (draft 0.1)

**Status:** design and local testnet prototype. Catecash currently has only an experimental local devnet. Mainnet genesis, public addresses, wallet behavior, and independent security review are outstanding. The devnet genesis in the Catecash Zebra checkout is a fixture, not a mainnet identifier.

## Asset and accounting rules

- Native CATE and wCATE both use **8 decimal places**. All bridge amounts are integer base units. The intended conversion is exactly 1:1 before any separately disclosed fee.
- A wCATE mint is backed by a distinct transparent CATE transaction output sent to bridge custody. The signed output key is `(Catecash genesis hash, transaction ID, output index)`. The Ethereum contract stores that key permanently after minting.
- The reserve invariant is `verified custody balance >= wCATE totalSupply + accepted but unpaid withdrawal burns`. Deposits awaiting mint and any operational fee balance may make the left side larger. A reserve monitor must reconcile this invariant against independently queried chain data.
- The bridge does not move ETH or BTC into Catecash, provide an exchange rate, or make Ethereum transfers private.

## Trust and control

An `m-of-n` independent signer committee attests to CATE deposits and controls the native CATE custody wallet. The Ethereum contract checks threshold EIP-712 signatures before minting. This is a **federated bridge**: a compromised threshold can authorize unbacked minting or steal escrowed CATE. The initial test fixture uses 2-of-3; actual membership and threshold need an operator and incident-response plan.

The Ethereum owner can pause new mints and burns, replace the committee, and adjust the outstanding-supply cap. It should be a separate multisignature account with a published change policy. Changing the committee increments an epoch and invalidates old mint attestations. Owner controls are powerful and require their own review. Pausing does not freeze ordinary ERC-20 transfers.

Only transparent CATE custody is in scope initially. A shielded custody wallet would need a different, auditable reserve and signer model. User deposits and Ethereum addresses can be linked by bridge records and timing.

## Deposit and mint flow

1. An intent service assigns a **single-use** transparent custody address to one Ethereum recipient and records an expiry height. The implementation must persist this mapping before showing the address. Do not reuse an address for another recipient.
2. The user pays native CATE to that address. An observer proposes the transaction ID, output index, block hash, and height.
3. Each signer independently checks the exact Catecash genesis, canonical block hash, confirmation depth, non-coinbase transaction, output address, and integer amount against its own node and the persisted intent. It also checks that the deposit was not already minted. The implemented checks are in `src/deposit-policy.js`; the real chain adapter and intent database are pending.
4. Signers sign the **same** EIP-712 payload: transaction ID, output index, Ethereum recipient, amount, expiration timestamp, and current committee epoch. The EIP-712 domain binds the Ethereum chain ID and deployed contract address. Signatures are submitted in ascending signer-address order.
5. Anyone may submit the threshold signatures. The contract checks the current signer set, cap, deadline, epoch, and unused output key before minting wCATE.

**Provisional testnet policy:** 20 Catecash confirmations, with the exact value to be set from observed reorganization behavior. On a detected Catecash reorganization or reserve discrepancy, operators pause minting, stop signing, and reconcile before resuming. A deep reorganization after minting can still leave unbacked wCATE; the confirmation threshold cannot eliminate that risk.

## Burn and native payout flow

1. A holder calls `requestWithdrawal(amount, cateAddress)` on Ethereum. The contract burns the holder's wCATE and emits a unique, monotonically numbered `WithdrawalRequested` event.
2. A payout service waits for Ethereum finality, independently verifies the event's contract, chain, transaction, log, amount, and destination, and records the withdrawal ID in a durable database. The current contract checks only destination string length; **the payout service must validate the final Catecash address encoding and network**.
3. The native custody committee signs exactly one CATE payout for that ID. The service records the native transaction ID and watches for confirmation. Crash recovery must reconcile both chains before retrying; an uncertain broadcast must never result in a second payout.
4. If payout cannot be completed, the burn remains a liability until resolved. Operators must not silently mint replacement wCATE or mark it paid.

The finalized Ethereum watcher, native signer wallet, payout service, and durable ledger are **not implemented**. There is currently no end-to-end native withdrawal path.

## Limits and launch gates

- The contract enforces a configurable maximum outstanding wCATE supply. It is a circuit breaker, not proof of reserves. Raising it must follow the published owner policy.
- No live key material belongs in the repo or in ordinary environment files. Signing keys need isolated custody and independent operators.
- Before public testnet: finalize chain identity and addresses; implement the Catecash RPC adapter and wallet; persist intents and withdrawal state; exercise reorgs, retries, and restart recovery.
- Before mainnet: publish custody addresses and signer identities, define finality and caps, add reserve monitoring and incident procedures, obtain independent contract and operational security reviews, and demonstrate complete round trips on public testnets.
