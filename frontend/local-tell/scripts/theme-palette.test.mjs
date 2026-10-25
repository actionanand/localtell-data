import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('../src/styles.scss', import.meta.url), 'utf8');
function palette(pattern) {
  return Object.fromEntries([...styles.match(pattern)[1].matchAll(/--lt-([\w-]+):\s*(#[a-f\d]{6});/gi)].map(match => [match[1], match[2]]));
}
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('Android code palettes, button labels and keyboard focus meet contrast requirements', () => {
  for (const colors of [palette(/:root\s*\{([^}]+)\}/), palette(/:root\[data-theme='dark'\]\s*\{([^}]+)\}/)]) {
    assert.ok(contrast(colors['numeric-code'], colors.card) >= 7);
    assert.ok(contrast(colors['short-code'], colors.card) >= 7);
    assert.ok(contrast(colors['on-primary'], colors.primary) >= 4.5);
    for (const surface of [colors.bg, colors.surface, colors.card]) assert.ok(contrast(colors.focus, surface) >= 3);
  }
});