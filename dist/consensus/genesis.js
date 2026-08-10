"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFORMANCE_GENESIS_PARAMS = void 0;
exports.encodeGenesisContent = encodeGenesisContent;
exports.decodeGenesisContent = decodeGenesisContent;
exports.validateGenesisParams = validateGenesisParams;
exports.validateGenesisEvent = validateGenesisEvent;
exports.buildUnsignedGenesisEvent = buildUnsignedGenesisEvent;
const constants_1 = require("./constants");
const errors_1 = require("./errors");
const nip01_1 = require("./nip01");
const primitives_1 = require("./primitives");
const pow_1 = require("./pow");
exports.CONFORMANCE_GENESIS_PARAMS = {
    protocolVersion: 0,
    blockReward: 5000000000n,
    rewardMaturity: 10,
    powDifficulty: 8,
    baseFee: 1000n,
    inputFee: 250n,
    outputFee: 500n,
    maxTxInputs: 32,
    maxTxOutputs: 32,
    maxBlockTransactions: 64
};
function encodeGenesisContent(params) {
    validateGenesisParams(params);
    const bytes = Buffer.concat([
        Buffer.from([params.protocolVersion]),
        (0, primitives_1.encodeU128)(params.blockReward),
        Buffer.from([(params.rewardMaturity >>> 24) & 0xff, (params.rewardMaturity >>> 16) & 0xff, (params.rewardMaturity >>> 8) & 0xff, params.rewardMaturity & 0xff]),
        Buffer.from([params.powDifficulty]),
        (0, primitives_1.encodeU128)(params.baseFee),
        (0, primitives_1.encodeU128)(params.inputFee),
        (0, primitives_1.encodeU128)(params.outputFee),
        Buffer.from([(params.maxTxInputs >>> 8) & 0xff, params.maxTxInputs & 0xff]),
        Buffer.from([(params.maxTxOutputs >>> 8) & 0xff, params.maxTxOutputs & 0xff]),
        Buffer.from([(params.maxBlockTransactions >>> 8) & 0xff, params.maxBlockTransactions & 0xff])
    ]);
    return bytes.toString('hex');
}
function decodeGenesisContent(contentHex) {
    const bytes = (0, primitives_1.hexToBytes)(contentHex, 76);
    const params = {
        protocolVersion: bytes[0] ?? 0,
        blockReward: (0, primitives_1.decodeU128)(bytes, 1),
        rewardMaturity: (0, primitives_1.decodeU32)(bytes, 17),
        powDifficulty: bytes[21] ?? 0,
        baseFee: (0, primitives_1.decodeU128)(bytes, 22),
        inputFee: (0, primitives_1.decodeU128)(bytes, 38),
        outputFee: (0, primitives_1.decodeU128)(bytes, 54),
        maxTxInputs: (0, primitives_1.decodeU16)(bytes, 70),
        maxTxOutputs: (0, primitives_1.decodeU16)(bytes, 72),
        maxBlockTransactions: (0, primitives_1.decodeU16)(bytes, 74)
    };
    validateGenesisParams(params);
    return params;
}
function validateGenesisParams(params) {
    (0, errors_1.assertConsensus)(params.protocolVersion === constants_1.PROTOCOL_VERSION, 'BLK_BAD_CONTENT');
    (0, errors_1.assertConsensus)(params.blockReward > 0n, 'BLK_BAD_CONTENT');
    (0, errors_1.assertConsensus)(params.rewardMaturity >= 1, 'BLK_BAD_CONTENT');
    (0, errors_1.assertConsensus)(params.powDifficulty >= 1 && params.powDifficulty <= 255, 'BLK_BAD_CONTENT');
    (0, errors_1.assertConsensus)(params.baseFee > 0n, 'BLK_BAD_CONTENT');
    (0, errors_1.assertConsensus)(params.maxTxInputs >= 1 && params.maxTxInputs <= constants_1.MAX_TX_INPUTS_ABSOLUTE, 'BLK_BAD_CONTENT');
    (0, errors_1.assertConsensus)(params.maxTxOutputs >= 1 && params.maxTxOutputs <= constants_1.MAX_TX_OUTPUTS_ABSOLUTE, 'BLK_BAD_CONTENT');
    (0, errors_1.assertConsensus)(params.maxBlockTransactions >= 1 && params.maxBlockTransactions <= constants_1.MAX_BLOCK_TRANSACTIONS_ABSOLUTE, 'BLK_BAD_CONTENT');
}
function validateGenesisEvent(event, cryptoProvider) {
    (0, errors_1.assertConsensus)(event.kind === constants_1.BLOCK_KIND, 'BLK_BAD_KIND');
    (0, errors_1.assertConsensus)(event.tags.length === 2, 'BLK_BAD_TAGS');
    (0, errors_1.assertConsensus)(event.tags[0]?.[0] === 't' && event.tags[0]?.[1] === constants_1.GENESIS_SCOPE && event.tags[0]?.length === 2, 'BLK_BAD_SCOPE');
    assertNonceTag(event.tags[1] ?? [], 'BLK_BAD_NONCE');
    const params = decodeGenesisContent(event.content);
    const nonce = (0, primitives_1.parseCanonicalDecimalU64)(event.tags[1][1]);
    void nonce;
    const powValid = (0, pow_1.verifyBlockPow)({
        chainId: (0, primitives_1.hexToBytes)(event.id, 32),
        parentId: Buffer.alloc(32, 0),
        eventId: (0, primitives_1.hexToBytes)(event.id, 32),
        powDifficulty: params.powDifficulty,
        nonceGateBits: Number(event.tags[1][2])
    });
    (0, errors_1.assertConsensus)(powValid, 'BLK_INSUFFICIENT_POW');
    (0, errors_1.assertConsensus)((0, nip01_1.computeEventId)({
        pubkey: event.pubkey,
        created_at: event.created_at,
        kind: event.kind,
        tags: event.tags,
        content: event.content
    }) === event.id, 'BLK_BAD_NIP01_ID');
    return params;
}
function buildUnsignedGenesisEvent(input) {
    return {
        pubkey: input.minerPubkey,
        created_at: input.createdAt,
        kind: constants_1.BLOCK_KIND,
        tags: [
            ['t', constants_1.GENESIS_SCOPE],
            ['nonce', input.nonce.toString(10), constants_1.NIP13_GATE_BITS.toString(10)]
        ],
        content: encodeGenesisContent(input.params)
    };
}
function assertNonceTag(tag, code) {
    (0, errors_1.assertConsensus)(tag.length === 3 && tag[0] === 'nonce', code);
    (0, primitives_1.parseCanonicalDecimalU64)(tag[1] ?? '');
    (0, errors_1.assertConsensus)(tag[2] === constants_1.NIP13_GATE_BITS.toString(10), 'BLK_BAD_DIFFICULTY');
}
