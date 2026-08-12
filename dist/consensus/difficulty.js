"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateMedianTimePast = calculateMedianTimePast;
exports.calculateCandidateTimestamp = calculateCandidateTimestamp;
exports.calculateNextDifficulty = calculateNextDifficulty;
exports.clampDifficultyBits = clampDifficultyBits;
exports.computeBlockWork = computeBlockWork;
function calculateMedianTimePast(blockId, getBlock) {
    const timestamps = [];
    let cursor = blockId;
    while (cursor !== null && timestamps.length < 11) {
        const block = getBlock(cursor);
        if (block === null) {
            break;
        }
        timestamps.push(block.createdAt);
        cursor = block.parentId;
    }
    timestamps.sort((left, right) => left - right);
    if (timestamps.length === 0) {
        return 0;
    }
    return timestamps[(timestamps.length - 1) >> 1];
}
function calculateCandidateTimestamp(parentBlockId, localUnixTime, getBlock) {
    const medianTimePast = calculateMedianTimePast(parentBlockId, getBlock);
    return Math.max(localUnixTime, medianTimePast + 1);
}
function calculateNextDifficulty(params, candidateHeight, parentBlock, getBlock) {
    if (candidateHeight <= BigInt(params.difficultyWindow)) {
        return params.initialDifficultyBits;
    }
    if ((candidateHeight - 1n) % BigInt(params.difficultyWindow) !== 0n) {
        return parentBlock.requiredDifficulty;
    }
    const startBlock = getAncestor(parentBlock, params.difficultyWindow, getBlock);
    const endMedianTimePast = calculateMedianTimePast(parentBlock.blockId, getBlock);
    const startMedianTimePast = calculateMedianTimePast(startBlock.blockId, getBlock);
    const actualSpan = BigInt(endMedianTimePast - startMedianTimePast);
    if (actualSpan <= 0n) {
        throw new Error('invalid non-positive difficulty timespan');
    }
    const targetSpan = BigInt(params.difficultyWindow * params.targetBlockSeconds);
    let nextDifficulty = parentBlock.requiredDifficulty;
    if (actualSpan * 4n < targetSpan * 3n) {
        nextDifficulty += 1;
    }
    else if (actualSpan * 2n > targetSpan * 3n) {
        nextDifficulty -= 1;
    }
    return clampDifficultyBits(nextDifficulty, params.minDifficultyBits, params.maxDifficultyBits);
}
function clampDifficultyBits(difficultyBits, minimumDifficultyBits, maximumDifficultyBits) {
    if (difficultyBits < minimumDifficultyBits) {
        return minimumDifficultyBits;
    }
    if (difficultyBits > maximumDifficultyBits) {
        return maximumDifficultyBits;
    }
    return difficultyBits;
}
function computeBlockWork(requiredDifficulty) {
    return 1n << BigInt(requiredDifficulty);
}
function getAncestor(block, depth, getBlock) {
    let cursor = block;
    for (let step = 0; step < depth; step += 1) {
        if (cursor === null || cursor.parentId === null) {
            throw new Error('insufficient ancestor history for difficulty retarget');
        }
        cursor = getBlock(cursor.parentId);
    }
    if (cursor === null) {
        throw new Error('missing ancestor history for difficulty retarget');
    }
    return cursor;
}
