"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateMinimumBurn = calculateMinimumBurn;
exports.splitFees = splitFees;
function calculateMinimumBurn(params, inputCount, outputCount) {
    return 1000n + (250n * BigInt(inputCount)) + (500n * BigInt(outputCount));
}
function splitFees(sumInputs, sumOutputs, params, inputCount, outputCount) {
    const actualFee = sumInputs - sumOutputs;
    const minimumBurn = calculateMinimumBurn(params, inputCount, outputCount);
    const priorityFee = actualFee - minimumBurn;
    return { actualFee, minimumBurn, priorityFee };
}
