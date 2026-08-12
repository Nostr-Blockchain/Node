import { MAX_U128 } from '../consensus/constants';
import { type NetworkParams } from '../networks/params';

const DECIMAL_AMOUNT_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/u;

export function parseDecimalAmount(amountText: string, allowZero = false): bigint {
  if (!DECIMAL_AMOUNT_PATTERN.test(amountText)) {
    throw new Error(`invalid amount: ${amountText}`);
  }
  const [wholePart, fractionalPart = ''] = amountText.split('.');
  const wholeUnits = BigInt(wholePart) * 100_000_000n;
  const fractionalUnits = fractionalPart.length === 0
    ? 0n
    : BigInt(fractionalPart.padEnd(8, '0'));
  const totalUnits = wholeUnits + fractionalUnits;
  if (totalUnits > MAX_U128) {
    throw new Error('amount overflow');
  }
  if (!allowZero && totalUnits === 0n) {
    throw new Error('amount must be greater than zero');
  }
  return totalUnits;
}

export function formatDecimalAmount(baseUnits: bigint): string {
  if (baseUnits < 0n) {
    throw new Error('amount must not be negative');
  }
  const wholeUnits = baseUnits / 100_000_000n;
  const fractionalUnits = baseUnits % 100_000_000n;
  return `${wholeUnits.toString(10)}.${fractionalUnits.toString(10).padStart(8, '0')}`;
}

export function formatDisplayAmount(baseUnits: bigint, networkParams: NetworkParams): string {
  return `${formatDecimalAmount(baseUnits)} ${networkParams.displaySymbol}`;
}
