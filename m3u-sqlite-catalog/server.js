import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './database.js';
import { importChannels, parseM3u } from './m3u-import.js';

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const escapeLike = value => value.replace(/[\\%_]/g, '\\$&');
const positiveInt = (value, fallback, max) => Math.min(Math.max(Number.parseInt(value, 10) || fallback, 1), max);

function filtersFromQuery(query) {
  const group = String(query.group ?? '');
  const term = String(query.q ?? '').trim();
  const clauses = [];
  const params = [];
  if (group) { clauses.push('group_name = ?'); params.push(group); }
  if (term) {
    clauses.push("(title LIKE ? ESCAPE '\\' OR group_name LIKE ? ESCAPE '\\' OR tvg_id LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(term)}%`;
    params.push(like, like, like);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params, group, term };
}

app.use(express.static(path.join(root, 'public')));

app.post('/api/import', express.text({ type: 'text/plain', limit: '50mb' }), (req, res) => {
  if (typeof req.body !== 'string') {
    res.status(400).json({ error: 'Envie o conteúdo de um arquivo M3U.' });
    return;
  }

  const channels = parseM3u(req.body);
  if (channels.length === 0) {
    res.status(400).json({ error: 'O arquivo não contém canais M3U válidos.' });
    return;
  }

  try {
    res.json(importChannels(channels));
  } catch (error) {
    console.error('Erro ao importar arquivo M3U:', error);
    res.status(500).json({ error: 'Não foi possível importar o arquivo M3U.' });
  }
});

app.get('/api/stats', (_req, res) => {
  res.json(db.prepare('SELECT COUNT(*) AS total FROM channels').get());
});

app.get('/api/groups', (_req, res) => {
  const groups = db.prepare(`
    SELECT group_name AS name, COUNT(*) AS total
    FROM channels
    GROUP BY group_name
    ORDER BY total DESC, name COLLATE NOCASE
  `).all();
  res.json(groups);
});

app.get('/api/channels', (req, res) => {
  const page = positiveInt(req.query.page, 1, 1_000_000);
  // Página pequena evita transferir e carregar dezenas de imagens de uma vez.
  const pageSize = positiveInt(req.query.pageSize, 24, 48);
  const { where, params } = filtersFromQuery(req.query);
  const channels = db.prepare(`
    SELECT id, title, url, logo, group_name AS groupName, tvg_id AS tvgId
    FROM channels ${where}
    ORDER BY title COLLATE NOCASE
    LIMIT ? OFFSET ?
  `).all(...params, pageSize + 1, (page - 1) * pageSize);
  // Evita COUNT(*) nas 216 mil linhas a cada pesquisa.
  const hasMore = channels.length > pageSize;
  res.json({ channels: channels.slice(0, pageSize), page, pageSize, hasMore });
});

// Exporta todos os itens do filtro atual, sem a limitação de 24 itens da tela.
// O resultado pode ser enviado diretamente ao painel do TVBox para importar.
app.get('/api/kick/channels', (_req, res) => {
  // Lista de streamers da Kick para verificar status
  const kickStreamers = [
    'streamer1', 'streamer2', 'streamer3', 'streamer4', 'streamer5',
    'streamer6', 'streamer7', 'streamer8', 'streamer9', 'streamer10'
  ];

  async function fetchChannel(name) {
    try {
      const fetch = await import('node-fetch');
      const response = await fetch.default(`https://kick.com/api/v2/channels/${name}`);
      const data = await response.json();
      return { name, livestream: data.livestream ?? null };
    } catch (error) {
      console.error(`Erro ao buscar ${name}:`, error);
      return { name, livestream: null };
    }
  }

  Promise.all(kickStreamers.map(fetchChannel))
    .then(results => {
      const live = results.filter(r => r.livestream !== null);
      const offline = results.filter(r => r.livestream === null);
      res.json({ live, offline });
    })
    .catch(error => {
      console.error('Erro ao consultar channels Kick:', error);
      res.status(500).json({ error: 'Erro ao consultar channels Kick' });
    });
});

app.get('/api/export/tvbox.json', (req, res) => {
  const { where, params, group, term } = filtersFromQuery(req.query);
  const rows = db.prepare(`
    SELECT title, url, logo, group_name AS groupName, tvg_id AS tvgId
    FROM channels ${where}
    ORDER BY title COLLATE NOCASE
  `).iterate(...params);
  const filename = `tvbox-${(group || term || 'catalogo').replace(/[^a-z0-9_-]/gi, '-').slice(0, 60)}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.write(`{\n  "format": "tvbox-import/v1",\n  "exportedAt": ${JSON.stringify(new Date().toISOString())},\n  "filters": ${JSON.stringify({ group, query: term })},\n  "channels": [\n`);
  let first = true;
  for (const row of rows) {
    const item = {
      name: row.title,
      url: row.url,
      type: /\.mp4(?:[?#]|$)/i.test(row.url) ? 'mp4' : 'hls',
      category: row.groupName || 'm3u',
      // O TVBox usa `poster`; `logo` fica para compatibilidade com exportações antigas.
      poster: row.logo || '',
      logo: row.logo || '',
      tvgId: row.tvgId || ''
    };
    res.write(`${first ? '' : ',\n'}    ${JSON.stringify(item)}`);
    first = false;
  }
  res.end('\n  ]\n}\n');
});

app.listen(process.env.PORT || 3001, () => {
  console.log(`Catálogo disponível em http://localhost:${process.env.PORT || 3001}`);
});
