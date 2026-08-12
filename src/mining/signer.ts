import { CryptoProvider } from '../crypto/provider';
import { bytesToHex } from '../consensus/primitives';

export interface BlockSigner {
  getPublicKeyHex(): string;
  signEventId(eventIdHex: string): string;
}

export class InMemorySigner implements BlockSigner {
  private readonly secretKey: Uint8Array;
  private readonly cryptoProvider: CryptoProvider;
  private readonly publicKeyHex: string;

  public constructor(secretKey: Uint8Array, cryptoProvider: CryptoProvider) {
    this.secretKey = Uint8Array.from(secretKey);
    this.cryptoProvider = cryptoProvider;
    this.publicKeyHex = bytesToHex(this.cryptoProvider.deriveXOnlyPublicKey(this.secretKey));
  }

  public getPublicKeyHex(): string {
    return this.publicKeyHex;
  }

  public signEventId(eventIdHex: string): string {
    return bytesToHex(this.cryptoProvider.signSchnorr(this.secretKey, Buffer.from(eventIdHex, 'hex')));
  }
}
