"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NobleCryptoProvider = void 0;
const secp256k1_1 = require("@noble/curves/secp256k1");
class NobleCryptoProvider {
    isValidXOnlyPublicKey(pubkey32) {
        try {
            const compressed = Buffer.concat([Buffer.from([0x02]), Buffer.from(pubkey32)]);
            secp256k1_1.secp256k1.ProjectivePoint.fromHex(compressed);
            return true;
        }
        catch {
            return false;
        }
    }
    verifySchnorr(pubkey32, message32, signature64) {
        try {
            return secp256k1_1.schnorr.verify(signature64, message32, pubkey32);
        }
        catch {
            return false;
        }
    }
    signSchnorr(secret32, message32) {
        return secp256k1_1.schnorr.sign(message32, secret32);
    }
    deriveXOnlyPublicKey(secret32) {
        return secp256k1_1.schnorr.getPublicKey(secret32);
    }
}
exports.NobleCryptoProvider = NobleCryptoProvider;
