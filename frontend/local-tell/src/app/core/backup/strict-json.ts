/**
 * Strict JSON reader ported from Android `StrictBackupJson` (validation rules, depth and value
 * limits) that also builds a value tree. Numbers keep their source text so 64-bit integers are
 * never rounded, and typed accessors reproduce Android org.json's Integer/Long/Double typing.
 */

export class JsonNumber {
  constructor(readonly raw: string) {}

  /** org.json types a literal without '.', 'e' or 'E' that fits a Java long as Integer/Long. */
  get integral(): bigint | null {
    if (/[.eE]/.test(this.raw)) return null;
    const value = BigInt(this.raw);
    return value >= -(2n ** 63n) && value < 2n ** 63n ? value : null;
  }

  get isInt(): boolean {
    const value = this.integral;
    return value !== null && value >= -(2n ** 31n) && value < 2n ** 31n;
  }

  toDouble(): number {
    return Number(this.raw);
  }
}

export type JsonValue = null | boolean | string | JsonNumber | JsonValue[] | JsonObject;
export type JsonObject = Map<string, JsonValue>;

export class StrictJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrictJsonError';
  }
}

const MAX_DEPTH = 16;
const MAX_VALUES = 40_000;
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

export function validBackupUnicode(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function parseStrictJson(text: string): JsonValue {
  return new StrictJsonReader(text).read();
}

class StrictJsonReader {
  private index = 0;
  private values = 0;

  constructor(private readonly text: string) {}

  read(): JsonValue {
    const result = this.value(0);
    this.whitespace();
    this.require(this.index === this.text.length, 'Trailing content');
    return result;
  }

  private require(condition: boolean, message: string): asserts condition {
    if (!condition) throw new StrictJsonError(message);
  }

  private whitespace(): void {
    while (this.index < this.text.length && ' \t\r\n'.includes(this.text[this.index])) this.index++;
  }

  private take(character: string): boolean {
    this.whitespace();
    if (this.index >= this.text.length || this.text[this.index] !== character) return false;
    this.index++;
    return true;
  }

  private value(depth: number): JsonValue {
    this.require(depth <= MAX_DEPTH, 'JSON nesting is too deep');
    this.require(++this.values <= MAX_VALUES, 'JSON has too many values');
    this.whitespace();
    this.require(this.index < this.text.length, 'Unexpected end of JSON');
    switch (this.text[this.index]) {
      case '{': {
        this.index++;
        const object: JsonObject = new Map();
        if (this.take('}')) return object;
        do {
          this.whitespace();
          const key = this.string();
          this.require(!object.has(key), 'Duplicate JSON key');
          this.require(this.take(':'), 'Expected ":"');
          object.set(key, this.value(depth + 1));
        } while (this.take(','));
        this.require(this.take('}'), 'Expected "}"');
        return object;
      }
      case '[': {
        this.index++;
        const array: JsonValue[] = [];
        if (this.take(']')) return array;
        do {
          array.push(this.value(depth + 1));
        } while (this.take(','));
        this.require(this.take(']'), 'Expected "]"');
        return array;
      }
      case '"':
        return this.string();
      case 't':
        this.literal('true');
        return true;
      case 'f':
        this.literal('false');
        return false;
      case 'n':
        this.literal('null');
        return null;
      default: {
        NUMBER.lastIndex = this.index;
        const match = NUMBER.exec(this.text);
        this.require(match !== null, 'Invalid JSON value');
        this.index += match[0].length;
        return new JsonNumber(match[0]);
      }
    }
  }

  private literal(value: string): void {
    this.require(this.text.startsWith(value, this.index), 'Invalid JSON literal');
    this.index += value.length;
  }

  private string(): string {
    this.require(this.index < this.text.length && this.text[this.index++] === '"', 'Expected string');
    let result = '';
    while (this.index < this.text.length) {
      const character = this.text[this.index++];
      if (character === '"') {
        this.require(validBackupUnicode(result), 'Invalid Unicode in JSON string');
        return result;
      }
      this.require(character >= ' ', 'Unescaped control character');
      if (character !== '\\') {
        result += character;
        continue;
      }
      this.require(this.index < this.text.length, 'Unterminated escape');
      const escaped = this.text[this.index++];
      switch (escaped) {
        case '"':
        case '\\':
        case '/':
          result += escaped;
          break;
        case 'b':
          result += '\b';
          break;
        case 'f':
          result += '\f';
          break;
        case 'n':
          result += '\n';
          break;
        case 'r':
          result += '\r';
          break;
        case 't':
          result += '\t';
          break;
        case 'u': {
          this.require(this.index + 4 <= this.text.length, 'Short unicode escape');
          const code = this.text.slice(this.index, this.index + 4);
          this.require(/^[0-9a-fA-F]{4}$/.test(code), 'Invalid unicode escape');
          this.index += 4;
          result += String.fromCharCode(parseInt(code, 16));
          break;
        }
        default:
          throw new StrictJsonError('Invalid JSON escape');
      }
    }
    throw new StrictJsonError('Unterminated JSON string');
  }
}

/** Accessors with the same type rules as Android `AppBackupCodec`'s JSONObject extensions. */
export function asObject(value: JsonValue | undefined): JsonObject {
  if (!(value instanceof Map)) throw new StrictJsonError('Expected JSON object');
  return value;
}

export function asArray(value: JsonValue | undefined): JsonValue[] {
  if (!Array.isArray(value)) throw new StrictJsonError('Expected JSON array');
  return value;
}

export function requireKey(object: JsonObject, key: string): JsonValue {
  if (!object.has(key)) throw new StrictJsonError(`Missing ${key}`);
  return object.get(key) as JsonValue;
}

export function text(object: JsonObject, key: string): string {
  const value = requireKey(object, key);
  if (typeof value !== 'string') throw new StrictJsonError(`Invalid text: ${key}`);
  return value;
}

export function optionalText(object: JsonObject, key: string): string | null {
  return !object.has(key) || object.get(key) === null ? null : text(object, key);
}

export function numberValue(object: JsonObject, key: string): number {
  const value = requireKey(object, key);
  if (!(value instanceof JsonNumber)) throw new StrictJsonError(`Invalid number: ${key}`);
  return value.toDouble();
}

export function optionalNumber(object: JsonObject, key: string): number | null {
  return !object.has(key) || object.get(key) === null ? null : numberValue(object, key);
}

export function integerValue(object: JsonObject, key: string): bigint {
  const value = requireKey(object, key);
  const integral = value instanceof JsonNumber ? value.integral : null;
  if (integral === null) throw new StrictJsonError(`Invalid integer: ${key}`);
  return integral;
}
