"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsensusError = void 0;
exports.assertConsensus = assertConsensus;
class ConsensusError extends Error {
    code;
    constructor(code, message) {
        super(message ?? code);
        this.code = code;
    }
}
exports.ConsensusError = ConsensusError;
function assertConsensus(condition, code, message) {
    if (!condition) {
        throw new ConsensusError(code, message);
    }
}
