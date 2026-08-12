"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryUtxoView = void 0;
class MemoryUtxoView {
    utxos = new Map();
    constructor(initialUtxos = []) {
        for (const utxo of initialUtxos) {
            this.setUtxo(utxo);
        }
    }
    getUtxo(sourceId, outputIndex) {
        return this.utxos.get(key(sourceId, outputIndex)) ?? null;
    }
    listUtxosByOwner(owner) {
        return [...this.utxos.values()].filter((utxo) => Buffer.compare(utxo.owner, Buffer.from(owner)) === 0);
    }
    listAllUtxos() {
        return [...this.utxos.values()];
    }
    setUtxo(utxo) {
        this.utxos.set(key(utxo.sourceId, utxo.outputIndex), utxo);
    }
    deleteUtxo(sourceId, outputIndex) {
        this.utxos.delete(key(sourceId, outputIndex));
    }
    snapshot() {
        return [...this.utxos.values()].map((utxo) => ({ ...utxo, sourceId: Buffer.from(utxo.sourceId), owner: Buffer.from(utxo.owner) }));
    }
}
exports.MemoryUtxoView = MemoryUtxoView;
function key(sourceId, outputIndex) {
    return `${Buffer.from(sourceId).toString('hex')}:${outputIndex}`;
}
