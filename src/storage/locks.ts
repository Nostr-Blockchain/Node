import fs from 'node:fs';
import path from 'node:path';

export class DataDirLock {
  private readonly lockFilePath: string;
  private released = false;

  public constructor(dataDir: string) {
    this.lockFilePath = path.join(dataDir, 'nostr-blockchain.lock');
    fs.mkdirSync(dataDir, { recursive: true });
    this.acquire();
  }

  public close(): void {
    if (this.released) {
      return;
    }
    this.released = true;
    try {
      fs.rmSync(this.lockFilePath, { force: true });
    } catch {
      return;
    }
  }

  private acquire(): void {
    const payload = JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString(),
      platform: process.platform
    });

    try {
      const fileDescriptor = fs.openSync(this.lockFilePath, 'wx');
      fs.writeFileSync(fileDescriptor, payload, 'utf8');
      fs.closeSync(fileDescriptor);
      return;
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }

    throw new Error(`network data dir already locked: ${this.lockFilePath}`);
  }
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
