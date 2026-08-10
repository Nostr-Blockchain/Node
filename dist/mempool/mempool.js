"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mempool = void 0;
class Mempool {
    entries = new Map();
    add(entry) {
        this.entries.set(entry.txId, entry);
    }
    remove(txId) {
        this.entries.delete(txId);
    }
    get(txId) {
        return this.entries.get(txId) ?? null;
    }
    values() {
        return [...this.entries.values()];
    }
    size() {
        return this.entries.size;
    }
    replace(entries) {
        this.entries.clear();
        for (const entry of entries) {
            this.entries.set(entry.txId, entry);
        }
    }
    clear() {
        this.entries.clear();
    }
}
exports.Mempool = Mempool;
