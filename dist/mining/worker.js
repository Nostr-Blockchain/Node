"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateCandidatePow = evaluateCandidatePow;
const pow_1 = require("../consensus/pow");
const primitives_1 = require("../consensus/primitives");
function evaluateCandidatePow(input) {
    const eventIdBytes = Buffer.from(input.eventIdHex, 'hex');
    if ((0, primitives_1.leadingZeroBits)(eventIdBytes) < 6) {
        return {
            eventIdHex: input.eventIdHex,
            cpuWorkHex: '',
            success: false
        };
    }
    const cpuWork = (0, pow_1.cacheWalkR1)(Buffer.from(input.chainIdHex, 'hex'), Buffer.from(input.parentIdHex, 'hex'), Buffer.from(input.eventIdHex, 'hex'));
    return {
        eventIdHex: input.eventIdHex,
        cpuWorkHex: cpuWork.toString('hex'),
        success: (0, pow_1.verifyBlockPow)({
            chainId: Buffer.from(input.chainIdHex, 'hex'),
            parentId: Buffer.from(input.parentIdHex, 'hex'),
            eventId: Buffer.from(input.eventIdHex, 'hex'),
            requiredTarget: input.requiredTarget,
            nonceGateBits: 6
        })
    };
}
