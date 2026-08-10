"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectTransactionsForBlock = selectTransactionsForBlock;
const node_crypto_1 = require("node:crypto");
const constants_1 = require("../consensus/constants");
const primitives_1 = require("../consensus/primitives");
function selectTransactionsForBlock(parentBlockIdHex, entries, params) {
    const sorted = [...entries].sort((left, right) => {
        if (left.evaluation.priorityFee !== right.evaluation.priorityFee) {
            return left.evaluation.priorityFee > right.evaluation.priorityFee ? -1 : 1;
        }
        const leftKey = tieBreaker(parentBlockIdHex, left.txId);
        const rightKey = tieBreaker(parentBlockIdHex, right.txId);
        return Buffer.compare(leftKey, rightKey);
    });
    const selected = [];
    const spent = new Set();
    let priorityFees = 0n;
    for (const entry of sorted) {
        if (selected.length >= params.maxBlockTransactions) {
            break;
        }
        const conflicts = entry.evaluation.consumedOutpoints.some((utxo) => spent.has((0, primitives_1.outpointKey)(utxo.sourceId, utxo.outputIndex)));
        if (conflicts) {
            continue;
        }
        if (params.blockReward + priorityFees + entry.evaluation.priorityFee > constants_1.MAX_U128) {
            continue;
        }
        selected.push(entry);
        priorityFees += entry.evaluation.priorityFee;
        for (const utxo of entry.evaluation.consumedOutpoints) {
            spent.add((0, primitives_1.outpointKey)(utxo.sourceId, utxo.outputIndex));
        }
    }
    return selected;
}
function tieBreaker(parentBlockIdHex, txIdHex) {
    return (0, node_crypto_1.createHash)('sha256').update(Buffer.from(parentBlockIdHex + txIdHex, 'hex')).digest();
}
