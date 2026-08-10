"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildReorgPlan = buildReorgPlan;
function buildReorgPlan(index, currentTipId, candidateTipId) {
    const currentPath = currentTipId === null ? [] : collectPathToGenesis(index, currentTipId);
    const candidatePath = collectPathToGenesis(index, candidateTipId);
    const currentSet = new Set(currentPath);
    let commonAncestorId = null;
    for (const blockId of candidatePath) {
        if (currentSet.has(blockId)) {
            commonAncestorId = blockId;
            break;
        }
    }
    const disconnectIds = [];
    for (const blockId of currentPath) {
        if (blockId === commonAncestorId) {
            break;
        }
        disconnectIds.push(blockId);
    }
    const connectIds = candidatePath
        .slice(0, commonAncestorId === null ? candidatePath.length : candidatePath.indexOf(commonAncestorId))
        .reverse();
    return { commonAncestorId, disconnectIds, connectIds };
}
function collectPathToGenesis(index, tipId) {
    const path = [];
    let currentId = tipId;
    while (currentId !== null) {
        path.push(currentId);
        currentId = index.get(currentId)?.parentId ?? null;
    }
    return path;
}
