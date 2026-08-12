"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClassifiedConsensusError = exports.ConsensusError = void 0;
exports.assertConsensus = assertConsensus;
class ConsensusError extends Error {
    code;
    constructor(code, message) {
        super(message ?? code);
        this.code = code;
    }
}
exports.ConsensusError = ConsensusError;
class ClassifiedConsensusError extends ConsensusError {
    invalidityClass;
    canonicalEventId;
    cacheByEventId;
    constructor(code, invalidityClass, canonicalEventId, cacheByEventId, message) {
        super(code, message);
        this.invalidityClass = invalidityClass;
        this.canonicalEventId = canonicalEventId;
        this.cacheByEventId = cacheByEventId;
    }
}
exports.ClassifiedConsensusError = ClassifiedConsensusError;
function assertConsensus(condition, code, message) {
    if (!condition) {
        throw new ConsensusError(code, message);
    }
}
