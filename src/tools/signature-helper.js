import * as CSL from "@emurgo/cardano-serialization-lib-browser";
import {cbor_to_json} from 'cquisitor_wasm'
import blake2b from "blake2b";



export function checkTxSignature(tx_hex, pubKeyHex, signature_hex) {
    const tx = CSL.FixedTransaction.from_hex(tx_hex);
    const txHash = getTxHash(tx.raw_body()).to_bytes();
    const pubKey = CSL.PublicKey.from_hex(pubKeyHex);
    const signature = CSL.Ed25519Signature.from_hex(signature_hex);
    const isValid = pubKey.verify(txHash, signature);
    return {
        valid: isValid
    };
}

export function checkBlockOrTx(hex) {
    if (isBlock(hex)) {
        return checkBlockTxsSignatures(hex);
    } else if (isTransactions(hex)) {
        return checkTxSignatures(hex)
    } else {
        return {
            Error: "can't parse block or tx"
        };
    }
}

export function checkTxSignatures(tx_hex) {
    const tx = CSL.FixedTransaction.from_hex(tx_hex);
    const txHash = getTxHash(tx.raw_body());
    const auxiliary_data = tx.auxiliary_data();
    const witnessSet = tx.witness_set();

    return checkBodySignatures(txHash, auxiliary_data, witnessSet);
}

export function checkBlockTxsSignatures(block_hex) {
    const txs = getTxsWithWitsAndAuxiliaryFromBlock(block_hex);
    const results = [];
    for (let i = 0; i < txs.length; i++) {
        const tx = txs[i];
        const txHash = getTxHash(fromHexString(tx.bodyHex));
        const auxiliary_data = tx.auxData;
        const witnessSet = tx.witnessSet;
        const result = checkBodySignatures(txHash, auxiliary_data, witnessSet);
        results.push(result);
    }

    return results;
}

function checkBodySignatures(txHash, auxiliary_data, witnessSet) {
    const catalystRegistrationHash = getCatalystRegistrationHash(auxiliary_data);
    const catalystWitnesses = getCatalystWitnesses(auxiliary_data);
    const vkeyWitnesses = getVKeyWitnesses(witnessSet);
    const invalidCatalystWitnesses = validateBytesSignature(catalystRegistrationHash, catalystWitnesses);
    const invalidVkeyWitnesses = validateBytesSignature(txHash.to_bytes(), vkeyWitnesses);

    if (invalidCatalystWitnesses.length > 0 || invalidVkeyWitnesses.length > 0) {
        return {
            valid: false,
            tx_hash: txHash.to_hex(),
            invalidCatalystWitnesses: witnessesListToSignaturesList(invalidCatalystWitnesses),
            invalidVkeyWitnesses: witnessesListToSignaturesList(invalidVkeyWitnesses)
        };
    }

    return {
        valid: true,
        tx_hash: txHash.to_hex(),
    };
}

function getTxHash(body_bytes) {
    return CSL.TransactionHash.from_bytes(blake2b(32).update(body_bytes).digest('binary'));
}

function getCatalystWitnesses(auxiliary_data) {
    if (auxiliary_data == null) {
        return null;
    }

    const catalystMeta = auxiliary_data.metadata().get(CSL.BigNum.from_str("61284"));
    const catalystMetaSign = auxiliary_data.metadata().get(CSL.BigNum.from_str("61285"));
    if (catalystMeta == null || catalystMetaSign == null) {
        return null;
    }

    try {
        const stakePubKeyBytes = catalystMeta.as_map()
            .get(CSL.TransactionMetadatum.new_int(CSL.Int.from_str("2"))).as_bytes();
        const signatureBytes = catalystMetaSign.as_map()
            .get(CSL.TransactionMetadatum.new_int(CSL.Int.from_str("1"))).as_bytes();
        const stakePubKey = CSL.PublicKey.from_bytes(stakePubKeyBytes);
        const signature = CSL.Ed25519Signature.from_bytes(signatureBytes);
        return [{
            pubKey: stakePubKey,
            signature: signature
        }];
    } catch (e) {
        throw new Error("Catalyst metadata is not valid");
    }
}

function getVKeyWitnesses(witnessSet)
{
    const vkeyWitnesses = [];
    if (witnessSet == null) {
        return vkeyWitnesses;
    }

    const vkeys = witnessSet.vkeys();

    if (vkeys == null) {
        return vkeyWitnesses;
    }

    for (let i = 0; i < vkeys.len(); i++) {
        const vkeyWitness = vkeys.get(i);
        vkeyWitnesses.push({
            pubKey: vkeyWitness.vkey().public_key(),
            signature: vkeyWitness.signature()
        });
    }
    return vkeyWitnesses;
}

function validateBytesSignature(bytes_to_verify, vkeyWitnesses)  {
    const invalidWitnesses = [];

    if (vkeyWitnesses == null) {
        return invalidWitnesses;
    }

    for (let i = 0; i < vkeyWitnesses.length; i++) {
        const vkeyWitness = vkeyWitnesses[i];
        const isValid = vkeyWitness.pubKey.verify(bytes_to_verify, vkeyWitness.signature);
        if (!isValid) {
            invalidWitnesses.push(vkeyWitness);
        }
    }
    return invalidWitnesses;
}

function witnessesListToSignaturesList(witnesses) {
    const signatures = [];
    if (witnesses == null) {
        return signatures;
    }

    for (let i = 0; i < witnesses.length; i++) {
        const witness = witnesses[i];
        signatures.push(witness.signature.to_hex());
    }
    return signatures;
}

function getCatalystRegistrationHash(auxiliary_data) {
    if (auxiliary_data == null) {
        return null;
    }

    const catalystMeta = auxiliary_data.metadata().get(CSL.BigNum.from_str("61284"));
    if (catalystMeta == null) {
        return null;
    }

    const generalMeta = CSL.GeneralTransactionMetadata.new();
    generalMeta.insert(CSL.BigNum.from_str("61284"), catalystMeta);
    return blake2b(32).update(generalMeta.to_bytes()).digest('binary')
}

function isBlock(hex) {
    try {
        CSL.Block.from_hex(hex);
        return true;
    } catch (e) {
        return false;
    }
}

function isTransactions(hex) {
    try {
        CSL.Transaction.from_hex(hex);
        return true;
    } catch (e) {
        return false;
    }
}

function getTxsWithWitsAndAuxiliaryFromBlock(block_hex) {
    let block = JSON.parse(cbor_to_json(block_hex))[0];
    let bodies = block.values[1].values;
    let wits = block.values[2].values;
    let aux = block.values[3].values;
    const txsWithWitsAndAuxiliary = []
    for (let i = 0; i < bodies.length; i++) {
        if (bodies[i].type  === "Break") {
            continue;
        }
        const bodyLocation = bodies[i].struct_position_info;
        const witLocation = wits[i].struct_position_info;
        const aux_dataLocation = getAuxiliaryDataLocation(aux, i);
        const bodyHex  = block_hex.slice(bodyLocation.offset * 2,
            (bodyLocation.offset + bodyLocation.length) * 2);
        const witHex = block_hex.slice(witLocation.offset * 2,
            (witLocation.offset + witLocation.length) * 2);
        const aux_dataHex = getAuxiliaryHex(block_hex, aux_dataLocation);

        txsWithWitsAndAuxiliary.push({
            bodyHex: bodyHex,
            witnessSet: CSL.TransactionWitnessSet.from_hex(witHex),
            auxData: getAuxiliaryData(aux_dataHex)
        });
    }

    return txsWithWitsAndAuxiliary;
}

function getAuxiliaryDataLocation(aux_cbor_json, index) {
    for (let i = 0; i < aux_cbor_json.length; i++) {
        const aux = aux_cbor_json[i];
        if (aux.key.value === index) {
            return aux.value.struct_position_info;
        }
    }
    return null;
}

function getAuxiliaryHex(body_hex, position_info) {
    if (position_info == null) {
        return null;
    }

    return body_hex.slice(position_info.offset * 2,
        (position_info.offset + position_info.length) * 2);
}

function getAuxiliaryData(auxiliary_data_hex) {
    if (auxiliary_data_hex == null) {
        return null;
    }

    return CSL.AuxiliaryData.from_hex(auxiliary_data_hex);
}

function fromHexString (hexString) {
   return Uint8Array.from(hexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
}
