import { dropboxSdkNamespace } from './dropbox-sdk';

describe('Dropbox SDK production interop', () => {
  const constructors = { Dropbox: class {}, DropboxAuth: class {} };

  it('accepts the named development exports', () => {
    expect(dropboxSdkNamespace(constructors)).toBe(constructors);
  });

  it('accepts the UMD default namespace emitted by the production builder', () => {
    expect(dropboxSdkNamespace({ default: constructors })).toBe(constructors);
  });

  it('rejects malformed exports with a recoverable message', () => {
    expect(() => dropboxSdkNamespace({ default: {} })).toThrow('Reload the page');
  });
});