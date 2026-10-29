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
const NEW_RELEASE_LIMIT = 10;
const NEW_RELEASE_SECTION = {
  id: "new-releases",
  type: "new-releases",
  title: "Recém lançados",
  enabled: true,
  limit: NEW_RELEASE_LIMIT,
};

const DEFAULT_HOME_CONFIG = {
  sections: [
    { id: "kick-live", type: "kick-live", title: "Ao vivo na Kick", enabled: true, limit: 1 },
    NEW_RELEASE_SECTION,
    { id: "movies", type: "category", category: "filmes", title: "Filmes em destaque", enabled: true, limit: 18 },
    { id: "series", type: "series", title: "Séries", enabled: true, limit: 18 },
  ],
};

function creationTime(item) {
  const value = item.createdAt;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 1_000_000_000_000) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  const id = Number(item.id);
  return Number.isFinite(id) && id > 1_000_000_000_000 ? id : null;
}

function getNewReleaseOrder() {
  const movies = loadDB().filter((item) => {
    if (item.contentType === "live") return false;
    if (item.contentType === "movie") return true;
    const categories = [item.category, ...(Array.isArray(item.categories) ? item.categories : [])];
    return categories.some((category) =>
      ["filme", "filmes", "movie", "movies"].includes(
        String(category || "").split("|")[0].trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR"),
      ),
    );
  });
  const series = loadSeriesCatalog();
  const candidates = [
    ...movies.map((item, index) => ({
      key: `movie:${item.id}`,
      createdAt: creationTime(item),
      age: movies.length - index,
    })),
    ...series.map((item, index) => ({
      key: `series:${item.id}`,
      createdAt: creationTime(item),
      age: series.length - index,
    })),
  ];
  candidates.sort((left, right) => {
    if (left.createdAt != null && right.createdAt != null && left.createdAt !== right.createdAt) {
      return right.createdAt - left.createdAt;
    }
    if (left.createdAt != null && right.createdAt == null) return -1;
    if (left.createdAt == null && right.createdAt != null) return 1;
    return left.age - right.age || left.key.localeCompare(right.key);
  });
  return candidates.slice(0, NEW_RELEASE_LIMIT).map((item) => item.key);
}

function getNewReleaseKeys() {
  return new Set(getNewReleaseOrder());
}

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
    if (!Array.isArray(config?.sections)) return structuredClone(DEFAULT_HOME_CONFIG);
    const sections = config.sections.filter((section) => section.type !== "new-releases");
    sections.unshift({ ...NEW_RELEASE_SECTION });
    return { ...config, sections, banners: Array.isArray(config.banners) ? config.banners : [] };
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
  getNewReleaseOrder,
  getNewReleaseKeys,
  loadCategoriesMeta,
  saveCategoriesMeta,
  loadHomeConfig,
  saveHomeConfig,
};
