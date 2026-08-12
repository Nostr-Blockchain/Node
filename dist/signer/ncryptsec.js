"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNcryptsec = createNcryptsec;
exports.decryptNcryptsec = decryptNcryptsec;
exports.readNcryptsecFile = readNcryptsecFile;
exports.writeNcryptsecFile = writeNcryptsecFile;
exports.validateSignerFilePermissions = validateSignerFilePermissions;
exports.generateSecretKeyHex = generateSecretKeyHex;
exports.readLegacyOrNcryptsecSecret = readLegacyOrNcryptsecSecret;
const node_fs_1 = __importDefault(require("node:fs"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const base_1 = require("@scure/base");
const chacha_1 = require("@noble/ciphers/chacha");
const scrypt_1 = require("@noble/hashes/scrypt");
const primitives_1 = require("../consensus/primitives");
const NCRYPTSEC_PREFIX = 'ncryptsec';
const NCRYPTSEC_VERSION = 0x02;
const NCRYPTSEC_SALT_BYTES = 16;
const NCRYPTSEC_NONCE_BYTES = 24;
const NCRYPTSEC_LOG_N = 16;
const NCRYPTSEC_DERIVED_KEY_BYTES = 32;
const NCRYPTSEC_SCRYPT_R = 8;
const NCRYPTSEC_SCRYPT_P = 1;
const NCRYPTSEC_MAX_MEMORY = (2 ** 30) + 1024;
function createNcryptsec(secretKey, password, keySecurityByte = 0x01) {
    if (secretKey.length !== 32) {
        throw new Error('signer secret key must be exactly 32 bytes');
    }
    const normalizedPassword = normalizePassword(password);
    const salt = node_crypto_1.default.randomBytes(NCRYPTSEC_SALT_BYTES);
    const nonce = node_crypto_1.default.randomBytes(NCRYPTSEC_NONCE_BYTES);
    const symmetricKey = deriveSymmetricKey(normalizedPassword, salt, NCRYPTSEC_LOG_N);
    try {
        const cipher = (0, chacha_1.xchacha20poly1305)(symmetricKey, nonce, Uint8Array.of(keySecurityByte));
        const ciphertext = cipher.encrypt(secretKey);
        const encodedPayload = Buffer.concat([
            Buffer.from([NCRYPTSEC_VERSION]),
            Buffer.from([NCRYPTSEC_LOG_N]),
            Buffer.from(salt),
            Buffer.from(nonce),
            Buffer.from([keySecurityByte]),
            Buffer.from(ciphertext)
        ]);
        return base_1.bech32.encode(NCRYPTSEC_PREFIX, base_1.bech32.toWords(encodedPayload), 5000);
    }
    finally {
        symmetricKey.fill(0);
    }
}
function decryptNcryptsec(ncryptsec, password) {
    const { prefix, words } = base_1.bech32.decode(ncryptsec, 5000);
    if (prefix !== NCRYPTSEC_PREFIX) {
        throw new Error('signer key must use ncryptsec prefix');
    }
    const payload = Buffer.from(base_1.bech32.fromWords(words));
    if (payload.length !== 91) {
        throw new Error('ncryptsec payload must be exactly 91 bytes');
    }
    const version = payload[0] ?? 0;
    if (version !== NCRYPTSEC_VERSION) {
        throw new Error(`unsupported ncryptsec version: ${version}`);
    }
    const logN = payload[1] ?? 0;
    const salt = payload.subarray(2, 18);
    const nonce = payload.subarray(18, 42);
    const keySecurityByte = payload[42] ?? 0x02;
    const ciphertext = payload.subarray(43);
    const symmetricKey = deriveSymmetricKey(normalizePassword(password), salt, logN);
    try {
        const cipher = (0, chacha_1.xchacha20poly1305)(symmetricKey, nonce, Uint8Array.of(keySecurityByte));
        const secretKey = cipher.decrypt(ciphertext);
        if (secretKey.length !== 32) {
            throw new Error('decrypted signer secret must be exactly 32 bytes');
        }
        return {
            secretKey: Uint8Array.from(secretKey),
            keySecurityByte,
            logN
        };
    }
    finally {
        symmetricKey.fill(0);
    }
}
function readNcryptsecFile(filePath) {
    return node_fs_1.default.readFileSync(filePath, 'utf8').trim();
}
function writeNcryptsecFile(filePath, ncryptsec) {
    node_fs_1.default.writeFileSync(filePath, `${ncryptsec}\n`, { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') {
        node_fs_1.default.chmodSync(filePath, 0o600);
    }
}
function validateSignerFilePermissions(filePath) {
    const stats = node_fs_1.default.statSync(filePath);
    if (process.platform === 'win32') {
        return;
    }
    if ((stats.mode & 0o077) !== 0) {
        throw new Error(`signer secret file permissions are too broad: ${filePath}`);
    }
}
function generateSecretKeyHex() {
    for (;;) {
        const secretKey = node_crypto_1.default.randomBytes(32);
        if (!secretKey.equals(Buffer.alloc(32, 0))) {
            return (0, primitives_1.bytesToHex)(secretKey);
        }
    }
}
function readLegacyOrNcryptsecSecret(filePath, password) {
    const fileText = node_fs_1.default.readFileSync(filePath, 'utf8').trim();
    if (/^[0-9a-f]{64}$/u.test(fileText)) {
        return (0, primitives_1.hexToBytes)(fileText, 32);
    }
    if (password === null) {
        throw new Error('encrypted signer key requires a password source');
    }
    return decryptNcryptsec(fileText, password).secretKey;
}
function deriveSymmetricKey(password, salt, logN) {
    return (0, scrypt_1.scrypt)(password, salt, {
        N: 2 ** logN,
        r: NCRYPTSEC_SCRYPT_R,
        p: NCRYPTSEC_SCRYPT_P,
        dkLen: NCRYPTSEC_DERIVED_KEY_BYTES,
        maxmem: NCRYPTSEC_MAX_MEMORY
    });
}
function normalizePassword(password) {
    return password.normalize('NFKC');
}
