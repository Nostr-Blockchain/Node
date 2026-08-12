"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeTransactionContent = encodeTransactionContent;
exports.decodeTransactionContent = decodeTransactionContent;
exports.deriveTransactionTags = deriveTransactionTags;
exports.canonicalizeTransactionData = canonicalizeTransactionData;
exports.parseTransactionEvent = parseTransactionEvent;
const constants_1 = require("./constants");
const errors_1 = require("./errors");
const primitives_1 = require("./primitives");
function encodeTransactionContent(data) {
    const parts = [Buffer.from([data.version]), (0, primitives_1.encodeU16)(data.inputs.length)];
    for (const input of data.inputs) {
        parts.push(Buffer.from(input.sourceId));
        parts.push((0, primitives_1.encodeU16)(input.outputIndex));
    }
    parts.push((0, primitives_1.encodeU16)(data.outputs.length));
    for (const output of data.outputs) {
        parts.push(Buffer.from(output.ownerPubkey));
        parts.push((0, primitives_1.encodeU128)(output.amount));
    }
    return Buffer.concat(parts).toString('hex');
}
function decodeTransactionContent(contentHex) {
    const bytes = decodeTransactionContentHex(contentHex);
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
    const expectedLength = 5 + (34 * inputCount) + (48 * outputCount);
    (0, errors_1.assertConsensus)(bytes.length === expectedLength, 'TX_BAD_LENGTH');
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
    return [
        ['t', (0, constants_1.makeChainScope)(chainIdHex)],
        ['v', constants_1.PROTOCOL_VERSION.toString(10)],
        ...data.inputs.map((input) => ['i', Buffer.from(input.sourceId).toString('hex'), canonicalDecimal(input.outputIndex)]),
        ...data.outputs.map((output) => ['p', Buffer.from(output.ownerPubkey).toString('hex')])
    ];
}
function canonicalizeTransactionData(data) {
    return {
        version: data.version,
        inputs: (0, primitives_1.sortOutpointsCanonical)(data.inputs).map((input) => ({
            sourceId: Buffer.from(input.sourceId),
            outputIndex: input.outputIndex
        })),
        outputs: data.outputs.map((output) => ({
            ownerPubkey: Buffer.from(output.ownerPubkey),
            amount: output.amount
        }))
    };
}
function parseTransactionEvent(event, chainIdHex) {
    (0, errors_1.assertConsensus)(event.kind === constants_1.TX_KIND, 'TX_BAD_KIND');
    const data = decodeTransactionContent(event.content);
    (0, errors_1.assertConsensus)(data.version === constants_1.PROTOCOL_VERSION, 'TX_BAD_VERSION');
    assertTransactionTags(event.tags, chainIdHex, data);
    return {
        event,
        data
    };
}
function decodeTransactionContentHex(contentHex) {
    try {
        return (0, primitives_1.hexToBytes)(contentHex);
    }
    catch (error) {
        if (error instanceof errors_1.ConsensusError && error.code === 'BAD_HEX') {
            throw new errors_1.ConsensusError('TX_BAD_CONTENT_HEX');
        }
        throw error;
    }
}
function assertTransactionTags(tags, chainIdHex, data) {
    const expectedLength = 2 + data.inputs.length + data.outputs.length;
    (0, errors_1.assertConsensus)(tags.length === expectedLength, 'TX_BAD_TAGS');
    const scopeTag = tags[0] ?? [];
    (0, errors_1.assertConsensus)(scopeTag.length === 2 && scopeTag[0] === 't' && scopeTag[1] === (0, constants_1.makeChainScope)(chainIdHex), 'TX_BAD_SCOPE');
    const versionTag = tags[1] ?? [];
    (0, errors_1.assertConsensus)(versionTag.length === 2 && versionTag[0] === 'v' && versionTag[1] === constants_1.PROTOCOL_VERSION.toString(10), 'TX_BAD_TAGS');
    for (let index = 0; index < data.inputs.length; index += 1) {
        const tag = tags[index + 2] ?? [];
        const input = data.inputs[index];
        (0, errors_1.assertConsensus)(tag.length === 3
            && tag[0] === 'i'
            && tag[1] === Buffer.from(input.sourceId).toString('hex')
            && tag[2] === canonicalDecimal(input.outputIndex), 'TX_BAD_TAGS');
    }
    for (let index = 0; index < data.outputs.length; index += 1) {
        const tag = tags[data.inputs.length + index + 2] ?? [];
        const output = data.outputs[index];
        (0, errors_1.assertConsensus)(tag.length === 2
            && tag[0] === 'p'
            && tag[1] === Buffer.from(output.ownerPubkey).toString('hex'), 'TX_BAD_TAGS');
    }
}
function canonicalDecimal(value) {
    return value.toString(10);
}
