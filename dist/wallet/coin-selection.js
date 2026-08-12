"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSpendableWalletUtxo = isSpendableWalletUtxo;
exports.sortWalletUtxosForSelection = sortWalletUtxosForSelection;
exports.selectWalletCoins = selectWalletCoins;
const fees_1 = require("../consensus/fees");
const primitives_1 = require("../consensus/primitives");
function isSpendableWalletUtxo(utxo, candidateHeight, rewardMaturity) {
    return !utxo.isReward || candidateHeight - utxo.createdHeight >= BigInt(rewardMaturity);
}
function sortWalletUtxosForSelection(utxos) {
    return [...utxos].sort((left, right) => {
        if (left.amount !== right.amount) {
            return left.amount > right.amount ? -1 : 1;
        }
        const sourceCompare = (0, primitives_1.compareBytes)(left.sourceId, right.sourceId);
        if (sourceCompare !== 0) {
            return sourceCompare;
        }
        return left.outputIndex - right.outputIndex;
    });
}
function selectWalletCoins(utxos, networkParams, candidateHeight, recipientAmount, requestedPriorityFee) {
    const spendableUtxos = sortWalletUtxosForSelection(utxos.filter((utxo) => isSpendableWalletUtxo(utxo, candidateHeight, networkParams.rewardMaturity)));
    const selectedUtxos = [];
    let selectedAmount = 0n;
    for (const utxo of spendableUtxos) {
        if (selectedUtxos.length >= networkParams.maxTxInputs) {
            break;
        }
        selectedUtxos.push(utxo);
        selectedAmount += utxo.amount;
        const oneOutputMinimumBurn = (0, fees_1.calculateMinimumBurn)(networkParams, selectedUtxos.length, 1);
        if (selectedAmount >= recipientAmount + oneOutputMinimumBurn + requestedPriorityFee) {
            const oneOutputRemainder = selectedAmount - recipientAmount - oneOutputMinimumBurn - requestedPriorityFee;
            if (oneOutputRemainder === 0n || oneOutputRemainder <= networkParams.outputFee) {
                return {
                    selectedUtxos: (0, primitives_1.sortOutpointsCanonical)(selectedUtxos),
                    recipientAmount,
                    requestedPriorityFee,
                    actualPriorityFee: requestedPriorityFee + oneOutputRemainder,
                    minimumBurn: oneOutputMinimumBurn,
                    changeAmount: 0n,
                    selectedAmount,
                    useChangeOutput: false
                };
            }
            const twoOutputMinimumBurn = (0, fees_1.calculateMinimumBurn)(networkParams, selectedUtxos.length, 2);
            return {
                selectedUtxos: (0, primitives_1.sortOutpointsCanonical)(selectedUtxos),
                recipientAmount,
                requestedPriorityFee,
                actualPriorityFee: requestedPriorityFee,
                minimumBurn: twoOutputMinimumBurn,
                changeAmount: selectedAmount - recipientAmount - twoOutputMinimumBurn - requestedPriorityFee,
                selectedAmount,
                useChangeOutput: true
            };
        }
    }
    throw new Error(`insufficient spendable funds within ${networkParams.maxTxInputs} inputs`);
}
