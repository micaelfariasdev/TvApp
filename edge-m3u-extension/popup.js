const elements = Object.fromEntries(
  [
    "refresh",
    "playlists",
    "manual-url",
    "use-manual-url",
    "server",
    "token",
    "kind",
    "title",
    "category",
    "category-field",
    "series-fields",
    "series-select",
    "refresh-series",
    "new-series-fields",
    "series-title",
    "series-id",
    "season",
    "episode",
    "save",
    "status",
  ].map((id) => [id, document.getElementById(id)]),
);

const SERVER_BASE_URL = "http://164.152.62.129";
let detectedPlaylists = [];
let seriesCatalog = [];
let seriesCatalogLoaded = false;
let seriesCatalogLoading = false;

function setStatus(message, error = false) {
  elements.status.textContent = message;
  elements.status.style.color = error ? "#ff9d9d" : "#d2c4f2";
}

function updateKindFields() {
  const isSeries = elements.kind.value === "series";
  elements["series-fields"].hidden = !isSeries;
  elements["category-field"].hidden = isSeries;
  elements["new-series-fields"].hidden =
    !isSeries || elements["series-select"].value !== "__new__";
  if (isSeries && !seriesCatalogLoaded) loadSeriesCatalog();
  if (elements.kind.value === "movie" && elements.category.value === "m3u") {
    elements.category.value = "filmes";
  } else if (elements.kind.value === "channel" && elements.category.value === "filmes") {
    elements.category.value = "m3u";
  }
}

async function loadSeriesCatalog() {
  if (seriesCatalogLoading) return;
  seriesCatalogLoading = true;
  elements["refresh-series"].disabled = true;
  elements["series-select"].replaceChildren(new Option("Carregando séries...", ""));
  try {
    const response = await fetch(`${SERVER_BASE_URL}/tvbox/api/series`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Falha ao carregar séries do servidor (HTTP ${response.status}).`);
    }
    const entries = await response.json();
    if (!Array.isArray(entries)) throw new Error("O catálogo de séries retornou um formato inválido.");
    seriesCatalog = entries.filter((entry) =>
      entry && typeof entry.id === "string" &&
      (typeof entry.title === "string" || typeof entry.name === "string")
    );
    seriesCatalogLoaded = true;
    renderSeriesOptions();
    setStatus(`${seriesCatalog.length} série(s) carregada(s) do servidor.`);
  } catch (error) {
    elements["series-select"].replaceChildren(
      new Option("Não foi possível carregar séries", ""),
      new Option("Criar nova série...", "__new__"),
    );
    elements["new-series-fields"].hidden = false;
    setStatus(error.message || "Erro ao consultar o catálogo de séries.", true);
  } finally {
    seriesCatalogLoading = false;
    elements["refresh-series"].disabled = false;
  }
}

function renderSeriesOptions() {
  const previousSelection = elements["series-select"].value;
  elements["series-select"].replaceChildren(
    new Option("Selecione uma série...", ""),
    ...seriesCatalog.map((series) =>
      new Option(series.title || series.name || series.id, series.id)
    ),
    new Option("Criar nova série...", "__new__"),
  );
  if (
    previousSelection &&
    [...elements["series-select"].options].some((option) => option.value === previousSelection)
  ) {
    elements["series-select"].value = previousSelection;
  }
  elements["new-series-fields"].hidden = elements["series-select"].value !== "__new__";
}

function makeSeriesId(title) {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function sendBackgroundMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response || {};
}

function renderPlaylists() {
  const selectedUrl = detectedPlaylists[Number(elements.playlists.value)]?.url;
  const orderedRequests = [...detectedPlaylists].sort((left, right) => {
    const priority = (request) => {
      const path = new URL(request.url).pathname.toLowerCase();
      if (/\/master(?:\.txt)?$/.test(path)) return 0;
      if (/\.m3u8?$/.test(path)) return 1;
      return 2;
    };
    return priority(left) - priority(right);
  });
  elements.playlists.replaceChildren();
  if (!detectedPlaylists.length) {
    elements.playlists.add(new Option("Nenhuma requisição com m3u capturada", ""));
    return;
  }
  orderedRequests.forEach((request, index) => {
    const option = new Option(
      `Aba ${request.tabId} · ${request.method} — ${request.url}`,
      String(index),
    );
    elements.playlists.add(option);
  });
  if (selectedUrl) {
    const index = orderedRequests.findIndex((request) => request.url === selectedUrl);
    elements.playlists.value = String(index >= 0 ? index : 0);
  } else {
    elements.playlists.value = "0";
  }
  detectedPlaylists = orderedRequests;
}

async function refreshCapturedPlaylists() {
  const { requests = [] } = await sendBackgroundMessage({
    type: "GET_CAPTURED",
  });
  detectedPlaylists = requests;
  renderPlaylists();
}

async function restoreCapturedPlaylists() {
  try {
    await refreshCapturedPlaylists();
    setStatus(`${detectedPlaylists.length} requisição(ões) com m3u capturada(s) nesta sessão.`);
  } catch (error) {
    setStatus(error.message || "Não foi possível carregar as requisições capturadas.", true);
  }
}

function useManualUrl() {
  const rawUrl = elements["manual-url"].value.trim();
  try {
    const parsed = new URL(rawUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("A URL precisa começar com http:// ou https://.");
    }
    if (!/\.m3u8?$|(?:^|\/)master(?:\.txt)?$|\/m3u8?\//i.test(parsed.pathname)) {
      throw new Error("A URL não parece ser uma playlist M3U/HLS.");
    }

    detectedPlaylists = [parsed.href];
    elements.playlists.replaceChildren(
      new Option(`URL informada — ${parsed.host}`, "0"),
    );
    elements.playlists.value = "0";
    setStatus("URL da playlist selecionada. Confira os dados e adicione ao servidor.");
  } catch (error) {
    setStatus(error.message || "Informe uma URL válida da playlist.", true);
  }
}

async function requestServerPermission(serverUrl) {
  const server = new URL(serverUrl);
  const originPattern = `${server.origin}/*`;
  const granted = await chrome.permissions.request({ origins: [originPattern] });
  if (!granted) throw new Error("Permissão para acessar esse servidor não concedida.");
  return server.origin;
}

async function signPayload(token, payload) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const message = `${timestamp}.${nonce}.${JSON.stringify(payload)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  const hexSignature = Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    "X-Request-Timestamp": timestamp,
    "X-Request-Nonce": nonce,
    "X-Request-Signature": hexSignature,
  };
}

async function saveItem() {
  elements.save.disabled = true;
  try {
    const selected = Number(elements.playlists.value);
    const selectedRequest = detectedPlaylists[selected];
    const url = selectedRequest?.url;
    if (!url) throw new Error("Selecione uma requisição capturada primeiro.");

    const token = elements.token.value.trim();
    const title = elements.title.value.trim();
    if (!token || !title) {
      throw new Error("Preencha o token e o título.");
    }
    const origin = await requestServerPermission(SERVER_BASE_URL);
    const kind = elements.kind.value;
    const payload = {
      kind,
      title,
      url,
      type: /\.mp4(?:$|[?#])/i.test(url) ? "mp4" : "hls",
    };

    if (kind === "series") {
      const selectedSeriesId = elements["series-select"].value;
      const isNewSeries = selectedSeriesId === "__new__";
      const seriesTitle = elements["series-title"].value.trim();
      const seriesId = isNewSeries
        ? (elements["series-id"].value.trim() || makeSeriesId(seriesTitle))
        : selectedSeriesId;
      if (!seriesId) throw new Error("Selecione uma série ou escolha criar uma nova.");
      if (isNewSeries && !seriesTitle) throw new Error("Informe o nome da nova série.");
      payload.seriesTitle = isNewSeries ? seriesTitle : "";
      payload.seriesId = seriesId;
      payload.seasonNumber = Number(elements.season.value);
      payload.episodeNumber = Number(elements.episode.value);
    } else {
      payload.category = elements.category.value.trim() || (kind === "movie" ? "filmes" : "m3u");
    }

    const signatureHeaders = await signPayload(token, payload);
    const response = await fetch(`${origin}/tvbox/api/extension/import`, {
      method: "POST",
      headers: {
        ...signatureHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Falha no servidor (${response.status}).`);
    await chrome.storage.local.set({ token });
    setStatus(body.message || "Adicionado ao servidor.");
  } catch (error) {
    setStatus(error.message || "Não foi possível adicionar ao servidor.", true);
  } finally {
    elements.save.disabled = false;
  }
}

elements.refresh.addEventListener("click", restoreCapturedPlaylists);
elements["use-manual-url"].addEventListener("click", useManualUrl);
elements.save.addEventListener("click", saveItem);
elements.kind.addEventListener("change", updateKindFields);
elements["series-select"].addEventListener("change", updateKindFields);
elements["refresh-series"].addEventListener("click", () => {
  seriesCatalogLoaded = false;
  loadSeriesCatalog();
});
elements["series-title"].addEventListener("input", () => {
  if (!elements["series-id"].dataset.edited) {
    elements["series-id"].value = makeSeriesId(elements["series-title"].value);
  }
});
elements["series-id"].addEventListener("input", () => {
  elements["series-id"].dataset.edited = "true";
});

chrome.storage.local.get(["token"]).then((settings) => {
  elements.server.value = SERVER_BASE_URL;
  elements.token.value = settings.token || "";
});
restoreCapturedPlaylists();
loadSeriesCatalog();
updateKindFields();
