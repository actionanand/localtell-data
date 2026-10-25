import { encode } from '../location-code/local-tell-location-code';
import { parseLocationInput, type LocationInputResult, type LocationInputSource } from './location-input-parser';

function expectCoordinate(result: LocationInputResult, source: LocationInputSource): void {
  expect(result.kind).toBe('Coordinate');
  if (result.kind === 'Coordinate') expect(result.source).toBe(source);
}

/** Cases ported from Android LocationInputParserTest.kt. */
describe('parseLocationInput (Android compatibility)', () => {
  it('parses numeric and short LocalTell codes', () => {
    const encoded = encode(12.971598, 77.594566);
    expectCoordinate(parseLocationInput(encoded.numericCode), 'NUMERIC_CODE');
    expectCoordinate(parseLocationInput(encoded.shortCode), 'SHORT_CODE');
  });

  it('parses comma and whitespace coordinate pairs including negatives', () => {
    expectCoordinate(parseLocationInput(' 12.971598, 77.594566 '), 'COORDINATE');
    expectCoordinate(parseLocationInput('-8.181910  -77.352330'), 'COORDINATE');
    for (const value of ['12 77', '-12 77', '12 -77', '-12 -77', '+12.5,.5', '12.,77.']) {
      expectCoordinate(parseLocationInput(value), 'COORDINATE');
    }
  });

  it('keeps raw coordinate precision for coordinate input', () => {
    const result = parseLocationInput('12.9715984, 77.5945656');
    expect(result).toEqual({ kind: 'Coordinate', latitude: 12.9715984, longitude: 77.5945656, source: 'COORDINATE' });
  });

  it('handles numeric and all digit short forms structurally', () => {
    expectCoordinate(parseLocationInput('0370697756405661642'), 'NUMERIC_CODE');
    expectCoordinate(parseLocationInput('222223846299449'), 'SHORT_CODE');
    expectCoordinate(parseLocationInput('22222-38462-99449'), 'SHORT_CODE');
  });

  it('rejects invalid partial and ambiguous input', () => {
    for (const value of ['91, 0', '0, 181', 'hello', '1234', 'ABCDE-OFGHI-KMNPQ', '', '   ']) {
      expect(parseLocationInput(value).kind).toBe('Error');
    }
  });

  it('reports the decode reason for code failures', () => {
    expect(parseLocationInput('91, 0')).toEqual({ kind: 'Error', reason: 'OutOfRange' });
    expect(parseLocationInput('0 370 697 756 405 661 643')).toEqual({ kind: 'Error', reason: 'InvalidChecksum' });
    expect(parseLocationInput('23G93-PU3ER-X2S3Q')).toEqual({ kind: 'Error', reason: 'InvalidChecksum' });
    expect(parseLocationInput('23G93-PU3ER-X2SOP')).toEqual({ kind: 'Error', reason: 'InvalidCharacter' });
    expect(parseLocationInput('hello')).toEqual({ kind: 'Error', reason: null });
  });

  it('never treats an invalid code as coordinates', () => {
    const result = parseLocationInput('0370697756405661643');
    expect(result.kind).toBe('Error');
  });
});
