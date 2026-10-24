let captureQueue = Promise.resolve();
const MAX_CAPTURED_REQUESTS = 300;

function queueRequest(request) {
  captureQueue = captureQueue.then(async () => {
    const stored = await chrome.storage.session.get("capturedM3uRequests");
    const requests = stored.capturedM3uRequests || [];
    requests.push(request);
    await chrome.storage.session.set({
      capturedM3uRequests: requests.slice(-MAX_CAPTURED_REQUESTS),
    });
  });
  captureQueue = captureQueue.catch((error) => {
    console.error("Could not store captured M3U request:", error);
  });
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0 || !details.url.toLowerCase().includes("m3u")) return;
    queueRequest({
      tabId: details.tabId,
      url: details.url,
      method: details.method,
      timeStamp: details.timeStamp,
    });
  },
  { urls: ["<all_urls>"] },
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "GET_CAPTURED") return false;
  captureQueue
    .then(() => chrome.storage.session.get("capturedM3uRequests"))
    .then(({ capturedM3uRequests = [] }) => {
      sendResponse({ requests: capturedM3uRequests });
    })
    .catch((error) => sendResponse({ error: error.message }));
  return true;
});
