"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeReferenceEventForId = serializeReferenceEventForId;
exports.computeReferenceEventId = computeReferenceEventId;
exports.verifyReferenceSchnorrEvent = verifyReferenceSchnorrEvent;
exports.signReferenceEvent = signReferenceEvent;
const node_crypto_1 = require("node:crypto");
const secp256k1_1 = require("@noble/curves/secp256k1");
function serializeReferenceEventForId(event) {
    return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
}
function computeReferenceEventId(event) {
    return (0, node_crypto_1.createHash)('sha256').update(Buffer.from(serializeReferenceEventForId(event), 'utf8')).digest('hex');
}
function verifyReferenceSchnorrEvent(event) {
    try {
        return secp256k1_1.schnorr.verify(event.sig, hexToBytes(event.id, 32), hexToBytes(event.pubkey, 32));
    }
    catch {
        return false;
    }
}
function signReferenceEvent(secretKeyHex, event) {
    const id = computeReferenceEventId(event);
    return {
        ...event,
        id,
        sig: Buffer.from(secp256k1_1.schnorr.sign(hexToBytes(id, 32), hexToBytes(secretKeyHex, 32))).toString('hex')
    };
}
function hexToBytes(value, expectedBytes) {
    if (!/^[0-9a-f]+$/u.test(value) || value.length !== expectedBytes * 2) {
        throw new Error(`expected ${expectedBytes} lowercase hex bytes`);
    }
    return Buffer.from(value, 'hex');
}
