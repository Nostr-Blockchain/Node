import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export interface ControlRequest {
  readonly token: string;
  readonly command: 'status' | 'stop' | 'signer_unlock' | 'signer_lock' | 'wallet_address' | 'wallet_balance' | 'wallet_utxos' | 'wallet_send';
  readonly password?: string;
  readonly to?: string;
  readonly amount?: string;
  readonly priorityFee?: string;
}

export interface ControlResponse {
  readonly ok: boolean;
  readonly code: string;
  readonly payload?: unknown;
}

interface ControlSocketMetadata {
  readonly host: string;
  readonly port: number;
  readonly token: string;
  readonly pid: number;
  readonly createdAt: string;
}

export interface LocalControlHandlers {
  readonly onStatus: () => unknown;
  readonly onStop: () => void;
  readonly onSignerUnlock?: (password: string) => unknown;
  readonly onSignerLock?: () => unknown;
  readonly onWalletAddress?: () => unknown;
  readonly onWalletBalance?: () => unknown;
  readonly onWalletUtxos?: () => unknown;
  readonly onWalletSend?: (request: { readonly to: string; readonly amount: string; readonly priorityFee: string }) => unknown;
}

export class LocalControlSocket {
  private readonly metadataPath: string;
  private readonly handlers: LocalControlHandlers;
  private readonly host = '127.0.0.1';
  private readonly token = crypto.randomBytes(32).toString('hex');
  private readonly server = net.createServer((socket) => this.handleSocket(socket));

  public constructor(dataDir: string, handlers: LocalControlHandlers) {
    this.metadataPath = getControlSocketPath(dataDir);
    this.handlers = handlers;
  }

  public async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, this.host, () => {
        this.server.off('error', reject);
        resolve();
      });
    });

    const address = this.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('control socket failed to bind a local TCP address');
    }

    writeControlMetadata(this.metadataPath, {
      host: this.host,
      port: address.port,
      token: this.token,
      pid: process.pid,
      createdAt: new Date().toISOString()
    });
  }

  public async close(): Promise<void> {
    fs.rmSync(this.metadataPath, { force: true });
    if (!this.server.listening) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private handleSocket(socket: net.Socket): void {
    let rawMessage = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      rawMessage += chunk;
    });
    socket.on('end', () => {
      const response = this.dispatch(rawMessage);
      socket.end(`${JSON.stringify(response, jsonBigIntReplacer)}\n`);
    });
    socket.on('error', () => undefined);
  }

  private dispatch(rawMessage: string): ControlResponse {
    try {
      let parsed: ControlRequest;
      try {
        parsed = JSON.parse(rawMessage.trim()) as ControlRequest;
      } catch {
        return { ok: false, code: 'CONTROL_BAD_REQUEST' };
      }

      if (parsed.token !== this.token) {
        return { ok: false, code: 'CONTROL_UNAUTHORIZED' };
      }

      if (parsed.command === 'status') {
        return { ok: true, code: 'OK', payload: this.handlers.onStatus() };
      }
      if (parsed.command === 'stop') {
        this.handlers.onStop();
        return { ok: true, code: 'STOPPING' };
      }
      if (parsed.command === 'signer_unlock') {
        if (typeof parsed.password !== 'string' || parsed.password.length === 0) {
          return { ok: false, code: 'CONTROL_BAD_REQUEST' };
        }
        if (this.handlers.onSignerUnlock === undefined) {
          return { ok: false, code: 'BOOT_SIGNER_UNAVAILABLE' };
        }
        return { ok: true, code: 'OK', payload: this.handlers.onSignerUnlock(parsed.password) };
      }
      if (parsed.command === 'signer_lock') {
        if (this.handlers.onSignerLock === undefined) {
          return { ok: false, code: 'BOOT_SIGNER_UNAVAILABLE' };
        }
        return { ok: true, code: 'OK', payload: this.handlers.onSignerLock() };
      }
      if (parsed.command === 'wallet_address') {
        if (this.handlers.onWalletAddress === undefined) {
          return { ok: false, code: 'CONTROL_UNKNOWN_COMMAND' };
        }
        return { ok: true, code: 'OK', payload: this.handlers.onWalletAddress() };
      }
      if (parsed.command === 'wallet_balance') {
        if (this.handlers.onWalletBalance === undefined) {
          return { ok: false, code: 'CONTROL_UNKNOWN_COMMAND' };
        }
        return { ok: true, code: 'OK', payload: this.handlers.onWalletBalance() };
      }
      if (parsed.command === 'wallet_utxos') {
        if (this.handlers.onWalletUtxos === undefined) {
          return { ok: false, code: 'CONTROL_UNKNOWN_COMMAND' };
        }
        return { ok: true, code: 'OK', payload: this.handlers.onWalletUtxos() };
      }
      if (parsed.command === 'wallet_send') {
        if (this.handlers.onWalletSend === undefined || typeof parsed.to !== 'string' || typeof parsed.amount !== 'string' || typeof parsed.priorityFee !== 'string') {
          return { ok: false, code: 'CONTROL_BAD_REQUEST' };
        }
        return { ok: true, code: 'OK', payload: this.handlers.onWalletSend({ to: parsed.to, amount: parsed.amount, priorityFee: parsed.priorityFee }) };
      }
      return { ok: false, code: 'CONTROL_UNKNOWN_COMMAND' };
    } catch (error) {
      return { ok: false, code: error instanceof Error ? error.message : 'CONTROL_INTERNAL_ERROR' };
    }
  }
}

export function getControlSocketPath(dataDir: string): string {
  return path.join(dataDir, 'control.sock');
}

export function hasControlSocket(dataDir: string): boolean {
  return fs.existsSync(getControlSocketPath(dataDir));
}

export async function sendLocalControlRequest(
  dataDir: string,
  command: 'status' | 'stop' | 'signer_unlock' | 'signer_lock' | 'wallet_address' | 'wallet_balance' | 'wallet_utxos' | 'wallet_send',
  payload?: { readonly password?: string; readonly to?: string; readonly amount?: string; readonly priorityFee?: string }
): Promise<ControlResponse> {
  const metadata = readControlMetadata(dataDir);
  return await new Promise<ControlResponse>((resolve, reject) => {
    const socket = net.createConnection(metadata.port, metadata.host);
    let rawResponse = '';
    socket.setEncoding('utf8');
    socket.once('connect', () => {
      socket.end(`${JSON.stringify({ token: metadata.token, command, ...(payload ?? {}) } satisfies ControlRequest)}\n`);
    });
    socket.on('data', (chunk) => {
      rawResponse += chunk;
    });
    socket.once('end', () => {
      try {
        resolve(JSON.parse(rawResponse.trim()) as ControlResponse);
      } catch (error) {
        reject(error);
      }
    });
    socket.once('error', reject);
  });
}

export function readControlMetadata(dataDir: string): ControlSocketMetadata {
  const metadataPath = getControlSocketPath(dataDir);
  if (!fs.existsSync(metadataPath)) {
    throw new Error('CONTROL_UNAVAILABLE');
  }
  const parsedMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Partial<ControlSocketMetadata>;
  validateControlMetadata(parsedMetadata);
  return parsedMetadata as ControlSocketMetadata;
}

function writeControlMetadata(metadataPath: string, metadata: ControlSocketMetadata): void {
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') {
    fs.chmodSync(metadataPath, 0o600);
  }
}

function jsonBigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString(10) : value;
}

function validateControlMetadata(metadata: Partial<ControlSocketMetadata>): void {
  if (metadata.host !== '127.0.0.1') {
    throw new Error('CONTROL_UNAVAILABLE');
  }
  if (!Number.isInteger(metadata.port) || metadata.port === undefined || metadata.port < 1 || metadata.port > 65_535) {
    throw new Error('CONTROL_UNAVAILABLE');
  }
  if (typeof metadata.token !== 'string' || !/^[0-9a-f]{64}$/u.test(metadata.token)) {
    throw new Error('CONTROL_UNAVAILABLE');
  }
  if (!Number.isInteger(metadata.pid) || metadata.pid === undefined || metadata.pid < 1) {
    throw new Error('CONTROL_UNAVAILABLE');
  }
  if (typeof metadata.createdAt !== 'string' || Number.isNaN(Date.parse(metadata.createdAt))) {
    throw new Error('CONTROL_UNAVAILABLE');
  }
}
