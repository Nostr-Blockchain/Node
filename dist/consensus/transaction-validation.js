"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateTransactionEvent = validateTransactionEvent;
exports.validateParsedTransaction = validateParsedTransaction;
const constants_1 = require("./constants");
const fees_1 = require("./fees");
const transaction_codec_1 = require("./transaction-codec");
const errors_1 = require("./errors");
const primitives_1 = require("./primitives");
function validateTransactionEvent(event, chainIdHex, candidateHeight, params, cryptoProvider, view) {
    const parsed = (0, transaction_codec_1.parseTransactionEvent)(event, chainIdHex);
    return validateParsedTransaction(parsed, candidateHeight, params, cryptoProvider, view);
}
function validateParsedTransaction(parsed, candidateHeight, params, cryptoProvider, view) {
    const { event } = parsed;
    const data = (0, transaction_codec_1.canonicalizeTransactionData)(parsed.data);
    (0, errors_1.assertConsensus)(data.inputs.length >= 1 && data.inputs.length <= params.maxTxInputs, 'TX_BAD_COUNTS');
    (0, errors_1.assertConsensus)(data.outputs.length >= 1 && data.outputs.length <= params.maxTxOutputs, 'TX_BAD_COUNTS');
    for (let index = 1; index < data.inputs.length; index += 1) {
        const previous = data.inputs[index - 1];
        const current = data.inputs[index];
        const compare = (0, primitives_1.compareBytes)(previous.sourceId, current.sourceId);
        (0, errors_1.assertConsensus)(compare < 0 || (compare === 0 && previous.outputIndex < current.outputIndex), 'TX_INPUT_ORDER');
    }
    const seenOutpoints = new Set();
    const consumedOutpoints = [];
    let sumInputs = 0n;
    for (const input of data.inputs) {
        const key = (0, primitives_1.outpointKey)(input.sourceId, input.outputIndex);
        (0, errors_1.assertConsensus)(!seenOutpoints.has(key), 'TX_DUPLICATE_INPUT');
        seenOutpoints.add(key);
        const utxo = view.getUtxo(input.sourceId, input.outputIndex);
        (0, errors_1.assertConsensus)(utxo !== null, 'TX_INPUT_MISSING');
        (0, errors_1.assertConsensus)((0, primitives_1.compareBytes)(utxo.owner, Buffer.from(event.pubkey, 'hex')) === 0, 'TX_WRONG_OWNER');
        if (utxo.isReward) {
            (0, errors_1.assertConsensus)(candidateHeight - utxo.createdHeight >= BigInt(params.rewardMaturity), 'TX_IMMATURE_REWARD');
        }
        consumedOutpoints.push(utxo);
        sumInputs += utxo.amount;
        (0, errors_1.assertConsensus)(sumInputs <= constants_1.MAX_U128 * BigInt(data.inputs.length), 'TX_VALUE_OVERFLOW');
    }
    const createdOutputs = [];
    let sumOutputs = 0n;
    data.outputs.forEach((output, index) => {
        (0, errors_1.assertConsensus)(output.amount > 0n, 'TX_OUTPUT_ZERO');
        (0, errors_1.assertConsensus)(cryptoProvider.isValidXOnlyPublicKey(output.ownerPubkey), 'TX_BAD_OUTPUT_KEY');
        sumOutputs += output.amount;
        (0, errors_1.assertConsensus)(sumOutputs <= constants_1.MAX_U128 * BigInt(data.outputs.length), 'TX_VALUE_OVERFLOW');
        createdOutputs.push({
            sourceId: Buffer.from(event.id, 'hex'),
            outputIndex: index,
            owner: output.ownerPubkey,
            amount: output.amount,
            createdHeight: candidateHeight,
            isReward: false
        });
    });
    (0, errors_1.assertConsensus)(sumInputs >= sumOutputs, 'TX_OUTPUTS_EXCEED_INPUTS');
    const fees = (0, fees_1.splitFees)(sumInputs, sumOutputs, params, data.inputs.length, data.outputs.length);
    (0, errors_1.assertConsensus)(fees.actualFee >= fees.minimumBurn, 'TX_FEE_TOO_LOW');
    (0, errors_1.assertConsensus)(fees.priorityFee <= constants_1.MAX_U128 - params.blockReward, 'TX_PRIORITY_TOO_LARGE');
    return {
        parsed: {
            ...parsed,
            data
        },
        consumedOutpoints,
        createdOutputs,
        sumInputs,
        sumOutputs,
        actualFee: fees.actualFee,
        minimumBurn: fees.minimumBurn,
        priorityFee: fees.priorityFee
    };
}
