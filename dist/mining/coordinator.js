"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MiningCoordinator = void 0;
exports.buildWorkerSearchInput = buildWorkerSearchInput;
const node_path_1 = __importDefault(require("node:path"));
const node_worker_threads_1 = require("node:worker_threads");
const block_codec_1 = require("../consensus/block-codec");
const nip01_1 = require("../consensus/nip01");
const worker_1 = require("./worker");
class MiningCoordinator {
    static WORKER_BATCH_ATTEMPTS = 25_000;
    enabled;
    mode;
    workerCount;
    generation = 0n;
    pauseReason = null;
    constructor(enabled = true, mode = 'continuous', workerCount = 1) {
        this.enabled = enabled;
        this.mode = mode;
        this.workerCount = workerCount;
        this.pauseReason = enabled ? null : 'DISABLED';
    }
    getStatus() {
        return {
            enabled: this.enabled,
            mode: this.mode,
            workerCount: this.workerCount,
            activeGeneration: this.generation,
            pauseReason: this.pauseReason
        };
    }
    setMode(mode) {
        this.mode = mode;
        this.enabled = mode !== 'disabled';
        this.generation += 1n;
        this.pauseReason = this.enabled ? null : 'DISABLED';
    }
    setPauseReason(pauseReason) {
        this.pauseReason = pauseReason;
    }
    invalidateGeneration() {
        this.generation += 1n;
        return this.generation;
    }
    buildUnsignedWinningBlock(parentIdHex, chainIdHex, networkParams, signer, txIds, requiredDifficulty, createdAt = Math.floor(Date.now() / 1000)) {
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
            const result = (0, worker_1.evaluateCandidatePow)({
                chainIdHex,
                parentIdHex,
                eventIdHex,
                requiredDifficulty,
                fixedGateBits: networkParams.nip13GateBits,
                cacheWalkR1: networkParams.cacheWalkR1
            });
            if (result.success) {
                return {
                    ...event,
                    id: eventIdHex
                };
            }
            nonce += 1n;
        }
    }
    async searchForWinner(input) {
        const workerScriptPath = node_path_1.default.resolve(__dirname, 'worker.js');
        while (input.generation === this.generation) {
            const workers = Array.from({ length: this.workerCount }, (_, workerIndex) => {
                const worker = new node_worker_threads_1.Worker(workerScriptPath);
                const workerInput = buildWorkerSearchInput({
                    chainIdHex: input.chainIdHex,
                    parentIdHex: input.parentIdHex,
                    minerPubkeyHex: input.signer.getPublicKeyHex(),
                    txIds: input.txIds,
                    requiredDifficulty: input.requiredDifficulty,
                    createdAt: input.createdAt,
                    workerIndex,
                    workerCount: this.workerCount,
                    maxAttempts: MiningCoordinator.WORKER_BATCH_ATTEMPTS,
                    fixedGateBits: input.networkParams.nip13GateBits,
                    cacheWalkR1: input.networkParams.cacheWalkR1
                });
                return new Promise((resolve, reject) => {
                    worker.once('message', (result) => resolve({ worker, result }));
                    worker.once('error', reject);
                    worker.postMessage(workerInput);
                });
            });
            const results = await Promise.all(workers);
            try {
                const winner = results.find(({ result }) => result.success);
                if (winner !== undefined) {
                    return winner.result;
                }
            }
            finally {
                await Promise.all(results.map(async ({ worker }) => worker.terminate()));
            }
        }
        return null;
    }
}
exports.MiningCoordinator = MiningCoordinator;
function buildWorkerSearchInput(input) {
    return {
        chainIdHex: input.chainIdHex,
        parentIdHex: input.parentIdHex,
        minerPubkeyHex: input.minerPubkeyHex,
        txIds: input.txIds,
        requiredDifficulty: input.requiredDifficulty,
        createdAt: input.createdAt,
        startNonce: input.workerIndex.toString(10),
        nonceStep: input.workerCount.toString(10),
        maxAttempts: input.maxAttempts,
        fixedGateBits: input.fixedGateBits,
        cacheWalkR1: input.cacheWalkR1
    };
}
