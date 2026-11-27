# SmartCatecash EVM L1 launch plan

**Status:** superseded by the [Solana native CATE ↔ USDC order book](solana-atomic-orderbook.md). This earlier SmartCatecash plan remains for historical review only. Its network has not been deployed. The Catecash public-network checklist is still NO-GO; private candidate mining is not a reviewed public mainnet.

## Intended architecture

```text
Catecash PoW chain (mined CATE; source of supply)
             | transparent custody and verified deposits/withdrawals
             v
SmartCatecash (independent EVM L1; native CATE pays gas)
             | 1:1 wrap native CATE into wCAT; bridge locks wCAT
             v
Ethereum (wCATE ERC-20; wCATE/WETH pool)
             | supported bridges lock Ethereum wCATE
             +-- BNB Smart Chain: bridged wCATE / WBNB pool
             +-- Robinhood Chain: bridged wCATE / WETH pool
```

SmartCatecash is a **configured EVM L1 operated by Catecash's nodes, with its own EIP-155 chain ID and genesis**. Existing EVM software supplies execution and consensus; Catecash operates the validator set and network parameters. It is not an Ethereum rollup and does not inherit Ethereum security. Native SmartCatecash CATE is wrapped 1:1 as wCAT before the Ethereum bridge. Robinhood Chain is an Ethereum L2; deployment there does not list CATE in Robinhood's brokerage or crypto app. Each destination token needs a verified bridge route, its own contract identity, and its own funded liquidity pool before swaps can work. Pools are planned on Ethereum, Robinhood Chain, and BNB Smart Chain. A swap pool trades assets; it does not bridge them.

## Supply and fee invariants

1. The only source of economic CATE is the Catecash PoW chain. SmartCatecash must not introduce a discretionary premine, validator issuance, faucet allocation on mainnet, or unrestricted native-coin minting. Testnet coins are separate and worthless.
2. Every increase in native SmartCatecash CATE must correspond to a unique, sufficiently confirmed, unspent native Catecash custody deposit. Every release from Catecash custody must correspond to a finalized SmartCatecash burn or lock. Track the deposit outpoint and withdrawal ID permanently and reject replay across all chain IDs and contract versions.
3. For each bridge edge, the outstanding destination claim plus accepted but unpaid withdrawals must never exceed independently verified source reserves. SmartCatecash wCAT must be backed by native CATE locked in its wrapper; Ethereum wCATE must be backed by wCAT locked in its bridge escrow. Reconcile reserves, pending deposits, pending withdrawals, and outstanding supply as integer amounts; fail closed on disagreement or a source-chain reorganization. Do not count a locked backing coin as additional circulating CATE.
4. Catecash uses 8 decimal places. If the EVM native unit uses 18 decimals, the exact conversion is `1 Catecash atom = 10^10 EVM base units`. Withdrawals must be whole Catecash atoms; dust and EVM gas fees need an explicit accounting rule. No floating-point conversion.
5. Decide whether EVM transaction fees are paid to validators or burned. A SmartCatecash-side burn leaves surplus CATE in Catecash custody unless an explicitly reviewed rule handles it. The fee mechanism must preserve the published cross-chain supply invariant.
6. The bridge is initially limited to transparent Catecash deposits. Transfers on EVM chains and bridge records are public and must not be represented as shielded Catecash payments.

## Chain implementation decision

Choose and pin maintained EVM L1 software before writing genesis or deployment files. Configure its chain identity, validator set, nodes, and native asset; do not build or fork a new EVM implementation. Evaluate existing stacks against the required **reserve-backed native CATE issuance and redemption after genesis**. Record the upstream version, consensus rules, validator controls, upgrade process, license, and operational dependencies. A standard ERC-20 or a genesis-only allocation cannot provide a dynamically bridged native gas coin. The selected stack must expose a supported, access-controlled native mint/burn mechanism that the PoW bridge can use. Do not assume any EVM stack supplies a Catecash bridge.

The acceptance test for the selected stack is a local, containerized, fresh-genesis EVM network that can: expose standard Ethereum RPC; deploy and call a Solidity contract; stop, restart, and resync a second node; reject a wrong chain ID; and demonstrate the exact native-CATE mint/lock/burn rules against mocked, replay-resistant Catecash deposit evidence. An ordinary token contract is insufficient to create native gas balances.

## Decisions to freeze before public testnet

- Chain name, unique EIP-155 chain ID distinct from Ethereum, BNB Smart Chain, Robinhood Chain, and testnets; native symbol and decimals; genesis allocation (zero economic CATE unless independently backed); fee recipient/burn rule; block and gas parameters; and upgrade governance. Publish the chain ID and genesis hash for wallets, bridges, and replay protection.
- Validator admission, number of Catecash-operated nodes, quorum, recovery rules, RPC separation, failure response, and chain halt/restart policy. If Catecash controls every validator, describe the public network as operator-controlled and do not claim validator decentralization or Ethereum security. Run validators across separate hosts and failure domains, with a separate RPC node.
- Bridge custody and signer model, confirmation depth based on observed Catecash reorganizations, per-transfer and outstanding-supply limits, emergency pause, and public reserve evidence.
- Native-CATE bridge state machine and exact mapping of Catecash 8-decimal atoms to EVM units, including gas bootstrap and withdrawal dust.
- Canonical token representations and contract addresses on Ethereum, BNB Smart Chain, and Robinhood Chain; test the latter two routes after the Ethereum route is proven. The current wCAT wrapper, SmartCatecash escrow, and Ethereum wCATE contracts are **testnet prototypes**, not a production bridge.

## Work sequence and launch gates

| Stage | Deliverable | Evidence to advance |
| --- | --- | --- |
| 0. Source-chain readiness | Resolve the Catecash [public mainnet checklist](../../catecash-zebra/docs/catecash/mainnet-checklist.md) and freeze its identity and transparent custody interface. | Reviewed public release and independently operated, tested network. |
| 1. Stack decision | Architecture decision record comparing candidate EVM stacks and native CATE supply mechanics. | Reproducible local prototype and explicit supply/fee model. |
| 2. Local devnet | Containerized validator, separate RPC node, genesis, contract deployment, explorer, monitoring, and test-only bridge actors. | Fresh-start, restart, sync, replay, reorg, fee, withdrawal, and reserve-invariant tests. |
| 3. Public testnet | Multiple Catecash-operated validators, separate bridge signers, public RPC, faucet, explorer, wallet metadata, and full Catecash ↔ SmartCatecash round trips. | Published test report including failures, recoveries, and third-party read-only node sync. |
| 4. External-chain testnets | Ethereum first, then BSC and Robinhood Chain representations, return routes, and separate pool trials on all three destinations. | Exact accounting across every hop and funded pool tests with slippage and withdrawal checks. |
| 5. Mainnet review | Independent security review of chain configuration, custody, bridge, operations, and incident procedures. | Remediated findings, reproducible container images, published parameters, reserve dashboard, and signed go/no-go record. |

All servers run the chain and bridge services in containers. Keep live signing material in restricted host storage and mount it read-only outside build contexts; never commit, bake into images, pass as build arguments, or put it in container environment variables. The public RPC must not expose administrative or signer interfaces.

## Current inventory and blockers

- [`catecash-bridge`](../README.md) has a local native CATE ↔ wCAT wrapper, SmartCatecash wCAT escrow ↔ Ethereum wCATE round-trip prototype, and PoW deposit policy tests. It lacks a real Catecash RPC adapter, native SmartCatecash issuance, persistent deposit intents, custody and payout services, independently operated finality watchers, and an end-to-end PoW route.
- The Catecash [mainnet checklist](../../catecash-zebra/docs/catecash/mainnet-checklist.md) says NO-GO for a public network. [Private candidate hosts](../../catecash-zebra/docs/catecash/mainnet-hosted-candidate.md) have mined blocks, but they are not a reviewed public source chain.
- There is no selected or deployed SmartCatecash EVM client stack, genesis, chain ID, validator set, native-CATE bridge, token deployment on BSC or Robinhood Chain, or funded swap market in this workspace.

**Next concrete task:** select the existing EVM stack and configure an isolated local devnet with Catecash-operated nodes and test-only CATE. Verify native mint/burn support before integrating the PoW bridge. Do not advertise a public launch date until the source-chain and bridge gates pass.
