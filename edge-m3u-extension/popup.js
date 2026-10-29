const elements = Object.fromEntries(
  [
    "refresh",
    "toggle-master",
    "filter-extm3u",
    "download-json",
    "clear-requests",
    "toggle-batch",
    "batch-selection-tools",
    "select-all",
    "clear-selection",
    "batch-selection-status",
    "playlists-label",
    "playlists",
    "manual-section",
    "manual-single",
    "manual-batch",
    "manual-url",
    "manual-urls",
    "use-manual-url",
    "use-manual-urls",
    "server",
    "token",
    "kind",
    "title",
    "single-title-label",
    "single-title-group",
    "batch-titles-container",
    "batch-titles-heading",
    "batch-titles-help",
    "batch-inputs-list",
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
let onlyMasterActive = false;
let batchModeActive = false;

function setStatus(message, error = false) {
  elements.status.textContent = message;
  elements.status.style.color = error ? "#ff9d9d" : "#d2c4f2";
}

function updateKindFields() {
  const isSeries = elements.kind.value === "series";
  elements["single-title-label"].textContent = isSeries
    ? "Nome deste episódio"
    : "Nome do canal ou filme";
  elements.title.placeholder = isSeries ? "Digite o nome do episódio" : "Título";
  elements["series-fields"].hidden = !isSeries;
  elements["category-field"].hidden = isSeries;
  elements["new-series-fields"].hidden =
    !isSeries || elements["series-select"].value !== "__new__";
    
  const hasBatchSelection = selectedPlaylistOptions().length > 0;
  elements["batch-titles-container"].hidden = !batchModeActive || !hasBatchSelection;
  elements["single-title-group"].hidden = batchModeActive && (isSeries || hasBatchSelection);

  if (isSeries && !seriesCatalogLoaded) loadSeriesCatalog();
  if (elements.kind.value === "movie" && elements.category.value === "m3u") {
    elements.category.value = "filmes";
  } else if (elements.kind.value === "channel" && elements.category.value === "filmes") {
    elements.category.value = "m3u";
  }
}

function toggleBatchMode() {
  batchModeActive = !batchModeActive;
  
  elements.playlists.multiple = batchModeActive;
  elements.playlists.size = batchModeActive ? 8 : 1;
  elements["manual-single"].hidden = batchModeActive;
  elements["manual-batch"].hidden = !batchModeActive;
  elements["batch-selection-tools"].hidden = !batchModeActive;
  elements["batch-selection-status"].hidden = !batchModeActive;

  if (batchModeActive) {
    elements["toggle-batch"].textContent = "Modo lote: ON";
    elements["toggle-batch"].style.background = "#492c73";
    elements["toggle-batch"].style.borderColor = "#9c73ef";
    elements["playlists-label"].textContent = "Selecione vários links (Ctrl/Shift + clique):";
    elements.playlists.selectedIndex = -1;
  } else {
    elements["toggle-batch"].textContent = "Modo lote: OFF";
    elements["toggle-batch"].style.background = "#211d2b";
    elements["toggle-batch"].style.borderColor = "#554b68";
    elements["playlists-label"].textContent = "Requisição com m3u";
    elements["batch-titles-container"].hidden = true;
    elements["single-title-group"].hidden = false;
  }
  updateKindFields();
  updateBatchInputs();
}

function selectedPlaylistOptions() {
  return Array.from(elements.playlists.selectedOptions).filter((option) => option.value !== "");
}

function updateBatchSelectionStatus() {
  const count = selectedPlaylistOptions().length;
  elements["batch-selection-status"].textContent = count === 0
    ? "Nenhum link selecionado."
    : `${count} link(s) selecionado(s).`;
}

function selectAllPlaylists(selected) {
  Array.from(elements.playlists.options).forEach((option) => {
    option.selected = selected && option.value !== "";
  });
  updateBatchInputs();
  updateBatchSelectionStatus();
}

function titleFromRequest(request, index) {
  try {
    const parsed = new URL(request.url);
    const segments = parsed.pathname.split("/").filter(Boolean).map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
    const meaningful = segments.reverse().find((segment) =>
      !/^(master|master\.txt|stream|playlist|index|.*\.m3u8?)$/i.test(segment)
    );
    return meaningful || `${parsed.hostname} - ${index + 1}`;
  } catch {
    return `Item ${index + 1}`;
  }
}

function updateBatchInputs() {
  if (!batchModeActive) return;
  
  const selectedOptions = selectedPlaylistOptions();
  const container = elements["batch-inputs-list"];
  const isSeries = elements.kind.value === "series";
  const startingEpisode = Number(elements.episode.value) || 1;
  const previousTitles = new Map(
    Array.from(container.querySelectorAll(".batch-item-title")).map((input) => {
      const request = detectedPlaylists[Number(input.dataset.index)];
      return [request?.url, input.value];
    }).filter(([url]) => url),
  );
  container.replaceChildren();

  if (selectedOptions.length === 0) {
    elements["batch-titles-container"].hidden = true;
    elements["single-title-group"].hidden = isSeries;
    updateBatchSelectionStatus();
    return;
  }

  elements["batch-titles-container"].hidden = false;
  elements["single-title-group"].hidden = true;
  elements["batch-titles-heading"].textContent = isSeries
    ? "Nomes individuais dos episódios:"
    : "Títulos individuais para os itens selecionados:";
  elements["batch-titles-help"].hidden = !isSeries;

  selectedOptions.forEach((opt, index) => {
    const reqIndex = Number(opt.value);
    const req = detectedPlaylists[reqIndex];
    if (!req) return;

    const wrapper = document.createElement("div");
    wrapper.style.cssText = "margin-bottom: 8px;";

    const label = document.createElement("label");
    label.style.cssText = "font-size: 12px; color: #bdb4ce; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
    const itemNumber = isSeries
      ? `E${String(startingEpisode + index).padStart(2, "0")} · `
      : `${index + 1}. `;
    label.textContent = `${itemNumber}${req.url}`;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "batch-item-title";
    input.dataset.index = reqIndex;
    input.placeholder = isSeries
      ? `Digite o nome do episódio ${startingEpisode + index}`
      : `Título para o item ${index + 1}`;
    input.setAttribute(
      "aria-label",
      isSeries
        ? `Nome do episódio ${startingEpisode + index}`
        : `Título do item ${index + 1}`,
    );
    input.maxLength = 200;
    input.style.cssText = "width: 100%; min-height: 32px; padding: 4px 8px; background: #211d2b; border: 1px solid #554b68; border-radius: 5px; color: #f5f1ff;";
    
    input.value = previousTitles.get(req.url) || titleFromRequest(req, index);

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    container.appendChild(wrapper);
  });
  updateBatchSelectionStatus();
}

async function loadSeriesCatalog() {
  if (seriesCatalogLoading) return;
  seriesCatalogLoading = true;
  elements["refresh-series"].disabled = true;
  elements["series-select"].replaceChildren(new Option("Carregando séries...", ""));
  try {
    const response = await chrome.runtime.sendMessage({ type: "FETCH_SERIES" });
    if (!response || !response.success) {
      throw new Error(`Falha ao carregar séries do servidor (${response?.error || "Erro desconhecido"}).`);
    }
    const entries = response.data;
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

function renderPlaylists(requests = detectedPlaylists) {
  const selectedUrls = new Set(selectedPlaylistOptions().map((option) =>
    detectedPlaylists[Number(option.value)]?.url
  ).filter(Boolean));
  const orderedRequests = [...requests].sort((left, right) => {
    const priority = (request) => {
      const path = new URL(request.url).pathname.toLowerCase();
      if (/\/master(?:\.txt)?$/.test(path)) return 0;
      if (/\.m3u8?$/.test(path)) return 1;
      return 2;
    };
    return priority(left) - priority(right);
  });
  elements.playlists.replaceChildren();
  detectedPlaylists = orderedRequests;
  if (!detectedPlaylists.length) {
    elements.playlists.add(new Option("Nenhuma requisição com m3u capturada", ""));
    updateBatchInputs();
    updateBatchSelectionStatus();
    return;
  }
  orderedRequests.forEach((request, index) => {
    const option = new Option(
      `Aba ${request.tabId} · ${request.method} — ${request.url}`,
      String(index),
    );
    elements.playlists.add(option);
  });
  if (batchModeActive) {
    Array.from(elements.playlists.options).forEach((option) => {
      option.selected = selectedUrls.has(orderedRequests[Number(option.value)]?.url);
    });
    updateBatchInputs();
  } else {
    elements.playlists.value = "0";
  }
  updateBatchSelectionStatus();
}

async function refreshCapturedPlaylists() {
  const { requests = [] } = await sendBackgroundMessage({
    type: "GET_CAPTURED",
    onlyMaster: onlyMasterActive
  });
  renderPlaylists(requests);
}

async function clearCapturedPlaylists() {
  try {
    const { requests = [] } = await sendBackgroundMessage({
      type: "CLEAR_CAPTURED",
    });
    detectedPlaylists = requests;
    renderPlaylists();
    setStatus("Lista de requisições limpa.");
  } catch (error) {
    setStatus(error.message || "Não foi possível limpar a lista.", true);
  }
}

async function restoreCapturedPlaylists() {
  try {
    await refreshCapturedPlaylists();
    setStatus(`${detectedPlaylists.length} requisição(ões) capturada(s) nesta sessão.`);
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

    detectedPlaylists = [{ tabId: 0, url: parsed.href, method: "MANUAL", timeStamp: Date.now() }];
    renderPlaylists();
    setStatus("URL da playlist selecionada. Confira os dados e adicione ao servidor.");
  } catch (error) {
    setStatus(error.message || "Informe uma URL válida da playlist.", true);
  }
}

function useManualUrls() {
  const urls = [...new Set(elements["manual-urls"].value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean))];
  if (urls.length === 0) {
    setStatus("Cole pelo menos uma URL, uma por linha.", true);
    return;
  }

  const requests = [];
  const errors = [];
  urls.forEach((rawUrl, index) => {
    try {
      const parsed = new URL(rawUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("use HTTP ou HTTPS");
      }
      if (!/\.m3u8?$|(?:^|\/)master(?:\.txt)?$|\/m3u8?\//i.test(parsed.pathname)) {
        throw new Error("não parece ser uma URL M3U/HLS");
      }
      requests.push({
        tabId: 0,
        url: parsed.href,
        method: "MANUAL",
        timeStamp: Date.now(),
      });
    } catch (error) {
      errors.push(`Linha ${index + 1}: ${error.message}`);
    }
  });

  if (requests.length === 0) {
    setStatus(errors.slice(0, 3).join(" · ") || "Nenhuma URL válida.", true);
    return;
  }
  if (!batchModeActive) toggleBatchMode();
  detectedPlaylists = requests;
  renderPlaylists();
  selectAllPlaylists(true);
  setStatus(
    `${requests.length} link(s) carregado(s). Revise os títulos e envie o lote.` +
      (errors.length ? ` ${errors.length} linha(s) inválida(s) ignorada(s).` : ""),
    errors.length > 0,
  );
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

async function saveSingleItem() {
  const selected = Number(elements.playlists.value);
  const selectedRequest = detectedPlaylists[selected];
  const url = selectedRequest?.url;
  if (!url) throw new Error("Selecione uma requisição capturada primeiro.");

  const token = elements.token.value.trim();
  const title = elements.title.value.trim();
  if (!token || !title) {
    throw new Error("Preencha o token e o título.");
  }
  
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

  const response = await chrome.runtime.sendMessage({
    type: "IMPORT_ITEM",
    token,
    payload,
    headers: {
      ...signatureHeaders,
      "Content-Type": "application/json",
    }
  });

  if (!response || !response.success) {
    throw new Error(response?.error || "Erro ao comunicar com o background.");
  }

  await chrome.storage.local.set({ token });
  setStatus(response.message || "Adicionado ao servidor.");
}

async function saveBatchItems() {
  const token = elements.token.value.trim();
  if (!token) throw new Error("Preencha o token.");

  const kind = elements.kind.value;
  const selectedOptions = selectedPlaylistOptions();
  if (selectedOptions.length === 0) {
    throw new Error("Selecione pelo menos uma requisição na lista.");
  }

  let items = [];

  if (kind === "series") {
    const startEpisode = Number(elements.episode.value);
    const seasonNumber = Number(elements.season.value);
    const selectedSeriesId = elements["series-select"].value;
    const isNewSeries = selectedSeriesId === "__new__";
    const seriesTitle = elements["series-title"].value.trim();
    const seriesId = isNewSeries
      ? (elements["series-id"].value.trim() || makeSeriesId(seriesTitle))
      : selectedSeriesId;
    if (!seriesId) throw new Error("Selecione uma série ou escolha criar uma nova.");
    if (isNewSeries && !seriesTitle) throw new Error("Informe o nome da nova série.");
    if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || seasonNumber > 999) {
      throw new Error("Informe uma temporada entre 1 e 999.");
    }
    if (
      !Number.isInteger(startEpisode) ||
      startEpisode < 1 ||
      startEpisode + selectedOptions.length - 1 > 9999
    ) {
      throw new Error("Os números dos episódios devem ficar entre 1 e 9999.");
    }

    const titleInputs = Array.from(
      elements["batch-inputs-list"].querySelectorAll(".batch-item-title"),
    );
    if (titleInputs.length !== selectedOptions.length) {
      throw new Error("Informe um nome para cada episódio selecionado.");
    }

    items = selectedOptions.map((opt, index) => {
      const reqIndex = Number(opt.value);
      const url = detectedPlaylists[reqIndex]?.url;
      const title = titleInputs[index]?.value.trim();
      if (!url) return null;
      if (!title || title.length > 200) return null;

      const episodeNumber = startEpisode + index;
      return {
        kind,
        url,
        type: /\.mp4(?:$|[?#])/i.test(url) ? "mp4" : "hls",
        seriesTitle: isNewSeries ? seriesTitle : "",
        seriesId,
        seasonNumber,
        episodeNumber,
        title,
      };
    }).filter(Boolean);

  } else {
    const titleInputs = Array.from(elements["batch-inputs-list"].querySelectorAll(".batch-item-title"));
    
    items = titleInputs.map((input) => {
      const reqIndex = Number(input.dataset.index);
      const url = detectedPlaylists[reqIndex]?.url;
      const title = input.value.trim();
      if (!url || !title || title.length > 200) return null;

      return {
        kind,
        url,
        title,
        category: elements.category.value.trim() || (kind === "movie" ? "filmes" : "m3u"),
        type: /\.mp4(?:$|[?#])/i.test(url) ? "mp4" : "hls"
      };
    }).filter(Boolean);

    if (items.length === 0) throw new Error("Preencha os títulos de todos os itens selecionados.");
  }

  if (items.length === 0) throw new Error("Nenhum item válido para enviar.");
  if (items.length !== selectedOptions.length) {
    throw new Error("Confira os links e títulos: cada item selecionado precisa ter uma URL e um título válido.");
  }
  if (items.some((item) => item.title.length > 200)) {
    throw new Error("Os títulos dos episódios podem ter no máximo 200 caracteres.");
  }
  if (!window.confirm(`Adicionar ${items.length} item(ns) ao servidor?`)) return;
  elements.save.disabled = true;
  setStatus(`Enviando ${items.length} item(ns)...`);
  const response = await chrome.runtime.sendMessage({
    type: "IMPORT_BATCH",
    token,
    items
  });

  if (!response || !response.success) {
    throw new Error(response?.error || "Erro ao enviar lote.");
  }

  await chrome.storage.local.set({ token });
  setStatus(
    response.message || `${items.length} itens adicionados com sucesso!`,
    Number(response.failedCount) > 0,
  );
}

async function saveItem() {
  elements.save.disabled = true;
  try {
    if (batchModeActive) {
      await saveBatchItems();
    } else {
      await saveSingleItem();
    }
  } catch (error) {
    setStatus(error.message || "Não foi possível adicionar ao servidor.", true);
  } finally {
    elements.save.disabled = false;
  }
}

async function filterExtM3uContent() {
  setStatus("Analisando o conteúdo das requisições capturadas...");
  elements["filter-extm3u"].disabled = true;
  try {
    const response = await sendBackgroundMessage({ type: "CHECK_EXTM3U_CONTENT" });
    if (response && response.success && Array.isArray(response.requests)) {
      renderPlaylists(response.requests);
      setStatus(`Filtro aplicado: ${response.requests.length} link(s) com #EXTM3U encontrados.`);
    }
  } catch (error) {
    setStatus(error.message || "Erro ao filtrar conteúdo.", true);
  } finally {
    elements["filter-extm3u"].disabled = false;
  }
}

function downloadJsonList() {
  if (!detectedPlaylists.length) {
    setStatus("Nenhuma requisição capturada para exportar.", true);
    return;
  }
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(detectedPlaylists, null, 2));
  const downloadAnchor = document.createElement("a");
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `m3u_requests_${Date.now()}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  setStatus("Download do JSON iniciado.");
}

elements.refresh.addEventListener("click", restoreCapturedPlaylists);
elements["clear-requests"].addEventListener("click", clearCapturedPlaylists);
elements["use-manual-url"].addEventListener("click", useManualUrl);
elements["use-manual-urls"].addEventListener("click", useManualUrls);
elements["toggle-batch"].addEventListener("click", toggleBatchMode);
elements["select-all"].addEventListener("click", () => selectAllPlaylists(true));
elements["clear-selection"].addEventListener("click", () => selectAllPlaylists(false));
elements.playlists.addEventListener("change", () => {
  updateBatchInputs();
  updateBatchSelectionStatus();
});
elements.kind.addEventListener("change", () => {
  updateKindFields();
  updateBatchInputs();
});
elements.episode.addEventListener("change", updateBatchInputs);
elements.save.addEventListener("click", saveItem);
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
elements["toggle-master"].addEventListener("click", () => {
  onlyMasterActive = !onlyMasterActive;
  if (onlyMasterActive) {
    elements["toggle-master"].textContent = "Focar master.txt: ON";
    elements["toggle-master"].style.background = "#492c73";
    elements["toggle-master"].style.borderColor = "#9c73ef";
  } else {
    elements["toggle-master"].textContent = "Focar master.txt: OFF";
    elements["toggle-master"].style.background = "#211d2b";
    elements["toggle-master"].style.borderColor = "#554b68";
  }
  restoreCapturedPlaylists();
});
elements["filter-extm3u"].addEventListener("click", filterExtM3uContent);
elements["download-json"].addEventListener("click", downloadJsonList);

chrome.storage.local.get(["token"]).then((settings) => {
  elements.server.value = SERVER_BASE_URL;
  elements.token.value = settings.token || "";
});

restoreCapturedPlaylists();
loadSeriesCatalog();
updateKindFields();