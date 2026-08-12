"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chooseBetterTip = chooseBetterTip;
exports.chooseInitialTip = chooseInitialTip;
exports.choosePreferredTip = choosePreferredTip;
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
    const comparableTips = tips.filter((tip) => isComparableTip(tip) && tip.height > 0n);
    if (comparableTips.length === 0) {
        return null;
    }
    const bestWork = comparableTips.reduce((bestWorkValue, tip) => tip.cumulativeWork > bestWorkValue ? tip.cumulativeWork : bestWorkValue, comparableTips[0].cumulativeWork);
    const bestTips = comparableTips.filter((tip) => tip.cumulativeWork === bestWork);
    return bestTips.sort((left, right) => (0, primitives_1.compareBytes)(Buffer.from(left.blockId, 'hex'), Buffer.from(right.blockId, 'hex')))[0] ?? null;
}
function choosePreferredTip(tips, preferredTipId) {
    const initialTip = chooseInitialTip(tips);
    if (initialTip === null || preferredTipId === null) {
        return initialTip;
    }
    const preferredTip = tips.find((tip) => tip.blockId === preferredTipId) ?? null;
    if (!isComparableTip(preferredTip) || preferredTip.height === 0n) {
        return initialTip;
    }
    return preferredTip.cumulativeWork === initialTip.cumulativeWork ? preferredTip : initialTip;
}
function isComparableTip(tip) {
    return tip !== null && tip.validationState === 'STATE_VALID' && tip.height !== null && tip.cumulativeWork !== null;
}
