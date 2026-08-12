import fs from 'node:fs';
import path from 'node:path';

import { NobleCryptoProvider } from '../crypto/noble-provider';
import { bytesToHex, hexToBytes } from '../consensus/primitives';
import { BlockSigner, InMemorySigner } from '../mining/signer';
import { createNcryptsec, decryptNcryptsec, generateSecretKeyHex, readNcryptsecFile, validateSignerFilePermissions, writeNcryptsecFile } from './ncryptsec';

export type SignerState = 'LOCKED' | 'UNLOCKED' | 'UNAVAILABLE';

export class LocalSignerProvider {
  private readonly signerPath: string;
  private readonly cryptoProvider = new NobleCryptoProvider();
  private unlockedSigner: InMemorySigner | null = null;

  public constructor(signerPath: string) {
    this.signerPath = signerPath;
  }

  public ensureSignerFile(password: string): { signerPath: string; pubkeyHex: string } {
    if (fs.existsSync(this.signerPath)) {
      throw new Error(`refusing to overwrite existing signer key: ${this.signerPath}`);
    }
    fs.mkdirSync(path.dirname(this.signerPath), { recursive: true });
    const secretKeyHex = generateSecretKeyHex();
    const secretKey = hexToBytes(secretKeyHex, 32);
    const pubkeyHex = bytesToHex(this.cryptoProvider.deriveXOnlyPublicKey(secretKey));
    const encrypted = createNcryptsec(secretKey, password, 0x01);
    writeNcryptsecFile(this.signerPath, encrypted);
    secretKey.fill(0);
    return { signerPath: this.signerPath, pubkeyHex };
  }

  public unlock(password: string): string {
    validateSignerFilePermissions(this.signerPath);
    const encodedKey = readNcryptsecFile(this.signerPath);
    const decryptedKey = decryptNcryptsec(encodedKey, password);
    this.unlockedSigner = new InMemorySigner(decryptedKey.secretKey, this.cryptoProvider);
    decryptedKey.secretKey.fill(0);
    return this.unlockedSigner.getPublicKeyHex();
  }

  public lock(): void {
    this.unlockedSigner = null;
  }

  public getState(): SignerState {
    if (!fs.existsSync(this.signerPath)) {
      return 'UNAVAILABLE';
    }
    return this.unlockedSigner === null ? 'LOCKED' : 'UNLOCKED';
  }

  public getUnlockedSigner(): BlockSigner | null {
    return this.unlockedSigner;
  }

  public readPublicKey(password: string): string {
    validateSignerFilePermissions(this.signerPath);
    const encodedKey = readNcryptsecFile(this.signerPath);
    const decryptedKey = decryptNcryptsec(encodedKey, password);
    try {
      return bytesToHex(this.cryptoProvider.deriveXOnlyPublicKey(decryptedKey.secretKey));
    } finally {
      decryptedKey.secretKey.fill(0);
    }
  }

  public getSignerPath(): string {
    return this.signerPath;
  }

  public checkReadable(): void {
    validateSignerFilePermissions(this.signerPath);
    const encodedKey = readNcryptsecFile(this.signerPath);
    if (!encodedKey.startsWith('ncryptsec1')) {
      throw new Error('signer file does not contain ncryptsec data');
    }
  }
}
