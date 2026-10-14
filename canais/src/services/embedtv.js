"use strict";

const hls = require("./hls");
const { loadDB, saveDB } = require("./db");
const { BASE_URL } = require("../config/env");

const API_URLS = [
  "https://embedtv.cc/api/events",
  "http://embedtv.cc/api/events",
];
const CHANNEL_API_URLS = [
  "https://embedtv.cc/api/channels",
  "http://embedtv.cc/api/channels",
];
const CHANNEL_SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;

let cache = null;
let updatedAt = 0;
let pending = null;
let lastAttempt = null;
let lastError = null;
let lastHttpStatus = null;
let syncing = null;
let channelsCache = null;
let channelsUpdatedAt = 0;
let channelsPending = null;

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isBrasileirao(event) {
  const league = normalize(event?.league?.name);
  // A EmbedTV já retornou variações como "Brasileirão Série A" e
  // "Brasileirão - Série A". Não depender de uma única pontuação.
  return league.includes("brasileirao") && league.includes("serie a");
}

function extractPlayer(player) {
  if (typeof player === "string") {
    return player;
  }

  if (player && typeof player === "object") {
    return player.url || player.apiUrl || player.embedUrl || player.src || null;
  }

  return null;
}

function allowedEmbed(value) {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      (url.hostname === "embedtv.cc" ||
        url.hostname === "embedtv.lat" ||
        url.hostname.endsWith(".embedtv.cc") ||
        url.hostname.endsWith(".embedtv.lat"))
    );
  } catch {
    return false;
  }
}

function idFor(event) {
  return hls.slug(event.title || event.slug || String(event.id || ""));
}

async function load(force = false) {
  if (!force && cache && Date.now() - updatedAt < 60000) {
    return cache;
  }

  if (pending) {
    return pending;
  }

  pending = (async () => {
    lastAttempt = new Date().toISOString();

    let lastFailure = null;

    for (const apiUrl of API_URLS) {
      try {
        console.log("[EMBEDTV] Consultando:", apiUrl);

        const response = await fetch(apiUrl, {
          headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0",
          },
          signal: AbortSignal.timeout(15000),
        });

        lastHttpStatus = response.status;

        if (!response.ok) {
          throw new Error(`EmbedTV retornou HTTP ${response.status}`);
        }

        const payload = await response.json();

        const events = Array.isArray(payload) ? payload : payload?.events;

        if (!Array.isArray(events)) {
          throw new Error("A API retornou um formato inválido");
        }

        cache = events;
        updatedAt = Date.now();
        lastError = null;

        console.log(`[EMBEDTV] Consulta concluída: ${events.length} eventos`);

        return events;
      } catch (error) {
        lastFailure = error;

        console.error("[EMBEDTV] Falha:", apiUrl, error.message);
      }
    }

    lastError = lastFailure?.message || "Não foi possível consultar a EmbedTV";

    throw lastFailure || new Error(lastError);
  })();

  try {
    return await pending;
  } finally {
    pending = null;
  }
}

async function loadChannels(force = false) {
  if (!force && channelsCache && Date.now() - channelsUpdatedAt < CHANNEL_SYNC_INTERVAL_MS) return channelsCache;
  if (channelsPending) return channelsPending;
  channelsPending = (async () => {
    let failure;
    for (const apiUrl of CHANNEL_API_URLS) {
      try {
        const response = await fetch(apiUrl, {
          headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw new Error(`EmbedTV canais retornou HTTP ${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload?.channels)) throw new Error("Formato de canais inválido");
        channelsCache = { categories: Array.isArray(payload.categories) ? payload.categories : [], channels: payload.channels };
        channelsUpdatedAt = Date.now();
        return channelsCache;
      } catch (error) { failure = error; }
    }
    throw failure || new Error("Não foi possível consultar os canais EmbedTV");
  })();
  try { return await channelsPending; } finally { channelsPending = null; }
}

async function syncChannels(force = false) {
  const payload = await loadChannels(force);
  const categoryById = new Map(payload.categories.map((category) => [Number(category.id), String(category.name || "outros").trim()]));
  const imported = payload.channels.map((channel) => {
    const category = (Array.isArray(channel.categories) ? channel.categories : [])
      .map((id) => categoryById.get(Number(id)))
      .find((name) => name && name.toLowerCase() !== "todos") || "EmbedTV";
    const id = `embedtv-channel-${hls.slug(channel.id || channel.name)}`;
    return {
      id,
      name: channel.name || channel.id || id,
      // O banco público guarda apenas o endereço do proxy. A origem fica
      // separada para o serviço HLS continuar renovando o token do EmbedTV.
      url: `${BASE_URL}/tvbox/api/live/${encodeURIComponent(id)}.m3u8`,
      originUrl: channel.url,
      type: "hls",
      category,
      poster: channel.image || channel.preview || null,
      source: "embedtv-channels",
      sourceId: String(channel.id || ""),
    };
  }).filter((channel) => channel.originUrl);
  const importedIds = new Set(imported.map((channel) => channel.id));
  const current = loadDB();
  const kept = current.filter((item) => item.source !== "embedtv-channels" || importedIds.has(item.id));
  const byId = new Map(kept.map((item) => [String(item.id), item]));
  for (const channel of imported) byId.set(channel.id, { ...byId.get(channel.id), ...channel });
  saveDB([...byId.values()]);
  for (const channel of imported) {
    try {
      const existing = hls.channelById(channel.id);
      if (existing && existing.url !== channel.originUrl) hls.remove(channel.id);
      await hls.add({ id: channel.id, name: channel.name, url: channel.originUrl, automatic: false });
    }
    catch (error) { console.warn("[EMBEDTV] Canal não registrado no proxy:", channel.id, error.message); }
  }
  return { categories: payload.categories.length, imported: imported.length, updatedAt: new Date(channelsUpdatedAt).toISOString() };
}

async function resetChannels() {
  const current = loadDB();
  const embedChannels = current.filter((item) => item.source === "embedtv-channels");
  // Limpa também registros órfãos que ficaram apenas no hls-channels.json.
  // Sem isso, hls.add() recusa o mesmo ID quando a origem/token mudou.
  const proxyIds = hls.list()
    .map((channel) => String(channel.id || ""))
    .filter((id) => id.startsWith("embedtv-channel-"));
  for (const id of new Set([
    ...embedChannels.map((channel) => String(channel.id)),
    ...proxyIds,
  ])) hls.remove(id);
  saveDB(current.filter((item) => item.source !== "embedtv-channels"));
  channelsCache = null;
  channelsUpdatedAt = 0;
  const payload = await loadChannels(true);
  const result = await syncChannels(true);
  return { removed: embedChannels.length, ...result, apiChannels: payload.channels.length };
}

async function syncPlayers(events) {
  if (syncing) return syncing;
  syncing = registerPlayers(events);
  try { return await syncing; } finally { syncing = null; }
}

async function registerPlayers(events) {
  // A sincronização deve registrar qualquer evento com player válido.
  // O filtro de Brasileirão é aplicado somente quando solicitado pela rota,
  // não durante o registro interno dos HLS.
  const selected = Array.isArray(events) ? events : [];
  let registered = 0;
  let failed = 0;
  for (const event of selected) {
    const id = idFor(event);
    if (!id) continue;
    const start = Date.parse(event.time_start || "");
    if (Number.isFinite(start) && Date.now() >= start + 5 * 60 * 60 * 1000) continue;
    const player = (Array.isArray(event.players) ? event.players : [])
      .map(extractPlayer).find((url) => url && allowedEmbed(url));
    if (!player) continue;
    try {
      await hls.add({ id, name: event.title || id, url: player, automatic: true });
      registered++;
    } catch (error) {
      failed++;
      console.error("[EMBEDTV] Falha:", id, error.message);
    }
  }
  return { registered, failed };
}

function mapEvent(event, baseUrl = "") {
  const channels = new Map(hls.list().map((channel) => [channel.id, channel]));

  const id = idFor(event);
  const channel = channels.get(id);
  const players = channel ? [{
    embedUrl: channel.url,
    apiUrl: `${baseUrl}/tvbox/api/live/${encodeURIComponent(id)}.m3u8`,
    status: channel.status,
    error: channel.error,
  }] : [];

  return {
    id: event.id,
    slug: id,
    originalSlug: event.slug || null,
    hlsUrl: channel ? `${baseUrl}/tvbox/api/live/${encodeURIComponent(id)}.m3u8` : null,
    title: event.title || null,

    league: {
      name: event.league?.name || null,
      image: event.league?.image || null,
    },

    teams: {
      home: {
        name: event.teams?.home?.name || null,
        image: event.teams?.home?.image || null,
      },

      away: {
        name: event.teams?.away?.name || null,
        image: event.teams?.away?.image || null,
      },
    },

    time_start: event.time_start || null,
    time_end: event.time_end || null,

    players,
  };
}

async function events(options = {}) {
  const {
    brasileirao = false,
    force = false,
    baseUrl = "",
    sync = false,
  } = options;

  // Consulta a API sem aguardar a verificação HLS.
  const allEvents = await load(force);

  const selected = brasileirao ? allEvents.filter(isBrasileirao) : allEvents;

  // Registra os players antes de montar a resposta. Antes isso rodava em
  // segundo plano e uma URL recém-trocada aparecia como `not_registered`
  // até a próxima consulta da API.
  let syncResult = null;
  if (sync) {
    syncResult = await syncPlayers(selected);
  }

  return {
    events: selected.map((event) => mapEvent(event, baseUrl)),
    total: selected.length,
    updatedAt: new Date(updatedAt).toISOString(),
    syncing: Boolean(syncing),
    sync: syncResult,
  };
}

function status() {
  return {
    lastAttempt,

    updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,

    lastError,
    lastHttpStatus,

    cachedEvents: cache?.length || 0,
  };
}

module.exports = {
  events,
  channels: loadChannels,
  syncChannels,
  resetChannels,
  load,
  status,
};

// Consulta inicial e sincronização dos canais.
setImmediate(async () => {
  try {
    console.log("[EMBEDTV] Iniciando consulta automática...");

    await events({
      force: true,
      sync: true,
    });
    await syncChannels(false);

    console.log("[EMBEDTV] Consulta inicial concluída.");
  } catch (error) {
    console.error("[EMBEDTV] Erro inicial:", error.message);
  }
});

// Canais mudam pouco; sincroniza duas vezes por dia e mantém o proxy renovando
// os tokens internamente conforme cada canal é reproduzido.
const timer = setInterval(async () => {
  try {
    await syncChannels(true);
  } catch (error) {
    console.error("[EMBEDTV] Erro na sincronização de canais:", error.message);
  }
}, CHANNEL_SYNC_INTERVAL_MS);

timer.unref?.();
