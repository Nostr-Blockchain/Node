"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlockIndex = void 0;
class BlockIndex {
    entries = new Map();
    children = new Map();
    upsert(entry) {
        const previous = this.entries.get(entry.blockId);
        if (previous !== undefined && previous.parentId !== null) {
            this.children.get(previous.parentId)?.delete(entry.blockId);
        }
        this.entries.set(entry.blockId, { ...entry });
        if (entry.parentId !== null) {
            const siblings = this.children.get(entry.parentId) ?? new Set();
            siblings.add(entry.blockId);
            this.children.set(entry.parentId, siblings);
        }
    }
    get(blockId) {
        return this.entries.get(blockId) ?? null;
    }
    getChildren(blockId) {
        return [...(this.children.get(blockId) ?? new Set())];
    }
    listStateValidTips() {
        return [...this.entries.values()].filter((entry) => {
            if (entry.validationState !== 'STATE_VALID') {
                return false;
            }
            return !this.getChildren(entry.blockId)
                .some((blockId) => this.get(blockId)?.validationState === 'STATE_VALID');
        });
    }
    markInvalidAncestor(rootBlockId) {
        const queue = [...this.getChildren(rootBlockId)];
        while (queue.length > 0) {
            const blockId = queue.shift();
            const entry = this.entries.get(blockId);
            if (entry !== undefined && entry.validationState !== 'INVALID') {
                entry.validationState = 'INVALID_ANCESTOR';
                queue.push(...this.getChildren(blockId));
            }
        }
    }
    all() {
        return [...this.entries.values()].map((entry) => ({ ...entry }));
    }
}
exports.BlockIndex = BlockIndex;
