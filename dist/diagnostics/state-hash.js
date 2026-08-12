"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeStateHash = computeStateHash;
const node_crypto_1 = require("node:crypto");
const primitives_1 = require("../consensus/primitives");
function computeStateHash(chainIdHex, snapshot, activeDifficulty) {
    const tipId = snapshot.activeTip === null ? Buffer.alloc(32, 0) : (0, primitives_1.hexToBytes)(snapshot.activeTip, 32);
    const payload = Buffer.concat([
        Buffer.from('NostrBlockchain-v0/state', 'ascii'),
        (0, primitives_1.hexToBytes)(chainIdHex, 32),
        (0, primitives_1.encodeU64)(snapshot.activeHeight),
        tipId,
        Buffer.from([activeDifficulty]),
        (0, primitives_1.encodeU128)(snapshot.activeCumulativeWork),
        (0, primitives_1.encodeU128)(snapshot.totalSupply),
        Buffer.from(snapshot.utxoDigest, 'hex')
    ]);
    return (0, node_crypto_1.createHash)('sha256').update(payload).digest('hex');
}
