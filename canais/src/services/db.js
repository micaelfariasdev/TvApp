const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "../../database.json");
const SERIES_FILE = path.join(__dirname, "../../series.json");

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = [
      {
        id: 1,
        name: "Loud Coringa",
        url: "https://kick.com/api/v2/channels/coringa/playback-url",
        type: "kick",
        category: "lives",
      },
      {
        id: 2,
        name: "Gabepeixe",
        url: "https://kick.com/api/v2/channels/gabepeixe/playback-url",
        type: "kick",
        category: "lives",
      },
      {
        id: 3,
        name: "Allan",
        url: "https://kick.com/api/v2/channels/allanstag/playback-url",
        type: "kick",
        category: "lives",
      },
    ];
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), "utf-8");
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function loadSeriesCatalog() {
  if (!fs.existsSync(SERIES_FILE)) return [];
  return JSON.parse(fs.readFileSync(SERIES_FILE, "utf-8"));
}

function saveSeriesCatalog(data) {
  fs.writeFileSync(SERIES_FILE, JSON.stringify(data, null, 2), "utf-8");
}

const CATEGORIES_FILE = path.join(__dirname, "../../categories.json");
const HOME_FILE = path.join(__dirname, "../../home.json");

const DEFAULT_HOME_CONFIG = {
  sections: [
    { id: "kick-live", type: "kick-live", title: "Ao vivo na Kick", enabled: true, limit: 1 },
    { id: "movies", type: "category", category: "filmes", title: "Filmes em destaque", enabled: true, limit: 18 },
    { id: "series", type: "series", title: "Séries", enabled: true, limit: 18 },
  ],
};

function loadCategoriesMeta() {
  if (!fs.existsSync(CATEGORIES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CATEGORIES_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveCategoriesMeta(data) {
  fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function loadHomeConfig() {
  if (!fs.existsSync(HOME_FILE)) return structuredClone(DEFAULT_HOME_CONFIG);
  try {
    const config = JSON.parse(fs.readFileSync(HOME_FILE, "utf-8"));
    return Array.isArray(config?.sections)
      ? { ...config, sections: config.sections, banners: Array.isArray(config.banners) ? config.banners : [] }
      : structuredClone(DEFAULT_HOME_CONFIG);
  } catch {
    return structuredClone(DEFAULT_HOME_CONFIG);
  }
}

function saveHomeConfig(data) {
  const sections = Array.isArray(data?.sections) ? data.sections : [];
  fs.writeFileSync(HOME_FILE, JSON.stringify({ ...data, sections, banners: Array.isArray(data?.banners) ? data.banners : [] }, null, 2), "utf-8");
}

module.exports = {
  DB_FILE,
  SERIES_FILE,
  CATEGORIES_FILE,
  HOME_FILE,
  loadDB,
  saveDB,
  loadSeriesCatalog,
  saveSeriesCatalog,
  loadCategoriesMeta,
  saveCategoriesMeta,
  loadHomeConfig,
  saveHomeConfig,
};
