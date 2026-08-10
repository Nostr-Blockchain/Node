"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MiningCoordinator = void 0;
const nip01_1 = require("../consensus/nip01");
const block_codec_1 = require("../consensus/block-codec");
const worker_1 = require("./worker");
const difficulty_1 = require("../consensus/difficulty");
class MiningCoordinator {
    enabled;
    mode;
    workerCount;
    generation = 0n;
    constructor(enabled = true, mode = 'continuous', workerCount = 1) {
        this.enabled = enabled;
        this.mode = mode;
        this.workerCount = workerCount;
    }
    getStatus() {
        return {
            enabled: this.enabled,
            mode: this.mode,
            workerCount: this.workerCount,
            activeGeneration: this.generation,
            pauseReason: this.enabled ? null : 'disabled'
        };
    }
    setMode(mode) {
        this.mode = mode;
        this.enabled = mode !== 'disabled';
        this.generation += 1n;
    }
    buildUnsignedWinningBlock(parentIdHex, chainIdHex, params, signer, txIds, genesisCreatedAt, parentCreatedAt, candidateHeight, createdAt = Math.floor(Date.now() / 1000)) {
        const requiredTarget = (0, difficulty_1.computeRequiredTarget)(params, genesisCreatedAt, parentCreatedAt, candidateHeight);
        let nonce = 0n;
        for (;;) {
            const event = {
                pubkey: signer.getPublicKeyHex(),
                created_at: createdAt,
                kind: 7343,
                tags: (0, block_codec_1.buildBlockTags)(chainIdHex, parentIdHex, txIds, nonce),
                content: '00'
            };
            const eventIdHex = (0, nip01_1.computeEventId)(event);
            const result = (0, worker_1.evaluateCandidatePow)({ chainIdHex, parentIdHex, eventIdHex, requiredTarget });
            if (result.success) {
                return {
                    ...event,
                    id: eventIdHex
                };
            }
            nonce += 1n;
        }
    }
}
exports.MiningCoordinator = MiningCoordinator;
