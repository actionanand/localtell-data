import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PLACEHOLDER = 'DROPBOX_APP_KEY_PLACEHOLDER';
const root = fileURLToPath(new URL('../', import.meta.url));

export function validatedKey(value, required = false) {
  if (value === undefined || value === '') {
    if (required) throw new Error('DROPBOX_APP_KEY is required for deployment.');
    return '';
  }
  if (!/^[a-zA-Z0-9]{8,32}$/.test(value)) throw new Error('DROPBOX_APP_KEY has an invalid format.');
  return value;
}

export async function injectKey(file, value, required = false) {
  const key = validatedKey(value, required);
  const source = await readFile(file, 'utf8');
  const literal = `'${PLACEHOLDER}'`;
  if (source.split(PLACEHOLDER).length !== 2 || !source.includes(literal)) {
    throw new Error('Expected exactly one quoted Dropbox App key placeholder; refusing to change the file.');
  }
  await writeFile(file, source.replace(literal, JSON.stringify(key)));
}

export async function verifyBundle(directory, value, required = false) {
  const key = validatedKey(value, required);
  let found = false;
  let count = 0;
  async function scan(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (entry.name.endsWith('.js')) {
        count++;
        const source = await readFile(path, 'utf8');
        if (source.includes(PLACEHOLDER)) throw new Error('Unresolved Dropbox placeholder in production JavaScript.');
        if (key && ['"', "'", '`'].some((quote) => source.includes(quote + key + quote))) found = true;
      }
    }
  }
  await scan(directory);
  if (!count || (key && !found)) throw new Error('Production JavaScript does not contain the configured public App key.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const required = process.env.DROPBOX_KEY_REQUIRED === 'true';
    if (process.argv.includes('--verify')) {
      await verifyBundle(join(root, 'dist/local-tell/browser'), process.env.DROPBOX_APP_KEY, required);
      console.log('Dropbox production configuration verified.');
    } else {
      await injectKey(join(root, 'src/environments/environment.ts'), process.env.DROPBOX_APP_KEY, required);
      console.log('Dropbox build configuration prepared.');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}