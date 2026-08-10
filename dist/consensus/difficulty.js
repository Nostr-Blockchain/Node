"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeRequiredTarget = computeRequiredTarget;
exports.computeBlockWork = computeBlockWork;
exports.targetToHex = targetToHex;
exports.targetFromHex = targetFromHex;
const primitives_1 = require("./primitives");
const RADIX = 65536n;
const MAX_U256 = (1n << 256n) - 1n;
function computeRequiredTarget(params, genesisCreatedAt, parentCreatedAt, candidateHeight) {
    if (candidateHeight === 0n) {
        return params.initialPowTarget;
    }
    const heightDelta = candidateHeight - 1n;
    const anchorParentTime = BigInt(genesisCreatedAt - params.targetBlockInterval);
    const timeDelta = BigInt(parentCreatedAt) - anchorParentTime;
    const exponent = (0, primitives_1.truncDivTowardZero)((timeDelta - BigInt(params.targetBlockInterval) * (heightDelta + 1n)) * RADIX, BigInt(params.asertHalfLife));
    const numShifts = exponent >> 16n;
    const frac = exponent - (numShifts * RADIX);
    const factor = (((195766423245049n * frac) + (971821376n * frac * frac) + (5127n * frac * frac * frac) + (1n << 47n)) >> 48n) + RADIX;
    let nextTarget = params.initialPowTarget * factor;
    if (numShifts < 0n) {
        nextTarget >>= -numShifts;
    }
    else {
        nextTarget <<= numShifts;
    }
    nextTarget >>= 16n;
    if (nextTarget < 1n) {
        return 1n;
    }
    if (nextTarget > params.powLimitTarget) {
        return params.powLimitTarget;
    }
    return nextTarget;
}
function computeBlockWork(requiredTarget) {
    return (MAX_U256 / (requiredTarget + 1n)) + 1n;
}
function targetToHex(requiredTarget) {
    return (0, primitives_1.encodeU256)(requiredTarget).toString('hex');
}
function targetFromHex(requiredTargetHex) {
    return (0, primitives_1.decodeU256)(Buffer.from(requiredTargetHex, 'hex'));
}
