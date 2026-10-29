const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const {
  EXTENSION_API_TOKEN,
  PASSWORD,
  SESSION_SECRET,
} = require("../config/env");
const {
  loadDB,
  saveDB,
  loadSeriesCatalog,
  saveSeriesCatalog,
  getNewReleaseOrder,
  getNewReleaseKeys,
} = require("../services/db");
const { loadCategoriesMeta, saveCategoriesMeta } = require("../services/db");
const { loadHomeConfig, saveHomeConfig } = require("../services/db");

const { findPoster } = require("../services/poster");
const {
  SESSION_COOKIE,
  hasTvboxSession,
  requireTvboxAccess,
  clearSession,
  signSession,
  passwordMatches,
  safeText,
  removeLegacyPasswordFromHtml,
} = require("../utils/helpers");

const {
  itemCategories,
  categoriesFromForm,
  allCategoryNames,
  hasCategory,
} = require("../services/categories");
function categoryFields(items, selected = []) {
  const names = allCategoryNames(items, loadCategoriesMeta());
  return names
    .map(
      (cat) =>
        `<label style="display:flex;gap:8px;align-items:center"><input style="width:auto" type="checkbox" name="categories" value="${safeText(cat)}" ${selected.includes(cat) ? "checked" : ""}>${safeText(cat)}</label>`,
    )
    .join("");
}
function inferredContentType(item) {
  if (["movie", "live"].includes(item.contentType)) return item.contentType;
  const movieCategories = itemCategories(item).map((category) =>
    category.split("|")[0].trim().toLocaleLowerCase("pt-BR"),
  );
  return movieCategories.some((category) =>
    ["filme", "filmes", "movie", "movies"].includes(category),
  )
    ? "movie"
    : null;
}

function contentTypeFromForm(value) {
  return ["movie", "live"].includes(value) ? value : null;
}
const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

const extensionRequestNonces = new Map();
const EXTENSION_REQUEST_WINDOW_MS = 2 * 60 * 1000;

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
  if (req.path === "/login" || req.path.startsWith("/api/")) {
    return next();
  }

  if (requireTvboxAccess(req, res)) return next();
});

function setExtensionCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (
    origin.startsWith("chrome-extension://") ||
    origin.startsWith("moz-extension://")
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, X-Request-Timestamp, X-Request-Nonce, X-Request-Signature",
    );
  }
}

function validExtensionRequest(req) {
  if (Buffer.byteLength(EXTENSION_API_TOKEN) < 32) return false;
  const timestamp = String(req.headers["x-request-timestamp"] || "");
  const nonce = String(req.headers["x-request-nonce"] || "");
  const signature = String(req.headers["x-request-signature"] || "");
  const timestampMs = Number(timestamp);
  if (
    !Number.isSafeInteger(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > EXTENSION_REQUEST_WINDOW_MS ||
    !/^[a-f0-9-]{36}$/i.test(nonce) ||
    !/^[a-f0-9]{64}$/i.test(signature)
  ) {
    return false;
  }

  for (const [storedNonce, expiresAt] of extensionRequestNonces) {
    if (expiresAt <= Date.now()) extensionRequestNonces.delete(storedNonce);
  }
  if (extensionRequestNonces.has(nonce)) return false;

  const signedPayload = `${timestamp}.${nonce}.${JSON.stringify(req.body)}`;
  const expected = crypto
    .createHmac("sha256", EXTENSION_API_TOKEN)
    .update(signedPayload)
    .digest();
  const received = Buffer.from(signature, "hex");
  if (
    received.length !== expected.length ||
    !crypto.timingSafeEqual(received, expected)
  ) {
    return false;
  }

  if (extensionRequestNonces.size >= 10_000) return false;
  extensionRequestNonces.set(nonce, timestampMs + EXTENSION_REQUEST_WINDOW_MS);
  return true;
}

router.options("/api/extension/import", (req, res) => {
  setExtensionCors(req, res);
  res.sendStatus(204);
});

router.post("/api/extension/import", (req, res) => {
  setExtensionCors(req, res);
  if (!validExtensionRequest(req)) {
    return res.status(401).json({
      error:
        "Assinatura inválida, expirada ou repetida. Verifique a chave da extensão no servidor.",
    });
  }

  const kind = String(req.body.kind || "");
  const title = String(req.body.title || "").trim();
  const url = String(req.body.url || "").trim();
  const type = String(req.body.type || "hls").toLowerCase();
  if (!["channel", "movie", "series"].includes(kind)) {
    return res.status(400).json({ error: "Tipo de conteúdo inválido." });
  }
  if (
    !title ||
    title.length > 200 ||
    !/^https?:\/\//i.test(url) ||
    url.length > 4096
  ) {
    return res
      .status(400)
      .json({ error: "Informe título e URL HTTP(S) válidos." });
  }
  if (!["hls", "mp4"].includes(type)) {
    return res.status(400).json({ error: "Formato de mídia inválido." });
  }

  if (kind === "series") {
    const seriesId = String(req.body.seriesId || "").trim();
    const seriesTitle = String(req.body.seriesTitle || "").trim();
    const seasonNumber = Number(req.body.seasonNumber);
    const episodeNumber = Number(req.body.episodeNumber);
    if (
      !/^[A-Za-z0-9_-]{1,80}$/.test(seriesId) ||
      !Number.isInteger(seasonNumber) ||
      seasonNumber < 1 ||
      seasonNumber > 999 ||
      !Number.isInteger(episodeNumber) ||
      episodeNumber < 1 ||
      episodeNumber > 9999
    ) {
      return res
        .status(400)
        .json({ error: "Série, temporada ou episódio inválido." });
    }

    const seriesFile = path.join(SERIES_DIRECTORY, `${seriesId}.json`);
    const catalog = loadSeriesCatalog();
    const existingEntry = catalog.find((item) => item.id === seriesId);
    let seriesData;
    if (fs.existsSync(seriesFile)) {
      seriesData = JSON.parse(fs.readFileSync(seriesFile, "utf-8"));
    } else {
      if (!seriesTitle || seriesTitle.length > 200) {
        return res
          .status(400)
          .json({ error: "Informe o título da nova série." });
      }
      if (existingEntry) {
        return res
          .status(409)
          .json({ error: "O catálogo da série está inconsistente." });
      }
      seriesData = {
        title: seriesTitle,
        poster: null,
        createdAt: Date.now(),
        seasons: [],
      };
      catalog.push({
        id: seriesId,
        title: seriesTitle,
        endpoint: `series/${seriesId}.json`,
        poster: null,
        createdAt: seriesData.createdAt,
      });
    }

    seriesData.seasons = Array.isArray(seriesData.seasons)
      ? seriesData.seasons
      : [];
    let season = seriesData.seasons.find(
      (item) => Number(item.number) === seasonNumber,
    );
    if (!season) {
      season = { number: seasonNumber, episodes: [] };
      seriesData.seasons.push(season);
    }
    season.episodes = Array.isArray(season.episodes) ? season.episodes : [];
    if (
      season.episodes.some(
        (item) =>
          Number(item.number) === episodeNumber ||
          String(item.url || "") === url,
      )
    ) {
      return res
        .status(409)
        .json({ error: "Esse episódio ou URL já está cadastrado." });
    }

    season.episodes.push({ number: episodeNumber, title, url, type });
    season.episodes.sort((a, b) => Number(a.number) - Number(b.number));
    fs.mkdirSync(SERIES_DIRECTORY, { recursive: true });
    fs.writeFileSync(seriesFile, JSON.stringify(seriesData, null, 2), "utf-8");
    saveSeriesCatalog(catalog);
    return res
      .status(201)
      .json({ ok: true, message: "Episódio adicionado à série." });
  }

  const dbData = loadDB();
  if (dbData.some((item) => String(item.url || "") === url)) {
    return res.status(409).json({ error: "Essa URL já está cadastrada." });
  }
  const category =
    String(req.body.category || (kind === "movie" ? "filmes" : "m3u"))
      .trim()
      .slice(0, 100) || (kind === "movie" ? "filmes" : "m3u");
  dbData.push({
    id: Date.now(),
    name: title,
    url,
    type,
    category,
    categories: [category],
    contentType: kind === "movie" ? "movie" : "live",
    createdAt: Date.now(),
  });
  saveDB(dbData);
  return res
    .status(201)
    .json({ ok: true, message: "Item adicionado ao catálogo." });
});

router.get("/api/channels", (req, res) => {
  const dbData = loadDB();
  const categoriesMeta = loadCategoriesMeta();
  const newReleaseOrder = getNewReleaseOrder();
  const newReleaseKeys = new Set(newReleaseOrder);
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(
    ",",
  )[0];
  const baseUrl = `${forwardedProto || req.protocol}://${req.get("host")}`;

  const cleanData = dbData.map(
    ({
      id,
      name,
      url,
      type,
      category,
      categories,
      poster,
      source,
      contentType,
      createdAt,
    }) => {
      const categoryKey = String(category || "outros").trim();
      const categoryPoster = categoriesMeta[categoryKey]?.poster || null;

      const proxyUrl =
        source === "embedtv-channels"
          ? `${baseUrl}/tvbox/api/live/${encodeURIComponent(id)}.m3u8`
          : url;
      return {
        id,
        name,
        url: proxyUrl,
        type,
        category,
        categories: itemCategories({ category, categories }),
        contentType:
          contentTypeFromForm(contentType) ||
          inferredContentType({ category, categories, contentType }),
        poster: poster || categoryPoster,
        newRelease: newReleaseKeys.has(`movie:${id}`),
        newReleaseOrder: newReleaseOrder.indexOf(`movie:${id}`),
        createdAt:
          createdAt || (Number(id) > 1_000_000_000_000 ? Number(id) : null),
      };
    },
  );

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(cleanData);
});

router.get("/api/v2/catalog", (req, res) => {
  try {
    const channels = loadDB();
    const seriesCatalog = loadSeriesCatalog();
    const items = [];
    const movieCategoryNames = new Set(["filme", "filmes", "movie", "movies"]);
    const dateLabel = (value) => {
      const timestamp = Number.isFinite(Number(value))
        ? Number(value)
        : Date.parse(value);
      if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
      return new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(timestamp);
    };
    const creationTime = (item) => {
      const value = item.createdAt;
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim()) {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 1_000_000_000_000)
          return numeric;
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      const id = Number(item.id);
      return Number.isFinite(id) && id > 1_000_000_000_000 ? id : null;
    };
    const mapChannel = (item, index) => {
      const categories = [
        ...new Set(
          itemCategories(item).flatMap((value) =>
            value
              .split("|")
              .map((category) => category.trim())
              .filter(Boolean),
          ),
        ),
      ];
      const normalizedCategories = categories.map((value) =>
        value
          .split("|")[0]
          .trim()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLocaleLowerCase("pt-BR"),
      );
      const itemType = String(item.type || "").toLocaleLowerCase("pt-BR");
      const itemUrl = String(item.url || "");
      const isKick =
        itemType === "kick" ||
        /(?:^|\/\/)(?:www\.)?kick\.com(?:\/|$)/i.test(itemUrl);
      const isMovie =
        item.contentType === "movie" ||
        (item.contentType !== "live" &&
          normalizedCategories.some((category) =>
            movieCategoryNames.has(category),
          ));
      const kind = isKick ? "kick" : isMovie ? "movie" : "live";
      const category =
        categories.find(
          (value) =>
            !movieCategoryNames.has(
              value
                .split("|")[0]
                .trim()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLocaleLowerCase("pt-BR"),
            ),
        ) ||
        categories[0] ||
        "Sem categoria";
      const title = String(item.name || item.id || "Sem título");
      const createdAt = creationTime(item);
      const kindLabel =
        kind === "movie" ? "Filme" : kind === "kick" ? "Kick" : "Ao vivo";
      const description =
        kind === "kick"
          ? "Canal da Kick"
          : kind === "live"
            ? "Canal ao vivo"
            : "Filme";
      const kickUsername =
        kind === "kick"
          ? itemUrl.match(/\/channels\/([^/?#]+)(?:\/playback-url)?/i)?.[1] ||
            itemUrl.match(/^https?:\/\/(?:www\.)?kick\.com\/([^/?#]+)/i)?.[1] ||
            ""
          : "";

      return {
        id: `${kind}:${item.id ?? index}`,
        title,
        subtitle: `${description} · ${category}`,
        kind,
        kindLabel,
        category,
        addedLabel: dateLabel(createdAt),
        createdAt,
        posterMark: title.charAt(0).toLocaleUpperCase("pt-BR"),
        posterTone: [
          "sand",
          "red",
          "blue",
          "teal",
          "green",
          "violet",
          "orange",
          "navy",
          "pink",
          "purple",
          "yellow",
        ][index % 11],
        posterUrl: item.poster || null,
        url: item.url || "",
        mediaType: item.type || "hls",
        ...(kickUsername ? { username: kickUsername } : {}),
        ...(kind === "live" || kind === "kick"
          ? {
              status:
                item.isLive === true || item.status === "online"
                  ? "online"
                  : item.isLive === false || item.status === "offline"
                    ? "offline"
                    : "unknown",
            }
          : {}),
      };
    };

    channels.forEach((item, index) => items.push(mapChannel(item, index)));

    seriesCatalog.forEach((item, index) => {
      const id = String(item.id || "");
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        throw new Error(`ID de série inválido no catálogo: ${id || "(vazio)"}`);
      }
      const detailsFile = path.join(SERIES_DIRECTORY, `${id}.json`);
      const details = fs.existsSync(detailsFile)
        ? JSON.parse(fs.readFileSync(detailsFile, "utf-8"))
        : {};
      const seasons = Array.isArray(details.seasons) ? details.seasons : [];
      const episodes = seasons.reduce(
        (total, season) =>
          total + (Array.isArray(season.episodes) ? season.episodes.length : 0),
        0,
      );
      const title = String(item.title || item.name || details.title || id);
      const createdAt = creationTime(item);
      items.push({
        id: `series:${id}`,
        title,
        subtitle: `Série · ${seasons.length} ${seasons.length === 1 ? "temporada" : "temporadas"}`,
        kind: "series",
        kindLabel: "Série",
        category: String(item.category || "Séries"),
        addedLabel: dateLabel(createdAt),
        createdAt,
        posterMark: title.charAt(0).toLocaleUpperCase("pt-BR"),
        posterTone: ["blue", "green", "violet", "orange", "navy"][index % 5],
        posterUrl: item.poster || details.poster || null,
        episodes,
        seasons: seasons.length,
      });
    });

    items.sort((left, right) => {
      if (left.createdAt != null && right.createdAt != null) {
        return right.createdAt - left.createdAt;
      }
      if (left.createdAt != null) return -1;
      if (right.createdAt != null) return 1;
      return 0;
    });
    const counts = {
      movies: items.filter((item) => item.kind === "movie").length,
      series: items.filter((item) => item.kind === "series").length,
      live: items.filter((item) => item.kind === "live").length,
      kick: items.filter((item) => item.kind === "kick").length,
    };

    return res.json({
      version: 2,
      generatedAt: new Date().toISOString(),
      counts,
      items,
    });
  } catch (error) {
    console.error("Falha ao montar catálogo da API v2:", error);
    return res
      .status(500)
      .json({ error: "Não foi possível carregar o catálogo do servidor." });
  }
});

router.get("/api/v2/catalog/series/:id", (req, res) => {
  const id = String(req.params.id || "");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) {
    return res.status(400).json({ error: "ID de série inválido." });
  }

  try {
    const series = loadSeriesCatalog().find((item) => String(item.id) === id);
    if (!series)
      return res.status(404).json({ error: "Série não encontrada." });

    const detailsFile = path.join(SERIES_DIRECTORY, `${id}.json`);
    const details = fs.existsSync(detailsFile)
      ? JSON.parse(fs.readFileSync(detailsFile, "utf-8"))
      : {};
    const seasons = Array.isArray(details.seasons) ? details.seasons : [];

    return res.json({
      id,
      title: String(series.title || series.name || details.title || id),
      poster: series.poster || details.poster || null,
      seasons: seasons.map((season) => ({
        number: Number(season.number) || 0,
        episodes: Array.isArray(season.episodes)
          ? season.episodes.map((episode, index) => ({
              number: Number(episode.number) || index + 1,
              title: String(
                episode.title ||
                  `Episódio ${Number(episode.number) || index + 1}`,
              ),
              url: String(episode.url || ""),
              type: episode.type === "mp4" ? "mp4" : "hls",
            }))
          : [],
      })),
    });
  } catch (error) {
    console.error("Falha ao carregar episódios da série:", error);
    return res
      .status(500)
      .json({ error: "Não foi possível carregar os episódios da série." });
  }
});

router.post("/api/v2/catalog/series/:id/seasons", (req, res) => {
  if (!requireTvboxAccess(req, res)) return;
  const id = String(req.params.id || "");
  const number = Number(req.body.number);
  if (
    !/^[a-zA-Z0-9_-]{1,80}$/.test(id) ||
    !Number.isInteger(number) ||
    number < 1 ||
    number > 999
  ) {
    return res
      .status(400)
      .json({ error: "ID ou número de temporada inválido." });
  }

  try {
    const file = path.join(SERIES_DIRECTORY, `${id}.json`);
    const catalog = loadSeriesCatalog();
    if (
      !catalog.some((item) => String(item.id) === id) ||
      !fs.existsSync(file)
    ) {
      return res.status(404).json({ error: "Série não encontrada." });
    }
    const details = JSON.parse(fs.readFileSync(file, "utf-8"));
    details.seasons = Array.isArray(details.seasons) ? details.seasons : [];
    if (details.seasons.some((season) => Number(season.number) === number)) {
      return res.status(409).json({ error: "Essa temporada já existe." });
    }
    details.seasons.push({ number, episodes: [] });
    details.seasons.sort(
      (left, right) => Number(left.number) - Number(right.number),
    );
    fs.writeFileSync(file, JSON.stringify(details, null, 2), "utf-8");
    return res.status(201).json({ ok: true, number });
  } catch (error) {
    console.error("Falha ao criar temporada:", error);
    return res
      .status(500)
      .json({ error: "Não foi possível criar a temporada." });
  }
});

router.post("/api/v2/catalog/series/:id/episodes", (req, res) => {
  if (!requireTvboxAccess(req, res)) return;
  const id = String(req.params.id || "");
  const seasonNumber = Number(req.body.seasonNumber);
  const number = Number(req.body.number);
  const title = String(req.body.title || "").trim();
  const url = String(req.body.url || "").trim();
  const type = String(req.body.type || "");
  if (
    !/^[a-zA-Z0-9_-]{1,80}$/.test(id) ||
    !Number.isInteger(seasonNumber) ||
    seasonNumber < 1 ||
    seasonNumber > 999 ||
    !Number.isInteger(number) ||
    number < 1 ||
    number > 9999 ||
    !title ||
    title.length > 200 ||
    !/^https?:\/\//i.test(url) ||
    url.length > 4096 ||
    !["hls", "mp4"].includes(type)
  ) {
    return res
      .status(400)
      .json({
        error: "Informe temporada, número, título, URL e formato válidos.",
      });
  }

  try {
    const file = path.join(SERIES_DIRECTORY, `${id}.json`);
    const catalog = loadSeriesCatalog();
    if (
      !catalog.some((item) => String(item.id) === id) ||
      !fs.existsSync(file)
    ) {
      return res.status(404).json({ error: "Série não encontrada." });
    }
    const details = JSON.parse(fs.readFileSync(file, "utf-8"));
    const season = (details.seasons || []).find(
      (item) => Number(item.number) === seasonNumber,
    );
    if (!season)
      return res.status(404).json({ error: "Temporada não encontrada." });
    season.episodes = Array.isArray(season.episodes) ? season.episodes : [];
    if (season.episodes.some((episode) => Number(episode.number) === number)) {
      return res
        .status(409)
        .json({ error: "Esse número de episódio já existe na temporada." });
    }
    season.episodes.push({ number, title, url, type });
    season.episodes.sort(
      (left, right) => Number(left.number) - Number(right.number),
    );
    fs.writeFileSync(file, JSON.stringify(details, null, 2), "utf-8");
    return res.status(201).json({ ok: true, seasonNumber, number });
  } catch (error) {
    console.error("Falha ao adicionar episódio:", error);
    return res
      .status(500)
      .json({ error: "Não foi possível adicionar o episódio." });
  }
});

router.patch(
  "/api/v2/catalog/series/:id/seasons/:seasonNumber/episodes/:episodeNumber",
  (req, res) => {
    if (!requireTvboxAccess(req, res)) return;
    const id = String(req.params.id || "");
    const sourceSeasonNumber = Number(req.params.seasonNumber);
    const sourceEpisodeNumber = Number(req.params.episodeNumber);
    const targetSeasonNumber = Number(
      req.body.seasonNumber ?? sourceSeasonNumber,
    );
    const number = Number(req.body.number);
    const title = String(req.body.title || "").trim();
    const url = String(req.body.url || "").trim();
    const type = String(req.body.type || "");
    if (
      !/^[a-zA-Z0-9_-]{1,80}$/.test(id) ||
      !Number.isInteger(sourceSeasonNumber) ||
      sourceSeasonNumber < 1 ||
      !Number.isInteger(sourceEpisodeNumber) ||
      sourceEpisodeNumber < 1 ||
      !Number.isInteger(targetSeasonNumber) ||
      targetSeasonNumber < 1 ||
      targetSeasonNumber > 999 ||
      !Number.isInteger(number) ||
      number < 1 ||
      number > 9999 ||
      !title ||
      title.length > 200 ||
      !/^https?:\/\//i.test(url) ||
      url.length > 4096 ||
      !["hls", "mp4"].includes(type)
    ) {
      return res
        .status(400)
        .json({ error: "Informe dados válidos para o episódio." });
    }

    try {
      const file = path.join(SERIES_DIRECTORY, `${id}.json`);
      const catalog = loadSeriesCatalog();
      if (
        !catalog.some((item) => String(item.id) === id) ||
        !fs.existsSync(file)
      ) {
        return res.status(404).json({ error: "Série não encontrada." });
      }
      const details = JSON.parse(fs.readFileSync(file, "utf-8"));
      const seasons = Array.isArray(details.seasons) ? details.seasons : [];
      const sourceSeason = seasons.find(
        (season) => Number(season.number) === sourceSeasonNumber,
      );
      const targetSeason = seasons.find(
        (season) => Number(season.number) === targetSeasonNumber,
      );
      if (!sourceSeason || !targetSeason) {
        return res.status(404).json({ error: "Temporada não encontrada." });
      }
      sourceSeason.episodes = Array.isArray(sourceSeason.episodes)
        ? sourceSeason.episodes
        : [];
      targetSeason.episodes = Array.isArray(targetSeason.episodes)
        ? targetSeason.episodes
        : [];
      const episode = sourceSeason.episodes.find(
        (item) => Number(item.number) === sourceEpisodeNumber,
      );
      if (!episode)
        return res.status(404).json({ error: "Episódio não encontrado." });
      if (
        targetSeason.episodes.some(
          (item) => item !== episode && Number(item.number) === number,
        )
      ) {
        return res
          .status(409)
          .json({ error: "Esse número de episódio já existe na temporada." });
      }

      sourceSeason.episodes = sourceSeason.episodes.filter(
        (item) => item !== episode,
      );
      episode.number = number;
      episode.title = title;
      episode.url = url;
      episode.type = type;
      targetSeason.episodes.push(episode);
      sourceSeason.episodes.sort(
        (left, right) => Number(left.number) - Number(right.number),
      );
      if (sourceSeason !== targetSeason) {
        targetSeason.episodes.sort(
          (left, right) => Number(left.number) - Number(right.number),
        );
      }
      fs.writeFileSync(file, JSON.stringify(details, null, 2), "utf-8");
      return res.json({ ok: true, seasonNumber: targetSeasonNumber, number });
    } catch (error) {
      console.error("Falha ao editar episódio:", error);
      return res
        .status(500)
        .json({ error: "Não foi possível editar o episódio." });
    }
  },
);

router.post("/api/v2/catalog/posters/search", async (req, res) => {
  if (!requireTvboxAccess(req, res)) return;
  const title = String(req.body.title || "").trim();
  const kind = String(req.body.kind || "");
  if ((!title && kind !== "kick") || title.length > 200) {
    return res
      .status(400)
      .json({ error: "Informe um título de até 200 caracteres." });
  }
  if (kind === "kick") {
    const username = String(req.body.username || "")
      .trim()
      .replace(/^@/, "");
    if (!/^[a-zA-Z0-9_.-]{2,80}$/.test(username)) {
      return res
        .status(400)
        .json({ error: "Informe um usuário válido da Kick." });
    }

    try {
      const response = await fetch(
        `https://kick.com/api/v2/channels/${encodeURIComponent(username)}`,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0",
            Referer: "https://kick.com/",
          },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) {
        return res.status(response.status === 404 ? 404 : 502).json({
          error:
            response.status === 404
              ? "Não foi encontrado um canal da Kick com esse usuário."
              : "Não foi possível consultar o perfil da Kick agora.",
        });
      }
      const data = await response.json();
      const poster =
        data.user?.profile_pic ||
        data.user?.profile_picture ||
        data.profile_pic ||
        data.profile_picture ||
        data.banner_picture ||
        "";
      if (!poster) {
        return res
          .status(404)
          .json({ error: "Esse canal da Kick não possui uma foto de perfil." });
      }
      return res.json({
        poster,
        title: data.user?.username || data.slug || username,
        source: "Kick",
      });
    } catch (error) {
      console.error("Falha ao buscar capa de canal da Kick:", error);
      return res
        .status(502)
        .json({ error: "Não foi possível buscar a capa na Kick agora." });
    }
  }

  if (!["movie", "series"].includes(kind)) {
    return res
      .status(400)
      .json({
        error: "A busca de capas aceita filmes, séries e canais da Kick.",
      });
  }

  try {
    const result = await findPoster(title, kind === "series" ? "tv" : "movie");
    if (!result?.poster) {
      return res
        .status(404)
        .json({ error: "Nenhuma capa encontrada para esse título." });
    }
    return res.json(result);
  } catch (error) {
    console.error("Falha ao buscar capa do catálogo:", error);
    return res
      .status(502)
      .json({ error: "Não foi possível buscar a capa agora." });
  }
});

router.post("/api/v2/session", (req, res) => {
  if (!PASSWORD || !SESSION_SECRET) {
    return res
      .status(503)
      .json({
        error: "O login administrativo não está configurado no servidor.",
      });
  }
  if (!passwordMatches(req.body.password)) {
    return res.status(401).json({ error: "Senha incorreta." });
  }
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  return res.json({ token: signSession({ expiresAt }), expiresAt });
});

router.get("/api/v2/session", (req, res) => {
  if (!requireTvboxAccess(req, res)) return;
  return res.json({ authenticated: true });
});

router.post("/api/v2/catalog/items", (req, res) => {
  if (!requireTvboxAccess(req, res)) return;
  const kind = String(req.body.kind || "");
  const title = String(req.body.title || "").trim();
  const category = String(req.body.category || "").trim();
  const poster = String(req.body.poster || "").trim();
  if (!["movie", "series", "live", "kick"].includes(kind)) {
    return res.status(400).json({ error: "Tipo de conteúdo inválido." });
  }
  if (!title || title.length > 200) {
    return res
      .status(400)
      .json({ error: "Informe um título de até 200 caracteres." });
  }
  if (category.length > 100) {
    return res
      .status(400)
      .json({ error: "A categoria deve ter até 100 caracteres." });
  }
  if (poster && (!/^https?:\/\//i.test(poster) || poster.length > 4096)) {
    return res
      .status(400)
      .json({ error: "Informe uma URL HTTP(S) válida para a capa." });
  }

  if (kind === "series") {
    const baseId =
      title
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "serie";
    const catalog = loadSeriesCatalog();
    let id = baseId;
    let suffix = 2;
    while (
      catalog.some((item) => item.id === id) ||
      fs.existsSync(path.join(SERIES_DIRECTORY, `${id}.json`))
    ) {
      id = `${baseId}-${suffix++}`;
    }
    const createdAt = Date.now();
    const validPoster = poster || null;
    fs.mkdirSync(SERIES_DIRECTORY, { recursive: true });
    catalog.push({
      id,
      title,
      category: category || "Séries",
      endpoint: `series/${id}.json`,
      poster: validPoster,
      createdAt,
    });
    fs.writeFileSync(
      path.join(SERIES_DIRECTORY, `${id}.json`),
      JSON.stringify(
        {
          title,
          category: category || "Séries",
          poster: validPoster,
          createdAt,
          seasons: [],
        },
        null,
        2,
      ),
      "utf-8",
    );
    saveSeriesCatalog(catalog);
    return res.status(201).json({ ok: true, id: `series:${id}` });
  }

  if (kind === "kick") {
    const username = String(req.body.username || "")
      .trim()
      .replace(/^@/, "");
    if (!/^[a-zA-Z0-9_.-]{2,80}$/.test(username)) {
      return res
        .status(400)
        .json({ error: "Informe um usuário válido da Kick." });
    }
    const channels = loadDB();
    if (
      channels.some((item) =>
        String(item.url || "")
          .toLowerCase()
          .includes(`/channels/${username.toLowerCase()}/playback-url`),
      )
    ) {
      return res
        .status(409)
        .json({ error: "Esse canal da Kick já está cadastrado." });
    }
    let id = Date.now();
    while (channels.some((item) => String(item.id) === String(id))) id++;
    channels.push({
      id,
      name: title,
      url: `https://kick.com/api/v2/channels/${encodeURIComponent(username)}/playback-url`,
      type: "kick",
      category: "kick",
      createdAt: id,
      ...(poster ? { poster } : {}),
    });
    saveDB(channels);
    return res.status(201).json({ ok: true, id: `kick:${id}` });
  }

  const url = String(req.body.url || "").trim();
  const mediaType = String(req.body.mediaType || "hls").toLowerCase();
  if (!/^https?:\/\//i.test(url) || url.length > 4096) {
    return res
      .status(400)
      .json({ error: "Informe uma URL HTTP(S) válida para o conteúdo." });
  }
  if (!["hls", "mp4", "embed"].includes(mediaType)) {
    return res.status(400).json({ error: "Formato de mídia inválido." });
  }

  const channels = loadDB();
  if (channels.some((item) => String(item.url || "") === url)) {
    return res.status(409).json({ error: "Essa URL já está cadastrada." });
  }
  let id = Date.now();
  while (channels.some((item) => String(item.id) === String(id))) id++;
  channels.push({
    id,
    name: title,
    url,
    type: mediaType,
    category: category || (kind === "movie" ? "filmes" : "m3u"),
    categories: categoriesFromForm({
      category: category || (kind === "movie" ? "filmes" : "m3u"),
    }),
    contentType: kind,
    createdAt: id,
    ...(poster ? { poster } : {}),
  });
  saveDB(channels);
  return res.status(201).json({ ok: true, id: `${kind}:${id}` });
});

router.patch("/api/v2/catalog/categories", (req, res) => {
  if (!requireTvboxAccess(req, res)) return;
  const category = String(req.body.category || "").trim();
  const kind = String(req.body.kind || "");
  if (!category || category.length > 100 || !["movie", "live"].includes(kind)) {
    return res
      .status(400)
      .json({ error: "Informe uma categoria e um tipo válido." });
  }
  const channels = loadDB();
  const normalizedCategory = category.toLocaleLowerCase("pt-BR");
  const matchingItems = channels.filter((item) => {
    if (String(item.type || "").toLowerCase() === "kick") return false;
    return itemCategories(item).some((value) =>
      value
        .split("|")
        .some(
          (part) =>
            part.trim().toLocaleLowerCase("pt-BR") === normalizedCategory,
        ),
    );
  });
  if (!matchingItems.length) {
    return res
      .status(404)
      .json({ error: "Nenhum filme ou canal encontrado nessa categoria." });
  }
  matchingItems.forEach((item) => {
    item.contentType = kind;
  });
  saveDB(channels);
  return res.json({ ok: true, updated: matchingItems.length });
});

router.patch("/api/v2/catalog/items/:id", (req, res) => {
  if (!requireTvboxAccess(req, res)) return;
  const [requestedKind, ...idParts] = String(req.params.id || "").split(":");
  const id = idParts.join(":");
  const kind = String(req.body.kind || requestedKind);
  const title = String(req.body.title || "").trim();
  const category = String(req.body.category || "").trim();
  const poster = String(req.body.poster || "").trim();
  if (!title || title.length > 200 || category.length > 100) {
    return res.status(400).json({ error: "Título ou categoria inválidos." });
  }
  if (poster && (!/^https?:\/\//i.test(poster) || poster.length > 4096)) {
    return res
      .status(400)
      .json({ error: "Informe uma URL HTTP(S) válida para a capa." });
  }

  if (requestedKind === "series") {
    if (kind !== "series" || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return res.status(400).json({ error: "Série inválida para edição." });
    }
    const series = loadSeriesCatalog();
    const entry = series.find((item) => item.id === id);
    const file = path.join(SERIES_DIRECTORY, `${id}.json`);
    if (!entry || !fs.existsSync(file)) {
      return res.status(404).json({ error: "Série não encontrada." });
    }
    const details = JSON.parse(fs.readFileSync(file, "utf-8"));
    const updatedAt = Date.now();
    entry.title = title;
    entry.category = category || "Séries";
    entry.poster = poster || null;
    entry.updatedAt = updatedAt;
    details.title = title;
    details.category = entry.category;
    details.poster = entry.poster;
    details.updatedAt = updatedAt;
    fs.writeFileSync(file, JSON.stringify(details, null, 2), "utf-8");
    saveSeriesCatalog(series);
    return res.json({ ok: true });
  }

  if (
    !["movie", "live", "kick"].includes(requestedKind) ||
    (requestedKind === "kick"
      ? kind !== "kick"
      : !["movie", "live"].includes(kind))
  ) {
    return res
      .status(400)
      .json({ error: "Não é possível alterar o tipo deste item." });
  }
  const channels = loadDB();
  const item = channels.find((entry) => String(entry.id) === id);
  if (!item) return res.status(404).json({ error: "Item não encontrado." });
  if (
    requestedKind === "kick" &&
    String(item.type || "").toLowerCase() !== "kick"
  ) {
    return res.status(400).json({ error: "Canal da Kick inválido." });
  }
  item.name = title;
  item.category =
    category ||
    (kind === "movie" ? "filmes" : kind === "kick" ? "kick" : "m3u");
  item.categories = categoriesFromForm({ category: item.category });
  item.poster = poster || null;
  if (kind === "movie" || kind === "live") {
    item.contentType = kind;
    if (req.body.url !== undefined) {
      const url = String(req.body.url || "").trim();
      const mediaType = String(
        req.body.mediaType || item.type || "",
      ).toLowerCase();
      if (!/^https?:\/\//i.test(url) || url.length > 4096) {
        return res
          .status(400)
          .json({ error: "Informe uma URL HTTP(S) válida para o conteúdo." });
      }
      if (!["hls", "mp4", "embed"].includes(mediaType)) {
        return res.status(400).json({ error: "Formato de mídia inválido." });
      }
      if (
        channels.some(
          (entry) => entry !== item && String(entry.url || "") === url,
        )
      ) {
        return res.status(409).json({ error: "Essa URL já está cadastrada." });
      }
      item.url = url;
      item.type = mediaType;
    }
  }
  saveDB(channels);
  return res.json({ ok: true });
});

// Configuração pública consumida pelo app Android. A edição continua protegida
// pelo middleware da rota /tvbox.
router.get("/api/home", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(loadHomeConfig());
});

function bannerCatalog() {
  return [
    ...loadDB().map((item) => ({ key: "item:" + item.id, name: item.name })),
    ...loadSeriesCatalog().map((item) => ({
      key: "series:" + item.id,
      name: item.title || item.name || item.id,
    })),
  ];
}
function bannerEditor(config) {
  const catalog = bannerCatalog();
  function row(banner = {}) {
    const options = catalog
      .map(
        (item) =>
          `<option value="${safeText(item.key)}" ${item.key === banner.target ? "selected" : ""}>${safeText(item.name)}</option>`,
      )
      .join("");
    return `<fieldset style="margin:16px 0;padding:16px;border:1px solid #46516a;border-radius:12px">
      <label>Conteúdo</label><select name="bannerTarget"><option value="">Selecione um item</option>${options}</select>
      <label>Título (vazio usa o nome do item)</label><input name="bannerTitle" value="${safeText(banner.title || "")}">
      <label>Descrição</label><input name="bannerSubtitle" value="${safeText(banner.subtitle || "")}">
      <label>Imagem horizontal (opcional)</label><input type="url" name="bannerImage" value="${safeText(banner.image || "")}" placeholder="https://...">
      <label>Exibir</label><select name="bannerEnabled"><option value="true">Sim</option><option value="false" ${banner.enabled === false ? "selected" : ""}>Não</option></select>
      <div class="actions" style="margin-top:12px"><button class="btn" type="button" data-banner-up>Subir</button><button class="btn" type="button" data-banner-down>Descer</button><button class="btn danger" type="button" data-banner-remove>Remover</button></div>
    </fieldset>`;
  }
  return `<section class="panel"><h2>Banners do carrossel CINEDARK</h2>
    <p>Escolha até 12 destaques. A ordem abaixo será a ordem no app. Sem banners cadastrados, o app usa as capas do catálogo.</p>
    <form method="post" action="/tvbox/home/banners"><div id="banner-rows">${(config.banners || []).map(row).join("")}</div>
      <template id="banner-template">${row()}</template>
      <div class="actions"><button type="button" class="btn" id="banner-add">Adicionar banner</button><button class="btn primary" type="submit">Salvar banners</button></div>
    </form></section>`;
}
router.post("/home/banners", (req, res) => {
  const list = (value) =>
    Array.isArray(value) ? value : value == null ? [] : [value];
  const targets = list(req.body.bannerTarget),
    titles = list(req.body.bannerTitle);
  const subtitles = list(req.body.bannerSubtitle),
    images = list(req.body.bannerImage),
    enabled = list(req.body.bannerEnabled);
  const known = new Set(bannerCatalog().map((item) => item.key));
  const banners = targets
    .map((target, index) => ({
      target: String(target),
      title: String(titles[index] || "")
        .trim()
        .slice(0, 160),
      subtitle: String(subtitles[index] || "")
        .trim()
        .slice(0, 320),
      image: /^https?:\/\//i.test(String(images[index] || ""))
        ? String(images[index]).trim()
        : "",
      enabled: enabled[index] !== "false",
    }))
    .filter((banner) => known.has(banner.target))
    .slice(0, 12);
  saveHomeConfig({ ...loadHomeConfig(), banners });
  res.redirect("/tvbox/home?saved=1");
});

router.get("/home", (req, res) => {
  const config = loadHomeConfig();

  const categories = [...new Set(loadDB().flatMap(itemCategories))].sort(
    (a, b) => a.localeCompare(b, "pt-BR"),
  );

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

  res.send(
    tvboxPage(
      "Página inicial",
      body.replace("{{bannerEditor}}", bannerEditor(config)),
    ),
  );
});

// Dados dinâmicos da Home
router.get("/home/data", (req, res) => {
  try {
    const config = loadHomeConfig();

    const categories = [...new Set(loadDB().flatMap(itemCategories))].sort(
      (a, b) => a.localeCompare(b, "pt-BR"),
    );

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
  sections.push({
    id: "new-releases",
    type: "new-releases",
    title: "Recém lançados",
    enabled: true,
    limit: 10,
  });
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
  saveHomeConfig({ ...loadHomeConfig(), sections });
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
  const newReleaseOrder = getNewReleaseOrder();
  const newReleaseKeys = new Set(newReleaseOrder);
  const catalog = loadSeriesCatalog().map((item) => ({
    id: item.id,
    title: item.title || item.name || item.id,
    poster: item.poster || null,
    newRelease: newReleaseKeys.has(`series:${item.id}`),
    newReleaseOrder: newReleaseOrder.indexOf(`series:${item.id}`),
    createdAt: item.createdAt || null,
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
  const newReleaseKeys = getNewReleaseKeys();
  const cards = series.length
    ? series
        .map(
          (item) =>
            `<article class="card"><div class="row"><span class="badge">SÉRIE</span>${newReleaseKeys.has(`series:${item.id}`) ? '<span class="badge">RECÉM LANÇADO</span>' : ""}<div class="actions"><a class="btn" href="/tvbox/series/${encodeURIComponent(item.id)}">Abrir</a><a class="btn danger" href="/tvbox/series/${encodeURIComponent(item.id)}/delete" onclick="return confirm('Excluir a série e todas as temporadas e episódios?')">Excluir</a></div></div><h2 style="margin-top:14px">${safeText(item.title)}</h2><p class="muted">ID: ${safeText(item.id)}<br>Endpoint: ${safeText(item.endpoint || `series/${item.id}.json`)}</p></article>`,
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
    createdAt: Date.now(),
  });
  saveSeriesCatalog(catalog);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        title,
        poster: validPoster,
        createdAt: catalog[catalog.length - 1].createdAt,
        seasons: [],
      },
      null,
      2,
    ),
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
  if (req.body.target === "category")
    return importM3UCategory(req, res, incoming);

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
      createdAt: Date.now() + added,
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

function importM3UCategory(req, res, incoming) {
  const category = String(req.body.category || "").trim();
  if (!category) return res.status(400).send("Categoria ausente");
  const normalize = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLocaleLowerCase("pt-BR")
      .replace(/\s+/g, " ");
  const db = loadDB();
  let added = 0,
    updated = 0,
    ignored = 0;
  const used = new Set(db.map((item) => String(item.id)));
  let nextId =
    Math.max(Date.now(), ...db.map((item) => Number(item.id) || 0)) + 1;
  for (const raw of incoming) {
    const name = String(raw?.name || raw?.title || "").trim();
    const url = String(raw?.url || "").trim();
    if (
      !name ||
      !/^https?:\/\//i.test(url) ||
      !["http:", "https:"].includes(new URL(url).protocol)
    ) {
      ignored++;
      continue;
    }
    const matches = db.filter(
      (item) =>
        hasCategory(item, category) && normalize(item.name) === normalize(name),
    );
    if (matches.length > 1) {
      ignored++;
      continue;
    }
    if (matches.length === 1) {
      if (matches[0].url !== url || matches[0].type !== "mp4") {
        matches[0].url = url;
        matches[0].type = "mp4";
        updated++;
      } else ignored++;
      continue;
    }
    const poster = String(raw.poster || raw.logo || "").trim();
    while (used.has(String(nextId))) nextId++;
    const id = nextId++;
    used.add(String(id));
    db.push({
      id,
      name,
      url,
      type: "mp4",
      category,
      categories: [category],
      createdAt: Date.now() + added,
      ...(/^https?:\/\//i.test(poster) ? { poster } : {}),
    });
    added++;
  }
  if (added || updated) saveDB(db);
  res.send(
    tvboxPage(
      "Importação concluída",
      `<section class="panel"><h1>Importação concluída</h1><p>${updated} atualizados · ${added} adicionados · ${ignored} ignorados</p><a class="btn primary" href="/tvbox/categories">Voltar às categorias</a></section>`,
    ),
  );
}

router.get("/categories", (req, res) => {
  const dbData = loadDB();
  const newReleaseKeys = getNewReleaseKeys();
  const categories = dbData.reduce((groups, item) => {
    for (const category of itemCategories(item).length
      ? itemCategories(item)
      : ["outros"]) {
      (groups[category] ||= []).push(item);
    }
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
          .map((item) => {
            const contentType = inferredContentType(item);
            const contentTypeBadge = contentType
              ? `<span class="badge">${contentType === "movie" ? "FILME NO APP" : "AO VIVO NO APP"}</span>`
              : "";
            const newReleaseBadge = newReleaseKeys.has(`movie:${item.id}`)
              ? '<span class="badge">RECÉM LANÇADO</span>'
              : "";
            return `<article class="category-item" data-name="${safeText(`${item.name}${item.type || ""}`)}"><div><strong>${safeText(item.name)}</strong><span class="badge">${safeText(item.type || "hls")}</span>${contentTypeBadge}${newReleaseBadge}<p class="url">${safeText(item.url)}</p></div><div class="actions"><a class="btn" href="/tvbox/edit/${item.id}">Editar</a><a class="btn danger" href="/tvbox/delete/${item.id}" onclick="return confirm('Excluir este item?')">Excluir</a></div></article>`;
          })
          .join("");
        return `<details class="category-group" data-category="${safeText(category)}"><summary><div><span class="badge">CATEGORIA</span><strong>${safeText(category)}</strong></div><div class="summary-actions" onclick="event.stopPropagation()"><a class="btn" href="/tvbox/category/${encodeURIComponent(category)}">Gerenciar / Renomear</a><span class="count">${items.length} item(ns)</span></div></summary><div class="category-content"><div class="category-tools"><span class="muted">Abra somente a lista que quiser administrar.</span><form method="post" action="/tvbox/category/delete" onsubmit="return confirm('Excluir todos os ${items.length} itens da categoria?')"><input type="hidden" name="category" value="${safeText(category)}"><button class="btn danger" type="submit">Excluir categoria</button></form></div><div class="category-items">${rows}</div></div></details>`;
      })
      .join("") ||
    '<section class="panel"><div class="empty">Nenhuma categoria cadastrada.</div></section>';
  const body = fs
    .readFileSync(
      path.join(TEMPLATES_DIRECTORY, "tvbox-categories.html"),
      "utf-8",
    )
    .replaceAll("{{categoryCount}}", String(Object.keys(categories).length))
    .replace("{{categorySections}}", categorySections)
    .replace(
      "{{categorySelectOptions}}",
      Object.keys(categories)
        .sort()
        .map(
          (category) =>
            `<option value="${safeText(category)}">${safeText(category)}</option>`,
        )
        .join(""),
    );
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
    return (
      !hasCategory(item, normalizedCategory) || itemCategories(item).length > 1
    );
  });
  saveDB(
    remaining.map((item) => {
      const categories = itemCategories(item).filter(
        (value) => value.toLocaleLowerCase("pt-BR") !== normalizedCategory,
      );
      return { ...item, category: categories[0] || "outros", categories };
    }),
  );
  res.redirect("/tvbox/categories");
});

router.get("/", (req, res) => {
  if (!hasTvboxSession(req)) return res.redirect("/tvbox/login");
  const channels = loadDB();
  const series = loadSeriesCatalog();

  const byCategory = channels.reduce((total, item) => {
    for (const key of itemCategories(item).length
      ? itemCategories(item)
      : ["outros"])
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
  return res.send(
    tvboxPage(
      "Adicionar item",
      body.replace("{{categoryOptions}}", categoryFields(loadDB())),
    ),
  );
});

// Busca e cadastro manual de lives da Kick.
router.get("/kick", (req, res) => {
  const body = fs.readFileSync(
    path.join(TEMPLATES_DIRECTORY, "tvbox-kick.html"),
    "utf-8",
  );
  res.send(tvboxPage("Buscar na Kick", body));
});

router.get("/api/kick/catalog", (req, res) => {
  const items = loadDB()
    .filter((item) => String(item.type || "").toLowerCase() === "kick")
    .map((item) => ({
      id: item.id,
      name: item.name,
      username:
        String(item.url || "").match(/channels\/([^/]+)\/playback-url/i)?.[1] ||
        "",
      poster: item.poster || "",
      category: item.category || "kick",
    }));
  res.json({ results: items });
});

router.post("/kick/refresh-photo", async (req, res) => {
  try {
    const username = String(req.body.username || "")
      .trim()
      .replace(/^@/, "");
    const response = await fetch(
      `https://kick.com/api/v2/channels/${encodeURIComponent(username)}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0",
          Referer: "https://kick.com/",
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw Error(`Kick retornou HTTP ${response.status}`);
    const data = await response.json();
    const poster =
      data.user?.profile_pic ||
      data.user?.profile_picture ||
      data.profile_pic ||
      data.profile_picture ||
      data.banner_picture ||
      "";
    if (!poster) throw Error("A API não retornou foto");
    const dbData = loadDB();
    const item = dbData.find((x) =>
      String(x.url || "")
        .toLowerCase()
        .includes(`/channels/${username.toLowerCase()}/playback-url`),
    );
    if (!item) throw Error("Live não encontrada no catálogo");
    item.poster = poster;
    item.name = item.name || data.user?.username || username;
    saveDB(dbData);
    res.json({ ok: true, poster });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

router.get("/api/kick/search", async (req, res) => {
  try {
    const query = String(req.query.query || "").trim();
    if (!query) return res.json({ results: [] });
    const response = await fetch(
      `https://search.kick.com/api/v1/search/enriched?query=${encodeURIComponent(query)}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0",
          Referer: "https://kick.com/",
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw Error(`Kick retornou HTTP ${response.status}`);
    const payload = await response.json();
    const raw = Array.isArray(payload)
      ? payload
      : payload.results ||
        payload.channels ||
        payload.data?.channels ||
        payload.data?.results ||
        [];
    const results = raw
      .map((item) => item.channel || item.user || item)
      .map((item) => ({
        name: item.name || item.username || item.slug || "",
        username: item.username || item.slug || item.channel_slug || "",
        poster:
          item.avatar_url ||
          item.profile_pic ||
          item.profile_picture ||
          item.banner_picture ||
          item.user?.profile_pic ||
          "",
      }))
      .filter((item) => item.username);
    res.json({
      results: results.filter(
        (item, i, all) =>
          all.findIndex(
            (x) => x.username.toLowerCase() === item.username.toLowerCase(),
          ) === i,
      ),
    });
  } catch (error) {
    res.status(502).json({ error: error.message, results: [] });
  }
});

router.post("/kick/add", (req, res) => {
  const username = String(req.body.username || "")
    .trim()
    .replace(/^@/, "");
  const name = String(req.body.name || username).trim();
  const poster = String(req.body.poster || "").trim();
  if (!/^[a-zA-Z0-9_\-\.]{2,80}$/.test(username))
    return res.status(400).json({ error: "Username inválido" });
  const dbData = loadDB();
  if (
    dbData.some((item) =>
      String(item.url || "").includes(`/channels/${username}/playback-url`),
    )
  )
    return res.json({ ok: true, exists: true });
  dbData.push({
    id: Date.now(),
    name,
    url: `https://kick.com/api/v2/channels/${encodeURIComponent(username)}/playback-url`,
    type: "kick",
    category: "kick",
    ...(/^https?:\/\//i.test(poster) ? { poster } : {}),
  });
  saveDB(dbData);
  res.json({ ok: true });
});

router.post("/add", (req, res) => {
  const { name, url, type, poster } = req.body;
  const categories = categoriesFromForm(req.body);
  const category = categories[0];
  const imageUrl = String(poster || "").trim();

  let dbData = loadDB();
  dbData.push({
    id: Date.now(),
    name,
    url,
    type,
    category,
    categories,
    ...(contentTypeFromForm(req.body.contentType)
      ? { contentType: contentTypeFromForm(req.body.contentType) }
      : {}),
    createdAt: Date.now(),
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

  const categoryOptions = categoryFields(dbData, itemCategories(item));

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
    .replace(
      "{{content_type_auto}}",
      !contentTypeFromForm(item.contentType) ? "selected" : "",
    )
    .replace(
      "{{content_type_live}}",
      contentTypeFromForm(item.contentType) === "live" ? "selected" : "",
    )
    .replace(
      "{{content_type_movie}}",
      contentTypeFromForm(item.contentType) === "movie" ? "selected" : "",
    )
    .replace("{{categoryOptions}}", categoryOptions);

  res.send(tvboxPage("Editar item", body));
});

router.post("/edit/:id", (req, res) => {
  const id = req.params.id;
  const { name, url, type, poster } = req.body;
  const categories = categoriesFromForm(req.body);
  const category = categories[0];
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
    ...dbData[index],
    id: dbData[index].id,
    name,
    url,
    type,
    category,
    categories,
    ...(contentTypeFromForm(req.body.contentType)
      ? { contentType: contentTypeFromForm(req.body.contentType) }
      : { contentType: undefined }),
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
  const items = channels.filter((item) => hasCategory(item, categoryName));

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
                    <form method="post" action="/tvbox/category/item/delete" onsubmit="return confirm('Excluir este filme do catálogo?')" style="margin:0"><input type="hidden" name="itemId" value="${safeText(item.id)}"><input type="hidden" name="category" value="${safeText(categoryName)}"><button type="submit" class="btn danger">Excluir</button></form>
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
  const renameForm = `<section class="panel" style="margin:18px 0"><h2>Renomear categoria</h2><form method="post" action="/tvbox/category/rename" style="display:flex;gap:12px;align-items:end;flex-wrap:wrap"><input type="hidden" name="oldName" value="${safeText(categoryName)}"><div style="flex:1;min-width:220px"><label>Novo nome da categoria</label><input name="newName" maxlength="120" value="${safeText(categoryName)}" required></div><button class="btn primary" type="submit">Salvar nome</button></form></section>`;
  const body = templateContent
    .replaceAll("{{categoryName}}", safeText(categoryName))
    .replaceAll("{{categorySlug}}", encodeURIComponent(categoryName))
    .replaceAll("{{poster}}", safeText(currentPoster))
    .replaceAll("{{itemsRows}}", itemsRows);

  res.send(tvboxPage(`Categoria: ${categoryName}`, renameForm + body));
});

router.post("/category/rename", (req, res) => {
  const oldName = String(req.body.oldName || "").trim();
  const newName = String(req.body.newName || "").trim();
  if (!oldName || !newName || newName.length > 120)
    return res.status(400).send("Nome de categoria inválido");
  const key = (value) => String(value).trim().toLocaleLowerCase("pt-BR");
  const current = loadDB();
  if (!current.some((item) => hasCategory(item, oldName)))
    return res.status(404).send("Categoria não encontrada");
  if (
    key(oldName) !== key(newName) &&
    current.some((item) => hasCategory(item, newName))
  )
    return res.status(409).send("Já existe uma categoria com esse nome");
  for (const item of current) {
    if (!hasCategory(item, oldName)) continue;
    const names = itemCategories(item).map((name) =>
      key(name) === key(oldName) ? newName : name,
    );
    item.categories = [...new Set(names)];
    item.category =
      key(item.category) === key(oldName)
        ? newName
        : item.category || item.categories[0];
  }
  saveDB(current);
  const meta = loadCategoriesMeta();
  const previousKey = Object.keys(meta).find(
    (name) => key(name) === key(oldName),
  );
  if (previousKey && previousKey !== newName) {
    meta[newName] = meta[previousKey];
    delete meta[previousKey];
    saveCategoriesMeta(meta);
  }
  const home = loadHomeConfig();
  if (Array.isArray(home.sections)) {
    home.sections = home.sections.map((section) =>
      section.type === "category" && key(section.category) === key(oldName)
        ? {
            ...section,
            category: newName,
            title: newName,
            id: `category-${key(newName)}`,
          }
        : section,
    );
    saveHomeConfig(home);
  }
  res.redirect(`/tvbox/category/${encodeURIComponent(newName)}`);
});

router.post("/category/item/delete", (req, res) => {
  const itemId = String(req.body.itemId || "");
  const category = String(req.body.category || "");
  const current = loadDB();
  const target = current.find((item) => String(item.id) === itemId);
  if (!target || !hasCategory(target, category))
    return res.status(404).send("Item não encontrado nesta categoria");
  saveDB(current.filter((item) => String(item.id) !== itemId));
  res.redirect(`/tvbox/category/${encodeURIComponent(category)}`);
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
router.get("/api/events/brasileirao-serie-a", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const result = await embedtv.events({
      brasileirao: true,
      baseUrl: getPublicBaseUrl(req),
      sync: true,
    });

    res.json(result);
  } catch (error) {
    console.error("[EMBEDTV] Brasileirão:", error.message);

    res.status(502).json({
      events: [],
      error: error.message,
    });
  }
});

// API de todos os eventos
router.get("/api/embedtv/epg", async (_req, res) => {
  try {
    const epg = await embedtv.epgAll();
    res.setHeader("Cache-Control", "no-store");
    return res.json(epg);
  } catch (error) {
    console.error("[EMBEDTV] Falha ao servir EPG:", error.message);
    return res
      .status(502)
      .json({ error: "Falha ao consultar programação EmbedTV" });
  }
});

router.get("/api/embedtv/epg/:channelId", async (req, res) => {
  try {
    const schedule = await embedtv.epgForChannel(req.params.channelId);
    if (!schedule)
      return res
        .status(404)
        .json({ error: "Programação do canal não encontrada" });
    res.setHeader("Cache-Control", "private, max-age=600");
    return res.json(schedule);
  } catch (error) {
    console.error(
      "[EMBEDTV] Falha ao servir programação do canal:",
      error.message,
    );
    return res
      .status(502)
      .json({ error: "Falha ao consultar programação EmbedTV" });
  }
});

router.get("/api/embedtv/events", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const result = await embedtv.events({
      baseUrl: getPublicBaseUrl(req),
      sync: true,
    });

    const now = new Date();

    const eventsAtuais = result.events.filter((event) => {
      const timeEnd = new Date(event.time_end);
      const limiteComFolga = new Date(timeEnd.getTime() + 30 * 60000);
      return limiteComFolga >= now;
    });

    var resultFiltrado = {
      ...result,
      events: eventsAtuais,
      total: eventsAtuais.length,
    };

    res.json(resultFiltrado);
  } catch (error) {
    console.error("[EMBEDTV] Todos os eventos:", error.message);

    res.status(502).json({
      events: [],
      error: error.message,
    });
  }
});

// Painel HLS

router.get("/hls", (req, res) => {
  try {
    const file = path.join(TEMPLATES_DIRECTORY, "tvbox-hls.html");

    console.log("[TVBOX HLS] Abrindo:", file);

    if (!fs.existsSync(file)) {
      return res
        .status(500)
        .send("ERRO: arquivo tvbox-hls.html não encontrado em " + file);
    }

    const html = fs.readFileSync(file, "utf8");

    console.log("[TVBOX HLS] HTML carregado:", html.length, "caracteres");

    const page = tvboxPage("Canais HLS", html);

    console.log("[TVBOX HLS] Página montada com sucesso");

    return res.status(200).type("html").send(page);
  } catch (error) {
    console.error("[TVBOX HLS] ERRO AO ABRIR PÁGINA:", error.stack);

    return res
      .status(500)
      .type("text")
      .send("Erro ao abrir painel HLS:\n\n" + error.stack);
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

router.post("/hls/channels/:id/refresh", async (req, res) => {
  const channel = hls.channelById(req.params.id);

  if (!channel) {
    return res.status(404).json({
      error: "Canal não encontrado",
    });
  }

  try {
    const result = await hls.refresh(channel, true);

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
      lastCheck: new Date(result.checked).toISOString(),
    });
  } catch (error) {
    return res.status(502).json({
      error: error.message,
    });
  }
});

// Excluir canal
router.delete("/hls/channels/:id", (req, res) => {
  if (!hls.remove(req.params.id)) {
    return res.status(404).json({
      error: "Canal não encontrado",
    });
  }

  res.json({ ok: true });
});

router.delete("/hls/channels", (req, res) => {
  try {
    const removed = hls.removeAll();
    res.json({ ok: true, removed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Diagnóstico da EmbedTV
router.get("/hls/embedtv-status", (req, res) => {
  res.json(embedtv.status());
});

router.post("/hls/sync-embedtv", async (req, res) => {
  try {
    console.log("[EMBEDTV] Sincronização solicitada pelo painel");

    const result = await embedtv.events({
      force: true,
      sync: true,
      baseUrl: getPublicBaseUrl(req),
    });

    return res.json({
      ...result,
      message: "Eventos consultados. Sincronização HLS iniciada.",
    });
  } catch (error) {
    console.error("[EMBEDTV] Falha na consulta:", error);

    return res.status(502).json({
      error: error.message,
    });
  }
});

router.post("/hls/reset-embedtv-channels", async (req, res) => {
  try {
    console.log("[EMBEDTV] Reset manual dos canais solicitado pelo painel");
    const result = await embedtv.resetChannels();
    res.json({
      ok: true,
      ...result,
      message: "Canais EmbedTV removidos e sincronizados novamente.",
    });
  } catch (error) {
    console.error("[EMBEDTV] Falha no reset dos canais:", error);
    res.status(502).json({ error: error.message });
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
