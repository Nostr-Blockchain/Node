"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateMinimumBurn = calculateMinimumBurn;
exports.splitFees = splitFees;
function calculateMinimumBurn(params, inputCount, outputCount) {
    return params.baseFee + (params.inputFee * BigInt(inputCount)) + (params.outputFee * BigInt(outputCount));
}
function splitFees(sumInputs, sumOutputs, params, inputCount, outputCount) {
    const actualFee = sumInputs - sumOutputs;
    const minimumBurn = calculateMinimumBurn(params, inputCount, outputCount);
    const priorityFee = actualFee - minimumBurn;
    return { actualFee, minimumBurn, priorityFee };
}
