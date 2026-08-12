#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSignedTransactionEvent = void 0;
var builder_1 = require("../wallet/builder");
Object.defineProperty(exports, "buildSignedTransactionEvent", { enumerable: true, get: function () { return builder_1.buildSignedTransactionEvent; } });
function main() {
    const [, , command] = process.argv;
    if (command === undefined) {
        process.stdout.write('{"deprecated":"use nostr-blockchain CLI"}\n');
        return;
    }
    throw new Error('prototype wallet tool is deprecated; use nostr-blockchain wallet/send commands');
}
if (require.main === module) {
    main();
}
