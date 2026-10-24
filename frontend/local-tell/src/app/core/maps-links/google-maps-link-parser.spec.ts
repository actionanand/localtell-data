import { looksLikeMapLink, parseGoogleMapsLink } from './google-maps-link-parser';
import { coordinateText, googleMapsDirectionsUrl, googleMapsUrl } from './map-link-builder';

describe('MapLinkBuilder (Android LocationLinksTest parity)', () => {
  it('formats locale independent six decimal coordinate text', () => {
    expect(coordinateText(12.971598, 77.594566)).toBe('12.971598,77.594566');
    expect(coordinateText(-0, 0)).toBe('-0.000000,0.000000');
  });

  it('keeps the trailing search path slash', () => {
    const url = googleMapsUrl(12.848793, 77.711493);
    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=12.848793%2C77.711493');
    expect(url).toContain('/maps/search/?');
  });

  it('builds a directions URL to the destination', () => {
    expect(googleMapsDirectionsUrl(-33.86882, 151.209296)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=-33.868820%2C151.209296',
    );
  });
});

describe('parseGoogleMapsLink', () => {
  it('reads coordinate queries', () => {
    expect(parseGoogleMapsLink('https://www.google.com/maps/search/?api=1&query=12.971598%2C77.594566')).toEqual({
      kind: 'coordinate',
      latitude: 12.971598,
      longitude: 77.594566,
      via: 'query',
    });
    expect(parseGoogleMapsLink('https://maps.google.com/?q=12.97,77.59')).toMatchObject({ kind: 'coordinate', latitude: 12.97 });
    expect(parseGoogleMapsLink('https://www.google.co.in/maps?q=loc:8.18191,77.35233')).toMatchObject({
      kind: 'coordinate',
      longitude: 77.35233,
    });
    expect(parseGoogleMapsLink('www.google.com/maps?q=1,2')).toMatchObject({ kind: 'coordinate', latitude: 1, longitude: 2 });
  });

  it('handles negative coordinates', () => {
    expect(parseGoogleMapsLink('https://www.google.com/maps/search/?api=1&query=-33.86882,-151.209296')).toMatchObject({
      latitude: -33.86882,
      longitude: -151.209296,
    });
  });

  it('prefers place marker data over the viewport centre', () => {
    const link =
      'https://www.google.com/maps/place/Bengaluru/@12.95,77.49,11z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d12.971598!4d77.594566';
    expect(parseGoogleMapsLink(link)).toEqual({ kind: 'coordinate', latitude: 12.971598, longitude: 77.594566, via: 'place-data' });
  });

  it('reads path coordinates and DMS place paths', () => {
    expect(parseGoogleMapsLink('https://www.google.com/maps/place/12.971598,77.594566/@12.97,77.59,17z')).toMatchObject({
      kind: 'coordinate',
      via: 'path',
      latitude: 12.971598,
    });
    const dms = parseGoogleMapsLink(
      'https://www.google.com/maps/place/12%C2%B058\'17.8%22N+77%C2%B035\'40.4%22E/@12.9716,77.5946,17z',
    );
    expect(dms).toMatchObject({ kind: 'coordinate', latitude: 12.971611, longitude: 77.594556 });
  });

  it('chooses the destination of a directions link', () => {
    expect(parseGoogleMapsLink('https://www.google.com/maps/dir/?api=1&origin=1,1&destination=8.1,77.3')).toMatchObject({
      latitude: 8.1,
      longitude: 77.3,
      via: 'destination',
    });
    expect(parseGoogleMapsLink('https://www.google.com/maps/dir/12.9,77.5/8.18,77.41/@10,77,8z')).toMatchObject({
      latitude: 8.18,
      longitude: 77.41,
    });
    expect(parseGoogleMapsLink('https://maps.google.com/maps?saddr=1,1&daddr=2,2+to:8.5,76.9')).toMatchObject({
      latitude: 8.5,
      longitude: 76.9,
    });
  });

  it('supports geo URIs', () => {
    expect(parseGoogleMapsLink('geo:12.97,77.59')).toMatchObject({ kind: 'coordinate', via: 'geo-uri' });
    expect(parseGoogleMapsLink('geo:0,0?q=8.18,77.41(Home)')).toMatchObject({ latitude: 8.18, longitude: 77.41 });
  });

  it('rejects invalid hostnames and protocols', () => {
    expect(parseGoogleMapsLink('https://evil.example/maps?q=1,2')).toEqual({ kind: 'error', reason: 'unsupported-host' });
    expect(parseGoogleMapsLink('https://google.com.evil.example/maps?q=1,2')).toEqual({ kind: 'error', reason: 'unsupported-host' });
    expect(parseGoogleMapsLink('https://user@www.google.com/maps?q=1,2')).toEqual({ kind: 'error', reason: 'unsupported-host' });
    expect(parseGoogleMapsLink('javascript:alert(1)')).toEqual({ kind: 'error', reason: 'unsupported-protocol' });
    expect(parseGoogleMapsLink('ftp://www.google.com/maps?q=1,2')).toEqual({ kind: 'error', reason: 'unsupported-protocol' });
  });

  it('rejects out of range coordinates', () => {
    expect(parseGoogleMapsLink('https://www.google.com/maps?q=91,0')).toEqual({ kind: 'error', reason: 'out-of-range' });
    expect(parseGoogleMapsLink('https://www.google.com/maps?q=0,181')).toEqual({ kind: 'error', reason: 'out-of-range' });
  });

  it('marks viewport-only URLs for explicit confirmation', () => {
    expect(parseGoogleMapsLink('https://www.google.com/maps/@12.9716,77.5946,15z')).toEqual({
      kind: 'viewport-only',
      latitude: 12.9716,
      longitude: 77.5946,
    });
  });

  it('reports opaque short links without inventing coordinates', () => {
    expect(parseGoogleMapsLink('https://maps.app.goo.gl/AbCdEf123')).toEqual({ kind: 'short-link' });
    expect(parseGoogleMapsLink('https://goo.gl/maps/xyz')).toEqual({ kind: 'short-link' });
  });

  it('reports address-only links and oversize input', () => {
    expect(parseGoogleMapsLink('https://www.google.com/maps/search/?api=1&query=MG+Road+Bengaluru')).toEqual({
      kind: 'error',
      reason: 'address-only',
    });
    expect(parseGoogleMapsLink(`https://www.google.com/maps?q=1,2&x=${'a'.repeat(5000)}`)).toEqual({
      kind: 'error',
      reason: 'too-long',
    });
  });

  it('rejects conflicting marker data', () => {
    expect(parseGoogleMapsLink('https://www.google.com/maps/place/x/data=!3d1.5!4d2.5!3d3.5!4d4.5')).toEqual({
      kind: 'error',
      reason: 'ambiguous',
    });
  });

  it('detects link-like input', () => {
    expect(looksLikeMapLink('https://maps.app.goo.gl/x')).toBe(true);
    expect(looksLikeMapLink('google.com/maps?q=1,2')).toBe(true);
    expect(looksLikeMapLink('12.97, 77.59')).toBe(false);
    expect(looksLikeMapLink('23G93-PU3ER-X2S3P')).toBe(false);
  });
});
