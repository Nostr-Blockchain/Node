"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256 = sha256;
exports.utf8Bytes = utf8Bytes;
exports.hexToBytes = hexToBytes;
exports.bytesToHex = bytesToHex;
exports.encodeU16 = encodeU16;
exports.encodeU32 = encodeU32;
exports.encodeU64 = encodeU64;
exports.encodeU128 = encodeU128;
exports.encodeU256 = encodeU256;
exports.encodeU136 = encodeU136;
exports.decodeU16 = decodeU16;
exports.decodeU32 = decodeU32;
exports.decodeU32LE = decodeU32LE;
exports.decodeU64 = decodeU64;
exports.decodeU128 = decodeU128;
exports.decodeU136 = decodeU136;
exports.decodeU256 = decodeU256;
exports.compareBytes = compareBytes;
exports.countLeadingZeroBits = countLeadingZeroBits;
exports.countLeadingZeroBitsHex = countLeadingZeroBitsHex;
exports.hasLeadingZeroBits = hasLeadingZeroBits;
exports.leadingZeroBits = leadingZeroBits;
exports.parseCanonicalDecimalU64 = parseCanonicalDecimalU64;
exports.truncDivTowardZero = truncDivTowardZero;
exports.outpointKey = outpointKey;
exports.sortOutpointsCanonical = sortOutpointsCanonical;
const node_crypto_1 = require("node:crypto");
const constants_1 = require("./constants");
const errors_1 = require("./errors");
function sha256(data) {
    return (0, node_crypto_1.createHash)('sha256').update(data).digest();
}
function utf8Bytes(text) {
    return Buffer.from(text, 'utf8');
}
function hexToBytes(hex, expectedLength) {
    if (!/^[0-9a-f]*$/.test(hex) || hex.length % 2 !== 0) {
        throw new errors_1.ConsensusError('BAD_HEX', 'hex must be lowercase and even-length');
    }
    const bytes = Buffer.from(hex, 'hex');
    if (expectedLength !== undefined && bytes.length !== expectedLength) {
        throw new errors_1.ConsensusError('BAD_HEX', `expected ${expectedLength} bytes`);
    }
    return bytes;
}
function bytesToHex(bytes) {
    return Buffer.from(bytes).toString('hex');
}
function encodeU16(value) {
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16BE(value, 0);
    return bytes;
}
function encodeU32(value) {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(value, 0);
    return bytes;
}
function encodeU64(value) {
    if (value < 0n || value > constants_1.MAX_U64) {
        throw new errors_1.ConsensusError('BAD_U64');
    }
    const bytes = Buffer.alloc(8);
    let remaining = value;
    for (let index = 7; index >= 0; index -= 1) {
        bytes[index] = Number(remaining & 0xffn);
        remaining >>= 8n;
    }
    return bytes;
}
function encodeU128(value) {
    if (value < 0n || value > constants_1.MAX_U128) {
        throw new errors_1.ConsensusError('BAD_U128');
    }
    const bytes = Buffer.alloc(16);
    let remaining = value;
    for (let index = 15; index >= 0; index -= 1) {
        bytes[index] = Number(remaining & 0xffn);
        remaining >>= 8n;
    }
    return bytes;
}
function encodeU256(value) {
    if (value < 0n || value >= (1n << 256n)) {
        throw new errors_1.ConsensusError('BAD_U256');
    }
    const bytes = Buffer.alloc(32);
    let remaining = value;
    for (let index = 31; index >= 0; index -= 1) {
        bytes[index] = Number(remaining & 0xffn);
        remaining >>= 8n;
    }
    return bytes;
}
function encodeU136(value) {
    if (value < 0n || value >= (1n << 136n)) {
        throw new errors_1.ConsensusError('BAD_U136');
    }
    const bytes = Buffer.alloc(17);
    let remaining = value;
    for (let index = 16; index >= 0; index -= 1) {
        bytes[index] = Number(remaining & 0xffn);
        remaining >>= 8n;
    }
    return bytes;
}
function decodeU16(bytes, offset) {
    return Buffer.from(bytes).readUInt16BE(offset);
}
function decodeU32(bytes, offset) {
    return Buffer.from(bytes).readUInt32BE(offset);
}
function decodeU32LE(bytes, offset) {
    return Buffer.from(bytes).readUInt32LE(offset);
}
function decodeU64(bytes, offset) {
    let value = 0n;
    for (let index = offset; index < offset + 8; index += 1) {
        value = (value << 8n) | BigInt(bytes[index] ?? 0);
    }
    return value;
}
function decodeU128(bytes, offset) {
    let value = 0n;
    for (let index = offset; index < offset + 16; index += 1) {
        value = (value << 8n) | BigInt(bytes[index] ?? 0);
    }
    return value;
}
function decodeU136(bytes) {
    let value = 0n;
    for (const byte of bytes) {
        value = (value << 8n) | BigInt(byte);
    }
    return value;
}
function decodeU256(bytes, offset = 0) {
    let value = 0n;
    for (let index = offset; index < offset + 32; index += 1) {
        value = (value << 8n) | BigInt(bytes[index] ?? 0);
    }
    return value;
}
function compareBytes(left, right) {
    return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
function countLeadingZeroBits(bytes) {
    let count = 0;
    for (const byte of bytes) {
        if (byte === 0) {
            count += 8;
            continue;
        }
        for (let bit = 7; bit >= 0; bit -= 1) {
            if ((byte & (1 << bit)) === 0) {
                count += 1;
            }
            else {
                return count;
            }
        }
    }
    return count;
}
function countLeadingZeroBitsHex(hex) {
    return countLeadingZeroBits(hexToBytes(hex));
}
function hasLeadingZeroBits(bytes, expectedBits) {
    return countLeadingZeroBits(bytes) >= expectedBits;
}
function leadingZeroBits(bytes) {
    return countLeadingZeroBits(bytes);
}
function parseCanonicalDecimalU64(text) {
    if (!/^(0|[1-9][0-9]*)$/.test(text)) {
        throw new errors_1.ConsensusError('BAD_DECIMAL');
    }
    const value = BigInt(text);
    if (value > constants_1.MAX_U64) {
        throw new errors_1.ConsensusError('BAD_DECIMAL');
    }
    return value;
}
function truncDivTowardZero(dividend, divisor) {
    if (divisor === 0n) {
        throw new errors_1.ConsensusError('BAD_DIVISION');
    }
    return dividend / divisor;
}
function outpointKey(sourceId, outputIndex) {
    return `${bytesToHex(sourceId)}:${outputIndex}`;
}
function sortOutpointsCanonical(outpoints) {
    return [...outpoints].sort((left, right) => {
        const idCompare = compareBytes(left.sourceId, right.sourceId);
        if (idCompare !== 0) {
            return idCompare;
        }
        return left.outputIndex - right.outputIndex;
    });
}
