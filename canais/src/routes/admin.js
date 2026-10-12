const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { PASSWORD } = require("../config/env");
const {
  loadDB,
  saveDB,
  loadSeriesCatalog,
  saveSeriesCatalog,
} = require("../services/db");
const { loadCategoriesMeta, saveCategoriesMeta } = require("../services/db");
const { loadHomeConfig, saveHomeConfig } = require("../services/db");

const { findPoster } = require("../services/poster");
const {
  hasTvboxSession,
  requireTvboxAccess,
  clearSession,
  signSession,
  passwordMatches,
  safeText,
  removeLegacyPasswordFromHtml,
  SESSION_COOKIE,
} = require("../utils/helpers");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

const SERIES_DIRECTORY = path.join(__dirname, "../../series");
const TEMPLATES_DIRECTORY = path.join(__dirname, "../../templates");
const SESSION_DURATION_MS = 1000 * 60 * 60 * 12;

function tvboxPage(title, body) {
  const layout = fs.readFileSync(
    path.join(TEMPLATES_DIRECTORY, "tvbox.html"),
    "utf-8",
  );
  const navigation = `<nav class="actions app-navigation"><a class="btn" href="/tvbox">Visão geral</a><a class="btn" href="/tvbox/home">Home</a><a class="btn" href="/tvbox/categories">Categorias</a><a class="btn" href="/tvbox/series">Séries</a><a class="btn" href="/tvbox/hls">Canais HLS</a><form method="post" action="/tvbox/posters/fill" onsubmit="return confirm('Buscar capas para todos os filmes sem foto?')"><button class="btn" type="submit">Buscar capas faltantes</button></form><form method="post" action="/tvbox/logout"><button class="btn danger" type="submit">Sair</button></form></nav>`;
  return removeLegacyPasswordFromHtml(
    layout
      .replaceAll("{{title}}", safeText(title))
      .replaceAll("{{password}}", "")
      .replace("{{body}}", `${navigation}${body}`),
  );
}

function loginPage(message = "") {
  const layout = fs.readFileSync(
    path.join(TEMPLATES_DIRECTORY, "tvbox.html"),
    "utf-8",
  );
  const warning = message
    ? `<p class="login-message">${safeText(message)}</p>`
    : "";
  return layout
    .replaceAll("{{title}}", "Entrar")
    .replaceAll("{{password}}", "")
    .replace(
      "{{body}}",
      `<section class="login-shell"><div class="login-brand"><span class="brand-mark">▶</span><div><strong>TVBox</strong><small>Central de catálogo</small></div></div><h1>Bem-vindo de volta</h1><p>Entre para administrar filmes, séries, canais e listas ao vivo.</p>${warning}<form method="post" action="/tvbox/login"><label>Senha do painel</label><input type="password" name="password" autocomplete="current-password" autofocus required><button class="btn primary login-submit" type="submit">Entrar no painel</button></form></section>`,
    );
}

router.get("/login", (req, res) => {
  if (hasTvboxSession(req)) return res.redirect("/tvbox");
  if (!PASSWORD)
    return res
      .status(503)
      .send(
        loginPage(
          "Configure TVBOX_PASSWORD no servidor antes de usar o painel.",
        ),
      );
  res.send(
    loginPage(
      req.query.error === "1" ? "Senha inválida. Tente novamente." : "",
    ),
  );
});

router.post("/login", (req, res) => {
  if (!PASSWORD)
    return res
      .status(503)
      .send(loginPage("Configuração de segurança ausente no servidor."));
  if (!passwordMatches(req.body.password))
    return res.redirect("/tvbox/login?error=1");
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  res.cookie(SESSION_COOKIE, signSession({ expiresAt }), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    path: "/tvbox",
    maxAge: SESSION_DURATION_MS,
  });
  res.redirect("/tvbox");
});

router.post("/logout", (req, res) => {
  clearSession(res);
  res.redirect("/tvbox/login");
});

router.use((req, res, next) => {
  if (
    req.path === "/login" ||
    req.path.startsWith("/api/")
  ) {
    return next();
  }

  if (requireTvboxAccess(req, res)) return next();
});

router.get("/api/channels", (req, res) => {
  const dbData = loadDB();
  const categoriesMeta = loadCategoriesMeta();
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0];
  const baseUrl = `${forwardedProto || req.protocol}://${req.get("host")}`;

  const cleanData = dbData.map(({ id, name, url, type, category, poster, source }) => {
    const categoryKey = String(category || "outros").trim();
    const categoryPoster = categoriesMeta[categoryKey]?.poster || null;

    const proxyUrl = source === "embedtv-channels"
      ? `${baseUrl}/tvbox/api/live/${encodeURIComponent(id)}.m3u8`
      : url;
    return {
      id,
      name,
      url: proxyUrl,
      type,
      category,
      poster: poster || categoryPoster,
    };
  });

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(cleanData);
});

// Configuração pública consumida pelo app Android. A edição continua protegida
// pelo middleware da rota /tvbox.
router.get("/api/home", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(loadHomeConfig());
});

router.get("/home", (req, res) => {
  const config = loadHomeConfig();

  const categories = [
    ...new Set(
      loadDB().map(
        (item) => String(item.category || "outros").trim() || "outros",
      ),
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const enabledCategories = new Set(
    config.sections
      .filter(
        (section) => section.type === "category" && section.enabled !== false,
      )
      .map((section) =>
        String(section.category || "").toLocaleLowerCase("pt-BR"),
      ),
  );

  const hasKick = config.sections.some(
    (section) => section.type === "kick-live" && section.enabled !== false,
  );

  const hasSeries = config.sections.some(
    (section) => section.type === "series" && section.enabled !== false,
  );

  const categoryOptions =
    categories
      .map((category) => {
        const checked = enabledCategories.has(
          category.toLocaleLowerCase("pt-BR"),
        )
          ? "checked"
          : "";

        return `
        <label class="card" style="display:flex;align-items:center;gap:12px;padding:14px">
          <input
            type="checkbox"
            name="categories"
            value="${safeText(category)}"
            ${checked}
          >
          <span>
            <strong>${safeText(category)}</strong>
            <small class="muted" style="display:block;margin-top:3px">
              Exibir uma fileira desta categoria no app.
            </small>
          </span>
        </label>
      `;
      })
      .join("") ||
    '<p class="empty">Cadastre conteúdos com categoria antes de configurar a Home.</p>';

  const template = fs.readFileSync(
    path.join(TEMPLATES_DIRECTORY, "tvbox-home.html"),
    "utf-8",
  );

  const body = template
    .replace("{{categoryOptions}}", categoryOptions)
    .replace("{{kickChecked}}", hasKick ? "checked" : "")
    .replace("{{seriesChecked}}", hasSeries ? "checked" : "")
    .replace(
      "{{savedMessage}}",
      req.query.saved
        ? '<p class="login-message">Página inicial salva. Atualize o catálogo no app para aplicar.</p>'
        : "",
    );

  res.send(tvboxPage("Página inicial", body));
});

// Dados dinâmicos da Home
router.get("/home/data", (req, res) => {
  try {
    const config = loadHomeConfig();

    const categories = [
      ...new Set(
        loadDB().map(
          (item) => String(item.category || "outros").trim() || "outros",
        ),
      ),
    ].sort((a, b) => a.localeCompare(b, "pt-BR"));

    const enabledCategories = config.sections
      .filter(
        (section) => section.type === "category" && section.enabled !== false,
      )
      .map((section) =>
        String(section.category || "").toLocaleLowerCase("pt-BR"),
      );

    res.json({
      saved: req.query.saved === "1",
      showKick: config.sections.some(
        (section) => section.type === "kick-live" && section.enabled !== false,
      ),
      showSeries: config.sections.some(
        (section) => section.type === "series" && section.enabled !== false,
      ),
      categories: categories.map((category) => ({
        name: category,
        enabled: enabledCategories.includes(
          category.toLocaleLowerCase("pt-BR"),
        ),
      })),
    });
  } catch (error) {
    console.error("[HOME] Erro:", error);

    res.status(500).json({
      error: "Erro ao carregar configuração da Home",
    });
  }
});

router.post("/home", (req, res) => {
  const selected = Array.isArray(req.body.categories)
    ? req.body.categories
    : req.body.categories
      ? [req.body.categories]
      : [];
  const sections = [];
  if (req.body.showKick) {
    sections.push({
      id: "kick-live",
      type: "kick-live",
      title: "Ao vivo na Kick",
      enabled: true,
      limit: 40,
    });
  }
  selected
    .map((value) => String(value).trim())
    .filter(Boolean)
    .forEach((category) => {
      sections.push({
        id: `category-${category.toLocaleLowerCase("pt-BR")}`,
        type: "category",
        category,
        title: category,
        enabled: true,
        limit: 18,
      });
    });
  if (req.body.showSeries)
    sections.push({
      id: "series",
      type: "series",
      title: "Séries",
      enabled: true,
      limit: 18,
    });
  saveHomeConfig({ sections });
  res.redirect("/tvbox/home?saved=1");
});

router.get("/api/poster", async (req, res) => {
  const title = String(req.query.title || "").trim();
  const kind = req.query.kind === "tv" ? "tv" : "movie";
  if (!title)
    return res.status(400).json({ error: "Informe um título para buscar." });
  const result = await findPoster(title, kind);
  if (!result)
    return res.status(404).json({ error: "Nenhuma capa encontrada." });
  res.json(result);
});

router.post("/posters/fill", async (req, res) => {
  const dbData = loadDB();
  let updated = 0;
  for (const item of dbData) {
    if (item.poster) continue;
    const result = await findPoster(item.name, "movie");
    if (result?.poster) {
      item.poster = result.poster;
      updated++;
    }
  }
  saveDB(dbData);
  res.redirect(`/tvbox?covers=${updated}`);
});

router.post("/series/posters/fill", async (req, res) => {
  const catalog = loadSeriesCatalog();
  let updated = 0;
  for (const item of catalog) {
    if (item.poster) continue;
    const result = await findPoster(item.title || item.name || item.id, "tv");
    if (!result?.poster) continue;
    item.poster = result.poster;
    const file = path.join(SERIES_DIRECTORY, `${item.id}.json`);
    if (fs.existsSync(file)) {
      const details = JSON.parse(fs.readFileSync(file, "utf-8"));
      details.poster = result.poster;
      fs.writeFileSync(file, JSON.stringify(details, null, 2), "utf-8");
    }
    updated++;
  }
  saveSeriesCatalog(catalog);
  res.redirect(`/tvbox/series?covers=${updated}`);
});

router.get("/api/series", (req, res) => {
  const catalog = loadSeriesCatalog().map((item) => ({
    id: item.id,
    title: item.title || item.name || item.id,
    poster: item.poster || null,
    endpoint: `/tvbox/api/series/${encodeURIComponent(item.id)}`,
  }));
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(catalog);
});

router.get("/api/series/:id", (req, res) => {
  const id = req.params.id;
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    return res.status(400).json({ error: "Invalid series id" });
  const file = path.join(SERIES_DIRECTORY, `${id}.json`);
  if (!fs.existsSync(file))
    return res.status(404).json({ error: "Series not found" });
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.type("application/json").send(fs.readFileSync(file, "utf-8"));
});

router.get("/series", (req, res) => {
  const series = loadSeriesCatalog();
  const cards = series.length
    ? series
        .map(
          (item) =>
            `<article class="card"><div class="row"><span class="badge">SÉRIE</span><div class="actions"><a class="btn" href="/tvbox/series/${encodeURIComponent(item.id)}">Abrir</a><a class="btn danger" href="/tvbox/series/${encodeURIComponent(item.id)}/delete" onclick="return confirm('Excluir a série e todas as temporadas e episódios?')">Excluir</a></div></div><h2 style="margin-top:14px">${safeText(item.title)}</h2><p class="muted">ID: ${safeText(item.id)}<br>Endpoint: ${safeText(item.endpoint || `series/${item.id}.json`)}</p></article>`,
        )
        .join("")
    : '<div class="empty">Nenhuma série cadastrada ainda.</div>';

  const templateContent = fs.readFileSync(
    path.join(TEMPLATES_DIRECTORY, "tvbox-series.html"),
    "utf-8",
  );
  const body = templateContent.replace("{{cards}}", cards);
  res.send(tvboxPage("Séries", body));
});

router.get("/series/add", (req, res) => {
  const body = fs.readFileSync(
    path.join(TEMPLATES_DIRECTORY, "tvbox-series-add.html"),
    "utf-8",
  );
  res.send(tvboxPage("Nova série", body));
});

router.post("/series/add", (req, res) => {
  const id = String(req.body.id || "").trim();
  const title = String(req.body.title || "").trim();
  const poster = String(req.body.poster || "").trim();
  if (!title || !/^[A-Za-z0-9_-]+$/.test(id))
    return res
      .status(400)
      .send(
        tvboxPage(
          "Erro",
          '<section class="panel"><h1>Dados inválidos</h1><p class="muted">Use um título e um ID válido.</p></section>',
        ),
      );
  const catalog = loadSeriesCatalog();
  const file = path.join(SERIES_DIRECTORY, `${id}.json`);
  if (catalog.some((item) => item.id === id) || fs.existsSync(file))
    return res
      .status(409)
      .send(
        tvboxPage(
          "Erro",
          `<section class="panel"><h1>Essa série já existe</h1><a class="btn" href="/tvbox/series">Voltar</a></section>`,
        ),
      );
  fs.mkdirSync(SERIES_DIRECTORY, { recursive: true });
  const validPoster = /^https?:\/\//i.test(poster) ? poster : null;
  catalog.push({
    id,
    title,
    endpoint: `series/${id}.json`,
    poster: validPoster,
  });
  saveSeriesCatalog(catalog);
  fs.writeFileSync(
    file,
    JSON.stringify({ title, poster: validPoster, seasons: [] }, null, 2),
    "utf-8",
  );
  res.redirect(`/tvbox/series/${encodeURIComponent(id)}`);
});

router.get("/series/:id", (req, res) => {
  const id = req.params.id;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return res.status(400).send("ID inválido");
  const file = path.join(SERIES_DIRECTORY, `${id}.json`);
  if (!fs.existsSync(file)) return res.status(404).send("Série não encontrada");
  const data = JSON.parse(fs.readFileSync(file, "utf-8"));
  const seasons = Array.isArray(data.seasons) ? data.seasons : [];
  const catalogItem = loadSeriesCatalog().find((item) => item.id === id);
  const currentPoster = String(data.poster || catalogItem?.poster || "");
  const coverForm = `<form method="post" action="/tvbox/series/${encodeURIComponent(id)}/poster" class="row" style="margin:18px 0"><div style="min-width:260px;flex:1"><label style="margin-top:0">Capa da série</label><input type="url" name="poster" value="${safeText(currentPoster)}" placeholder="https://site.com/capa.jpg"></div><button class="btn" style="margin-top:25px">Salvar capa</button></form>`;
  const seasonCards = seasons.length
    ? seasons
        .sort((a, b) => a.number - b.number)
        .map(
          (season) =>
            `<article class="card"><div class="row"><div><span class="badge">TEMPORADA ${season.number}</span><h2 style="margin-top:12px">${(season.episodes || []).length} episódio(s)</h2></div><a class="btn danger" href="/tvbox/series/${id}/season/${season.number}/delete">Excluir temporada</a></div><table><tr><th>#</th><th>Título</th><th class="hide-mobile">URL</th><th>Tipo</th><th></th></tr>${(
              season.episodes || []
            )
              .sort((a, b) => a.number - b.number)
              .map(
                (ep) =>
                  `<tr><td>${ep.number}</td><td>${safeText(ep.title || `Episódio ${ep.number}`)}</td><td class="url hide-mobile">${safeText(ep.url)}</td><td><span class="badge">${safeText(ep.type || "mp4")}</span></td><td><a class="btn danger" href="/tvbox/series/${id}/season/${season.number}/episode/${ep.number}/delete">Excluir</a></td></tr>`,
              )
              .join(
                "",
              )}</table><form method="post" action="/tvbox/series/${id}/season/${season.number}/episodes"><h3 style="margin-top:20px">Adicionar episódio</h3><div class="grid"><div><label>Número</label><input type="number" min="1" name="number" required></div><div><label>Título</label><input name="title" required placeholder="Episódio ${(season.episodes || []).length + 1}"></div></div><label>URL do vídeo</label><input type="url" name="url" required placeholder="https://...mp4"><label>Tipo</label><select name="type"><option value="mp4">MP4</option><option value="hls">HLS</option></select><div class="actions" style="margin-top:16px"><button class="btn primary">Adicionar episódio</button></div></form></article>`,
        )
        .join("")
    : '<div class="empty">Adicione a primeira temporada para começar.</div>';

  const templateContent = fs.readFileSync(
    path.join(TEMPLATES_DIRECTORY, "tvbox-series-detail.html"),
    "utf-8",
  );
  const body = templateContent
    .replaceAll("{{title}}", safeText(data.title || id))
    .replaceAll("{{id}}", safeText(id))
    .replace("{{coverForm}}", coverForm)
    .replace("{{seasonCards}}", seasonCards);

  res.send(tvboxPage(data.title || id, body));
});

router.post("/series/:id/poster", (req, res) => {
  const id = req.params.id;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return res.status(400).send("ID inválido");
  const file = path.join(SERIES_DIRECTORY, `${id}.json`);
  if (!fs.existsSync(file)) return res.status(404).send("Série não encontrada");
  const poster = String(req.body.poster || "").trim();
  const validPoster = /^https?:\/\//i.test(poster) ? poster : null;
  const details = JSON.parse(fs.readFileSync(file, "utf-8"));
  details.poster = validPoster;
  fs.writeFileSync(file, JSON.stringify(details, null, 2), "utf-8");
  const catalog = loadSeriesCatalog();
  const index = catalog.findIndex((item) => item.id === id);
  if (index >= 0) catalog[index].poster = validPoster;
  saveSeriesCatalog(catalog);
  res.redirect(`/tvbox/series/${encodeURIComponent(id)}`);
});

router.post("/series/:id/seasons", (req, res) => {
  const id = req.params.id,
    number = Number(req.body.number),
    file = path.join(SERIES_DIRECTORY, `${id}.json`);
  if (!fs.existsSync(file) || !Number.isInteger(number) || number < 1)
    return res.status(400).send("Temporada inválida");
  const data = JSON.parse(fs.readFileSync(file, "utf-8"));
  data.seasons ||= [];
  if (!data.seasons.some((s) => Number(s.number) === number))
    data.seasons.push({ number, episodes: [] });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  res.redirect(`/tvbox/series/${id}`);
});

router.post("/series/:id/season/:season/episodes", (req, res) => {
  const id = req.params.id,
    seasonNumber = Number(req.params.season),
    number = Number(req.body.number),
    file = path.join(SERIES_DIRECTORY, `${id}.json`);
  if (
    !fs.existsSync(file) ||
    !Number.isInteger(number) ||
    number < 1 ||
    !req.body.url
  )
    return res.status(400).send("Episódio inválido");
  const data = JSON.parse(fs.readFileSync(file, "utf-8"));
  const season = (data.seasons || []).find(
    (s) => Number(s.number) === seasonNumber,
  );
  if (!season) return res.status(404).send("Temporada não encontrada");
  season.episodes ||= [];
  season.episodes = season.episodes.filter(
    (ep) => Number(ep.number) !== number,
  );
  season.episodes.push({
    number,
    title: String(req.body.title || `Episódio ${number}`),
    url: String(req.body.url),
    type: req.body.type === "hls" ? "hls" : "mp4",
  });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  res.redirect(`/tvbox/series/${id}`);
});

router.get("/series/:id/season/:season/delete", (req, res) => {
  const { id } = req.params,
    seasonNumber = Number(req.params.season),
    file = path.join(SERIES_DIRECTORY, `${id}.json`);
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    data.seasons = (data.seasons || []).filter(
      (s) => Number(s.number) !== seasonNumber,
    );
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  }
  res.redirect(`/tvbox/series/${id}`);
});

router.get("/series/:id/season/:season/episode/:episode/delete", (req, res) => {
  const { id } = req.params,
    seasonNumber = Number(req.params.season),
    episodeNumber = Number(req.params.episode),
    file = path.join(SERIES_DIRECTORY, `${id}.json`);
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    const season = (data.seasons || []).find(
      (s) => Number(s.number) === seasonNumber,
    );
    if (season)
      season.episodes = (season.episodes || []).filter(
        (ep) => Number(ep.number) !== episodeNumber,
      );
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  }
  res.redirect(`/tvbox/series/${id}`);
});

router.get("/import/m3u", (req, res) => {
  const seriesOptions =
    loadSeriesCatalog()
      .map(
        (item) =>
          `<option value="${safeText(item.id)}">${safeText(item.title)}</option>`,
      )
      .join("") || '<option value="">Nenhuma série cadastrada</option>';
  const body = fs
    .readFileSync(path.join(TEMPLATES_DIRECTORY, "tvbox-import.html"), "utf-8")
    .replace("{{seriesOptions}}", seriesOptions);
  res.send(tvboxPage("Importar M3U", body));
});

router.post("/import/m3u", upload.single("catalog"), (req, res) => {
  if (!req.file)
    return res
      .status(400)
      .send(
        tvboxPage(
          "Importar M3U",
          '<section class="panel"><h1>Arquivo ausente</h1><p class="muted">Selecione o JSON exportado pelo catálogo M3U.</p></section>',
        ),
      );
  let payload;
  try {
    payload = JSON.parse(req.file.buffer.toString("utf-8"));
  } catch {
    return res
      .status(400)
      .send(
        tvboxPage(
          "Importar M3U",
          '<section class="panel"><h1>JSON inválido</h1><p class="muted">O arquivo não pôde ser lido.</p></section>',
        ),
      );
  }
  const incoming = Array.isArray(payload) ? payload : payload.channels;
  if (!Array.isArray(incoming))
    return res
      .status(400)
      .send(
        tvboxPage(
          "Importar M3U",
          '<section class="panel"><h1>Formato inválido</h1><p class="muted">Use o arquivo gerado pelo catálogo M3U.</p></section>',
        ),
      );
  if (req.body.target === "episodes") {
    const seriesId = String(req.body.seriesId || "");
    const seasonNumber = Number(req.body.seasonNumber);
    const startEpisode = Number(req.body.startEpisode) || 1;
    const seriesFile = path.join(SERIES_DIRECTORY, `${seriesId}.json`);
    if (
      !/^[A-Za-z0-9_-]+$/.test(seriesId) ||
      !fs.existsSync(seriesFile) ||
      !Number.isInteger(seasonNumber) ||
      seasonNumber < 1
    )
      return res
        .status(400)
        .send(
          tvboxPage(
            "Importar M3U",
            '<section class="panel"><h1>Destino inválido</h1><p class="muted">Escolha uma série e uma temporada válidas.</p></section>',
          ),
        );
    const seriesData = JSON.parse(fs.readFileSync(seriesFile, "utf-8"));
    seriesData.seasons ||= [];
    let season = seriesData.seasons.find(
      (item) => Number(item.number) === seasonNumber,
    );
    if (!season) {
      season = { number: seasonNumber, episodes: [] };
      seriesData.seasons.push(season);
    }
    season.episodes ||= [];
    const knownUrls = new Set(season.episodes.map((item) => item.url));
    let added = 0,
      ignored = 0,
      nextNumber = Math.max(
        startEpisode,
        ...season.episodes.map((item) => Number(item.number) + 1),
        1,
      );
    for (const item of incoming) {
      const url = String(item?.url || "").trim();
      const title = String(item?.name || item?.title || "").trim();
      if (!title || !/^https?:\/\//i.test(url) || knownUrls.has(url)) {
        ignored++;
        continue;
      }
      season.episodes.push({
        number: nextNumber++,
        title,
        url,
        type: item.type === "mp4" ? "mp4" : "hls",
      });
      knownUrls.add(url);
      added++;
    }
    fs.writeFileSync(seriesFile, JSON.stringify(seriesData, null, 2), "utf-8");
    return res.send(
      tvboxPage(
        "Importação concluída",
        `<section class="panel"><h1>Episódios importados</h1><p class="muted"><strong>${added}</strong> episódio(s) adicionado(s) na temporada ${seasonNumber}. <strong>${ignored}</strong> item(ns) ignorado(s).</p><div class="actions"><a class="btn primary" href="/tvbox/series/${encodeURIComponent(seriesId)}">Abrir série</a></div></section>`,
      ),
    );
  }
  const current = loadDB();
  const urls = new Set(current.map((item) => item.url));
  let added = 0,
    ignored = 0;
  for (const item of incoming) {
    const url = String(item?.url || "").trim();
    const name = String(item?.name || item?.title || "").trim();
    if (!name || !/^https?:\/\//i.test(url) || urls.has(url)) {
      ignored++;
      continue;
    }
    const imageUrl = String(item?.poster || item?.logo || "").trim();
    current.push({
      id: Date.now() + added,
      name,
      url,
      type: item.type === "mp4" ? "mp4" : "hls",
      category:
        String(item.category || item.groupName || "m3u").trim() || "m3u",
      ...(/^https?:\/\//i.test(imageUrl) ? { poster: imageUrl } : {}),
    });
    urls.add(url);
    added++;
  }
  saveDB(current);
  res.send(
    tvboxPage(
      "Importação concluída",
      `<section class="panel"><h1>Importação concluída</h1><p class="muted"><strong>${added}</strong> canal(is) adicionado(s). <strong>${ignored}</strong> item(ns) ignorado(s) por URL repetida ou dados inválidos.</p><div class="actions"><a class="btn primary" href="/tvbox">Voltar ao painel</a><a class="btn" href="/tvbox/import/m3u">Importar outro arquivo</a></div></section>`,
    ),
  );
});

router.get("/categories", (req, res) => {
  const categories = loadDB().reduce((groups, item) => {
    const category = String(item.category || "outros").trim() || "outros";
    (groups[category] ||= []).push(item);
    return groups;
  }, {});

  const categorySections =
    Object.entries(categories)
      .sort(([left], [right]) => left.localeCompare(right, "pt-BR"))
      .map(([category, items]) => {
        const rows = items
          .sort((left, right) =>
            String(left.name).localeCompare(String(right.name), "pt-BR"),
          )
          .map(
            (item) =>
              `<article class="category-item" data-name="${safeText(`${item.name}${item.type || ""}`)}"><div><strong>${safeText(item.name)}</strong><span class="badge">${safeText(item.type || "hls")}</span><p class="url">${safeText(item.url)}</p></div><div class="actions"><a class="btn" href="/tvbox/edit/${item.id}">Editar</a><a class="btn danger" href="/tvbox/delete/${item.id}" onclick="return confirm('Excluir este item?')">Excluir</a></div></article>`,
          )
          .join("");
        return `<details class="category-group" data-category="${safeText(category)}"><summary><div><span class="badge">CATEGORIA</span><strong>${safeText(category)}</strong></div><div class="summary-actions" onclick="event.stopPropagation()"><a class="btn" href="/tvbox/category/${encodeURIComponent(category)}">Gerenciar Capa</a><span class="count">${items.length} item(ns)</span></div></summary><div class="category-content"><div class="category-tools"><span class="muted">Abra somente a lista que quiser administrar.</span><form method="post" action="/tvbox/category/delete" onsubmit="return confirm('Excluir todos os ${items.length} itens da categoria?')"><input type="hidden" name="category" value="${safeText(category)}"><button class="btn danger" type="submit">Excluir categoria</button></form></div><div class="category-items">${rows}</div></div></details>`;
      })
      .join("") ||
    '<section class="panel"><div class="empty">Nenhuma categoria cadastrada.</div></section>';
  const body = fs
    .readFileSync(
      path.join(TEMPLATES_DIRECTORY, "tvbox-categories.html"),
      "utf-8",
    )
    .replaceAll("{{categoryCount}}", String(Object.keys(categories).length))
    .replace("{{categorySections}}", categorySections);
  res.send(tvboxPage("Categorias", body));
});

router.post("/category/delete", (req, res) => {
  const category = String(req.body.category || "").trim();
  if (!category)
    return res
      .status(400)
      .send(
        tvboxPage(
          "Erro",
          '<section class="panel"><h1>Categoria invalida</h1></section>',
        ),
      );

  const normalizedCategory = category.toLocaleLowerCase("pt-BR");
  const remaining = loadDB().filter((item) => {
    const itemCategory = (
      String(item.category || "outros").trim() || "outros"
    ).toLocaleLowerCase("pt-BR");
    return itemCategory !== normalizedCategory;
  });
  saveDB(remaining);
  res.redirect("/tvbox/categories");
});

router.get("/", (req, res) => {
  if (!hasTvboxSession(req)) return res.redirect("/tvbox/login");
  const channels = loadDB();
  const series = loadSeriesCatalog();

  const byCategory = channels.reduce((total, item) => {
    const key = item.category || "outros";
    total[key] = (total[key] || 0) + 1;
    return total;
  }, {});

  const categoryCards =
    Object.entries(byCategory)
      .map(
        ([name, total]) =>
          `<article class="card">
          <span class="badge">CATEGORIA</span>
          <h2 style="margin-top:12px">${safeText(name)}</h2>
          <p class="muted">${total} item(ns) cadastrado(s).</p>
          <div class="actions" style="margin-top:14px">
            <a class="btn primary" href="/tvbox/category/${encodeURIComponent(name)}">Gerenciar Capa / Itens</a>
          </div>
        </article>`,
      )
      .join("") || '<div class="empty">Nenhuma categoria cadastrada.</div>';

  const templateContent = fs.readFileSync(
    path.join(TEMPLATES_DIRECTORY, "tvbox-dashboard.html"),
    "utf-8",
  );
  const body = templateContent
    .replaceAll("{{channelsCount}}", channels.length)
    .replaceAll("{{seriesCount}}", series.length)
    .replaceAll("{{categoryCards}}", categoryCards);

  return res.send(tvboxPage("Painel", body));
});

router.get("/add", (req, res) => {
  const body = fs.readFileSync(
    path.join(TEMPLATES_DIRECTORY, "tvbox-add.html"),
    "utf-8",
  );
  return res.send(tvboxPage("Adicionar item", body));
});

router.post("/add", (req, res) => {
  const { name, url, type, category, poster } = req.body;
  const imageUrl = String(poster || "").trim();

  let dbData = loadDB();
  dbData.push({
    id: Date.now(),
    name,
    url,
    type,
    category,
    ...(/^https?:\/\//i.test(imageUrl) ? { poster: imageUrl } : {}),
  });
  saveDB(dbData);
  res.redirect("/tvbox");
});

router.get("/series/:id/delete", (req, res) => {
  const id = req.params.id;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return res.status(400).send("ID inválido");
  const catalog = loadSeriesCatalog().filter((item) => item.id !== id);
  saveSeriesCatalog(catalog);
  const file = path.join(SERIES_DIRECTORY, `${id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.redirect("/tvbox/series");
});

router.get("/edit/:id", (req, res) => {
  if (!requireTvboxAccess(req, res)) return;
  const id = req.params.id;
  const dbData = loadDB();
  const item = dbData.find((item) => String(item.id) === String(id));
  if (!item)
    return res
      .status(404)
      .send(
        tvboxPage(
          "Não encontrado",
          '<section class="panel"><h1>Item não encontrado</h1></section>',
        ),
      );

  // Extrai todas as categorias únicas já presentes no banco de dados
  const uniqueCategories = [
    ...new Set(
      dbData.map((i) => String(i.category || "outros").trim() || "outros"),
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  // Gera as opções do select dinamicamente
  const categoryOptions = uniqueCategories
    .map(
      (cat) =>
        `<option value="${safeText(cat)}" ${item.category === cat ? "selected" : ""}>${safeText(cat)}</option>`,
    )
    .join("");

  const typeKey = (item.type || "").toLowerCase();
  const posterValue = safeText(item.poster || "");
  const body = fs
    .readFileSync(path.join(TEMPLATES_DIRECTORY, "tvbox-edit.html"), "utf-8")
    .replaceAll("{{id}}", safeText(id))
    .replaceAll("{{password}}", "")
    .replaceAll("{{name}}", safeText(item.name || ""))
    .replaceAll("{{url}}", safeText(item.url || ""))
    .replaceAll("{{poster}}", posterValue)
    .replace("{{type_mp4}}", typeKey === "mp4" ? "selected" : "")
    .replace("{{type_hls}}", typeKey === "hls" ? "selected" : "")
    .replace("{{type_kick}}", typeKey === "kick" ? "selected" : "")
    .replace("{{type_embed}}", typeKey === "embed" ? "selected" : "")
    .replace("{{categoryOptions}}", categoryOptions);

  res.send(tvboxPage("Editar item", body));
});

router.post("/edit/:id", (req, res) => {
  const id = req.params.id;
  const { name, url, type, category, poster } = req.body;
  const imageUrl = String(poster || "").trim();

  let dbData = loadDB();
  const index = dbData.findIndex((item) => String(item.id) === String(id));
  if (index === -1)
    return res
      .status(404)
      .send(
        tvboxPage(
          "Não encontrado",
          '<section class="panel"><h1>Item não encontrado</h1></section>',
        ),
      );

  dbData[index] = {
    id: dbData[index].id,
    name,
    url,
    type,
    category,
    ...(/^https?:\/\//i.test(imageUrl)
      ? { poster: imageUrl }
      : { poster: null }),
  };
  saveDB(dbData);
  res.redirect("/tvbox");
});

router.get("/delete/:id", (req, res) => {
  let dbData = loadDB();
  dbData = dbData.filter((item) => item.id != req.params.id);
  saveDB(dbData);
  res.redirect("/tvbox");
});

// Rota de Detalhes da Categoria
router.get("/category/:name", (req, res) => {
  const categoryName = decodeURIComponent(req.params.name);
  const channels = loadDB();
  const items = channels.filter(
    (item) =>
      (String(item.category || "outros").trim() || "outros").toLowerCase() ===
      categoryName.toLowerCase(),
  );

  const categoriesMeta = loadCategoriesMeta();
  const currentPoster = categoriesMeta[categoryName]?.poster || "";

  const itemsRows = items.length
    ? items
        .map(
          (item) => `
            <article class="category-item" style="display: flex; align-items: center; justify-content: space-between; background: #1f2937; border: 1px solid #374151; border-radius: 12px; padding: 16px 20px; margin-bottom: 12px; gap: 16px; transition: border-color 0.2s;" onmouseover="this.style.borderColor='#4b5563'" onmouseout="this.style.borderColor='#374151'">
                <div style="display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1;">
                    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <strong style="color: #ffffff; font-size: 15px; font-weight: 600;">${safeText(item.name)}</strong>
                        <span class="badge" style="background: #374151; color: #60a5fa; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${safeText(item.type || "hls")}</span>
                    </div>
                    <p class="url" style="color: #9ca3af; font-size: 13px; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${safeText(item.url)}">${safeText(item.url)}</p>
                </div>
                <div class="actions" style="display: flex; gap: 8px; flex-shrink: 0;">
                    <a class="btn" href="/tvbox/edit/${item.id}" style="background: #374151; color: #f3f4f6; text-decoration: none; padding: 8px 14px; font-size: 13px; font-weight: 500; border-radius: 8px; border: 1px solid #4b5563; transition: background 0.2s;" onmouseover="this.style.background='#4b5563'" onmouseout="this.style.background='#374151'">Editar</a>
                </div>
            </article>
            `,
        )
        .join("")
    : '<div class="empty" style="text-align: center; padding: 32px; color: #9ca3af; font-size: 14px; background: #1f2937; border-radius: 12px; border: 1px dashed #374151;">Nenhum item encontrado nesta categoria.</div>';

  const templateContent = fs.readFileSync(
    path.join(TEMPLATES_DIRECTORY, "tvbox-category-detail.html"),
    "utf-8",
  );
  const body = templateContent
    .replaceAll("{{categoryName}}", safeText(categoryName))
    .replaceAll("{{categorySlug}}", encodeURIComponent(categoryName))
    .replaceAll("{{poster}}", safeText(currentPoster))
    .replaceAll("{{itemsRows}}", itemsRows);

  res.send(tvboxPage(`Categoria: ${categoryName}`, body));
});

// Rota para Salvar a Capa da Categoria
router.post("/category/:name/poster", (req, res) => {
  const categoryName = decodeURIComponent(req.params.name);
  const poster = String(req.body.poster || "").trim();
  const validPoster = /^https?:\/\//i.test(poster) ? poster : null;

  const categoriesMeta = loadCategoriesMeta();
  categoriesMeta[categoryName] = { poster: validPoster };
  saveCategoriesMeta(categoriesMeta);

  res.redirect(`/tvbox/category/${encodeURIComponent(categoryName)}`);
});
[];

let kickCache = null;
let kickCacheAt = 0;
let kickPending = null;


const hls = require("../services/hls");
const embedtv = require("../services/embedtv");
// Reprodução HLS usando o prefixo /tvbox
router.get("/api/live/:id.m3u8", hls.play);
router.get("/api/live/resource/:token", hls.resource);

function getPublicBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

// API do Brasileirão Série A
router.get(
  "/api/events/brasileirao-serie-a",
  async (req, res) => {
    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );

    try {
      const result = await embedtv.events({
        brasileirao: true,
        baseUrl: getPublicBaseUrl(req),
        sync: true,
      });

      res.json(result);
    } catch (error) {
      console.error(
        "[EMBEDTV] Brasileirão:",
        error.message
      );

      res.status(502).json({
        events: [],
        error: error.message,
      });
    }
  }
);

// API de todos os eventos
router.get(
  "/api/embedtv/events",
  async (req, res) => {
    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );

    try {
      const result = await embedtv.events({
        baseUrl: getPublicBaseUrl(req),
        sync: true,
      });

      res.json(result);
    } catch (error) {
      console.error(
        "[EMBEDTV] Todos os eventos:",
        error.message
      );

      res.status(502).json({
        events: [],
        error: error.message,
      });
    }
  }
);

// Painel HLS

router.get("/hls", (req, res) => {
  try {
    const file = path.join(
      TEMPLATES_DIRECTORY,
      "tvbox-hls.html"
    );

    console.log("[TVBOX HLS] Abrindo:", file);

    if (!fs.existsSync(file)) {
      return res.status(500).send(
        "ERRO: arquivo tvbox-hls.html não encontrado em " + file
      );
    }

    const html = fs.readFileSync(file, "utf8");

    console.log(
      "[TVBOX HLS] HTML carregado:",
      html.length,
      "caracteres"
    );

    const page = tvboxPage("Canais HLS", html);

    console.log(
      "[TVBOX HLS] Página montada com sucesso"
    );

    return res
      .status(200)
      .type("html")
      .send(page);

  } catch (error) {
    console.error(
      "[TVBOX HLS] ERRO AO ABRIR PÁGINA:",
      error.stack
    );

    return res.status(500).type("text").send(
      "Erro ao abrir painel HLS:\n\n" +
      error.stack
    );
  }
});


// Canais cadastrados
router.get("/hls/channels", (req, res) => {
  res.json(hls.list());
});

// Configuração do polling HLS
router.get("/hls/settings", (req, res) => {
  res.json(hls.getSettings());
});

router.post("/hls/settings", (req, res) => {
  try {
    res.json(hls.setSettings(req.body));
  } catch (error) {
    res.status(400).json({
      error: error.message,
    });
  }
});

// Adicionar canal
router.post("/hls/channels", async (req, res) => {
  try {
    const channel = await hls.add(req.body);

    res.status(201).json(channel);
  } catch (error) {
    res.status(400).json({
      error: error.message,
    });
  }
});

// Atualizar canal manualmente

router.post(
  "/hls/channels/:id/refresh",
  async (req, res) => {
    const channel = hls.channelById(req.params.id);

    if (!channel) {
      return res.status(404).json({
        error: "Canal não encontrado",
      });
    }

    try {
      const result = await hls.refresh(
        channel,
        true
      );

      if (result.error) {
        return res.status(502).json({
          error: result.error,
          status: "error",
        });
      }

      return res.json({
        ok: true,
        status: "online",
        checks: result.checks,
        changes: result.changes,
        lastCheck: new Date(
          result.checked
        ).toISOString(),
      });
    } catch (error) {
      return res.status(502).json({
        error: error.message,
      });
    }
  }
);


// Excluir canal
router.delete(
  "/hls/channels/:id",
  (req, res) => {
    if (!hls.remove(req.params.id)) {
      return res.status(404).json({
        error: "Canal não encontrado",
      });
    }

    res.json({ ok: true });
  }
);

router.delete("/hls/channels", (req, res) => {
  try {
    const removed = hls.removeAll();
    res.json({ ok: true, removed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Diagnóstico da EmbedTV
router.get(
  "/hls/embedtv-status",
  (req, res) => {
    res.json(embedtv.status());
  }
);


router.post("/hls/sync-embedtv", async (req, res) => {
  try {
    console.log(
      "[EMBEDTV] Sincronização solicitada pelo painel"
    );

    const result = await embedtv.events({
      force: true,
      sync: true,
      baseUrl: getPublicBaseUrl(req),
    });

    return res.json({
      ...result,
      message:
        "Eventos consultados. Sincronização HLS iniciada.",
    });
  } catch (error) {
    console.error(
      "[EMBEDTV] Falha na consulta:",
      error
    );

    return res.status(502).json({
      error: error.message,
    });
  }
});



router.get("/api/kick/live", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const cacheMs = 60_000;

  if (kickCache && Date.now() - kickCacheAt < cacheMs) {
    return res.json(kickCache);
  }

  try {
    if (!kickPending) {
      kickPending = (async () => {
        const db = loadDB();

        // O banco atual retorna um array.
        // Busca apenas canais com type = kick.
        const channels = db.filter(
          (item) =>
            String(item.type || "")
              .trim()
              .toLowerCase() === "kick",
        );

        let failed = 0;

        const results = await Promise.all(
          channels.map(async (channel) => {
            try {
              // Usa o NAME cadastrado no painel,
              // sem depender da URL do canal.
              const name = String(channel.name || "").trim();

              if (!name) {
                failed++;
                console.warn("[KICK] Canal sem nome:", channel.id);
                return null;
              }

              const kickName = name
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/^@/, "")
                .replace(/\s+/g, "");

              const response = await fetch(
                `https://kick.com/api/v2/channels/${encodeURIComponent(kickName)}`,
                {
                  headers: {
                    Accept: "application/json",
                    "User-Agent": "Mozilla/5.0",
                    Referer: "https://kick.com/",
                  },
                  signal: AbortSignal.timeout(10000),
                },
              );

              if (!response.ok) {
                failed++;

                console.warn(`[KICK] ${kickName}: HTTP ${response.status}`);

                return null;
              }

              const data = await response.json();
              const live = data?.livestream;

              // A API pode retornar uma livestream
              // sem o campo is_live.
              const isLive = live != null && live.is_live !== false;

              if (!isLive) {
                console.log(`[KICK] OFFLINE: ${kickName}`);
                return null;
              }

              console.log(`[KICK] ONLINE: ${kickName}`);

              return {
                id: channel.id,
                name: channel.name || data.user?.username || kickName,
                kickName: data.slug || kickName,

                url: data.playback_url || null,
                playbackUrl: data.playback_url || null,

                playbackEndpoint: channel.url || null,

                type: "hls",
                category: "kick",

                poster: channel.poster || data.user?.profile_pic || null,

                isLive: true,
                title: live.session_title || "",
                viewers: live.viewer_count || 0,
                thumbnail: live.thumbnail?.url || null,
                startedAt: live.start_time || null,
              };
            } catch (error) {
              failed++;

              console.error(
                `[KICK] Erro no canal ${channel.name}:`,
                error.message,
              );

              return null;
            }
          }),
        );

        const liveChannels = results
          .filter(Boolean)
          .sort((a, b) => b.viewers - a.viewers);

        const result = {
          total: liveChannels.length,
          checked: channels.length,
          failed,
          updatedAt: new Date().toISOString(),
          channels: liveChannels,
        };

        // Mantém o cache de 60 segundos.
        // Evita substituir dados válidos por
        // um resultado de consulta com falhas.
        if (failed === 0 || !kickCache) {
          kickCache = result;
          kickCacheAt = Date.now();
        }

        return failed > 0 && kickCache !== result ? kickCache : result;
      })().finally(() => {
        kickPending = null;
      });
    }

    return res.json(await kickPending);
  } catch (error) {
    console.error("[KICK] Erro geral:", error);

    return res.status(500).json({
      error: "Erro ao consultar canais da Kick",
    });
  }
});

module.exports = router;
