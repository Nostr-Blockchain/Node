"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chooseBetterTip = chooseBetterTip;
exports.chooseInitialTip = chooseInitialTip;
const primitives_1 = require("../consensus/primitives");
function chooseBetterTip(currentTip, candidateTip) {
    if (!isComparableTip(candidateTip)) {
        return currentTip;
    }
    if (!isComparableTip(currentTip)) {
        return candidateTip;
    }
    if (candidateTip.cumulativeWork > currentTip.cumulativeWork) {
        return candidateTip;
    }
    return currentTip;
}
function chooseInitialTip(tips) {
    const comparableTips = tips.filter(isComparableTip);
    if (comparableTips.length === 0) {
        return null;
    }
    const bestWork = comparableTips.reduce((best, tip) => tip.cumulativeWork > best ? tip.cumulativeWork : best, comparableTips[0].cumulativeWork);
    const bestTips = comparableTips.filter((tip) => tip.cumulativeWork === bestWork);
    return bestTips.sort((left, right) => (0, primitives_1.compareBytes)(Buffer.from(left.blockId, 'hex'), Buffer.from(right.blockId, 'hex')))[0] ?? null;
}
function isComparableTip(tip) {
    return tip !== null && tip.validationState === 'STATE_VALID' && tip.height !== null && tip.cumulativeWork !== null;
}
