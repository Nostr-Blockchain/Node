#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSignedTransactionEvent = buildSignedTransactionEvent;
exports.selectSpendableUtxos = selectSpendableUtxos;
exports.buildPaymentPlan = buildPaymentPlan;
const node_crypto_1 = require("node:crypto");
const noble_provider_1 = require("../crypto/noble-provider");
const primitives_1 = require("../consensus/primitives");
const base_1 = require("@scure/base");
const nip01_1 = require("../consensus/nip01");
const transaction_codec_1 = require("../consensus/transaction-codec");
function toNpub(pubkeyHex) {
    const words = base_1.bech32.toWords(Buffer.from(pubkeyHex, 'hex'));
    return base_1.bech32.encode('npub', words, 5000);
}
function buildSignedTransactionEvent(secretHex, chainIdHex, createdAt, data) {
    const provider = new noble_provider_1.NobleCryptoProvider();
    const secret = Buffer.from(secretHex, 'hex');
    const pubkey = (0, primitives_1.bytesToHex)(provider.deriveXOnlyPublicKey(secret));
    const unsigned = {
        pubkey,
        created_at: createdAt,
        kind: 7342,
        tags: (0, transaction_codec_1.deriveTransactionTags)(chainIdHex, data),
        content: (0, transaction_codec_1.encodeTransactionContent)(data)
    };
    const id = (0, nip01_1.computeEventId)(unsigned);
    return {
        ...unsigned,
        id,
        sig: (0, primitives_1.bytesToHex)(provider.signSchnorr(secret, Buffer.from(id, 'hex')))
    };
}
function selectSpendableUtxos(utxos, candidateHeight, rewardMaturity) {
    return utxos.filter((utxo) => !utxo.isReward || candidateHeight - utxo.createdHeight >= BigInt(rewardMaturity));
}
function buildPaymentPlan(utxos, params, candidateHeight, sendAmount, priorityFee) {
    const spendableUtxos = selectSpendableUtxos(utxos, candidateHeight, params.rewardMaturity).sort((left, right) => left.amount < right.amount ? -1 : 1);
    const selectedUtxos = [];
    let selectedAmount = 0n;
    const minimumBurn = params.baseFee + params.inputFee + (params.outputFee * 2n);
    const totalRequired = sendAmount + minimumBurn + priorityFee;
    for (const utxo of spendableUtxos) {
        selectedUtxos.push(utxo);
        selectedAmount += utxo.amount;
        if (selectedAmount >= totalRequired) {
            break;
        }
    }
    if (selectedAmount < totalRequired) {
        throw new Error('insufficient spendable funds');
    }
    return {
        selectedUtxos,
        minimumBurn,
        priorityFee,
        changeAmount: selectedAmount - totalRequired,
        sendAmount
    };
}
function main() {
    const [, , command, ...args] = process.argv;
    const provider = new noble_provider_1.NobleCryptoProvider();
    if (command === 'key') {
        const secret = (0, node_crypto_1.randomBytes)(32);
        const pubkey = provider.deriveXOnlyPublicKey(secret);
        console.log(JSON.stringify({ secret: (0, primitives_1.bytesToHex)(secret), pubkey: (0, primitives_1.bytesToHex)(pubkey), npub: toNpub((0, primitives_1.bytesToHex)(pubkey)) }, null, 2));
        return;
    }
    if (command === 'sign-tx') {
        const [secretHex, chainIdHex, createdAtText, dataJson] = args;
        if (secretHex === undefined || chainIdHex === undefined || createdAtText === undefined || dataJson === undefined) {
            throw new Error('usage: sign-tx <secretHex> <chainIdHex> <createdAt> <transactionDataJson>');
        }
        console.log(JSON.stringify(buildSignedTransactionEvent(secretHex, chainIdHex, Number(createdAtText), JSON.parse(dataJson)), null, 2));
        return;
    }
    console.log(JSON.stringify({ command }, null, 2));
}
main();
