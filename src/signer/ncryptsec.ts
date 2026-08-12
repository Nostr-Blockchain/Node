import fs from 'node:fs';
import crypto from 'node:crypto';

import { bech32 } from '@scure/base';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { scrypt } from '@noble/hashes/scrypt';

import { bytesToHex, hexToBytes } from '../consensus/primitives';

const NCRYPTSEC_PREFIX = 'ncryptsec';
const NCRYPTSEC_VERSION = 0x02;
const NCRYPTSEC_SALT_BYTES = 16;
const NCRYPTSEC_NONCE_BYTES = 24;
const NCRYPTSEC_LOG_N = 16;
const NCRYPTSEC_DERIVED_KEY_BYTES = 32;
const NCRYPTSEC_SCRYPT_R = 8;
const NCRYPTSEC_SCRYPT_P = 1;
const NCRYPTSEC_MAX_MEMORY = (2 ** 30) + 1024;

export interface DecryptedNcryptsecKey {
  readonly secretKey: Uint8Array;
  readonly keySecurityByte: number;
  readonly logN: number;
}

export function createNcryptsec(secretKey: Uint8Array, password: string, keySecurityByte = 0x01): string {
  if (secretKey.length !== 32) {
    throw new Error('signer secret key must be exactly 32 bytes');
  }
  const normalizedPassword = normalizePassword(password);
  const salt = crypto.randomBytes(NCRYPTSEC_SALT_BYTES);
  const nonce = crypto.randomBytes(NCRYPTSEC_NONCE_BYTES);
  const symmetricKey = deriveSymmetricKey(normalizedPassword, salt, NCRYPTSEC_LOG_N);
  try {
    const cipher = xchacha20poly1305(symmetricKey, nonce, Uint8Array.of(keySecurityByte));
    const ciphertext = cipher.encrypt(secretKey);
    const encodedPayload = Buffer.concat([
      Buffer.from([NCRYPTSEC_VERSION]),
      Buffer.from([NCRYPTSEC_LOG_N]),
      Buffer.from(salt),
      Buffer.from(nonce),
      Buffer.from([keySecurityByte]),
      Buffer.from(ciphertext)
    ]);
    return bech32.encode(NCRYPTSEC_PREFIX, bech32.toWords(encodedPayload), 5000);
  } finally {
    symmetricKey.fill(0);
  }
}

export function decryptNcryptsec(ncryptsec: string, password: string): DecryptedNcryptsecKey {
  const { prefix, words } = bech32.decode(ncryptsec as `${string}1${string}`, 5000);
  if (prefix !== NCRYPTSEC_PREFIX) {
    throw new Error('signer key must use ncryptsec prefix');
  }
  const payload = Buffer.from(bech32.fromWords(words));
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
    const cipher = xchacha20poly1305(symmetricKey, nonce, Uint8Array.of(keySecurityByte));
    const secretKey = cipher.decrypt(ciphertext);
    if (secretKey.length !== 32) {
      throw new Error('decrypted signer secret must be exactly 32 bytes');
    }
    return {
      secretKey: Uint8Array.from(secretKey),
      keySecurityByte,
      logN
    };
  } finally {
    symmetricKey.fill(0);
  }
}

export function readNcryptsecFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').trim();
}

export function writeNcryptsecFile(filePath: string, ncryptsec: string): void {
  fs.writeFileSync(filePath, `${ncryptsec}\n`, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o600);
  }
}

export function validateSignerFilePermissions(filePath: string): void {
  const stats = fs.statSync(filePath);
  if (process.platform === 'win32') {
    return;
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new Error(`signer secret file permissions are too broad: ${filePath}`);
  }
}

export function generateSecretKeyHex(): string {
  for (;;) {
    const secretKey = crypto.randomBytes(32);
    if (!secretKey.equals(Buffer.alloc(32, 0))) {
      return bytesToHex(secretKey);
    }
  }
}

export function readLegacyOrNcryptsecSecret(filePath: string, password: string | null): Uint8Array {
  const fileText = fs.readFileSync(filePath, 'utf8').trim();
  if (/^[0-9a-f]{64}$/u.test(fileText)) {
    return hexToBytes(fileText, 32);
  }
  if (password === null) {
    throw new Error('encrypted signer key requires a password source');
  }
  return decryptNcryptsec(fileText, password).secretKey;
}

function deriveSymmetricKey(password: string, salt: Uint8Array, logN: number): Uint8Array {
  return scrypt(password, salt, {
    N: 2 ** logN,
    r: NCRYPTSEC_SCRYPT_R,
    p: NCRYPTSEC_SCRYPT_P,
    dkLen: NCRYPTSEC_DERIVED_KEY_BYTES,
    maxmem: NCRYPTSEC_MAX_MEMORY
  });
}

function normalizePassword(password: string): string {
  return password.normalize('NFKC');
}
