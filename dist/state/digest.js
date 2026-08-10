"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeUtxoDigest = computeUtxoDigest;
const node_crypto_1 = require("node:crypto");
const primitives_1 = require("../consensus/primitives");
function computeUtxoDigest(utxos) {
    const sorted = [...utxos].sort((left, right) => {
        const idCompare = (0, primitives_1.compareBytes)(left.sourceId, right.sourceId);
        if (idCompare !== 0) {
            return idCompare;
        }
        return left.outputIndex - right.outputIndex;
    });
    const hash = (0, node_crypto_1.createHash)('sha256');
    for (const utxo of sorted) {
        hash.update(Buffer.from(utxo.sourceId));
        hash.update((0, primitives_1.encodeU16)(utxo.outputIndex));
        hash.update(Buffer.from(utxo.owner));
        hash.update((0, primitives_1.encodeU128)(utxo.amount));
        hash.update((0, primitives_1.encodeU64)(utxo.createdHeight));
        hash.update(Buffer.from([utxo.isReward ? 1 : 0]));
    }
    return hash.digest('hex');
}
