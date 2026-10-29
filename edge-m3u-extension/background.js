let capturedRequests = [];
const MAX_CAPTURED_REQUESTS = 300;
const SERVER_BASE_URL = "http://164.152.62.129";

chrome.storage.session.remove("capturedM3uRequests").catch((error) => {
  console.error("Could not remove previously stored M3U requests:", error);
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (details.method !== "GET") return;

    const urlLower = details.url.toLowerCase();

    if (urlLower.includes(".css") || urlLower.endsWith("/css")) return;

    const imageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".ico", ".bmp"];
    if (imageExtensions.some(ext => urlLower.includes(ext))) return;

    if (capturedRequests.some(r => r.url === details.url)) return;

    capturedRequests.push({
      tabId: details.tabId,
      url: details.url,
      method: details.method,
      timeStamp: details.timeStamp,
      hasExtM3u: null
    });

    if (capturedRequests.length > MAX_CAPTURED_REQUESTS) {
      capturedRequests = capturedRequests.slice(-MAX_CAPTURED_REQUESTS);
    }
  },
  { urls: ["<all_urls>"] },
);

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) return;
  if (tab.url.startsWith("edge://") || tab.url.startsWith("chrome://") || tab.url.startsWith("about:")) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_MODAL" });
  } catch (err) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_MODAL" });
    } catch (injectionError) {
      console.error("Erro ao injetar modal flutuante:", injectionError);
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_CAPTURED") {
    let results = capturedRequests;
    if (message.onlyMaster) {
      results = capturedRequests.filter(r => /master\.txt(?:\?.*)?$/i.test(r.url));
    }
    sendResponse({ requests: results });
    return false;
  }
  
  if (message.type === "CLEAR_CAPTURED") {
    capturedRequests = [];
    sendResponse({ requests: [] });
    return false;
  }
  
  if (message.type === "CHECK_EXTM3U_CONTENT") {
    (async () => {
      const results = [];
      const targetList = message.onlyMaster ? capturedRequests.filter(r => /master\.txt(?:\?.*)?$/i.test(r.url)) : capturedRequests;
      for (const req of targetList) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3500);
          const res = await fetch(req.url, { 
            method: "GET", 
            signal: controller.signal,
            headers: { Range: "bytes=0-500" }
          });
          clearTimeout(timeoutId);
          
          if (res.ok) {
            const text = await res.text();
            if (text.trim().toUpperCase().includes("#EXTM3U")) {
              results.push({ ...req, hasExtM3u: true });
            }
          }
        } catch (e) {}
      }
      sendResponse({ success: true, requests: results });
    })();
    return true;
  }

  if (message.type === "FETCH_SERIES") {
    fetch(`${SERVER_BASE_URL}/tvbox/api/series`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        sendResponse({ success: true, data });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.type === "IMPORT_ITEM") {
    const { token, payload } = message;
    fetch(`${SERVER_BASE_URL}/tvbox/api/extension/import`, {
      method: "POST",
      headers: message.headers,
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          sendResponse({ success: false, error: body.error || `Falha no servidor (${res.status}).` });
        } else {
          sendResponse({ success: true, message: body.message || "Adicionado ao servidor." });
        }
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message || "Erro de conexão com o servidor." });
      });
    return true;
  }

  if (message.type === "IMPORT_BATCH") {
    const { token, items } = message;
    if (!Array.isArray(items) || items.length === 0) {
      sendResponse({ success: false, error: "O lote não contém itens." });
      return false;
    }
    
    async function signPayloadIndividual(token, payload) {
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      const messageStr = `${timestamp}.${nonce}.${JSON.stringify(payload)}`;
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
        new TextEncoder().encode(messageStr),
      );
      const hexSignature = Array.from(new Uint8Array(signature), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      return {
        "X-Request-Timestamp": timestamp,
        "X-Request-Nonce": nonce,
        "X-Request-Signature": hexSignature,
        "Content-Type": "application/json",
      };
    }

    (async () => {
      const results = [];

      for (const payload of items) {
        try {
          const itemHeaders = await signPayloadIndividual(token, payload);
          const res = await fetch(`${SERVER_BASE_URL}/tvbox/api/extension/import`, {
            method: "POST",
            headers: itemHeaders,
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(30_000),
          });
          const body = await res.json().catch(() => ({}));
          results.push({
            title: payload.title,
            success: res.ok,
            error: res.ok ? "" : body.error || `Falha no servidor (${res.status}).`,
          });
        } catch (err) {
          results.push({
            title: payload.title,
            success: false,
            error: err.message || "Erro de conexão.",
          });
        }
      }

      const successes = results.filter((result) => result.success).length;
      const failures = results.filter((result) => !result.success);
      const failureSummary = failures
        .slice(0, 3)
        .map((result) => `${result.title}: ${result.error}`)
        .join(" · ");
      const message = `${successes} de ${items.length} item(ns) adicionado(s).` +
        (failureSummary ? ` Falhas: ${failureSummary}` : "");

      if (successes > 0) {
        sendResponse({
          success: true,
          message,
          failedCount: failures.length,
        });
      } else {
        sendResponse({
          success: false,
          error: message || "Falha ao enviar lote.",
          failedCount: failures.length,
        });
      }
    })();
    return true;
  }

  return false;
});