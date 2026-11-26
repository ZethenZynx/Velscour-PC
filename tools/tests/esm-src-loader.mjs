import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, sep } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..') + sep;

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.js')) {
    const path = fileURLToPath(url);
    if (path.startsWith(root + 'src' + sep)) {
      return { format: 'module', shortCircuit: true, source: await readFile(path, 'utf8') };
    }
  }
  return nextLoad(url, context);
}
