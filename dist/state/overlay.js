"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateOverlay = void 0;
class StateOverlay {
    created = new Map();
    deleted = new Set();
    baseView;
    constructor(baseView) {
        this.baseView = baseView;
    }
    getUtxo(sourceId, outputIndex) {
        const compositeKey = key(sourceId, outputIndex);
        if (this.deleted.has(compositeKey)) {
            return null;
        }
        return this.created.get(compositeKey) ?? this.baseView.getUtxo(sourceId, outputIndex);
    }
    listUtxosByOwner(owner) {
        const merged = new Map();
        for (const utxo of this.baseView.listUtxosByOwner(owner)) {
            merged.set(key(utxo.sourceId, utxo.outputIndex), utxo);
        }
        for (const [compositeKey, utxo] of this.created.entries()) {
            if (Buffer.compare(utxo.owner, Buffer.from(owner)) === 0) {
                merged.set(compositeKey, utxo);
            }
        }
        for (const compositeKey of this.deleted) {
            merged.delete(compositeKey);
        }
        return [...merged.values()];
    }
    consumeUtxo(sourceId, outputIndex) {
        const compositeKey = key(sourceId, outputIndex);
        this.created.delete(compositeKey);
        this.deleted.add(compositeKey);
    }
    createUtxo(utxo) {
        const compositeKey = key(utxo.sourceId, utxo.outputIndex);
        this.deleted.delete(compositeKey);
        this.created.set(compositeKey, utxo);
    }
}
exports.StateOverlay = StateOverlay;
function key(sourceId, outputIndex) {
    return `${Buffer.from(sourceId).toString('hex')}:${outputIndex}`;
}
