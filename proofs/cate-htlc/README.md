# CATE HTLC proof

This external Rust crate uses the **unchanged** `zebra-script` validator and Catecash transaction branch ID. Its offline test builds claim and refund transactions for a P2SH hash/time-lock script. It checks a valid maker claim and taker refund and rejects a wrong secret, wrong signer, early refund, changed payout, and wrong signing domain. It does not by itself prove block inclusion, UTXO double-spend protection, fee policy, or recovery after browser restart.

Run from this directory with the Zebra repository's Rust toolchain and cached dependencies:

```sh
CARGO_TARGET_DIR=../../../catecash-zebra/target cargo +1.91.0 test --offline
CARGO_TARGET_DIR=../../../catecash-zebra/target cargo +1.91.0 build --offline --bin devnet_proof
```

`run_devnet.py` prepares and broadcasts two small devnet transactions (one claim, one refund) through the local cookie-authenticated Zebra RPC. It requires **two confirmed non-coinbase transparent UTXOs** controlled by a local devnet test key. The script validates chain and genesis, reads the key and cookie only from local files, and stores a restricted recovery record outside the repository before any broadcast. It never prints the key. Its phases are `prepare`, `fund`, `status`, and `settle`; `settle` can be rerun after a node or client restart. Keep the record until both spends confirm.

Recovery record updates use atomic replacement. Repeating `fund` or `settle` checks whether the exact transaction is already on the local chain or in the mempool before broadcasting, so a crash after broadcast does not require signing a different transaction. `status` reports confirmation counts for both funding and spending transactions and prints a completion line only after both spends have confirmed.

The miner-key UTXOs were coinbase rewards. Catecash consensus rejected a direct coinbase-to-transparent funding transaction. After explicit authorization, one full 5,000 CATE devnet reward was shielded into a locally backed-up Ironwood account, 0.1 CATE was unshielded, and that output was split into two ordinary outputs. The live harness funded both 0.01 CATE HTLCs; the maker claim and timed taker refund confirmed at devnet height 11,829. Duplicate spends were rejected, and confirmation status survived a local node restart. Public transaction IDs and the test record location are in the [implementation steps](../../docs/solana-swap-implementation-steps.md). This is an isolated CATE script proof, not a completed cross-chain swap.
