"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateGenesisBlock = validateGenesisBlock;
exports.validateBlock = validateBlock;
const constants_1 = require("./constants");
const errors_1 = require("./errors");
const genesis_1 = require("./genesis");
const primitives_1 = require("./primitives");
const block_codec_1 = require("./block-codec");
const pow_1 = require("./pow");
const transaction_validation_1 = require("./transaction-validation");
function validateGenesisBlock(event) {
    const parsed = (0, block_codec_1.parseBlockEvent)(event);
    (0, errors_1.assertConsensus)(parsed.isGenesis, 'BLK_BAD_PARENT');
    return (0, genesis_1.decodeGenesisContent)(event.content);
}
function validateBlock(event, chainIdHex, parentId, candidateHeight, params, transactions, view, cryptoProvider) {
    const parsedBlock = (0, block_codec_1.parseBlockEvent)(event, chainIdHex);
    (0, errors_1.assertConsensus)(!parsedBlock.isGenesis, 'BLK_BAD_PARENT');
    (0, errors_1.assertConsensus)((0, primitives_1.compareBytes)(parsedBlock.parentId, parentId) === 0, 'BLK_BAD_PARENT');
    (0, errors_1.assertConsensus)(parsedBlock.txIds.length <= params.maxBlockTransactions, 'BLK_BAD_TAGS');
    (0, errors_1.assertConsensus)(transactions.length === parsedBlock.txIds.length, 'BLK_TX_DATA_MISSING');
    for (let index = 0; index < transactions.length; index += 1) {
        (0, errors_1.assertConsensus)((0, primitives_1.compareBytes)((0, primitives_1.hexToBytes)(transactions[index].event.id, 32), parsedBlock.txIds[index]) === 0, 'BLK_TX_INVALID');
    }
    const powValid = (0, pow_1.verifyBlockPow)({
        chainId: (0, primitives_1.hexToBytes)(chainIdHex, 32),
        parentId,
        eventId: (0, primitives_1.hexToBytes)(event.id, 32),
        powDifficulty: params.powDifficulty,
        nonceGateBits: Number(parsedBlock.event.tags[parsedBlock.event.tags.length - 1][2])
    });
    (0, errors_1.assertConsensus)(powValid, 'BLK_INSUFFICIENT_POW');
    const txEvaluations = transactions.map((transaction) => (0, transaction_validation_1.validateParsedTransaction)(transaction, candidateHeight, params, cryptoProvider, view));
    const spentOutpoints = new Set();
    for (const evaluation of txEvaluations) {
        for (const consumed of evaluation.consumedOutpoints) {
            const key = `${consumed.sourceId.toString('hex')}:${consumed.outputIndex}`;
            (0, errors_1.assertConsensus)(!spentOutpoints.has(key), 'BLK_DOUBLE_SPEND');
            spentOutpoints.add(key);
        }
    }
    const totalMinimumBurn = txEvaluations.reduce((sum, evaluation) => sum + evaluation.minimumBurn, 0n);
    const totalPriorityFee = txEvaluations.reduce((sum, evaluation) => sum + evaluation.priorityFee, 0n);
    const blockRewardAmount = params.blockReward + totalPriorityFee;
    const rewardOutput = {
        sourceId: Buffer.from(event.id, 'hex'),
        outputIndex: constants_1.REWARD_OUTPUT_INDEX,
        owner: Buffer.from(event.pubkey, 'hex'),
        amount: blockRewardAmount,
        createdHeight: candidateHeight,
        isReward: true
    };
    return {
        parsedBlock,
        txEvaluations,
        consumedOutpoints: txEvaluations.flatMap((evaluation) => evaluation.consumedOutpoints),
        createdTxOutputs: txEvaluations.flatMap((evaluation) => evaluation.createdOutputs),
        rewardOutput,
        totalMinimumBurn,
        totalPriorityFee,
        blockRewardAmount
    };
}
