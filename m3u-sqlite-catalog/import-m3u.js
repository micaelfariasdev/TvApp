import fs from 'node:fs/promises';
import { db } from './database.js';

const source = process.argv[2];
if (!source) {
  console.error('Uso: npm run import -- "caminho/para/lista.m3u" ou URL');
  process.exit(1);
}

const text = /^https?:\/\//i.test(source)
  ? await (await fetch(source)).text()
  : await fs.readFile(source, 'utf8');

function attribute(line, name) {
  return line.match(new RegExp(`${name}="([^"]*)"`, 'i'))?.[1]?.trim() ?? '';
}

function parseM3u(content) {
  const channels = [];
  let current = null;
  for (const sourceLine of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const comma = line.indexOf(',');
      current = {
        title: (comma >= 0 ? line.slice(comma + 1) : 'Sem título').trim() || 'Sem título',
        logo: attribute(line, 'tvg-logo'),
        group: attribute(line, 'group-title'),
        tvgId: attribute(line, 'tvg-id')
      };
    } else if (!line.startsWith('#') && current) {
      channels.push({ ...current, url: line });
      current = null;
    }
  }
  return channels;
}

const channels = parseM3u(text);
const insert = db.prepare(`
  INSERT INTO channels (title, url, logo, group_name, tvg_id)
  VALUES (?, ?, ?, ?, ?)
`);

db.exec('DELETE FROM channels');
db.exec('BEGIN');
try {
  for (const channel of channels) {
    insert.run(channel.title, channel.url, channel.logo, channel.group, channel.tvgId);
  }
  db.exec('COMMIT');
  console.log(`${channels.length} itens importados para catalog.db`);
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
