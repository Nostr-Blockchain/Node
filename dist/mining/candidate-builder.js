"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMiningCandidate = buildMiningCandidate;
exports.updateCandidateNonce = updateCandidateNonce;
const constants_1 = require("../consensus/constants");
const block_codec_1 = require("../consensus/block-codec");
const selection_1 = require("../mempool/selection");
function buildMiningCandidate(chainIdHex, parentIdHex, params, mempool, minerPubkeyHex, createdAt, nonce = 0n) {
    const selectedEntries = (0, selection_1.selectTransactionsForBlock)(parentIdHex, mempool.values(), params);
    const txIds = selectedEntries.map((entry) => entry.txId).sort();
    const event = {
        pubkey: minerPubkeyHex,
        created_at: createdAt,
        kind: constants_1.BLOCK_KIND,
        tags: (0, block_codec_1.buildBlockTags)(chainIdHex, parentIdHex, txIds, nonce),
        content: '00'
    };
    return { parentId: parentIdHex, txIds, pubkey: minerPubkeyHex, createdAt, nonce, event };
}
function updateCandidateNonce(candidate, nonce) {
    const txIds = [...candidate.txIds];
    return {
        ...candidate,
        nonce,
        event: {
            ...candidate.event,
            tags: (0, block_codec_1.buildBlockTags)(candidate.event.tags[0][1].slice('nostr-blockchain:'.length), candidate.parentId, txIds, nonce)
        }
    };
}
