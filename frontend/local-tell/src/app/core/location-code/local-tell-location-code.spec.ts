import {
  LOCATION_SPACE,
  SAFE_ALPHABET,
  decodeNumeric,
  decodeShort,
  encode,
  formatNumeric,
  numericCodeForPayloadForTest,
  type LocationCodeDecodeResult,
} from './local-tell-location-code';

/** Golden vectors copied unchanged from Android LocalTellLocationCodeTest.kt. */
const goldenVectors = [
  { latitude: 0.0, longitude: 0.0, numericCode: '0 324 000 002 700 000 002', shortCode: '23AJF-FP6E3-7U43J' },
  { latitude: 12.971598, longitude: 77.594566, numericCode: '0 370 697 756 405 661 642', shortCode: '23G93-PU3ER-X2S3P' },
  { latitude: 8.088306, longitude: 77.538451, numericCode: '0 353 117 905 156 267 573', shortCode: '23E4K-GDYHA-PR872' },
  { latitude: -33.86882, longitude: 151.209296, numericCode: '0 202 072 251 873 404 765', shortCode: '22TPA-NB237-H7P3J' },
  { latitude: 90.0, longitude: 180.0, numericCode: '0 648 000 005 400 000 001', shortCode: '24K3V-WBAT4-DN653' },
  { latitude: -90.0, longitude: -180.0, numericCode: '0 000 000 000 000 000 009', shortCode: '22222-22222-22222' },
];

function expectCoordinate(latitude: number, longitude: number, result: LocationCodeDecodeResult): void {
  expect(result.kind).toBe('Success');
  if (result.kind !== 'Success') return;
  expect(result.latitude).toBe(latitude);
  expect(result.longitude).toBe(longitude);
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('LocalTell location code V1 (Android compatibility)', () => {
  it('keeps every Android golden vector stable', () => {
    for (const vector of goldenVectors) {
      const encoded = encode(vector.latitude, vector.longitude);
      expect(encoded.latitude).toBe(vector.latitude);
      expect(encoded.longitude).toBe(vector.longitude);
      expect(encoded.numericCode).toBe(vector.numericCode);
      expect(encoded.shortCode).toBe(vector.shortCode);
      expectCoordinate(vector.latitude, vector.longitude, decodeNumeric(vector.numericCode));
      expectCoordinate(vector.latitude, vector.longitude, decodeShort(vector.shortCode));
    }
  });

  it('decodes the required Bengaluru example exactly', () => {
    expectCoordinate(12.971598, 77.594566, decodeNumeric('0 370 697 756 405 661 642'));
    expectCoordinate(12.971598, 77.594566, decodeShort('23G93-PU3ER-X2S3P'));
  });

  it('round trips numeric and short codes to the same six decimal coordinate', () => {
    const encoded = encode(12.9715984, 77.5945656);
    expect(encoded.latitude).toBe(12.971598);
    expect(encoded.longitude).toBe(77.594566);
    expectCoordinate(encoded.latitude, encoded.longitude, decodeNumeric(encoded.numericCode));
    expectCoordinate(encoded.latitude, encoded.longitude, decodeShort(encoded.shortCode));
  });

  it('supports global coordinate boundaries and formatting separators', () => {
    for (const [latitude, longitude] of [
      [0, 0],
      [-89.999999, -179.999999],
      [90, 180],
      [-90, -180],
    ]) {
      const encoded = encode(latitude, longitude);
      expectCoordinate(encoded.latitude, encoded.longitude, decodeNumeric(encoded.numericCode.replaceAll(' ', '-')));
      expectCoordinate(encoded.latitude, encoded.longitude, decodeShort(encoded.shortCode.replaceAll('-', ' ')));
    }
  });

  it('preserves six decimal canonical values for deterministic random coordinates', () => {
    const random = mulberry32(7);
    for (let index = 0; index < 1_000; index++) {
      const encoded = encode(random() * 180 - 90, random() * 360 - 180);
      expect(encoded.numericCode.replaceAll(' ', '')).toHaveLength(19);
      expect(encoded.shortCode.replaceAll('-', '')).toHaveLength(15);
      expectCoordinate(encoded.latitude, encoded.longitude, decodeNumeric(encoded.numericCode));
      expectCoordinate(encoded.latitude, encoded.longitude, decodeShort(encoded.shortCode));
    }
  });

  it('never decodes checksum failures or ambiguous short characters', () => {
    const encoded = encode(8.18191, 77.35233);
    const numericLast = encoded.numericCode.at(-1);
    const numericReplacement = numericLast !== '0' ? '0' : '1';
    const shortReplacement = encoded.shortCode.at(-1) !== '2' ? '2' : '3';
    expect(decodeNumeric(encoded.numericCode.slice(0, -1) + numericReplacement).kind).toBe('InvalidChecksum');
    expect(decodeShort(encoded.shortCode.slice(0, -1) + shortReplacement).kind).toBe('InvalidChecksum');
    expect(decodeShort('OOOOO-OOOOO-OOOOO').kind).toBe('InvalidCharacter');
    expect([...'01ILO'].some((character) => SAFE_ALPHABET.includes(character))).toBe(false);
    expect(SAFE_ALPHABET).toHaveLength(31);
  });

  it('detects every single digit substitution in a numeric code', () => {
    const raw = encode(12.971598, 77.594566).numericCode.replaceAll(' ', '');
    for (let position = 0; position < raw.length; position++) {
      for (let digit = 0; digit <= 9; digit++) {
        if (String(digit) === raw[position]) continue;
        const mutated = raw.slice(0, position) + digit + raw.slice(position + 1);
        expect(decodeNumeric(mutated).kind).not.toBe('Success');
      }
    }
  });

  it('groups numeric presentation from the right without changing the raw code', () => {
    expect(formatNumeric('1234567890123456789')).toBe('1 234 567 890 123 456 789');
    expect(formatNumeric('123456789')).toBe('123 456 789');
  });

  it('decodes a valid all-digit short code as a short code', () => {
    expectCoordinate(-89.999909, -41.404562, decodeShort('22222-38462-99449'));
  });

  it('preserves leading zeros in numeric codes', () => {
    expect(encode(-90, -180).numericCode).toBe('0 000 000 000 000 000 009');
    expectCoordinate(-90, -180, decodeNumeric('0000000000000000009'));
  });

  it('rejects out of range and non-finite coordinates', () => {
    expect(() => encode(90.1, 0)).toThrow(RangeError);
    expect(() => encode(0, -180.1)).toThrow(RangeError);
    expect(() => encode(Number.NaN, 0)).toThrow(RangeError);
    expect(() => encode(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('rejects unknown future versions after a valid checksum', () => {
    expect(decodeNumeric(numericCodeForPayloadForTest(LOCATION_SPACE)).kind).toBe('UnsupportedVersion');
    expect(decodeNumeric('9'.repeat(18) + '0').kind).not.toBe('Success');
  });

  it('reports length and malformed input distinctly', () => {
    expect(decodeNumeric('123').kind).toBe('InvalidLength');
    expect(decodeNumeric('A370697756405661642').kind).toBe('MalformedNumericCode');
    expect(decodeShort('23G93-PU3ER').kind).toBe('InvalidLength');
    expect(decodeShort('ZZZZZZZZZZZZZ22').kind).toBe('MalformedShortCode');
  });

  it('normalizes case and separators like Kotlin', () => {
    expectCoordinate(12.971598, 77.594566, decodeShort('  23g93 pu3er-x2s3p  '));
    expectCoordinate(12.971598, 77.594566, decodeNumeric('\u00a00370-697 756\t405 661 642\u00a0'));
    // Java's regex \s is ASCII-only, so an interior no-break space is not a separator.
    expect(decodeNumeric('0370697756405\u00a0661642').kind).toBe('InvalidLength');
  });

  it('accepts Unicode decimal digits as Kotlin Char.isDigit does', () => {
    const arabicIndic = '0370697756405661642'.replace(/\d/g, (digit) => String.fromCharCode(0x0660 + Number(digit)));
    expectCoordinate(12.971598, 77.594566, decodeNumeric(arabicIndic));
  });

  it('rounds to the nearest six decimal grid position like Kotlin roundToLong', () => {
    expect(encode(0.0000004, 0).latitude).toBe(0);
    expect(encode(-0.0000004, 0).latitude).toBe(0);
    expect(encode(0.0000006, 0).latitude).toBe(0.000001);
    expect(encode(-0.0000006, 0).latitude).toBe(-0.000001);
    expect(encode(0, 179.9999996).longitude).toBe(180);
  });
});
