import type { IpProviderId } from '../config/app-config';

export interface IpLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly country: string | null;
  readonly countryCode: string | null;
  readonly region: string | null;
  readonly city: string | null;
  readonly ip: string | null;
  readonly provider: string;
  readonly timestamp: number;
}

export interface IpGeolocationProvider {
  readonly id: Exclude<IpProviderId, 'none'>;
  readonly endpoint: string;
  parse(body: unknown, now: number): IpLocation;
}

export class IpLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpLookupError';
  }
}

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new IpLookupError('Unexpected provider response');
  return value as Json;
}

function optionalText(body: Json, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200 ? value.trim() : null;
}

function coordinate(body: Json, latKey: string, lonKey: string): { latitude: number; longitude: number } {
  const latitude = Number(body[latKey]);
  const longitude = Number(body[lonKey]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new IpLookupError('The provider did not return valid coordinates');
  }
  return { latitude, longitude };
}

/** https://ipapi.co/api/#complete-location — HTTPS, CORS-enabled, no key for low volume. */
export const IPAPI_CO: IpGeolocationProvider = {
  id: 'ipapi-co',
  endpoint: 'https://ipapi.co/json/',
  parse(raw, now) {
    const body = record(raw);
    if (body['error'] === true) throw new IpLookupError(optionalText(body, 'reason') ?? 'The provider rejected the request');
    return {
      ...coordinate(body, 'latitude', 'longitude'),
      country: optionalText(body, 'country_name'),
      countryCode: optionalText(body, 'country_code'),
      region: optionalText(body, 'region'),
      city: optionalText(body, 'city'),
      ip: optionalText(body, 'ip'),
      provider: 'ipapi.co',
      timestamp: now,
    };
  },
};

/** https://ipwho.is — HTTPS, CORS-enabled, no key for non-commercial use. */
export const IPWHO_IS: IpGeolocationProvider = {
  id: 'ipwho-is',
  endpoint: 'https://ipwho.is/',
  parse(raw, now) {
    const body = record(raw);
    if (body['success'] === false) throw new IpLookupError(optionalText(body, 'message') ?? 'The provider rejected the request');
    return {
      ...coordinate(body, 'latitude', 'longitude'),
      country: optionalText(body, 'country'),
      countryCode: optionalText(body, 'country_code'),
      region: optionalText(body, 'region'),
      city: optionalText(body, 'city'),
      ip: optionalText(body, 'ip'),
      provider: 'ipwho.is',
      timestamp: now,
    };
  },
};

export const IP_PROVIDERS: Readonly<Record<Exclude<IpProviderId, 'none'>, IpGeolocationProvider>> = {
  'ipapi-co': IPAPI_CO,
  'ipwho-is': IPWHO_IS,
};
