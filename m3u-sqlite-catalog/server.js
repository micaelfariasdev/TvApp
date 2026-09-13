import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './database.js';

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
      logo: row.logo || '',
      tvgId: row.tvgId || ''
    };
    res.write(`${first ? '' : ',\n'}    ${JSON.stringify(item)}`);
    first = false;
  }
  res.end('\n  ]\n}\n');
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Catálogo disponível em http://localhost:${process.env.PORT || 3000}`);
});
