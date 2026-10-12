"use strict";

const hls = require("./hls");

const API_URLS = [
  "https://embedtv.cc/api/events",
  "http://embedtv.cc/api/events",
];

let cache = null;
let updatedAt = 0;
let pending = null;
let lastAttempt = null;
let lastError = null;
let lastHttpStatus = null;
let syncing = null;

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isBrasileirao(event) {
  return normalize(event?.league?.name) === "brasileirao - serie a";
}

function extractPlayer(player) {
  if (typeof player === "string") {
    return player;
  }

  if (player && typeof player === "object") {
    return player.url || player.embedUrl || player.src || null;
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

async function syncPlayers(events) {
  if (syncing) return syncing;
  syncing = registerPlayers(events);
  try { return await syncing; } finally { syncing = null; }
}

async function registerPlayers(events) {
  const selected = events.filter(isBrasileirao);
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

    console.log("[EMBEDTV] Consulta inicial concluída.");
  } catch (error) {
    console.error("[EMBEDTV] Erro inicial:", error.message);
  }
});

// Consulta e sincronização a cada 5 minutos.
const timer = setInterval(async () => {
  try {
    await events({
      force: true,
      sync: true,
    });
  } catch (error) {
    console.error("[EMBEDTV] Erro no polling:", error.message);
  }
}, 300000);

timer.unref?.();
