//! Builds two small, locally signed devnet HTLC round trips from mature test
//! UTXOs. Reads the devnet test key on stdin; never writes it to output.

use ripemd::Ripemd160;
use secp256k1::{Message, PublicKey, SecretKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{io::{self, Read}, sync::Arc};
use zebra_chain::{
    block::Height,
    parameters::NetworkUpgrade,
    serialization::{ZcashDeserializeInto, ZcashSerialize},
    transaction::{self, HashType, LockTime, SigHasher, Transaction},
    transparent::{self, Output, Script},
};
use zebra_script::CachedFfiTransaction;

const BRANCH_ID: u32 = 0xea3b_eeb4;
const LOCK_AMOUNT: u64 = 1_000_000;
const FEE: u64 = 10_000;

fn push(data: &[u8], target: &mut Vec<u8>) {
    if data.len() <= 75 { target.push(data.len() as u8); }
    else { assert!(data.len() < 256); target.extend_from_slice(&[0x4c, data.len() as u8]); }
    target.extend_from_slice(data);
}

fn p2pkh(pubkey: &PublicKey) -> Vec<u8> {
    let hash: [u8; 20] = Ripemd160::digest(Sha256::digest(pubkey.serialize())).into();
    let mut script = vec![0x76, 0xa9, 0x14];
    script.extend_from_slice(&hash);
    script.extend_from_slice(&[0x88, 0xac]);
    script
}

fn p2sh(redeem: &[u8]) -> Vec<u8> {
    let hash: [u8; 20] = Ripemd160::digest(Sha256::digest(redeem)).into();
    let mut script = vec![0xa9, 0x14];
    script.extend_from_slice(&hash);
    script.push(0x87);
    script
}

fn redeem(hash: &[u8; 32], maker: &PublicKey, taker: &PublicKey, refund_height: u32) -> Vec<u8> {
    let mut script = vec![0x63, 0xa8];
    push(hash, &mut script);
    script.push(0x88);
    push(&maker.serialize(), &mut script);
    script.extend_from_slice(&[0xac, 0x67]);
    let mut height_bytes = refund_height.to_le_bytes().to_vec();
    while height_bytes.last() == Some(&0) { height_bytes.pop(); }
    if height_bytes.last().is_some_and(|byte| byte & 0x80 != 0) { height_bytes.push(0); }
    push(&height_bytes, &mut script);
    script.extend_from_slice(&[0xb1, 0x75]);
    push(&taker.serialize(), &mut script);
    script.extend_from_slice(&[0xac, 0x68]);
    script
}

fn tx(input: transparent::Input, outputs: Vec<Output>, lock_height: u32, expiry: u32) -> Transaction {
    let template = Transaction::test_v6(
        NetworkUpgrade::Nu7, vec![input], outputs,
        LockTime::Height(Height(lock_height)), Height(expiry),
    );
    let mut bytes = template.zcash_serialize_to_vec().unwrap();
    bytes[8..12].copy_from_slice(&BRANCH_ID.to_le_bytes());
    bytes.as_slice().zcash_deserialize_into().unwrap()
}

fn input(hash: transaction::Hash, index: u32, unlock: &[u8]) -> transparent::Input {
    transparent::Input::PrevOut {
        outpoint: transparent::OutPoint { hash, index },
        unlock_script: Script::new(unlock),
        sequence: u32::MAX - 1,
    }
}

fn output(value: u64, script: &[u8]) -> Output {
    Output { value: value.try_into().unwrap(), lock_script: Script::new(script) }
}

fn sign(
    prev_hash: transaction::Hash, index: u32, prior: Output,
    outputs: Vec<Output>, lock_height: u32, expiry: u32,
    signing_script: &[u8], signer: &SecretKey, branch_data: Option<(&[u8], &[u8])>,
) -> Transaction {
    let placeholder = tx(input(prev_hash, index, &[]), outputs.clone(), lock_height, expiry);
    let sighash = SigHasher::new(&placeholder, NetworkUpgrade::Nu7, Arc::new(vec![prior.clone()]))
        .unwrap().sighash(HashType::ALL, Some((0, signing_script.to_vec())));
    let signature = secp256k1::ecdsa::sign(Message::from_digest(*sighash.as_ref()), signer);
    let mut sig = signature.serialize_der().to_vec();
    sig.push(1);
    let mut unlock = Vec::new();
    push(&sig, &mut unlock);
    match branch_data {
        Some((redeem_script, secret)) if !secret.is_empty() => {
            push(secret, &mut unlock);
            unlock.push(0x51);
            push(redeem_script, &mut unlock);
        }
        Some((redeem_script, _)) => {
            unlock.push(0x00);
            push(redeem_script, &mut unlock);
        }
        None => push(&PublicKey::from_secret_key(signer).serialize(), &mut unlock),
    }
    let signed = tx(input(prev_hash, index, &unlock), outputs, lock_height, expiry);
    CachedFfiTransaction::new(Arc::new(signed.clone()), Arc::new(vec![prior]), NetworkUpgrade::Nu7)
        .unwrap().is_valid(0).unwrap();
    signed
}

fn field<'a>(value: &'a Value, name: &str) -> &'a str {
    value[name].as_str().unwrap_or_else(|| panic!("missing {name}"))
}

fn unsigned(value: &Value, name: &str) -> u64 {
    value[name].as_u64().unwrap_or_else(|| panic!("missing {name}"))
}

fn main() {
    let mut input_json = String::new();
    io::stdin().read_to_string(&mut input_json).unwrap();
    let request: Value = serde_json::from_str(&input_json).unwrap();
    let key_bytes: [u8; 32] = hex::decode(field(&request, "secret_hex")).unwrap().try_into().unwrap();
    let taker = SecretKey::from_secret_bytes(key_bytes).unwrap();
    let maker = SecretKey::from_secret_bytes([0x11; 32]).unwrap(); // devnet proof only
    let taker_script = p2pkh(&PublicKey::from_secret_key(&taker));
    let maker_script = p2pkh(&PublicKey::from_secret_key(&maker));
    let tip = unsigned(&request, "tip_height") as u32;
    let expiry = tip + 120;
    let refund_height = tip + 4;
    let utxos = request["utxos"].as_array().expect("two UTXOs required");
    assert_eq!(utxos.len(), 2);

    let mut result = Vec::new();
    for (i, coin) in utxos.iter().enumerate() {
        let prior_script = hex::decode(field(coin, "script_hex")).unwrap();
        assert_eq!(prior_script, taker_script, "UTXO must belong to test key");
        let value = unsigned(coin, "value");
        assert!(value > LOCK_AMOUNT + FEE);
        let prior = output(value, &prior_script);
        let secret = [0x33 + i as u8; 32]; // devnet proof only; unique per HTLC
        let hash: [u8; 32] = Sha256::digest(secret).into();
        let redeem_script = redeem(&hash, &PublicKey::from_secret_key(&maker),
            &PublicKey::from_secret_key(&taker), refund_height);
        let fund = sign(field(coin, "txid").parse().unwrap(), unsigned(coin, "index") as u32,
            prior, vec![output(LOCK_AMOUNT, &p2sh(&redeem_script)),
                output(value - LOCK_AMOUNT - FEE, &taker_script)],
            0, expiry, &taker_script, &taker, None);
        let spend = if i == 0 {
            sign(fund.hash(), 0, output(LOCK_AMOUNT, &p2sh(&redeem_script)),
                vec![output(LOCK_AMOUNT - FEE, &maker_script)], 0, expiry,
                &redeem_script, &maker, Some((&redeem_script, &secret)))
        } else {
            sign(fund.hash(), 0, output(LOCK_AMOUNT, &p2sh(&redeem_script)),
                vec![output(LOCK_AMOUNT - FEE, &taker_script)], refund_height, expiry,
                &redeem_script, &taker, Some((&redeem_script, &[])))
        };
        result.push(json!({
            "path": if i == 0 { "claim" } else { "refund" },
            "funding_txid": fund.hash().to_string(),
            "funding_hex": hex::encode(fund.zcash_serialize_to_vec().unwrap()),
            "spend_txid": spend.hash().to_string(),
            "spend_hex": hex::encode(spend.zcash_serialize_to_vec().unwrap()),
            "redeem_script_hex": hex::encode(redeem_script),
            "refund_height": refund_height,
        }));
    }
    println!("{}", json!({"network":"catecash-devnet", "tip_height":tip, "swaps":result}));
}
