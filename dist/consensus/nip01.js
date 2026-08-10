"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeEventForId = serializeEventForId;
exports.computeEventId = computeEventId;
exports.validateNip01Event = validateNip01Event;
exports.validateChainKind = validateChainKind;
const constants_1 = require("./constants");
const errors_1 = require("./errors");
const primitives_1 = require("./primitives");
function serializeEventForId(event) {
    return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
}
function computeEventId(event) {
    return (0, primitives_1.bytesToHex)((0, primitives_1.sha256)((0, primitives_1.utf8Bytes)(serializeEventForId(event))));
}
function validateNip01Event(event, expectedKind, cryptoProvider, errorPrefix) {
    (0, errors_1.assertConsensus)(typeof event === 'object' && event !== null && !Array.isArray(event), `${errorPrefix}_BAD_JSON`);
    const record = event;
    const keys = Object.keys(record);
    (0, errors_1.assertConsensus)(keys.length === 7, `${errorPrefix}_BAD_JSON`);
    const expectedKeys = ['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags'];
    (0, errors_1.assertConsensus)(keys.slice().sort().join(',') === expectedKeys.join(','), `${errorPrefix}_BAD_JSON`);
    const nostrEvent = {
        id: stringField(record.id, `${errorPrefix}_BAD_JSON`),
        pubkey: stringField(record.pubkey, `${errorPrefix}_BAD_JSON`),
        created_at: numberField(record.created_at, `${errorPrefix}_BAD_JSON`),
        kind: numberField(record.kind, `${errorPrefix}_BAD_JSON`),
        tags: tagField(record.tags, `${errorPrefix}_BAD_JSON`),
        content: stringField(record.content, `${errorPrefix}_BAD_JSON`),
        sig: stringField(record.sig, `${errorPrefix}_BAD_JSON`)
    };
    assertHex(nostrEvent.id, 32, `${errorPrefix}_BAD_NIP01_ID`);
    assertHex(nostrEvent.pubkey, 32, `${errorPrefix}_BAD_JSON`);
    assertHex(nostrEvent.sig, 64, `${errorPrefix}_BAD_SIGNATURE`);
    (0, errors_1.assertConsensus)(BigInt(nostrEvent.created_at) >= 0n && BigInt(nostrEvent.created_at) <= constants_1.MAX_SAFE_CREATED_AT, `${errorPrefix}_BAD_JSON`);
    (0, errors_1.assertConsensus)(Number.isInteger(nostrEvent.kind) && nostrEvent.kind >= 0 && nostrEvent.kind <= 65535, `${errorPrefix}_BAD_KIND`);
    (0, errors_1.assertConsensus)(nostrEvent.kind === expectedKind, `${errorPrefix}_BAD_KIND`);
    (0, errors_1.assertConsensus)(cryptoProvider.isValidXOnlyPublicKey((0, primitives_1.hexToBytes)(nostrEvent.pubkey, 32)), `${errorPrefix}_BAD_JSON`);
    const recomputed = computeEventId({
        pubkey: nostrEvent.pubkey,
        created_at: nostrEvent.created_at,
        kind: nostrEvent.kind,
        tags: nostrEvent.tags,
        content: nostrEvent.content
    });
    (0, errors_1.assertConsensus)(recomputed === nostrEvent.id, `${errorPrefix}_BAD_NIP01_ID`);
    const signatureValid = cryptoProvider.verifySchnorr((0, primitives_1.hexToBytes)(nostrEvent.pubkey, 32), (0, primitives_1.hexToBytes)(nostrEvent.id, 32), (0, primitives_1.hexToBytes)(nostrEvent.sig, 64));
    (0, errors_1.assertConsensus)(signatureValid, `${errorPrefix}_BAD_SIGNATURE`);
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
    (0, errors_1.assertConsensus)(typeof value === 'string', code);
    return value;
}
function numberField(value, code) {
    (0, errors_1.assertConsensus)(typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value), code);
    return value;
}
function tagField(value, code) {
    (0, errors_1.assertConsensus)(Array.isArray(value), code);
    return value.map((tag) => {
        (0, errors_1.assertConsensus)(Array.isArray(tag), code);
        (0, errors_1.assertConsensus)(tag.every((entry) => typeof entry === 'string'), code);
        return [...tag];
    });
}
function assertHex(value, bytes, code) {
    (0, errors_1.assertConsensus)(/^[0-9a-f]+$/.test(value), code);
    (0, errors_1.assertConsensus)(value.length === bytes * 2, code);
}
