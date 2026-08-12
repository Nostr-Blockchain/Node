"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateCandidatePow = evaluateCandidatePow;
exports.searchWinningNonce = searchWinningNonce;
const node_worker_threads_1 = require("node:worker_threads");
const block_codec_1 = require("../consensus/block-codec");
const nip01_1 = require("../consensus/nip01");
const pow_1 = require("../consensus/pow");
const primitives_1 = require("../consensus/primitives");
function evaluateCandidatePow(input) {
    const eventIdBytes = Buffer.from(input.eventIdHex, 'hex');
    const fixedGateBits = input.fixedGateBits ?? 6;
    if (!(0, primitives_1.hasLeadingZeroBits)(eventIdBytes, fixedGateBits)) {
        return {
            eventIdHex: input.eventIdHex,
            cpuWorkHex: '',
            success: false
        };
    }
    const cpuWork = (0, pow_1.cacheWalkR1)(Buffer.from(input.chainIdHex, 'hex'), Buffer.from(input.parentIdHex, 'hex'), Buffer.from(input.eventIdHex, 'hex'), input.cacheWalkR1);
    return {
        eventIdHex: input.eventIdHex,
        cpuWorkHex: cpuWork.toString('hex'),
        success: (0, pow_1.verifyBlockPow)({
            chainId: Buffer.from(input.chainIdHex, 'hex'),
            parentId: Buffer.from(input.parentIdHex, 'hex'),
            eventId: Buffer.from(input.eventIdHex, 'hex'),
            requiredDifficulty: input.requiredDifficulty,
            nonceGateBits: fixedGateBits,
            cacheWalkR1: input.cacheWalkR1
        })
    };
}
function searchWinningNonce(input) {
    let nonce = BigInt(input.startNonce);
    const nonceStep = BigInt(input.nonceStep);
    for (let attempts = 0; attempts < input.maxAttempts; attempts += 1) {
        const eventIdHex = (0, nip01_1.computeEventId)({
            pubkey: input.minerPubkeyHex,
            created_at: input.createdAt,
            kind: 7343,
            tags: (0, block_codec_1.buildBlockTags)(input.chainIdHex, input.parentIdHex, [...input.txIds], nonce),
            content: '00'
        });
        const result = evaluateCandidatePow({
            chainIdHex: input.chainIdHex,
            parentIdHex: input.parentIdHex,
            eventIdHex,
            requiredDifficulty: input.requiredDifficulty,
            fixedGateBits: input.fixedGateBits,
            cacheWalkR1: input.cacheWalkR1
        });
        if (result.success) {
            return {
                ...result,
                nonce: nonce.toString(10),
                attempts: attempts + 1
            };
        }
        nonce += nonceStep;
    }
    return {
        eventIdHex: '',
        cpuWorkHex: '',
        success: false,
        attempts: input.maxAttempts
    };
}
if (!node_worker_threads_1.isMainThread && node_worker_threads_1.parentPort !== null) {
    node_worker_threads_1.parentPort.on('message', (message) => {
        node_worker_threads_1.parentPort?.postMessage(searchWinningNonce(message));
    });
}
