// Test-only: angular.json maps `.bklt` imports to bytes via the esbuild binary loader.
declare module '*.bklt' {
  const bytes: Uint8Array;
  export default bytes;
}
