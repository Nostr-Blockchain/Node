"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MissingObjectQueue = void 0;
class MissingObjectQueue {
    entries = new Map();
    maxEntries;
    constructor(maxEntries = 2048) {
        this.maxEntries = maxEntries;
    }
    add(request) {
        const existing = this.entries.get(request.objectId);
        if (existing !== undefined) {
            this.entries.set(request.objectId, {
                ...existing,
                sourceRelayUrl: existing.sourceRelayUrl ?? request.sourceRelayUrl
            });
            return;
        }
        this.entries.set(request.objectId, request);
        this.enforceBounds();
    }
    remove(objectId) {
        this.entries.delete(objectId);
    }
    has(objectId) {
        return this.entries.has(objectId);
    }
    markAttempt(objectId, nowMs) {
        const existing = this.entries.get(objectId);
        if (existing === undefined) {
            return null;
        }
        const attempts = existing.attempts + 1;
        const boundedDelayMs = Math.min(60_000, 1_000 * (2 ** Math.min(attempts, 6)));
        const updated = {
            ...existing,
            attempts,
            nextRetryMs: nowMs + boundedDelayMs
        };
        this.entries.set(objectId, updated);
        return updated;
    }
    listDue(nowMs) {
        return [...this.entries.values()].filter((entry) => entry.nextRetryMs === null || entry.nextRetryMs <= nowMs);
    }
    size() {
        return this.entries.size;
    }
    enforceBounds() {
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (typeof oldest !== 'string') {
                break;
            }
            this.entries.delete(oldest);
        }
    }
}
exports.MissingObjectQueue = MissingObjectQueue;
