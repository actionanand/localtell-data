/**
 * Java/Android text formatting needed for byte-compatible `.bklt` serialization and for the
 * Android Journey sort key. JavaScript already produces the shortest round-trip digits; these
 * helpers only reproduce Java's presentation rules around them.
 */

interface DecimalDigits {
  readonly negative: boolean;
  readonly digits: string;
  /** Decimal exponent of the first digit: value = 0.d1d2... x 10^(exponent + 1). */
  readonly exponent: number;
}

function decompose(value: number, digitsText: string): DecimalDigits {
  const match = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(digitsText);
  if (!match) throw new RangeError(`Unexpected exponential form: ${digitsText}`);
  const digits = (match[2] + (match[3] ?? '')).replace(/0+$/, '') || '0';
  return { negative: match[1] === '-' || Object.is(value, -0), digits, exponent: Number(match[4]) };
}

/** Formats shortest digits using Java's `Double.toString`/`Float.toString` layout. */
function javaLayout({ negative, digits, exponent }: DecimalDigits, magnitude: number): string {
  const sign = negative ? '-' : '';
  if (magnitude === 0) return `${sign}0.0`;
  if (magnitude >= 1e-3 && magnitude < 1e7) {
    if (exponent >= 0) {
      const integer = digits.slice(0, exponent + 1).padEnd(exponent + 1, '0');
      const fraction = digits.slice(exponent + 1) || '0';
      return `${sign}${integer}.${fraction}`;
    }
    return `${sign}0.${'0'.repeat(-exponent - 1)}${digits}`;
  }
  const fraction = digits.slice(1) || '0';
  return `${sign}${digits[0]}.${fraction}E${exponent}`;
}

function nonFinite(value: number): string | null {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Number.POSITIVE_INFINITY) return 'Infinity';
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity';
  return null;
}

/** Java `Double.toString(double)`. */
export function javaDoubleToString(value: number): string {
  const special = nonFinite(value);
  if (special !== null) return special;
  return javaLayout(decompose(value, value.toExponential()), Math.abs(value));
}

/** Shortest decimal digits that round-trip through IEEE-754 binary32. */
function shortestFloatExponential(value: number): string {
  if (value === 0) return value.toExponential();
  for (let precision = 1; precision <= 9; precision++) {
    const candidate = value.toExponential(precision - 1);
    if (Math.fround(Number(candidate)) === value) return candidate;
  }
  return value.toExponential(8);
}

/** Java `Float.toString(float)`; [value] must already be a binary32 value. */
export function javaFloatToString(value: number): string {
  const float = Math.fround(value);
  const special = nonFinite(float);
  if (special !== null) return special;
  return javaLayout(decompose(float, shortestFloatExponential(float)), Math.abs(float));
}

/**
 * Android `JSONObject.numberToString`: integral values print as a long, Double -0.0 prints "-0",
 * other values use the boxed type's `toString`.
 */
export function androidJsonNumber(value: number, type: 'double' | 'float'): string {
  if (!Number.isFinite(value)) throw new RangeError('JSON forbids non-finite numbers');
  const boxed = type === 'float' ? Math.fround(value) : value;
  if (type === 'double' && Object.is(boxed, -0)) return '-0';
  if (Number.isInteger(boxed) && Math.abs(boxed) < 2 ** 63) return BigInt(boxed).toString();
  return type === 'float' ? javaFloatToString(boxed) : javaDoubleToString(boxed);
}

/** Android `JSONStringer.string`: escapes quote, backslash, solidus and C0 controls. */
export function androidJsonString(value: string): string {
  let out = '"';
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    const code = value.charCodeAt(index);
    switch (character) {
      case '"':
      case '\\':
      case '/':
        out += `\\${character}`;
        break;
      case '\t':
        out += '\\t';
        break;
      case '\b':
        out += '\\b';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\f':
        out += '\\f';
        break;
      default:
        out += code <= 0x1f ? `\\u${code.toString(16).padStart(4, '0')}` : character;
    }
  }
  return `${out}"`;
}

/** Java `Instant.toString()` for a millisecond instant (ISO-8601, fraction only when non-zero). */
export function javaInstantToString(epochMillis: number): string {
  const iso = new Date(epochMillis).toISOString();
  return epochMillis % 1000 === 0 ? `${iso.slice(0, 19)}Z` : iso;
}

const INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2}(?::\d{2})?)$/;

/**
 * `Instant.parse(text).toEpochMilli()` for four-digit years. Throws on invalid text.
 * Sub-millisecond digits are truncated toward negative infinity as `toEpochMilli` does.
 */
export function parseJavaInstant(text: string): number {
  const match = INSTANT_PATTERN.exec(text);
  if (!match) throw new RangeError('Invalid ISO-8601 instant');
  const [, year, month, day, hour, minute, second, fraction = '', zone] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  let s = Number(second);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || s > 60) {
    throw new RangeError('Invalid ISO-8601 instant');
  }
  // ISO_INSTANT accepts a leap second and maps it to the 59th second.
  if (s === 60) s = 59;
  let offsetSeconds = 0;
  if (zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const [oh, om, os = '0'] = zone.slice(1).split(':');
    if (Number(oh) > 18 || Number(om) > 59 || Number(os) > 59) throw new RangeError('Invalid offset');
    offsetSeconds = sign * (Number(oh) * 3600 + Number(om) * 60 + Number(os));
  }
  const date = new Date(0);
  date.setUTCFullYear(y, mo - 1, d);
  date.setUTCHours(h, mi, s, 0);
  const millis = Number(fraction.padEnd(9, '0').slice(0, 3));
  return date.getTime() + millis - offsetSeconds * 1000;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
