"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBlockTags = buildBlockTags;
exports.parseBlockEvent = parseBlockEvent;
const constants_1 = require("./constants");
const errors_1 = require("./errors");
const primitives_1 = require("./primitives");
function buildBlockTags(chainIdHex, parentIdHex, txIdsHex, nonce) {
    const sortedTxIds = [...txIdsHex].sort();
    return [
        ['t', (0, constants_1.makeChainScope)(chainIdHex)],
        ['e', parentIdHex, '', 'parent'],
        ['nonce', nonce.toString(10), constants_1.NIP13_GATE_BITS.toString(10)],
        ...sortedTxIds.map((txId) => ['e', txId, '', 'tx'])
    ];
}
function parseBlockEvent(event, chainIdHex) {
    (0, errors_1.assertConsensus)(event.kind === constants_1.BLOCK_KIND, 'BLK_BAD_KIND');
    if (event.tags.length === 2 && event.tags[0]?.[0] === 't' && event.tags[0]?.[1] === constants_1.GENESIS_SCOPE) {
        (0, errors_1.assertConsensus)(event.content.length === 76 * 2, 'BLK_BAD_CONTENT');
        const nonceTag = event.tags[1] ?? [];
        (0, errors_1.assertConsensus)(nonceTag.length === 3 && nonceTag[0] === 'nonce' && nonceTag[2] === constants_1.NIP13_GATE_BITS.toString(10), 'BLK_BAD_NONCE');
        return {
            event,
            parentId: null,
            txIds: [],
            nonce: (0, primitives_1.parseCanonicalDecimalU64)(nonceTag[1] ?? ''),
            isGenesis: true
        };
    }
    (0, errors_1.assertConsensus)(event.content === '00', 'BLK_BAD_CONTENT');
    (0, errors_1.assertConsensus)(chainIdHex !== undefined, 'BLK_BAD_SCOPE');
    (0, errors_1.assertConsensus)(event.tags.length >= 3, 'BLK_BAD_TAGS');
    const scopeTag = event.tags[0] ?? [];
    (0, errors_1.assertConsensus)(scopeTag.length === 2 && scopeTag[0] === 't' && scopeTag[1] === (0, constants_1.makeChainScope)(chainIdHex), 'BLK_BAD_SCOPE');
    const parentTag = event.tags[1] ?? [];
    (0, errors_1.assertConsensus)(parentTag.length === 4 && parentTag[0] === 'e' && parentTag[2] === '' && parentTag[3] === 'parent', 'BLK_BAD_PARENT');
    const nonceTag = event.tags[2] ?? [];
    (0, errors_1.assertConsensus)(nonceTag.length === 3 && nonceTag[0] === 'nonce' && nonceTag[2] === constants_1.NIP13_GATE_BITS.toString(10), 'BLK_BAD_NONCE');
    const parentId = (0, primitives_1.hexToBytes)(parentTag[1] ?? '', 32);
    (0, errors_1.assertConsensus)((0, primitives_1.compareBytes)(parentId, (0, primitives_1.hexToBytes)(event.id, 32)) !== 0, 'BLK_SELF_PARENT');
    const txTags = event.tags.slice(3);
    (0, errors_1.assertConsensus)(txTags.length <= 64, 'BLK_BAD_TAGS');
    (0, errors_1.assertConsensus)(txTags.every((tag) => tag.length === 4 && tag[0] === 'e' && tag[2] === '' && tag[3] === 'tx'), 'BLK_BAD_TAGS');
    const txIds = txTags.map((tag) => (0, primitives_1.hexToBytes)(tag[1] ?? '', 32));
    for (let index = 1; index < txIds.length; index += 1) {
        const comparison = (0, primitives_1.compareBytes)(txIds[index - 1], txIds[index]);
        (0, errors_1.assertConsensus)(comparison !== 0, 'BLK_TX_DUPLICATE');
        (0, errors_1.assertConsensus)(comparison < 0, 'BLK_BAD_TAGS');
    }
    return {
        event,
        parentId,
        txIds,
        nonce: (0, primitives_1.parseCanonicalDecimalU64)(nonceTag[1] ?? ''),
        isGenesis: false
    };
}
