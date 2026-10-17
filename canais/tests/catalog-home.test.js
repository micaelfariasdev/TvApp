const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const categories = require("../src/services/categories");

function panel() {
  let items = [{ id: 7, name: "Filme", url: "https://example.test/movie.mp4", type: "mp4", category: "filmes", categories: ["filmes", "Marvel"], source: "manual" }];
  let config = { sections: [], banners: [{ target: "item:7", title: "Destaque", enabled: true }] };
  const routes = new Map();
  const router = { use() {}, delete() {}, get(route, ...handlers) { routes.set("GET " + route, handlers.at(-1)); }, post(route, ...handlers) { routes.set("POST " + route, handlers.at(-1)); } };
  const db = {
    loadDB: () => structuredClone(items), saveDB: data => { items = structuredClone(data); },
    loadSeriesCatalog: () => [{ id: "s1", title: "Série" }], saveSeriesCatalog() {},
    loadCategoriesMeta: () => ({ Terror: { poster: "https://example.test/terror.jpg" } }), saveCategoriesMeta() {},
    loadHomeConfig: () => structuredClone(config), saveHomeConfig: data => { config = structuredClone(data); }
  };
  const multer = () => ({ single: () => () => {} }); multer.memoryStorage = () => ({});
  const helpers = {
    requireTvboxAccess: () => true, hasTvboxSession: () => true, safeText: value => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;"),
    removeLegacyPasswordFromHtml: value => value
  };
  const file = path.resolve(__dirname, "../src/routes/admin.js");
  const dependencies = {
    express: { Router: () => router }, multer, "../config/env": { PASSWORD: "test" },
    "../services/db": db, "../services/categories": categories, "../utils/helpers": helpers,
    "../services/poster": {}, "../services/hls": {}, "../services/embedtv": {}
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), {
    require: name => name in dependencies ? dependencies[name] : require(name),
    __dirname: path.dirname(file), module, exports: module.exports, console, structuredClone, Date, URL, Buffer, setTimeout, clearTimeout
  }, { filename: file });
  function call(method, route, request = {}) {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, setHeader() {}, send(value) { this.body = value; }, json(value) { this.body = value; }, redirect(value) { this.redirected = value; } };
    routes.get(method + " " + route)({ body: {}, params: {}, query: {}, headers: {}, protocol: "http", get: () => "localhost", ...request }, response);
    return response;
  }
  return { call, items: () => items, config: () => config };
}

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

