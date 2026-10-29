const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const categories = require("../src/services/categories");

function panel(options = {}) {
  let items = [{ id: 7, name: "Filme", url: "https://example.test/movie.mp4", type: "mp4", category: "filmes", categories: ["filmes", "Marvel"], source: "manual" }];
  let seriesDetails = {
    title: "Série",
    seasons: [{ number: 1, episodes: [{ number: 1, title: "Episódio piloto", url: "https://example.test/episode.mp4", type: "mp4" }] }],
  };
  const seriesFile = path.resolve(__dirname, "../series/s1.json");
  const posterSearches = [];
  const fsModule = require("node:fs");
  const mockFs = Object.create(fsModule);
  mockFs.existsSync = filePath => path.resolve(filePath) === seriesFile || fsModule.existsSync(filePath);
  mockFs.readFileSync = (filePath, ...args) => path.resolve(filePath) === seriesFile
    ? JSON.stringify(seriesDetails)
    : fsModule.readFileSync(filePath, ...args);
  mockFs.writeFileSync = (filePath, content, ...args) => {
    if (path.resolve(filePath) === seriesFile) {
      seriesDetails = JSON.parse(content);
      return;
    }
    return fsModule.writeFileSync(filePath, content, ...args);
  };
  let config = { sections: [], banners: [{ target: "item:7", title: "Destaque", enabled: true }] };
  const routes = new Map();
  const router = { use() {}, delete() {}, options() {}, get(route, ...handlers) { routes.set("GET " + route, handlers.at(-1)); }, post(route, ...handlers) { routes.set("POST " + route, handlers.at(-1)); }, patch(route, ...handlers) { routes.set("PATCH " + route, handlers.at(-1)); } };
  const db = {
    loadDB: () => structuredClone(items), saveDB: data => { items = structuredClone(data); },
    loadSeriesCatalog: () => [{ id: "s1", title: "Série" }], saveSeriesCatalog() {},
    getNewReleaseOrder: () => [], getNewReleaseKeys: () => new Set(),
    loadCategoriesMeta: () => ({ Terror: { poster: "https://example.test/terror.jpg" } }), saveCategoriesMeta() {},
    loadHomeConfig: () => structuredClone(config), saveHomeConfig: data => { config = structuredClone(data); }
  };
  const multer = () => ({ single: () => () => {} }); multer.memoryStorage = () => ({});
  const helpers = {
    SESSION_COOKIE: "tvbox_session",
    requireTvboxAccess: () => true, hasTvboxSession: () => true, passwordMatches: value => value === "test", signSession: () => "token", safeText: value => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;"),
    removeLegacyPasswordFromHtml: value => value
  };
  const file = path.resolve(__dirname, "../src/routes/admin.js");
  const dependencies = {
    express: { Router: () => router }, multer, "../config/env": { PASSWORD: "test", SESSION_SECRET: "test" },
    "../services/db": db, "../services/categories": categories, "../utils/helpers": helpers,
    "../services/poster": {
      findPoster: async (title, kind) => {
        posterSearches.push({ title, kind });
        return { poster: "https://example.test/poster.jpg", title, source: "IMDb" };
      },
    },
    "../services/hls": {}, "../services/embedtv": {}
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), {
    require: name => name === "fs" ? mockFs : name in dependencies ? dependencies[name] : require(name),
    __dirname: path.dirname(file), module, exports: module.exports, console, structuredClone, Date, URL, Buffer, AbortSignal, setTimeout, clearTimeout,
    fetch: options.fetch || fetch,
  }, { filename: file });
  function call(method, route, request = {}) {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, setHeader() {}, send(value) { this.body = value; }, json(value) { this.body = value; }, cookie(...args) { this.cookieArgs = args; }, redirect(value) { this.redirected = value; } };
    routes.get(method + " " + route)({ body: {}, params: {}, query: {}, headers: {}, protocol: "http", get: () => "localhost", ...request }, response);
    return response;
  }
  async function callAsync(method, route, request = {}) {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, setHeader() {}, send(value) { this.body = value; }, json(value) { this.body = value; }, redirect(value) { this.redirected = value; } };
    await routes.get(method + " " + route)({ body: {}, params: {}, query: {}, headers: {}, protocol: "http", get: () => "localhost", ...request }, response);
    return response;
  }
  return { call, callAsync, items: () => items, setItems: value => { items = structuredClone(value); }, config: () => config, posterSearches, seriesDetails: () => structuredClone(seriesDetails) };
}

test("API v2 classifica catálogos reais e conta séries sem separar episódios", () => {
  const p = panel();
  p.setItems([
    { id: 7, name: "Filme", url: "https://example.test/movie.mp4", type: "mp4", category: "filmes", categories: ["filmes", "Marvel"], createdAt: 10 },
    { id: 8, name: "Canal", url: "https://example.test/live.m3u8", type: "hls", category: "Notícias" },
    { id: 9, name: "Streamer", url: "https://kick.com/streamer", type: "kick", category: "lives" },
  ]);

  const response = p.call("GET", "/api/v2/catalog");

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.version, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(response.body.counts)), { movies: 1, series: 1, live: 1, kick: 1 });
  assert.equal(response.body.items.find(item => item.id === "movie:7").category, "Marvel");
  assert.equal(response.body.items.find(item => item.id === "series:s1").episodes, 1);
  assert.equal(response.body.items.find(item => item.id === "kick:9").username, "streamer");
  assert.deepEqual(JSON.parse(JSON.stringify(response.body.items.map(item => item.id).slice(0, 1))), ["movie:7"]);
});

test("API v2 detalha temporadas e episódios da série", () => {
  const p = panel();
  const response = p.call("GET", "/api/v2/catalog/series/:id", { params: { id: "s1" } });
  const invalid = p.call("GET", "/api/v2/catalog/series/:id", { params: { id: "../s1" } });
  const missing = p.call("GET", "/api/v2/catalog/series/:id", { params: { id: "missing" } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.title, "Série");
  assert.deepEqual(JSON.parse(JSON.stringify(response.body.seasons)), [
    {
      number: 1,
      episodes: [{ number: 1, title: "Episódio piloto", url: "https://example.test/episode.mp4", type: "mp4" }],
    },
  ]);
  assert.equal(invalid.statusCode, 400);
  assert.equal(missing.statusCode, 404);
});

test("API v2 busca capas de filmes, séries e perfis da Kick", async () => {
  const kickRequests = [];
  const p = panel({
    fetch: async (url) => {
      kickRequests.push(url);
      return {
        ok: true,
        json: async () => ({ user: { username: "Streamer", profile_pic: "https://example.test/kick.jpg" } }),
      };
    },
  });
  const movie = await p.callAsync("POST", "/api/v2/catalog/posters/search", {
    body: { title: "Duna", kind: "movie" },
  });
  const series = await p.callAsync("POST", "/api/v2/catalog/posters/search", {
    body: { title: "Arcane", kind: "series" },
  });
  const invalid = await p.callAsync("POST", "/api/v2/catalog/posters/search", {
    body: { title: "Canal", kind: "live" },
  });
  const kick = await p.callAsync("POST", "/api/v2/catalog/posters/search", {
    body: { title: "Streamer", kind: "kick", username: "@streamer" },
  });
  const kickWithoutTitle = await p.callAsync("POST", "/api/v2/catalog/posters/search", {
    body: { kind: "kick", username: "streamer" },
  });

  assert.equal(movie.statusCode, 200);
  assert.equal(movie.body.source, "IMDb");
  assert.equal(series.statusCode, 200);
  assert.equal(kick.statusCode, 200);
  assert.equal(kick.body.poster, "https://example.test/kick.jpg");
  assert.equal(kick.body.source, "Kick");
  assert.equal(kickWithoutTitle.statusCode, 200);
  assert.deepEqual(kickRequests, [
    "https://kick.com/api/v2/channels/streamer",
    "https://kick.com/api/v2/channels/streamer",
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(p.posterSearches)), [
    { title: "Duna", kind: "movie" },
    { title: "Arcane", kind: "tv" },
  ]);
  assert.equal(invalid.statusCode, 400);
});

test("API v2 cria temporadas e adiciona episódios sem substituir os existentes", () => {
  const p = panel();
  const season = p.call("POST", "/api/v2/catalog/series/:id/seasons", {
    params: { id: "s1" },
    body: { number: 2 },
  });
  const duplicateSeason = p.call("POST", "/api/v2/catalog/series/:id/seasons", {
    params: { id: "s1" },
    body: { number: 2 },
  });
  const episode = p.call("POST", "/api/v2/catalog/series/:id/episodes", {
    params: { id: "s1" },
    body: {
      seasonNumber: 2,
      number: 1,
      title: "Novo episódio",
      url: "https://example.test/new-episode.m3u8",
      type: "hls",
    },
  });
  const duplicateEpisode = p.call("POST", "/api/v2/catalog/series/:id/episodes", {
    params: { id: "s1" },
    body: {
      seasonNumber: 2,
      number: 1,
      title: "Episódio duplicado",
      url: "https://example.test/duplicate.m3u8",
      type: "hls",
    },
  });

  assert.equal(season.statusCode, 201);
  assert.equal(duplicateSeason.statusCode, 409);
  assert.equal(episode.statusCode, 201);
  assert.equal(duplicateEpisode.statusCode, 409);
  assert.equal(p.seriesDetails().seasons[0].episodes[0].title, "Episódio piloto");
  assert.equal(p.seriesDetails().seasons[1].episodes[0].title, "Novo episódio");
});

test("API v2 edita episódios e permite movê-los entre temporadas existentes", () => {
  const p = panel();
  p.call("POST", "/api/v2/catalog/series/:id/seasons", {
    params: { id: "s1" },
    body: { number: 2 },
  });
  p.call("POST", "/api/v2/catalog/series/:id/episodes", {
    params: { id: "s1" },
    body: {
      seasonNumber: 2,
      number: 1,
      title: "Temporário",
      url: "https://example.test/temporary.mp4",
      type: "mp4",
    },
  });

  const updated = p.call("PATCH", "/api/v2/catalog/series/:id/seasons/:seasonNumber/episodes/:episodeNumber", {
    params: { id: "s1", seasonNumber: "2", episodeNumber: "1" },
    body: {
      seasonNumber: 1,
      number: 2,
      title: "Episódio revisado",
      url: "https://example.test/revised.m3u8",
      type: "hls",
    },
  });
  const details = p.seriesDetails();

  assert.equal(updated.statusCode, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(details.seasons.map(season => season.episodes.map(episode => episode.title)))), [
    ["Episódio piloto", "Episódio revisado"],
    [],
  ]);
  assert.equal(details.seasons[0].episodes[1].type, "hls");
});

test("API v2 emite sessão administrativa apenas para senha válida", () => {
  const p = panel();
  const valid = p.call("POST", "/api/v2/session", { body: { password: "test" } });
  const invalid = p.call("POST", "/api/v2/session", { body: { password: "wrong" } });
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.token, "token");
  assert.equal(invalid.statusCode, 401);
});

test("login do painel define o cookie da sessão administrativa", () => {
  const p = panel();
  const response = p.call("POST", "/login", {
    body: { password: "test" },
    secure: true,
  });

  assert.equal(response.redirected, "/tvbox");
  assert.equal(response.cookieArgs[0], "tvbox_session");
  assert.equal(response.cookieArgs[1], "token");
  assert.equal(response.cookieArgs[2].httpOnly, true);
  assert.equal(response.cookieArgs[2].secure, true);
});

test("API v2 cria itens e edita título, categoria e tipo entre filme e ao vivo", () => {
  const p = panel();
  const created = p.call("POST", "/api/v2/catalog/items", {
    body: {
      kind: "movie",
      title: "Novo filme",
      category: "Ação",
      url: "https://example.test/new.mp4",
      mediaType: "mp4",
    },
  });
  assert.equal(created.statusCode, 201);
  const channel = p.items().at(-1);
  assert.equal(channel.contentType, "movie");
  assert.equal(channel.category, "Ação");

  const updated = p.call("PATCH", "/api/v2/catalog/items/:id", {
    params: { id: `movie:${channel.id}` },
    body: { kind: "live", title: "Canal atualizado", category: "Notícias" },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(channel.contentType, "movie");
  assert.equal(p.items().at(-1).contentType, "live");
  assert.equal(p.items().at(-1).name, "Canal atualizado");
  assert.deepEqual(p.items().at(-1).categories, ["Notícias"]);
});

test("API v2 altera a classificação de todos os itens da categoria sem tocar na Kick", () => {
  const p = panel();
  p.setItems([
    { id: 10, name: "Filme", url: "https://example.test/film.mp4", type: "mp4", category: "Marvel", categories: ["Marvel"], contentType: "live" },
    { id: 11, name: "Canal", url: "https://example.test/live.m3u8", type: "hls", category: "Marvel" },
    { id: 12, name: "Kick", url: "https://kick.com/channels/streamer/playback-url", type: "kick", category: "Marvel" },
  ]);
  const response = p.call("PATCH", "/api/v2/catalog/categories", {
    body: { category: "Marvel", kind: "movie" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.updated, 2);
  assert.equal(p.items()[0].contentType, "movie");
  assert.equal(p.items()[1].contentType, "movie");
  assert.equal(p.items()[2].contentType, undefined);
});

test("cadastro e edição listam categorias existentes, inclusive extras e metadados", () => {
  const p = panel();
  for (const response of [p.call("GET", "/add"), p.call("GET", "/edit/:id", { params: { id: "7" } })]) {
    for (const name of ["Marvel", "Terror", "filmes"]) assert.ok(response.body.includes('value="' + name + '"'));
    assert.ok(!response.body.includes("{{categoryOptions}}"));
  }
});

test("categorias múltiplas sobrevivem ao cadastro, edição e API sem perder source", () => {
  const p = panel();
  p.call("POST", "/edit/:id", { params: { id: "7" }, body: { name: "Filme", url: "https://example.test/movie.mp4", type: "mp4", categories: ["filmes", "Marvel"], newCategories: "Ação; Marvel" } });
  assert.deepEqual(p.items()[0].categories, ["filmes", "Marvel", "Ação"]);
  assert.equal(p.items()[0].source, "manual");
  assert.deepEqual(p.call("GET", "/api/channels").body[0].categories, ["filmes", "Marvel", "Ação"]);
  p.call("POST", "/add", { body: { name: "Novo", url: "https://example.test/2.mp4", type: "mp4", categories: ["Marvel", "Terror"] } });
  assert.deepEqual(p.items()[1].categories, ["Marvel", "Terror"]);
  assert.ok(p.call("GET", "/category/:name", { params: { name: "Terror" } }).body.includes("Novo"));
});

test("salvar seções preserva banners; editor e API expõem o carrossel", () => {
  const p = panel();
  p.call("POST", "/home", { body: { showSeries: "on" } });
  assert.equal(p.config().banners[0].target, "item:7");
  const page = p.call("GET", "/home").body;
  assert.ok(page.includes('action="/tvbox/home/banners"'));
  assert.ok(!page.includes("{{bannerEditor}}"));
  p.call("POST", "/home/banners", { body: {
    bannerTarget: ["series:s1", "item:7", "item:inexistente"],
    bannerTitle: ["Minha série", "Meu filme", "Inválido"],
    bannerSubtitle: ["Temporadas", "", ""], bannerImage: ["https://example.test/banner.jpg", "javascript:bad", ""],
    bannerEnabled: ["true", "false", "true"]
  } });
  assert.equal(p.config().banners.length, 2);
  assert.equal(p.config().banners[0].target, "series:s1");
  assert.equal(p.config().banners[1].enabled, false);
  assert.equal(p.config().banners[1].image, "");
  assert.equal(p.call("GET", "/api/home").body.banners[0].title, "Minha série");
  assert.equal(p.config().sections[0].type, "series");
});

test("persistência de home preserva banners sem tocar nos arquivos reais", () => {
  let persisted = JSON.stringify({ sections: [], banners: [{ target: "item:7" }] });
  const fakeFs = {
    existsSync: () => true,
    readFileSync: () => persisted,
    writeFileSync: (file, data) => { assert.ok(file.endsWith("home.json")); persisted = data; }
  };
  const module = { exports: {} };
  const file = path.resolve(__dirname, "../src/services/db.js");
  vm.runInNewContext(fs.readFileSync(file, "utf8"), {
    require: name => name === "fs" ? fakeFs : require(name), __dirname: path.dirname(file), module, exports: module.exports, structuredClone
  }, { filename: file });
  const db = module.exports;
  const config = db.loadHomeConfig();
  assert.equal(config.banners[0].target, "item:7");
  db.saveHomeConfig({ ...config, sections: [{ id: "movies" }] });
  assert.equal(db.loadHomeConfig().banners[0].target, "item:7");
});
