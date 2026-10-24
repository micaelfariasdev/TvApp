import { db } from './database.js';

function attribute(line, name) {
  return line.match(new RegExp(`${name}="([^"]*)"`, 'i'))?.[1]?.trim() ?? '';
}

export function parseM3u(content) {
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

export function importChannels(channels) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO channels (title, url, logo, group_name, tvg_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  const seenUrls = new Set();
  let duplicates = 0;
  let added = 0;
  let alreadyImported = 0;

  db.exec('BEGIN');
  try {
    for (const channel of channels) {
      if (seenUrls.has(channel.url)) {
        duplicates++;
        continue;
      }
      seenUrls.add(channel.url);
      const result = insert.run(channel.title, channel.url, channel.logo, channel.group, channel.tvgId);
      if (result.changes > 0) added++;
      else alreadyImported++;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { added, alreadyImported, duplicates };
}
