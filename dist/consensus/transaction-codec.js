"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeTransactionContent = encodeTransactionContent;
exports.decodeTransactionContent = decodeTransactionContent;
exports.deriveTransactionTags = deriveTransactionTags;
exports.parseTransactionEvent = parseTransactionEvent;
const constants_1 = require("./constants");
const errors_1 = require("./errors");
const primitives_1 = require("./primitives");
function encodeTransactionContent(data) {
    const parts = [Buffer.from([data.version]), Buffer.alloc(2)];
    parts[1].writeUInt16BE(data.inputs.length, 0);
    for (const input of data.inputs) {
        parts.push(Buffer.from(input.sourceId));
        const indexBytes = Buffer.alloc(2);
        indexBytes.writeUInt16BE(input.outputIndex, 0);
        parts.push(indexBytes);
    }
    const outputCount = Buffer.alloc(2);
    outputCount.writeUInt16BE(data.outputs.length, 0);
    parts.push(outputCount);
    for (const output of data.outputs) {
        parts.push(Buffer.from(output.ownerPubkey));
        parts.push((0, primitives_1.encodeU128)(output.amount));
    }
    return Buffer.concat(parts).toString('hex');
}
function decodeTransactionContent(contentHex) {
    const bytes = (0, primitives_1.hexToBytes)(contentHex);
    (0, errors_1.assertConsensus)(bytes.length >= 5, 'TX_BAD_LENGTH');
    const version = bytes[0] ?? 0;
    const inputCount = (0, primitives_1.decodeU16)(bytes, 1);
    let offset = 3;
    const inputs = [];
    for (let index = 0; index < inputCount; index += 1) {
        (0, errors_1.assertConsensus)(offset + 34 <= bytes.length, 'TX_BAD_LENGTH');
        inputs.push({
            sourceId: bytes.subarray(offset, offset + 32),
            outputIndex: (0, primitives_1.decodeU16)(bytes, offset + 32)
        });
        offset += 34;
    }
    (0, errors_1.assertConsensus)(offset + 2 <= bytes.length, 'TX_BAD_LENGTH');
    const outputCount = (0, primitives_1.decodeU16)(bytes, offset);
    offset += 2;
    const outputs = [];
    for (let index = 0; index < outputCount; index += 1) {
        (0, errors_1.assertConsensus)(offset + 48 <= bytes.length, 'TX_BAD_LENGTH');
        outputs.push({
            ownerPubkey: bytes.subarray(offset, offset + 32),
            amount: (0, primitives_1.decodeU128)(bytes, offset + 32)
        });
        offset += 48;
    }
    (0, errors_1.assertConsensus)(offset === bytes.length, 'TX_BAD_LENGTH');
    return { version, inputs, outputs };
}
function deriveTransactionTags(chainIdHex, data) {
    const sourceIds = uniqueSortedHex(data.inputs.map((input) => input.sourceId));
    const owners = uniqueSortedHex(data.outputs.map((output) => output.ownerPubkey));
    return [
        ['t', (0, constants_1.makeChainScope)(chainIdHex)],
        ...sourceIds.map((hex) => ['e', hex]),
        ...owners.map((hex) => ['p', hex])
    ];
}
function parseTransactionEvent(event, chainIdHex) {
    const data = decodeTransactionContent(event.content);
    (0, errors_1.assertConsensus)(data.version === constants_1.PROTOCOL_VERSION, 'TX_BAD_VERSION');
    const expectedTags = deriveTransactionTags(chainIdHex, data);
    (0, errors_1.assertConsensus)(JSON.stringify(event.tags) === JSON.stringify(expectedTags), 'TX_BAD_TAGS');
    return {
        event,
        data,
        uniqueInputSourceIds: uniqueSortedBuffers(data.inputs.map((input) => input.sourceId)),
        uniqueOutputOwners: uniqueSortedBuffers(data.outputs.map((output) => output.ownerPubkey))
    };
}
function uniqueSortedHex(values) {
    return uniqueSortedBuffers(values).map((value) => (0, primitives_1.bytesToHex)(value));
}
function uniqueSortedBuffers(values) {
    const sorted = [...values].sort(primitives_1.compareBytes);
    const unique = [];
    for (const value of sorted) {
        if (unique.length === 0 || (0, primitives_1.compareBytes)(unique[unique.length - 1], value) !== 0) {
            unique.push(value);
        }
    }
    return unique;
}
