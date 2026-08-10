"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MissingObjectQueue = void 0;
class MissingObjectQueue {
    entries = new Map();
    add(request) {
        this.entries.set(request.objectId, request);
    }
    remove(objectId) {
        this.entries.delete(objectId);
    }
    listDue(nowMs) {
        return [...this.entries.values()].filter((entry) => entry.nextRetryMs === null || entry.nextRetryMs <= nowMs);
    }
}
exports.MissingObjectQueue = MissingObjectQueue;
