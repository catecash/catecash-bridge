# Catecash PoW → SmartCatecash wCAT → external chains bridge specification

**Status:** superseded by the [Solana native CATE ↔ USDC order book](solana-atomic-orderbook.md). This document describes the rejected bridge prototype for historical review only. The public Catecash network checklist is NO-GO, and there is no live bridge. The EVM contracts in this repo are local-only prototypes.

## Route and asset definitions

```text
1. Catecash PoW transparent CATE deposit → custody locks CATE
   → SmartCatecash issues the same amount as native gas CATE.
2. SmartCatecash native CATE deposit into its wrapper → 8-decimal wCAT.
3. SmartCatecash wCAT lock → Ethereum mints 8-decimal wCATE.
4. Ethereum wCATE burn → SmartCatecash releases wCAT; unwrap to native CATE if desired.
5. SmartCatecash native CATE burn or lock → Catecash PoW custody pays CATE.
```

The current [`WrappedCATE`](../contracts/WrappedCATE.sol) contract only accepts step 3 and returns through step 4. It no longer mints directly from a PoW transaction. A swap such as wCATE/ETH is a separate liquidity market after the bridge route works. Pools are planned on Ethereum, Robinhood Chain, and BNB Smart Chain. The latter two destinations require their own verified token routes, escrow accounting, and funded pools; they must not independently mint against the same PoW deposit.

| Pool destination | Proposed trading pair | Token route to verify first |
| --- | --- | --- |
| Ethereum | wCATE / WETH | SmartCatecash wCAT locked for Ethereum wCATE. |
| Robinhood Chain | bridged wCATE / WETH | Lock Ethereum wCATE through a supported Ethereum → Robinhood Chain route. |
| BNB Smart Chain | bridged wCATE / WBNB | Lock Ethereum wCATE through a supported Ethereum → BSC route. |

These are target pools, not deployed contracts or guaranteed bridge routes. Each destination token must have a documented redemption path to the Ethereum representation, and pool opening depends on sufficient liquidity and route testing. Pool shares and market prices do not change the 1:1 bridge accounting.

## Supply invariant

Native Catecash uses 8 decimal places. The EVM testnet prototype uses 18 native base units, so exactly **1 PoW atom = 10^10 SmartCatecash base units = 1 wCAT base unit = 1 wCATE base unit**. The wCAT wrapper rejects native deposits smaller than one PoW atom. PoW withdrawals must also be whole atoms. All calculations use integers.

At each hop, the outstanding destination claim plus accepted but unpaid withdrawal liabilities must be covered by independently verified locked source assets. In particular, wCAT supply is backed by native CATE in [`WrappedSmartCATE`](../contracts/WrappedSmartCATE.sol), and Ethereum wCATE supply is backed by wCAT in [`SmartCATEEscrow`](../contracts/SmartCATEEscrow.sol). A locked coin or token is backing, not another circulating coin. The mint authority on SmartCatecash must require unique, confirmed PoW outpoint evidence and must have no unrestricted mainnet mint path or discretionary genesis allocation. The configured EVM client must expose a supported, controlled native-asset mint/burn mechanism; ordinary ERC-20 contracts cannot create gas balances. This bridge integration is **not implemented** here. Fee burning, validator fee receipts, dust, and any force-sent native balance need a published reconciliation rule before mainnet.

## Hop 1: PoW Catecash ↔ SmartCatecash

The depositor receives a single-use transparent Catecash custody address bound to one SmartCatecash recipient. The intent service records the binding durably before showing the address. Each independent signer uses its own Catecash node to verify the exact genesis, canonical block, confirmation depth, non-coinbase transaction, output index, destination, amount, intent expiry, and unused outpoint. The existing [`deposit-policy`](../src/deposit-policy.js) implements only this read-only check with a mocked chain adapter in tests. It has no authority to mint native gas coins.

A production SmartCatecash issuance mechanism must accept threshold attestations bound to its chain ID, genesis, bridge instance, PoW outpoint, recipient, amount, deadline, and committee epoch. It must reject duplicate outpoints and exceedance of a hard supply cap. Signers must check native custody balance and unresolved withdrawals before signing. A deep PoW reorganization after issuance can still create undercollateralization; pause and incident handling are required.

For the reverse direction, a finalized SmartCatecash burn or lock must create a unique withdrawal ID. A durable payout service verifies that event, pays once from PoW custody, and records the resulting PoW transaction. An uncertain broadcast must be reconciled before retry; a burn remains a liability until paid. No PoW payout service exists yet.

## Hop 2: SmartCatecash wCAT ↔ Ethereum wCATE

The user wraps native SmartCatecash CATE into wCAT, approves the escrow, and locks wCAT in [`SmartCATEEscrow`](../contracts/SmartCATEEscrow.sol), which emits `DepositLocked`. The Ethereum [`WrappedCATE`](../contracts/WrappedCATE.sol) contract binds its source chain ID, source genesis, and escrow address at deployment. Independent signers verify the canonical SmartCatecash receipt, the escrow's wCAT token identity, and the exact event through [`evm-policy`](../src/evm-policy.js), then attest to the Ethereum mint. The token records the source transaction hash and log index permanently, rejects replay and stale committee signatures, and enforces an outstanding-supply cap.

The Ethereum holder burns wCATE with a SmartCatecash recipient address. Independent signers verify the finalized `WithdrawalRequested` log from the exact Ethereum token. `SmartCATEEscrow` checks their threshold EIP-712 release attestation, the one-time Ethereum token binding, its own available wCAT balance, and the unique Ethereum transaction hash/log index before sending wCAT. The holder can unwrap wCAT to native SmartCatecash CATE. The escrow token binding is a one-time owner action and must be verified after both testnet deployments.

The committee is a **federated trust boundary**. A compromised threshold can sign an unbacked mint or fraudulent release. Owner controls can change signers and pause flows. Use independent operators, segregated signer keys, a separate owner multisignature, published changes, caps, and monitoring. No smart contract can prove a remote event by itself in this prototype.

## Privacy and operations

Only transparent PoW custody is in scope. Bridge transaction timing and recipient mappings can link a Catecash payment to an EVM account. SmartCatecash and Ethereum transactions are public; no shielded-payment claim carries over to these chains.

Watchers and signers must persist observed events and decisions, wait for chain-specific finality, compare finalized block hashes, survive restarts, detect reorganizations, and fail closed on inconsistent RPC results. The EVM signer policy requires an `isFinalized(height, hash)` adapter check; the local test adapter returns true only as a fixture, so real chain-specific finality adapters remain unimplemented. Reconcile PoW custody against all SmartCatecash issuance and pending payouts, native CATE backing against wCAT supply, and SmartCatecash wCAT escrow against all Ethereum wCATE supply and pending releases. Pause new signing on any deficit or chain identity mismatch.

## Release gates

- Finalize and independently review the public Catecash PoW network, transparent custody wallet, address format, and RPC adapter.
- Configure and deploy a maintained EVM L1 stack without writing a new client; demonstrate reserve-backed native CATE issuance through its supported mechanism, reverse burn/payout, fee accounting, and validator sync on a local testnet.
- Deploy the wCAT wrapper and both bridge contracts on distinct public testnets; verify exact chain IDs, genesis hashes, contract code, one-time token binding, full forward and reverse routes, reorgs, pauses, and crash recovery.
- Establish a separate funded pool and tested return route for each destination: Ethereum, Robinhood Chain, and BNB Smart Chain. Define pool pairs, minimum liquidity, slippage limits, ownership, and withdrawal procedures before opening them to users.
- Add independent contract and operational security reviews, reserve monitoring, public caps, incident procedures, and a signed go/no-go record before mainnet.
