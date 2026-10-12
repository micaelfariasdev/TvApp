
const express = require("express");
const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const net = require("net");
const crypto = require("crypto");
const axios = require("axios");
const { SocksProxyAgent } = require("socks-proxy-agent");

const {
  loadDB,
  loadSeriesCatalog,
  loadCategoriesMeta,
} = require("../services/db");

const router = express.Router();
const hls = require("../services/hls");

const SERIES_DIRECTORY = path.join(__dirname, "../../series");

// ==========================================
// CONFIGURAÇÃO DO PROXY HLS
// ==========================================

const HLS_PROXY_PATH = "/api/hls-proxy";
const WARP_SOCKS_URL = "socks5h://127.0.0.1:40000";

const warpAgent = new SocksProxyAgent(WARP_SOCKS_URL, {
  keepAlive: true,
});

const MAX_PLAYLIST_SIZE = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

// ==========================================
// CANAIS
// ==========================================

router.get("/channels.json", (req, res) => {
  const dbData = loadDB();
  const categoriesMeta = loadCategoriesMeta();

  const cleanData = dbData.map(
    ({ name, url, type, category, poster }) => {
      const categoryKey = String(category || "outros").trim();
      const categoryPoster =
        categoriesMeta[categoryKey]?.poster || null;

      return {
        name,
        url,
        type,
        category,
        poster: poster || categoryPoster,
      };
    }
  );

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(cleanData);
});

// ==========================================
// SÉRIES
// ==========================================

router.get("/series.json", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const catalog = loadSeriesCatalog();

  res.type("application/json").send(
    JSON.stringify(catalog, null, 2)
  );
});

router.get("/series/:id.json", (req, res) => {
  const id = req.params.id;

  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({
      error: "Invalid series id",
    });
  }

  const file = path.join(
    SERIES_DIRECTORY,
    `${id}.json`
  );

  if (!fs.existsSync(file)) {
    return res.status(404).json({
      error: "Series not found",
    });
  }

  res.setHeader("Access-Control-Allow-Origin", "*");

  res.type("application/json").send(
    fs.readFileSync(file, "utf-8")
  );
});

// ==========================================
// REPRODUÇÃO HLS EXISTENTE
// ==========================================

router.get("/api/live/:id.m3u8", hls.play);

router.get(
  "/api/live/resource/:token",
  hls.resource
);

// ==========================================
// VALIDAÇÃO DOS DESTINOS
// ==========================================

function isPrivateIp(ip) {
  const family = net.isIP(ip);

  if (family === 4) {
    const p = ip.split(".").map(Number);

    return (
      p[0] === 0 ||
      p[0] === 10 ||
      p[0] === 127 ||
      p[0] >= 224 ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 192 && p[1] === 0 && p[2] === 0) ||
      (p[0] === 192 && p[1] === 0 && p[2] === 2) ||
      (p[0] === 198 && p[1] >= 18 && p[1] <= 19) ||
      (p[0] === 198 && p[1] === 51 && p[2] === 100) ||
      (p[0] === 203 && p[1] === 0 && p[2] === 113)
    );
  }

  if (family === 6) {
    const normalized = ip.toLowerCase();

    if (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("ff")
    ) {
      return true;
    }

    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.slice(7);

      if (net.isIP(mapped) === 4) {
        return isPrivateIp(mapped);
      }
    }
  }

  return false;
}

async function validateHlsUrl(rawUrl) {
  const target = new URL(rawUrl);

  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password ||
    !target.hostname
  ) {
    throw new Error("URL HLS inválida");
  }

  const hostname = target.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Destino interno não permitido");
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error("IP privado não permitido");
    }
  } else {
    const addresses = await dns.lookup(hostname, {
      all: true,
    });

    if (
      !addresses.length ||
      addresses.some((entry) => isPrivateIp(entry.address))
    ) {
      throw new Error("Destino não permitido");
    }
  }

  return target;
}

// ==========================================
// REESCRITA DAS URLS HLS
// ==========================================

const proxySessions = new Map();
const PROXY_SESSION_IDLE_MS = 15 * 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of proxySessions) {
    if (now - session.lastAccess > PROXY_SESSION_IDLE_MS) {
      proxySessions.delete(id);
    }
  }
}, 60_000).unref?.();

function getProxySession(id) {
  const validId = /^[a-f0-9]{24}$/i.test(String(id || "")) ? String(id) : null;
  let session = validId ? proxySessions.get(validId) : null;
  if (!session) {
    session = {
      id: crypto.randomBytes(12).toString("hex"),
      cookies: new Map(),
      lastAccess: Date.now(),
    };
    proxySessions.set(session.id, session);
  }
  session.lastAccess = Date.now();
  return session;
}

function cookieHeader(session, target) {
  if (!session) return "";
  const cookies = session.cookies.get(target.hostname.toLowerCase());
  return cookies ? [...cookies.values()].join("; ") : "";
}

function saveCookies(session, target, setCookie) {
  if (!session || !setCookie) return;
  const values = Array.isArray(setCookie) ? setCookie : [setCookie];
  const host = target.hostname.toLowerCase();
  const jar = session.cookies.get(host) || new Map();
  for (const value of values) {
    const pair = String(value).split(";", 1)[0];
    const name = pair.split("=", 1)[0]?.trim();
    if (name) jar.set(name, pair);
  }
  if (jar.size) session.cookies.set(host, jar);
}

function buildProxyUrl(url, session) {
  return (
    `${HLS_PROXY_PATH}?url=` +
    encodeURIComponent(url) +
    `&session=${encodeURIComponent(session.id)}`
  );
}

function rewritePlaylist(content, base, session) {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        return line;
      }

      // Tags com URI, como EXT-X-KEY,
      // EXT-X-MAP, EXT-X-PART e EXT-X-MEDIA.
      if (trimmed.startsWith("#")) {
        return line.replace(
          /URI="([^"]+)"/g,
          (_, uri) => {
            const absolute = new URL(
              uri,
              base
            ).href;

            return (
              `URI="${buildProxyUrl(absolute, session)}"`
            );
          }
        );
      }

      // Segmentos e playlists filhas.
      const absolute = new URL(
        trimmed,
        base
      ).href;

      return buildProxyUrl(absolute, session);
    })
    .join("\n");
}

// ==========================================
// BUSCA ATRAVÉS DO WARP
// ==========================================

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableHlsStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

async function fetchThroughWarpOnce(url, range, session) {
  let currentUrl = url;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const target = await validateHlsUrl(
      currentUrl
    );

    const response = await axios.get(
      target.href,
      {
        httpAgent: warpAgent,
        httpsAgent: warpAgent,
        proxy: false,
        responseType: "stream",
        timeout: 20000,
        maxRedirects: 0,
        validateStatus: () => true,
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "*/*",
          ...(cookieHeader(session, target)
            ? { Cookie: cookieHeader(session, target) }
            : {}),
          ...(range
            ? { Range: range }
            : {}),
        },
      }
    );

    if (
      [301, 302, 303, 307, 308].includes(
        response.status
      )
    ) {
      const location =
        response.headers.location;

      response.data.destroy();

      if (!location) {
        throw new Error(
          "Redirecionamento sem Location"
        );
      }

      currentUrl = new URL(
        location,
        target
      ).href;

      continue;
    }

    saveCookies(session, target, response.headers["set-cookie"]);
    return {
      response,
      finalUrl: target,
    };
  }

  throw new Error(
    "Muitos redirecionamentos"
  );
}

// Uma falha transitória no WARP/servidor de origem não deve encerrar a live
// imediatamente. Segmentos e playlists recebem duas novas tentativas curtas.
async function fetchThroughWarp(url, range, session) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await fetchThroughWarpOnce(url, range, session);
      if (!retryableHlsStatus(result.response.status) || attempt === 2) {
        return result;
      }
      result.response.data.destroy();
      await wait(350 * (attempt + 1));
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
      await wait(350 * (attempt + 1));
    }
  }

  throw lastError || new Error("Falha temporária ao buscar HLS");
}

// ==========================================
// POLLING DAS PLAYLISTS HLS
// ==========================================

// Cache por playlist ativa.
// O servidor acompanha apenas canais recentemente solicitados.

const livePlaylists = new Map();

const PLAYLIST_IDLE_MS = 10 * 60_000;
const PLAYLIST_MIN_POLL_MS = 2_000;
const PLAYLIST_MAX_POLL_MS = 10_000;
// Não entregue uma playlist velha por muito tempo: depois de 30 s o app
// recebe erro, baixa novamente o catálogo e pode usar uma URL assinada nova.
const PLAYLIST_MAX_STALE_MS = 30_000;

function playlistPollMs(body) {
  const match = body.match(
    /^#EXT-X-TARGETDURATION:\s*(\d+)/m
  );

  const seconds = match
    ? Number(match[1])
    : 6;

  return Math.max(
    PLAYLIST_MIN_POLL_MS,
    Math.min(
      PLAYLIST_MAX_POLL_MS,
      Math.floor(seconds * 500)
    )
  );
}

function playlistDetails(body) {
  const seq = body.match(
    /^#EXT-X-MEDIA-SEQUENCE:\s*(\d+)/m
  );

  return {
    sequence: seq ? Number(seq[1]) : null,
    ended: /^#EXT-X-ENDLIST\s*$/m.test(body),
    master: /^#EXT-X-STREAM-INF:/m.test(body),
  };
}

async function readPlaylist(url, session) {
  const { response, finalUrl } =
    await fetchThroughWarp(url, undefined, session);

  if (response.status !== 200) {
    response.data.destroy();

    throw new Error(
      `Playlist origem HTTP ${response.status}`
    );
  }

  const chunks = [];
  let total = 0;

  for await (const chunk of response.data) {
    total += chunk.length;

    if (total > MAX_PLAYLIST_SIZE) {
      response.data.destroy();
      throw new Error("Playlist muito grande");
    }

    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks)
    .toString("utf8");

  if (!body.trimStart().startsWith("#EXTM3U")) {
    throw new Error(
      "Resposta da origem não é playlist HLS válida"
    );
  }

  return {
    body,
    finalUrl: finalUrl.href,
  };
}

function stopPlaylistPoll(entry) {
  if (entry.timer) {
    clearTimeout(entry.timer);
  }

  entry.timer = null;
  livePlaylists.delete(entry.url);
}

function schedulePlaylistPoll(entry) {
  if (entry.timer) {
    clearTimeout(entry.timer);
  }

  if (
    Date.now() - entry.lastClientAt > PLAYLIST_IDLE_MS ||
    entry.ended ||
    entry.master
  ) {
    stopPlaylistPoll(entry);
    return;
  }

  entry.timer = setTimeout(async () => {
    entry.timer = null;

    if (
      Date.now() - entry.lastClientAt >
      PLAYLIST_IDLE_MS
    ) {
      stopPlaylistPoll(entry);
      return;
    }

    try {
      await updatePlaylist(entry);
    } catch (error) {
      console.warn(
        "[HLS POLL] Falha:",
        error.message,
        entry.url
      );
    }

    if (livePlaylists.get(entry.url) === entry) {
      schedulePlaylistPoll(entry);
    }
  }, entry.pollMs);

  entry.timer.unref?.();
}

async function updatePlaylist(entry) {
  if (entry.pending) {
    return entry.pending;
  }

  entry.pending = (async () => {
    const { body, finalUrl } =
      await readPlaylist(entry.url, entry.session);

    const details = playlistDetails(body);
    const previousSeq = entry.sequence;

    entry.body = rewritePlaylist(body, finalUrl, entry.session);

    entry.updatedAt = Date.now();
    entry.pollMs = playlistPollMs(body);
    entry.sequence = details.sequence;
    entry.ended = details.ended;
    entry.master = details.master;

    if (previousSeq !== entry.sequence) {
      console.log(
        `[HLS POLL] seq ${previousSeq} -> ${entry.sequence}; intervalo=${entry.pollMs}ms`
      );
    }

    if (entry.ended) {
      console.warn(
        "[HLS POLL] A ORIGEM enviou #EXT-X-ENDLIST:",
        entry.url
      );
    }

    return entry.body;
  })();

  try {
    return await entry.pending;
  } finally {
    entry.pending = null;
  }
}

async function getPlaylist(url, requestedSessionId) {
  let entry = livePlaylists.get(url);

  if (!entry) {
    entry = {
      url,
      session: getProxySession(requestedSessionId),
      body: null,
      pending: null,
      timer: null,
      updatedAt: 0,
      lastClientAt: Date.now(),
      pollMs: 3_000,
      sequence: null,
      ended: false,
      master: false,
    };

    livePlaylists.set(url, entry);
  }

  entry.session.lastAccess = Date.now();
  entry.lastClientAt = Date.now();

  if (!entry.body) {
    try {
      await updatePlaylist(entry);
    } catch (error) {
      stopPlaylistPoll(entry);
      throw error;
    }
  } else if (
    Date.now() - entry.updatedAt >
    entry.pollMs * 2
  ) {
    // Se a atualização atrasar, uma requisição
    // do player também pode renová-la.

    try {
      await updatePlaylist(entry);
    } catch (error) {
      if (
        Date.now() - entry.updatedAt >
        PLAYLIST_MAX_STALE_MS
      ) {
        throw error;
      }
    }
  }

  if (
    !entry.timer &&
    !entry.ended &&
    !entry.master
  ) {
    schedulePlaylistPoll(entry);
  }

  return entry.body;
}

// ==========================================
// PROXY HLS VIA CLOUDFLARE WARP
// ==========================================

router.get(
  HLS_PROXY_PATH,
  async (req, res) => {
    const rawUrl = String(
      req.query.url || ""
    );

    if (!rawUrl) {
      return res.status(400).json({
        error: "Informe o parâmetro url",
      });
    }

    try {
      await validateHlsUrl(rawUrl);
    } catch (error) {
      return res.status(400).json({
        error: error.message,
      });
    }

    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    try {
      const urlPath = new URL(rawUrl)
        .pathname.toLowerCase();

      // ==================================
      // PLAYLISTS M3U8 COM POLLING
      // ==================================

      if (urlPath.endsWith(".m3u8")) {
        const body = await getPlaylist(rawUrl, req.query.session);

        return res
          .status(200)
          .type("application/vnd.apple.mpegurl")
          .send(body);
      }

      // ==================================
      // SEGMENTOS E OUTROS RECURSOS
      // ==================================

      // Segmentos TS, M4S, MP4 fragmentado,
      // chaves e URLs sem extensão:
      // mantidos sob demanda.

      const session = getProxySession(req.query.session);
      const { response, finalUrl } =
        await fetchThroughWarp(
          rawUrl,
          req.headers.range,
          session
        );

      if (
        response.status !== 200 &&
        response.status !== 206
      ) {
        response.data.destroy();

        return res.status(502).json({
          error:
            `Origem retornou HTTP ${response.status}`,
        });
      }

      const contentType =
        response.headers["content-type"] || "";

      const isPlaylist = /mpegurl/i.test(
        contentType
      );

      // ==================================
      // PLAYLISTS SEM EXTENSÃO .M3U8
      // ==================================

      if (isPlaylist) {
        const chunks = [];
        let total = 0;

        for await (
          const chunk of response.data
        ) {
          total += chunk.length;

          if (total > MAX_PLAYLIST_SIZE) {
            response.data.destroy();

            return res.status(502).json({
              error: "Playlist muito grande",
            });
          }

          chunks.push(chunk);
        }

        const body = Buffer.concat(chunks)
          .toString("utf8");

        if (
          !body.trimStart()
            .startsWith("#EXTM3U")
        ) {
          return res.status(502).json({
            error: "Playlist HLS inválida",
          });
        }

        return res
          .status(200)
          .type("application/vnd.apple.mpegurl")
          .send(
            rewritePlaylist(body, finalUrl, session)
          );
      }

      // ==================================
      // STREAM DOS SEGMENTOS BINÁRIOS
      // ==================================

      res.status(response.status);

      res.setHeader(
        "Content-Type",
        contentType ||
          "application/octet-stream"
      );

      for (const header of [
        "content-length",
        "content-range",
        "accept-ranges",
      ]) {
        if (response.headers[header]) {
          res.setHeader(
            header,
            response.headers[header]
          );
        }
      }

      response.data.on(
        "error",
        (error) => {
          console.error(
            "[HLS PROXY] Erro no segmento:",
            error.message
          );

          if (!res.destroyed) {
            res.destroy(error);
          }
        }
      );

      res.on("close", () => {
        if (!res.writableFinished) {
          response.data.destroy();
        }
      });

      return response.data.pipe(res);
    } catch (error) {
      console.error(
        "[HLS PROXY] Erro:",
        error.message
      );

      if (res.headersSent) {
        return res.destroy(error);
      }

      return res.status(502).json({
        error:
          "Falha ao acessar HLS pelo WARP",
        detail: error.message,
      });
    }
  }
);

module.exports = router;
