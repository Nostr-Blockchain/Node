"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemorySigner = void 0;
const primitives_1 = require("../consensus/primitives");
class InMemorySigner {
    secretKey;
    cryptoProvider;
    publicKeyHex;
    constructor(secretKey, cryptoProvider) {
        this.secretKey = Uint8Array.from(secretKey);
        this.cryptoProvider = cryptoProvider;
        this.publicKeyHex = (0, primitives_1.bytesToHex)(this.cryptoProvider.deriveXOnlyPublicKey(this.secretKey));
    }
    getPublicKeyHex() {
        return this.publicKeyHex;
    }
    signEventId(eventIdHex) {
        return (0, primitives_1.bytesToHex)(this.cryptoProvider.signSchnorr(this.secretKey, Buffer.from(eventIdHex, 'hex')));
    }
}
exports.InMemorySigner = InMemorySigner;
