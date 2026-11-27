//! Offline proof of the proposed transparent CATE swap script using the
//! unchanged Zebra script verifier. This does not broadcast or mine blocks.

#[cfg(test)]
mod tests {
    use ripemd::Ripemd160;
    use secp256k1::{Message, PublicKey, SecretKey};
    use sha2::{Digest, Sha256};
    use std::sync::Arc;
    use zebra_chain::{
        block::Height,
        parameters::NetworkUpgrade,
        serialization::{ZcashDeserializeInto, ZcashSerialize},
        transaction::{self, HashType, LockTime, SigHasher, Transaction},
        transparent::{self, Output, Script},
    };
    use zebra_script::CachedFfiTransaction;

    const REFUND_HEIGHT: u32 = 510;
    const AMOUNT: u64 = 1_000_000;
    const CATECASH_BRANCH_ID: u32 = 0xea3b_eeb4;

    fn push(bytes: &[u8], script: &mut Vec<u8>) {
        if bytes.len() <= 75 {
            script.push(bytes.len() as u8);
        } else {
            assert!(bytes.len() <= 255);
            script.extend_from_slice(&[0x4c, bytes.len() as u8]);
        }
        script.extend_from_slice(bytes);
    }

    fn key(byte: u8) -> SecretKey {
        SecretKey::from_secret_bytes([byte; 32]).unwrap()
    }

    fn redeem_script(secret_hash: &[u8; 32], maker: &PublicKey, taker: &PublicKey) -> Vec<u8> {
        let mut script = vec![0x63, 0xa8]; // IF SHA256
        push(secret_hash, &mut script);
        script.push(0x88); // EQUALVERIFY
        push(&maker.serialize(), &mut script);
        script.extend_from_slice(&[0xac, 0x67]); // CHECKSIG ELSE
        // 510 as minimally encoded positive Script number (0x01fe).
        push(&[0xfe, 0x01], &mut script);
        script.extend_from_slice(&[0xb1, 0x75]); // CLTV DROP
        push(&taker.serialize(), &mut script);
        script.extend_from_slice(&[0xac, 0x68]); // CHECKSIG ENDIF
        script
    }

    fn p2sh_script(redeem: &[u8]) -> Script {
        let hash: [u8; 20] = Ripemd160::digest(Sha256::digest(redeem)).into();
        let mut bytes = vec![0xa9, 0x14]; // HASH160 PUSH20
        bytes.extend_from_slice(&hash);
        bytes.push(0x87); // EQUAL
        Script::new(&bytes)
    }

    fn catecash_tx(
        input: transparent::Input,
        destination_script: &[u8],
        lock_time: LockTime,
    ) -> Transaction {
        let template = Transaction::test_v6(
            NetworkUpgrade::Nu7,
            vec![input],
            vec![Output {
                value: (AMOUNT - 10_000).try_into().unwrap(),
                lock_script: Script::new(destination_script),
            }],
            lock_time,
            Height(600),
        );
        let mut bytes = template.zcash_serialize_to_vec().unwrap();
        bytes[8..12].copy_from_slice(&CATECASH_BRANCH_ID.to_le_bytes());
        bytes.as_slice().zcash_deserialize_into().unwrap()
    }

    fn funding_output(redeem: &[u8]) -> Output {
        Output {
            value: AMOUNT.try_into().unwrap(),
            lock_script: p2sh_script(redeem),
        }
    }

    fn input(unlock_script: &[u8]) -> transparent::Input {
        transparent::Input::PrevOut {
            outpoint: transparent::OutPoint {
                hash: transaction::Hash([0x42; 32]),
                index: 0,
            },
            unlock_script: Script::new(unlock_script),
            sequence: u32::MAX - 1,
        }
    }

    fn signed_spend(
        redeem: &[u8],
        signer: &SecretKey,
        secret: Option<&[u8]>,
        height: u32,
        destination_script: &[u8],
    ) -> Transaction {
        let lock_time = LockTime::Height(Height(height));
        let previous_outputs = Arc::new(vec![funding_output(redeem)]);
        let placeholder = catecash_tx(input(&[]), destination_script, lock_time);
        let sighash = SigHasher::new(&placeholder, NetworkUpgrade::Nu7, previous_outputs)
            .unwrap()
            .sighash(HashType::ALL, Some((0, redeem.to_vec())));
        let signature = secp256k1::ecdsa::sign(Message::from_digest(*sighash.as_ref()), signer);
        let mut signature_bytes = signature.serialize_der().to_vec();
        signature_bytes.push(0x01); // SIGHASH_ALL
        let mut unlock = Vec::new();
        push(&signature_bytes, &mut unlock);
        if let Some(secret) = secret {
            push(secret, &mut unlock);
            unlock.push(0x51); // TRUE: claim branch
        } else {
            unlock.push(0x00); // FALSE: refund branch
        }
        push(redeem, &mut unlock);
        catecash_tx(input(&unlock), destination_script, lock_time)
    }

    fn verify(tx: Transaction, redeem: &[u8]) -> bool {
        CachedFfiTransaction::new(
            Arc::new(tx),
            Arc::new(vec![funding_output(redeem)]),
            NetworkUpgrade::Nu7,
        )
        .unwrap()
        .is_valid(0)
        .is_ok()
    }

    #[test]
    fn catecash_claim_and_refund_branches() {
        let maker = key(0x11);
        let taker = key(0x22);
        let secret = [0x33; 32];
        let hash: [u8; 32] = Sha256::digest(secret).into();
        let redeem = redeem_script(
            &hash,
            &PublicKey::from_secret_key(&maker),
            &PublicKey::from_secret_key(&taker),
        );
        let destination = [0x51]; // OP_TRUE; script verification only, not a live payout

        assert!(verify(
            signed_spend(&redeem, &maker, Some(&secret), 0, &destination),
            &redeem
        ));
        assert!(verify(
            signed_spend(&redeem, &taker, None, REFUND_HEIGHT, &destination),
            &redeem
        ));
        assert!(!verify(
            signed_spend(&redeem, &maker, Some(&[0x44; 32]), 0, &destination),
            &redeem
        ));
        assert!(!verify(
            signed_spend(&redeem, &taker, Some(&secret), 0, &destination),
            &redeem
        ));
        assert!(!verify(
            signed_spend(&redeem, &maker, None, REFUND_HEIGHT, &destination),
            &redeem
        ));
        assert!(!verify(
            signed_spend(&redeem, &taker, None, REFUND_HEIGHT - 1, &destination),
            &redeem
        ));
        // The signature commits to the output; changing it after signing fails.
        let signed = signed_spend(&redeem, &maker, Some(&secret), 0, &destination);
        let mut changed_bytes = signed.zcash_serialize_to_vec().unwrap();
        let pos = changed_bytes
            .windows(2)
            .rposition(|window| window == [0x01, 0x51])
            .unwrap();
        changed_bytes[pos + 1] = 0x00;
        let changed = changed_bytes.as_slice().zcash_deserialize_into().unwrap();
        assert!(!verify(changed, &redeem));

        // A signature in Catecash's branch domain cannot be replayed on NU7.
        let mut wrong_branch = signed.zcash_serialize_to_vec().unwrap();
        let nu7: u32 = NetworkUpgrade::Nu7.branch_id().unwrap().into();
        wrong_branch[8..12].copy_from_slice(&nu7.to_le_bytes());
        let wrong_network = wrong_branch.as_slice().zcash_deserialize_into().unwrap();
        assert!(!verify(wrong_network, &redeem));
    }
}
