"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSignedTransactionEvent = buildSignedTransactionEvent;
exports.buildWalletTransaction = buildWalletTransaction;
const nip01_1 = require("../consensus/nip01");
const transaction_codec_1 = require("../consensus/transaction-codec");
const transaction_validation_1 = require("../consensus/transaction-validation");
const noble_provider_1 = require("../crypto/noble-provider");
const addresses_1 = require("./addresses");
const amounts_1 = require("./amounts");
const coin_selection_1 = require("./coin-selection");
const cryptoProvider = new noble_provider_1.NobleCryptoProvider();
function buildSignedTransactionEvent(secretHex, chainIdHex, createdAt, data) {
    const signer = {
        getPublicKeyHex() {
            return Buffer.from(cryptoProvider.deriveXOnlyPublicKey(Buffer.from(secretHex, 'hex'))).toString('hex');
        },
        signEventId(eventIdHex) {
            return Buffer.from(cryptoProvider.signSchnorr(Buffer.from(secretHex, 'hex'), Buffer.from(eventIdHex, 'hex'))).toString('hex');
        }
    };
    return signTransactionData(signer, chainIdHex, createdAt, data);
}
function buildWalletTransaction(input) {
    const recipientAmount = (0, amounts_1.parseDecimalAmount)(input.amountText, false);
    const requestedPriorityFee = (0, amounts_1.parseDecimalAmount)(input.priorityFeeText, true);
    const recipientPubkey = (0, addresses_1.parseRecipient)(input.recipientText);
    const selection = (0, coin_selection_1.selectWalletCoins)(input.walletUtxos, input.networkParams, input.candidateHeight, recipientAmount, requestedPriorityFee);
    const data = {
        version: input.networkParams.protocolVersion,
        inputs: selection.selectedUtxos.map((utxo) => ({
            sourceId: Buffer.from(utxo.sourceId),
            outputIndex: utxo.outputIndex
        })),
        outputs: [
            { ownerPubkey: Buffer.from(recipientPubkey), amount: selection.recipientAmount },
            ...(selection.useChangeOutput
                ? [{ ownerPubkey: Buffer.from(input.signer.getPublicKeyHex(), 'hex'), amount: selection.changeAmount }]
                : [])
        ]
    };
    const event = signTransactionData(input.signer, input.chainIdHex, input.createdAt, data);
    (0, nip01_1.validateNip01Event)(event, input.networkParams.txKind, cryptoProvider, 'TX');
    const parsed = (0, transaction_codec_1.parseTransactionEvent)(event, input.chainIdHex);
    const evaluation = (0, transaction_validation_1.validateParsedTransaction)(parsed, input.candidateHeight, toGenesisParams(input.networkParams), cryptoProvider, input.view);
    return {
        event,
        selection,
        recipientPubkeyHex: recipientPubkey.toString('hex'),
        actualFee: evaluation.actualFee
    };
}
function toGenesisParams(networkParams) {
    return {
        protocolVersion: networkParams.protocolVersion,
        blockReward: networkParams.blockReward,
        rewardMaturity: networkParams.rewardMaturity,
        powDifficulty: networkParams.initialDifficultyBits,
        baseFee: networkParams.baseFee,
        inputFee: networkParams.inputFee,
        outputFee: networkParams.outputFee,
        maxTxInputs: networkParams.maxTxInputs,
        maxTxOutputs: networkParams.maxTxOutputs,
        maxBlockTransactions: networkParams.maxBlockTransactions
    };
}
function signTransactionData(signer, chainIdHex, createdAt, data) {
    const unsignedEvent = {
        pubkey: signer.getPublicKeyHex(),
        created_at: createdAt,
        kind: 7342,
        tags: (0, transaction_codec_1.deriveTransactionTags)(chainIdHex, data),
        content: (0, transaction_codec_1.encodeTransactionContent)(data)
    };
    const eventId = (0, nip01_1.computeEventId)(unsignedEvent);
    return {
        ...unsignedEvent,
        id: eventId,
        sig: signer.signEventId(eventId)
    };
}
