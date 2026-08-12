"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeEventForId = serializeEventForId;
exports.computeEventId = computeEventId;
exports.validateNip01Event = validateNip01Event;
exports.validateChainKind = validateChainKind;
const constants_1 = require("./constants");
const errors_1 = require("./errors");
const primitives_1 = require("./primitives");
const EXPECTED_TOP_LEVEL_KEYS = ['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags'];
function serializeEventForId(event) {
    return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
}
function computeEventId(event) {
    return (0, primitives_1.bytesToHex)((0, primitives_1.sha256)((0, primitives_1.utf8Bytes)(serializeEventForId(event))));
}
function validateNip01Event(event, expectedKind, cryptoProvider, errorPrefix) {
    assertRepresentation(typeof event === 'object' && event !== null && !Array.isArray(event), `${errorPrefix}_BAD_JSON`);
    const record = event;
    const keys = Object.keys(record);
    assertRepresentation(keys.length === 7, `${errorPrefix}_BAD_JSON`);
    assertRepresentation(keys.slice().sort().join(',') === EXPECTED_TOP_LEVEL_KEYS.join(','), `${errorPrefix}_BAD_JSON`);
    const nostrEvent = {
        id: stringField(record.id, `${errorPrefix}_BAD_JSON`),
        pubkey: stringField(record.pubkey, `${errorPrefix}_BAD_JSON`),
        created_at: numberField(record.created_at, `${errorPrefix}_BAD_JSON`),
        kind: numberField(record.kind, `${errorPrefix}_BAD_JSON`),
        tags: tagField(record.tags, `${errorPrefix}_BAD_JSON`),
        content: stringField(record.content, `${errorPrefix}_BAD_JSON`),
        sig: stringField(record.sig, `${errorPrefix}_BAD_JSON`)
    };
    assertRepresentation(isLowercaseHexOfLength(nostrEvent.id, 32), `${errorPrefix}_BAD_NIP01_ID`);
    assertRepresentation(isLowercaseHexOfLength(nostrEvent.pubkey, 32), `${errorPrefix}_BAD_JSON`);
    assertRepresentation(isLowercaseHexOfLength(nostrEvent.sig, 64), `${errorPrefix}_BAD_SIGNATURE`);
    assertRepresentation(BigInt(nostrEvent.created_at) >= 0n && BigInt(nostrEvent.created_at) <= constants_1.MAX_SAFE_CREATED_AT, `${errorPrefix}_BAD_JSON`);
    const canonicalEventId = computeEventId({
        pubkey: nostrEvent.pubkey,
        created_at: nostrEvent.created_at,
        kind: nostrEvent.kind,
        tags: nostrEvent.tags,
        content: nostrEvent.content
    });
    assertIntrinsic(Number.isInteger(nostrEvent.kind) && nostrEvent.kind >= 0 && nostrEvent.kind <= 65535, `${errorPrefix}_BAD_KIND`, canonicalEventId);
    assertIntrinsic(nostrEvent.kind === expectedKind, `${errorPrefix}_BAD_KIND`, canonicalEventId);
    assertIntrinsic(cryptoProvider.isValidXOnlyPublicKey((0, primitives_1.hexToBytes)(nostrEvent.pubkey, 32)), `${errorPrefix}_BAD_JSON`, canonicalEventId);
    assertRepresentation(canonicalEventId === nostrEvent.id, `${errorPrefix}_BAD_NIP01_ID`, canonicalEventId);
    const signatureValid = cryptoProvider.verifySchnorr((0, primitives_1.hexToBytes)(nostrEvent.pubkey, 32), (0, primitives_1.hexToBytes)(nostrEvent.id, 32), (0, primitives_1.hexToBytes)(nostrEvent.sig, 64));
    assertRepresentation(signatureValid, `${errorPrefix}_BAD_SIGNATURE`, canonicalEventId);
    return nostrEvent;
}
function validateChainKind(kind) {
    if (kind === constants_1.TX_KIND)
        return 'tx';
    if (kind === constants_1.BLOCK_KIND)
        return 'block';
    throw new errors_1.ConsensusError('BAD_KIND');
}
function stringField(value, code) {
    assertRepresentation(typeof value === 'string', code);
    return value;
}
function numberField(value, code) {
    assertRepresentation(typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && Number.isSafeInteger(value), code);
    return value;
}
function tagField(value, code) {
    assertRepresentation(Array.isArray(value), code);
    return value.map((tag) => {
        assertIntrinsic(Array.isArray(tag), code, null);
        assertIntrinsic(tag.every((entry) => typeof entry === 'string'), code, null);
        return [...tag];
    });
}
function isLowercaseHexOfLength(value, bytes) {
    return value.length === bytes * 2 && /^[0-9a-f]+$/u.test(value);
}
function assertRepresentation(condition, code, canonicalEventId = null) {
    if (!condition) {
        throw new errors_1.ClassifiedConsensusError(code, 'representation-invalid', canonicalEventId, false);
    }
}
function assertIntrinsic(condition, code, canonicalEventId) {
    if (!condition) {
        throw new errors_1.ClassifiedConsensusError(code, 'id-intrinsic-invalid', canonicalEventId, canonicalEventId !== null);
    }
}
