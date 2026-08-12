"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDecimalAmount = parseDecimalAmount;
exports.formatDecimalAmount = formatDecimalAmount;
exports.formatDisplayAmount = formatDisplayAmount;
const constants_1 = require("../consensus/constants");
const DECIMAL_AMOUNT_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/u;
function parseDecimalAmount(amountText, allowZero = false) {
    if (!DECIMAL_AMOUNT_PATTERN.test(amountText)) {
        throw new Error(`invalid amount: ${amountText}`);
    }
    const [wholePart, fractionalPart = ''] = amountText.split('.');
    const wholeUnits = BigInt(wholePart) * 100000000n;
    const fractionalUnits = fractionalPart.length === 0
        ? 0n
        : BigInt(fractionalPart.padEnd(8, '0'));
    const totalUnits = wholeUnits + fractionalUnits;
    if (totalUnits > constants_1.MAX_U128) {
        throw new Error('amount overflow');
    }
    if (!allowZero && totalUnits === 0n) {
        throw new Error('amount must be greater than zero');
    }
    return totalUnits;
}
function formatDecimalAmount(baseUnits) {
    if (baseUnits < 0n) {
        throw new Error('amount must not be negative');
    }
    const wholeUnits = baseUnits / 100000000n;
    const fractionalUnits = baseUnits % 100000000n;
    return `${wholeUnits.toString(10)}.${fractionalUnits.toString(10).padStart(8, '0')}`;
}
function formatDisplayAmount(baseUnits, networkParams) {
    return `${formatDecimalAmount(baseUnits)} ${networkParams.displaySymbol}`;
}
