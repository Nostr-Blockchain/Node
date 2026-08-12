"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalSignerProvider = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const noble_provider_1 = require("../crypto/noble-provider");
const primitives_1 = require("../consensus/primitives");
const signer_1 = require("../mining/signer");
const ncryptsec_1 = require("./ncryptsec");
class LocalSignerProvider {
    signerPath;
    cryptoProvider = new noble_provider_1.NobleCryptoProvider();
    unlockedSigner = null;
    constructor(signerPath) {
        this.signerPath = signerPath;
    }
    ensureSignerFile(password) {
        if (node_fs_1.default.existsSync(this.signerPath)) {
            throw new Error(`refusing to overwrite existing signer key: ${this.signerPath}`);
        }
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(this.signerPath), { recursive: true });
        const secretKeyHex = (0, ncryptsec_1.generateSecretKeyHex)();
        const secretKey = (0, primitives_1.hexToBytes)(secretKeyHex, 32);
        const pubkeyHex = (0, primitives_1.bytesToHex)(this.cryptoProvider.deriveXOnlyPublicKey(secretKey));
        const encrypted = (0, ncryptsec_1.createNcryptsec)(secretKey, password, 0x01);
        (0, ncryptsec_1.writeNcryptsecFile)(this.signerPath, encrypted);
        secretKey.fill(0);
        return { signerPath: this.signerPath, pubkeyHex };
    }
    unlock(password) {
        (0, ncryptsec_1.validateSignerFilePermissions)(this.signerPath);
        const encodedKey = (0, ncryptsec_1.readNcryptsecFile)(this.signerPath);
        const decryptedKey = (0, ncryptsec_1.decryptNcryptsec)(encodedKey, password);
        this.unlockedSigner = new signer_1.InMemorySigner(decryptedKey.secretKey, this.cryptoProvider);
        decryptedKey.secretKey.fill(0);
        return this.unlockedSigner.getPublicKeyHex();
    }
    lock() {
        this.unlockedSigner = null;
    }
    getState() {
        if (!node_fs_1.default.existsSync(this.signerPath)) {
            return 'UNAVAILABLE';
        }
        return this.unlockedSigner === null ? 'LOCKED' : 'UNLOCKED';
    }
    getUnlockedSigner() {
        return this.unlockedSigner;
    }
    readPublicKey(password) {
        (0, ncryptsec_1.validateSignerFilePermissions)(this.signerPath);
        const encodedKey = (0, ncryptsec_1.readNcryptsecFile)(this.signerPath);
        const decryptedKey = (0, ncryptsec_1.decryptNcryptsec)(encodedKey, password);
        try {
            return (0, primitives_1.bytesToHex)(this.cryptoProvider.deriveXOnlyPublicKey(decryptedKey.secretKey));
        }
        finally {
            decryptedKey.secretKey.fill(0);
        }
    }
    getSignerPath() {
        return this.signerPath;
    }
    checkReadable() {
        (0, ncryptsec_1.validateSignerFilePermissions)(this.signerPath);
        const encodedKey = (0, ncryptsec_1.readNcryptsecFile)(this.signerPath);
        if (!encodedKey.startsWith('ncryptsec1')) {
            throw new Error('signer file does not contain ncryptsec data');
        }
    }
}
exports.LocalSignerProvider = LocalSignerProvider;
