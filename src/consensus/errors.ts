export class ConsensusError extends Error {
  public readonly code: string;

  public constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export function assertConsensus(condition: unknown, code: string, message?: string): asserts condition {
  if (!condition) {
    throw new ConsensusError(code, message);
  }
}
