/** Builds external links exactly like Android `MapLinkBuilder`. */

/** Java `String.format(Locale.US, "%.6f")` keeps the sign of negative zero; `toFixed` does not. */
export function formatFixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return Object.is(value, -0) ? `-${text}` : text;
}

export function coordinateText(latitude: number, longitude: number): string {
  return `${formatFixed(latitude, 6)},${formatFixed(longitude, 6)}`;
}

export function googleMapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinateText(latitude, longitude))}`;
}

export function googleMapsDirectionsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordinateText(latitude, longitude))}`;
}

export function openStreetMapUrl(latitude: number, longitude: number): string {
  const lat = formatFixed(latitude, 6);
  const lon = formatFixed(longitude, 6);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}
