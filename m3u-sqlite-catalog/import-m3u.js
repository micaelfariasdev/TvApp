import fs from 'node:fs/promises';
import { importChannels, parseM3u } from './m3u-import.js';

const source = process.argv[2];
if (!source) {
  console.error('Uso: npm run import -- "caminho/para/lista.m3u" ou URL');
  process.exit(1);
}

const text = /^https?:\/\//i.test(source)
  ? await (await fetch(source)).text()
  : await fs.readFile(source, 'utf8');

const channels = parseM3u(text);
const result = importChannels(channels);
console.log(`${result.added} novidades adicionadas ao catalog.db${result.alreadyImported ? ` (${result.alreadyImported} já existentes ignorados)` : ''}${result.duplicates ? ` (${result.duplicates} duplicatas na lista ignoradas)` : ''}`);
