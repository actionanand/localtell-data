// Test-only: angular.json maps `.wasm` imports to bytes via the esbuild binary loader.
declare module '*.wasm' {
  const bytes: Uint8Array;
  export default bytes;
}
