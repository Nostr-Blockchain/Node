"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toNpub = toNpub;
exports.parseRecipient = parseRecipient;
const base_1 = require("@scure/base");
const noble_provider_1 = require("../crypto/noble-provider");
const cryptoProvider = new noble_provider_1.NobleCryptoProvider();
function toNpub(pubkeyHex) {
    const words = base_1.bech32.toWords(Buffer.from(pubkeyHex, 'hex'));
    return base_1.bech32.encode('npub', words, 5000);
}
function parseRecipient(recipientText) {
    if (/^[0-9a-f]{64}$/u.test(recipientText)) {
        const recipientPubkey = Buffer.from(recipientText, 'hex');
        if (!cryptoProvider.isValidXOnlyPublicKey(recipientPubkey)) {
            throw new Error('invalid raw recipient pubkey');
        }
        return recipientPubkey;
    }
    try {
        const decoded = base_1.bech32.decode(recipientText, 5000);
        if (decoded.prefix !== 'npub') {
            throw new Error('invalid npub prefix');
        }
        const recipientPubkey = Buffer.from(base_1.bech32.fromWords(decoded.words));
        if (recipientPubkey.length !== 32 || !cryptoProvider.isValidXOnlyPublicKey(recipientPubkey)) {
            throw new Error('invalid npub recipient pubkey');
        }
        return recipientPubkey;
    }
    catch (error) {
        throw new Error(error instanceof Error ? error.message : 'invalid recipient');
    }
}
