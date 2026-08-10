"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseStrictJson = parseStrictJson;
const errors_1 = require("../consensus/errors");
class Parser {
    text;
    index = 0;
    maxDepth;
    constructor(text, maxDepth = 16) {
        this.text = text;
        this.maxDepth = maxDepth;
    }
    parse() {
        const value = this.parseValue(0);
        this.skipWhitespace();
        if (this.index !== this.text.length) {
            throw new errors_1.ConsensusError('BAD_JSON');
        }
        return value;
    }
    parseValue(depth) {
        if (depth > this.maxDepth) {
            throw new errors_1.ConsensusError('BAD_JSON');
        }
        this.skipWhitespace();
        const char = this.text[this.index];
        if (char === '{')
            return this.parseObject(depth + 1);
        if (char === '[')
            return this.parseArray(depth + 1);
        if (char === '"')
            return this.parseString();
        if (char === '-' || /[0-9]/.test(char ?? ''))
            return this.parseNumber();
        if (this.text.startsWith('true', this.index)) {
            this.index += 4;
            return true;
        }
        if (this.text.startsWith('false', this.index)) {
            this.index += 5;
            return false;
        }
        if (this.text.startsWith('null', this.index)) {
            this.index += 4;
            return null;
        }
        throw new errors_1.ConsensusError('BAD_JSON');
    }
    parseObject(depth) {
        this.expect('{');
        const result = {};
        const seenKeys = new Set();
        this.skipWhitespace();
        if (this.peek('}')) {
            this.index += 1;
            return result;
        }
        while (true) {
            this.skipWhitespace();
            if (this.text[this.index] !== '"') {
                throw new errors_1.ConsensusError('BAD_JSON');
            }
            const key = this.parseString();
            if (seenKeys.has(key)) {
                throw new errors_1.ConsensusError('DUPLICATE_JSON_KEY');
            }
            seenKeys.add(key);
            this.skipWhitespace();
            this.expect(':');
            result[key] = this.parseValue(depth);
            this.skipWhitespace();
            if (this.peek('}')) {
                this.index += 1;
                return result;
            }
            this.expect(',');
        }
    }
    parseArray(depth) {
        this.expect('[');
        const values = [];
        this.skipWhitespace();
        if (this.peek(']')) {
            this.index += 1;
            return values;
        }
        while (true) {
            values.push(this.parseValue(depth));
            this.skipWhitespace();
            if (this.peek(']')) {
                this.index += 1;
                return values;
            }
            this.expect(',');
        }
    }
    parseString() {
        this.expect('"');
        let result = '';
        while (this.index < this.text.length) {
            const char = this.text[this.index];
            if (char === '"') {
                this.index += 1;
                return result;
            }
            if (char === '\\') {
                this.index += 1;
                const escaped = this.text[this.index];
                if (escaped === undefined)
                    throw new errors_1.ConsensusError('BAD_JSON');
                if (escaped === 'u') {
                    const code = this.text.slice(this.index + 1, this.index + 5);
                    if (!/^[0-9a-fA-F]{4}$/.test(code))
                        throw new errors_1.ConsensusError('BAD_JSON');
                    result += String.fromCharCode(Number.parseInt(code, 16));
                    this.index += 5;
                    continue;
                }
                const map = {
                    '"': '"',
                    '\\': '\\',
                    '/': '/',
                    b: '\b',
                    f: '\f',
                    n: '\n',
                    r: '\r',
                    t: '\t'
                };
                const replacement = map[escaped];
                if (replacement === undefined)
                    throw new errors_1.ConsensusError('BAD_JSON');
                result += replacement;
                this.index += 1;
                continue;
            }
            result += char;
            this.index += 1;
        }
        throw new errors_1.ConsensusError('BAD_JSON');
    }
    parseNumber() {
        const start = this.index;
        if (this.peek('-'))
            this.index += 1;
        if (this.peek('0')) {
            this.index += 1;
        }
        else {
            this.consumeDigits();
        }
        if (this.peek('.')) {
            this.index += 1;
            this.consumeDigits();
        }
        if (this.peek('e') || this.peek('E')) {
            this.index += 1;
            if (this.peek('+') || this.peek('-'))
                this.index += 1;
            this.consumeDigits();
        }
        return Number(this.text.slice(start, this.index));
    }
    consumeDigits() {
        const start = this.index;
        while (/[0-9]/.test(this.text[this.index] ?? '')) {
            this.index += 1;
        }
        if (start === this.index) {
            throw new errors_1.ConsensusError('BAD_JSON');
        }
    }
    skipWhitespace() {
        while (/\s/.test(this.text[this.index] ?? '')) {
            this.index += 1;
        }
    }
    expect(char) {
        this.skipWhitespace();
        if (!this.peek(char)) {
            throw new errors_1.ConsensusError('BAD_JSON');
        }
        this.index += 1;
    }
    peek(char) {
        return this.text[this.index] === char;
    }
}
function parseStrictJson(text, maxDepth = 16) {
    return new Parser(text, maxDepth).parse();
}
