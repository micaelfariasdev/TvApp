"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const dns = require("node:dns/promises");
const net = require("node:net");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const axios = require("axios");
const { SocksProxyAgent } = require("socks-proxy-agent");
const FILE = path.join(__dirname, "../../hls-channels.json");
const SETTINGS = path.join(__dirname, "../../hls-settings.json");
// Mantém os tokens de recursos por tempo suficiente para uma reprodução em
// andamento. O limite antigo de 30 minutos fazia streams longas falharem
// mesmo que o app ainda estivesse assistindo.
const RESOURCE_IDLE_TTL_MS = 15 * 60 * 1000;
const AUTO_TTL_MS = 5 * 60 * 60 * 1000;
// Evita consultar centenas de origens ao mesmo tempo. A atualização normal é
// feita sob demanda pelo player; o polling serve apenas para manter o cache.
const POLL_CONCURRENCY = 2;
const MAX_REFRESH_PER_RUN = 20;
const channels = new Map(),
  cache = new Map(),
  resources = new Map();
let interval = null,
  lastRun = null,
  running = false;
let settings = { pollingSeconds: 300, embedtvSeconds: 60 };
const WARP_SOCKS_URL = process.env.WARP_SOCKS_URL || "socks5h://127.0.0.1:40000";
const warpAgent = new SocksProxyAgent(WARP_SOCKS_URL, { keepAlive: true });
try {
  settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS, "utf8")) };
} catch {}
try {
  for (const c of JSON.parse(fs.readFileSync(FILE, "utf8")))
    if (c.id && c.url && (!c.automatic || (c.expiresAt && c.expiresAt > Date.now()))) channels.set(c.id, c);
} catch {}
const slug = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-+$/g, "")
    .slice(0, 70);
function publicIP(ip) {
  if (net.isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}
async function validate(raw) {
  const u = new URL(raw);
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !["80", "443"].includes(u.port))
  )
    throw Error("URL não permitida");
  if (net.isIP(u.hostname)) {
    if (!publicIP(u.hostname)) throw Error("IP privado não permitido");
  } else {
    const ips = await dns.lookup(u.hostname, { all: true, family: 4 });
    if (!ips.length || ips.some((x) => !publicIP(x.address)))
      throw Error("Endereço de origem não permitido");
  }
  return u.href;
}
async function request(raw, headers = {}) {
  let url = raw;
  for (let i = 0; i < 5; i++) {
    url = await validate(url);
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*", ...headers },
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      await response.body?.cancel();
      if (!next) throw Error("Redirect inválido");
      url = new URL(next, url).href;
      continue;
    }
    return { response, url };
  }
  throw Error("Redirecionamentos demais");
}
async function textLimited(response) {
  const size = Number(response.headers.get("content-length") || 0);
  if (size > 2_000_000) throw Error("HTML/playlist grande demais");
  const data = await response.arrayBuffer();
  if (data.byteLength > 2_000_000) throw Error("HTML/playlist grande demais");
  return Buffer.from(data).toString("utf8");
}

// A página EmbedTV e o endereço temporário podem ter bloqueio/região por IP.
// A resolução usa o WARP quando HLS_USE_WARP não estiver explicitamente
// desativado. O fallback direto mantém o serviço funcionando caso o WARP
// esteja parado durante uma reinicialização.
async function requestEmbed(raw, headers = {}) {
  if (String(process.env.HLS_USE_WARP || "1") === "0") return request(raw, headers);
  try {
    let url = raw;
    for (let i = 0; i < 5; i++) {
      const target = await validate(url);
      const response = await axios.get(target, {
        httpAgent: warpAgent,
        httpsAgent: warpAgent,
        proxy: false,
        maxRedirects: 0,
        responseType: "arraybuffer",
        timeout: 15000,
        validateStatus: () => true,
        headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*", ...headers },
      });
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        url = new URL(response.headers.location, target).href;
        continue;
      }
      const body = Buffer.from(response.data || []);
      return {
        url: target,
        response: {
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          headers: { get: (name) => response.headers[String(name).toLowerCase()] || null },
          arrayBuffer: async () => body,
        },
      };
    }
    throw Error("Redirecionamentos demais");
  } catch (error) {
    console.warn(`[HLS] WARP indisponível; usando conexão direta: ${error.message}`);
    return request(raw, headers);
  }
}
function candidates(body, base) {
  const txt = body
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x2f;/gi, "/");
  const found = new Set();
  for (const m of txt.matchAll(
    /(?:https?:\/\/[^\s"'<>]+|["']([^"']+)["'])/gi,
  )) {
    const candidate = (m[1] || m[0]).replace(/[\\'";,)>]+$/g, "");
    if (!/\.(?:m3u8|txt)(?:[?#]|$)/i.test(candidate)) continue;
    try {
      found.add(new URL(candidate, base).href);
    } catch {}
  }
  return [...found].slice(0, 30);
}
async function resolve(channel) {
  const root = await requestEmbed(channel.url);
  if (!root.response.ok) throw Error("Origem HTTP " + root.response.status);
  const body = await textLimited(root.response);
  if (body.trimStart().startsWith("#EXTM3U")) return { url: root.url };
  const urls = candidates(body, root.url);
  const rootCookie = root.response.headers.get("set-cookie");
  console.log(`[HLS] Embed ${channel.id || channel.url}: ${urls.length} candidato(s)`);
  for (const candidate of urls) {
    try {
      const candidateHeaders = {
        Referer: root.url,
        Origin: new URL(root.url).origin,
        ...(rootCookie ? { Cookie: rootCookie.split(",").map((v) => v.split(";")[0]).join("; ") } : {}),
      };
      let p = await requestEmbed(candidate, candidateHeaders);
      // Alguns hosts recusam o IP do WARP, mas aceitam a conexão direta.
      // Tenta a origem uma segunda vez antes de descartar o canal.
      if ([401, 403].includes(p.response.status)) {
        console.warn(`[HLS] ${channel.id || channel.url}: WARP recusado (${p.response.status}), tentando direto`);
        p = await request(candidate, candidateHeaders);
      }
      if (!p.response.ok) {
        console.warn(`[HLS] ${channel.id || channel.url}: candidato HTTP ${p.response.status} ${candidate}`);
        continue;
      }
      const t = await textLimited(p.response);
      if (t.trimStart().startsWith("#EXTM3U")) return { url: p.url };
      console.warn(`[HLS] ${channel.id || channel.url}: candidato não é playlist ${candidate}`);
    } catch (e) {
      console.warn(`[HLS] ${channel.id || channel.url}: falha no candidato ${candidate}: ${e.message}`);
    }
  }
  throw Error("Não foi encontrada playlist HLS no embed");
}

// Modo opcional para origens que bloqueiam o IP do servidor: o Node apenas
// descobre o endereço temporário (`error.txt`/`.m3u8`) e o cliente acessa a
// playlist diretamente. O token fica exposto ao cliente e pode expirar.
async function resolveRedirect(channel) {
  const root = await requestEmbed(channel.url);
  if (!root.response.ok) throw Error("Origem HTTP " + root.response.status);
  const body = await textLimited(root.response);
  if (body.trimStart().startsWith("#EXTM3U")) return root.url;
  const urls = candidates(body, root.url);
  if (!urls.length) throw Error("Não foi encontrada playlist HLS no embed");
  return urls[0];
}

async function refresh(channel, force = false) {
  const old = cache.get(channel.id);
  if (old?.pending) return old.pending;
  // A URL HLS extraída de um embed pode ter token temporário. Ela fica em
  // cache normalmente, mas um refresh forçado deve consultar o embed de novo.
  if (channel.automatic && old?.url && !force) return old;
  if (!force && old?.checked) {
    // Após falha (especialmente 403), aguarda mais tempo antes de tentar de
    // novo. Repetir a requisição a cada ciclo só aumenta o bloqueio no host.
    const waitMs = old.error
      ? Math.max(settings.pollingSeconds * 2 * 1000, 10 * 60 * 1000)
      : settings.pollingSeconds * 1000;
    if (Date.now() - old.checked < waitMs) return old;
  }
  const promise = (async () => {
    try {
      const found = await resolve(channel);
      const value = {
        url: found.url,
        checked: Date.now(),
        error: null,
        checks: (old?.checks || 0) + 1,
        changes:
          (old?.changes || 0) + (old?.url && old.url !== found.url ? 1 : 0),
      };
      cache.set(channel.id, value);
      return value;
    } catch (e) {
      const value = {
        ...old,
        checked: Date.now(),
        error: e.message,
        checks: (old?.checks || 0) + 1,
      };
      cache.set(channel.id, value);
      return value;
    }
  })();
  cache.set(channel.id, { ...old, pending: promise });
  return promise;
}
function persist() {
  fs.writeFileSync(FILE, JSON.stringify([...channels.values()], null, 2));
}
function cleanup() {
  let changed = false;
  for (const [id, channel] of channels) {
    if (channel.automatic && (!channel.expiresAt || channel.expiresAt <= Date.now())) {
      channels.delete(id);
      cache.delete(id);
      changed = true;
    }
  }
  for (const [token, resource] of resources) {
    if (!channels.has(resource.channelId) || Date.now() - resource.lastAccess > RESOURCE_IDLE_TTL_MS) resources.delete(token);
  }
  if (changed) persist();
}

function list() {
  cleanup();
  return [...channels.values()].map((channel) => {
    const state = cache.get(channel.id);

    return {
      ...channel,

      status: state?.error ? "error" : state?.url ? "online" : "checking",

      error: state?.error || null,

      checks: state?.checks || 0,
      changes: state?.changes || 0,

      lastCheck: state?.checked ? new Date(state.checked).toISOString() : null,

      apiUrl: `/tvbox/api/live/${encodeURIComponent(channel.id)}.m3u8`,
    };
  });
}

async function add({ name, url, id, automatic = false }) {
  name = String(name || "").trim();
  url = String(url || "").trim();
  id = slug(id || name);

  if (!name || name.length > 100 || !id || !url || url.length > 4096) {
    throw Error("Canal inválido");
  }

  cleanup();
  await validate(url);

  const existing = channels.get(id);

  if (existing) {
    if (existing.automatic && !automatic) {
      existing.automatic = false;
      delete existing.createdAt;
      delete existing.expiresAt;
      channels.set(id, existing);
      persist();
    }
    // A fonte do mesmo evento pode mudar. Preserve o cache da sessão atual e
    // use a nova fonte somente quando a playlist precisar ser renovada.
    if (existing.automatic && automatic) {
      existing.name = name;
      existing.url = url;
      existing.createdAt = existing.createdAt || Date.now();
      existing.expiresAt = Date.now() + AUTO_TTL_MS;
      channels.set(id, existing);
      persist();
      return existing;
    }
    if (existing.url !== url) {
      throw Error("ID já usado para outra URL");
    }

    // O polling periódico já atualiza canais existentes.
    // Evita disparar várias verificações simultâneas.
    return existing;
  }

  const channel = {
    id,
    name,
    url,
    automatic,
    ...(automatic ? { createdAt: Date.now(), expiresAt: Date.now() + AUTO_TTL_MS } : {}),
  };

  channels.set(id, channel);
  persist();

  console.log(`[HLS] Canal cadastrado: ${id}`);

  // Não bloqueia o cadastro aguardando a origem.
  refresh(channel, true).catch((error) => {
    console.error(`[HLS] Erro ao verificar ${id}:`, error.message);
  });

  return channel;
}

function remove(id) {
  if (!channels.has(id)) return false;
  channels.delete(id);
  cache.delete(id);
  for (const [token, entry] of resources) if (entry.channelId === id) resources.delete(token);
  persist();
  return true;
}
function removeAll() {
  const removed = channels.size;
  channels.clear();
  cache.clear();
  resources.clear();
  persist();
  return removed;
}

function tokenFor(channelId, url) {
  const token = crypto.createHash("sha256").update(channelId + "\0" + url).digest("hex").slice(0, 32);
  const now = Date.now();
  const previous = resources.get(token);
  resources.set(token, { channelId, url, created: previous?.created || now, lastAccess: now });
  return token;
}

function rewrite(body, base, id) {
  return body
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line;

      if (line.trimStart().startsWith("#")) {
        return line.replace(
          /URI="([^"]+)"/g,
          (_, relative) => {
            const absolute = new URL(
              relative,
              base
            ).href;

            const token = tokenFor(
              id,
              absolute
            );

            return (
              `URI="/tvbox/api/live/resource/${token}"`
            );
          }
        );
      }

      const absolute = new URL(
        line.trim(),
        base
      ).href;

      const token = tokenFor(id, absolute);

      return (
        `/tvbox/api/live/resource/${token}`
      );
    })
    .join("\n");
}

async function play(req, res) {
  cleanup();
  const c = channels.get(req.params.id);
  if (!c) return res.status(404).send("Canal não encontrado");
  try {
    if (
      String(process.env.HLS_DIRECT_REDIRECT || "0") === "1" &&
      !c.automatic &&
      /embedtv\.cc$/i.test(new URL(c.url).hostname)
    ) {
      const target = await resolveRedirect(c);
      return res.redirect(302, target);
    }
    let state = await refresh(c);
    if (!state.url) throw Error(state.error || "Origem indisponível");
    // Playlist sempre nova, nunca guardar segmentos ao longo do polling.
    // A playlist temporária também precisa ser buscada pelo mesmo caminho
    // (WARP + Referer do embed); consultar direto costuma retornar 403.
    const sourceHeaders = {
      Referer: c.url,
      Origin: new URL(c.url).origin,
    };
    let p = await requestEmbed(state.url, sourceHeaders);
    if (!p.response.ok && [401, 403, 404, 410].includes(p.response.status)) {
      await p.response.body?.cancel();
      state = await refresh(c, true);
      if (!state.url) throw Error(state.error || "Unable to renew stream source");
      p = await requestEmbed(state.url, sourceHeaders);
    }
    if (!p.response.ok) throw Error("Origem HTTP " + p.response.status);
    const body = await textLimited(p.response);
    if (!body.trimStart().startsWith("#EXTM3U"))
      throw Error("Playlist inválida");
    res.set({
      "Content-Type": "application/vnd.apple.mpegurl",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    return res.send(rewrite(body, p.url, c.id));
  } catch (e) {
    return res.status(502).send(e.message);
  }
}
async function resource(req, res) {
  cleanup();
  const entry = resources.get(req.params.token);
  if (!entry || !channels.has(entry.channelId))
    return res.status(404).send("Recurso expirado");
  entry.lastAccess = Date.now();
  try {
    const { response, url } = await request(
      entry.url,
      req.headers.range ? { Range: req.headers.range } : {},
    );
    if (!response.ok && response.status !== 206)
      throw Error("Origem HTTP " + response.status);
    const type = response.headers.get("content-type") || "";
    const isPlaylist =
      /mpegurl/i.test(type) || /\.(m3u8|txt)$/i.test(new URL(url).pathname);
    if (isPlaylist) {
      const buf = await response.arrayBuffer();
      const body = Buffer.from(buf).toString("utf8");
      if (body.trimStart().startsWith("#EXTM3U")) {
        res.set({
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        });
        return res.send(rewrite(body, url, entry.channelId));
      }
      if (/mpegurl/i.test(type)) throw Error("Playlist inválida");
      res.status(response.status).set({
        "Content-Type": type || "application/octet-stream",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      return res.send(Buffer.from(buf));
    }
    res.status(response.status).set({
      "Content-Type": type || "application/octet-stream",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    if (response.headers.get("content-range"))
      res.set("Content-Range", response.headers.get("content-range"));
    if (response.headers.get("accept-ranges"))
      res.set("Accept-Ranges", response.headers.get("accept-ranges"));
    await pipeline(Readable.fromWeb(response.body), res);
  } catch (e) {
    if (!res.headersSent) res.status(502).send(e.message);
    else res.destroy();
  }
}
function getSettings() {
  return { ...settings, lastRun, running, channels: channels.size };
}
function setSettings(next) {
  const n = Number(next.pollingSeconds);
  if (!Number.isInteger(n) || n < 30 || n > 3600)
    throw Error("Polling deve ser de 30 a 3600 segundos");
  settings.pollingSeconds = n;
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
  start();
  return getSettings();
}
async function poll() {
  cleanup();
  if (running) return;
  running = true;
  try {
    // Não força uma nova descoberta em todos os canais. O cache e o backoff
    // controlam a frequência; canais em reprodução são renovados por play().
    const list = [...channels.values()]
      .filter((channel) => !channel.automatic)
      .sort((a, b) => (cache.get(a.id)?.checked || 0) - (cache.get(b.id)?.checked || 0))
      .slice(0, MAX_REFRESH_PER_RUN);
    let i = 0;
    await Promise.all(
      Array.from({ length: Math.min(POLL_CONCURRENCY, list.length) }, async () => {
        while (i < list.length) {
          const channel = list[i++];
          await refresh(channel, false);
        }
      }),
    );
    lastRun = new Date().toISOString();
  } finally {
    running = false;
  }
}
function start() {
  if (interval) clearInterval(interval);
  interval = setInterval(
    () => poll().catch((e) => console.warn("[HLS]", e.message)),
    settings.pollingSeconds * 1000,
  );
  interval.unref?.();
}
start();
setImmediate(() => poll().catch(() => {}));
setInterval(cleanup, 60000).unref?.();
cleanup();
module.exports = {
  list,
  add,
  remove,
  removeAll,
  refresh,
  getSettings,
  setSettings,
  poll,
  play,
  resource,
  channelById: (id) => channels.get(id),
  slug,
};
