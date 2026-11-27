#!/usr/bin/env python3
"""Run a tiny Catecash devnet HTLC claim/refund proof without changing Zebra.

The test key and RPC cookie are read from local files and never printed or
stored in the recovery record. The record contains signed test transactions,
including the claim preimage, so it is restricted to the current user.
"""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.request import Request, urlopen

EXPECTED_GENESIS = "6b9c4d783359202111571c123309b2c0511d1bf9036f74dee4921f04e1f0a9cf"
ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def decode_wif(wif):
    number = 0
    for letter in wif:
        number = number * 58 + ALPHABET.index(letter)
    raw = number.to_bytes((number.bit_length() + 7) // 8, "big")
    raw = b"\x00" * (len(wif) - len(wif.lstrip("1"))) + raw
    payload, checksum = raw[:-4], raw[-4:]
    assert hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4] == checksum
    assert len(payload) == 34 and payload[0] == 0xF0 and payload[-1] == 1
    return payload[1:33].hex()


def rpc(cookie_path, method, params):
    credential = cookie_path.read_text().strip().encode()
    auth = base64.b64encode(credential).decode()
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = Request("http://127.0.0.1:34342/", body,
                      {"Content-Type": "application/json", "Authorization": "Basic " + auth})
    with urlopen(request, timeout=15) as response:
        reply = json.load(response)
    if reply.get("error"):
        raise RuntimeError(f"{method}: {reply['error']}")
    return reply["result"]


def save_record(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".cate-htlc-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as file:
            os.fchmod(file.fileno(), 0o600)
            json.dump(data, file)
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def confirmations(cookie_path, txid):
    try:
        entry = rpc(cookie_path, "getrawtransaction", [txid, 1])
    except RuntimeError:
        return None
    return entry.get("confirmations", 0) if isinstance(entry, dict) else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=["prepare", "fund", "settle", "status"])
    parser.add_argument("--cookie-file", type=Path, required=True)
    parser.add_argument("--key-file", type=Path)
    parser.add_argument("--record", type=Path, default=Path("/private/tmp/cate-htlc-devnet-proof.json"))
    args = parser.parse_args()

    chain = rpc(args.cookie_file, "getblockchaininfo", [])
    assert chain["chain"] == "catecash-devnet"
    assert rpc(args.cookie_file, "getblockhash", [0]) == EXPECTED_GENESIS

    if args.phase == "prepare":
        if args.key_file is None:
            parser.error("prepare requires --key-file")
        key = json.loads(args.key_file.read_text())
        assert key["network"] == "CatecashDevnet"
        utxos = rpc(args.cookie_file, "getaddressutxos", [{"addresses": [key["address"]]}])
        ordinary = []
        for coin in sorted(utxos, key=lambda item: item["height"], reverse=True)[:50]:
            if chain["blocks"] - coin["height"] + 1 < 10:
                continue
            previous = rpc(args.cookie_file, "getrawtransaction", [coin["txid"], 1])
            if any("coinbase" in vin for vin in previous.get("vin", [])):
                continue
            ordinary.append(coin)
            if len(ordinary) == 2:
                break
        if len(ordinary) < 2:
            raise RuntimeError("two confirmed non-coinbase test UTXOs are required; "
                               "coinbase rewards must be shielded before transparent use")
        request = {"secret_hex": decode_wif(key["private_key_wif"]),
                   "tip_height": chain["blocks"],
                   "utxos": [{"txid": coin["txid"], "index": coin["outputIndex"],
                              "value": coin["satoshis"], "script_hex": coin["script"]}
                             for coin in ordinary]}
        builder = Path(__file__).resolve().parents[3] / "catecash-zebra/target/debug/devnet_proof"
        result = subprocess.run([str(builder)], input=json.dumps(request), text=True,
                                capture_output=True, check=True)
        record = json.loads(result.stdout)
        record["funding_submitted"] = []
        record["spends_submitted"] = []
        save_record(args.record, record)
        print(f"Prepared two signed test swaps; recovery record: {args.record}")
        return

    record = json.loads(args.record.read_text())
    assert record["network"] == "catecash-devnet"
    if args.phase == "fund":
        for swap in record["swaps"]:
            if swap["funding_txid"] in record["funding_submitted"]:
                continue
            txid = swap["funding_txid"]
            if confirmations(args.cookie_file, txid) is None:
                broadcast = rpc(args.cookie_file, "sendrawtransaction", [swap["funding_hex"]])
                assert str(broadcast) == txid
            record["funding_submitted"].append(txid)
            save_record(args.record, record)
            print(f"Recorded {swap['path']} funding: {txid}")
        return

    for swap in record["swaps"]:
        txid = swap["funding_txid"]
        funding_confirmations = confirmations(args.cookie_file, txid) or 0
        spend_confirmations = confirmations(args.cookie_file, swap["spend_txid"]) or 0
        print(f"{swap['path']} funding confirmations: {funding_confirmations}; "
              f"spend confirmations: {spend_confirmations}")
        if args.phase == "settle" and txid in record["funding_submitted"] \
                and funding_confirmations >= 1 \
                and swap["spend_txid"] not in record["spends_submitted"]:
            if swap["path"] == "refund" and chain["blocks"] < swap["refund_height"]:
                print(f"Refund waits for height {swap['refund_height']}; tip is {chain['blocks']}")
                continue
            spent = swap["spend_txid"]
            if confirmations(args.cookie_file, spent) is None:
                broadcast = rpc(args.cookie_file, "sendrawtransaction", [swap["spend_hex"]])
                assert str(broadcast) == spent
            record["spends_submitted"].append(spent)
            save_record(args.record, record)
            print(f"Recorded {swap['path']} spend: {spent}")
    if args.phase == "status" and all((confirmations(args.cookie_file, swap["spend_txid"]) or 0) >= 1
                                      for swap in record["swaps"]):
        print("Both claim and refund spends are confirmed")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Devnet proof stopped: {error}", file=sys.stderr)
        raise SystemExit(1)
