let modalContainer = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TOGGLE_MODAL") {
    toggleFloatingModal();
  }
});

function toggleFloatingModal() {
  if (modalContainer) {
    modalContainer.remove();
    modalContainer = null;
    return;
  }

  modalContainer = document.createElement("div");
  modalContainer.id = "tvbox-collector-modal-root";
  modalContainer.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    width: 380px;
    max-height: 85vh;
    z-index: 2147483647;
    background: #12101a;
    box-shadow: 0 10px 30px rgba(0,0,0,0.6);
    border: 1px solid #554b68;
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `;

  const headerBar = document.createElement("div");
  headerBar.style.cssText = `
    background: #211d2b;
    padding: 10px 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #554b68;
    font: 13px system-ui, sans-serif;
    color: #f5f1ff;
    font-weight: bold;
    cursor: default;
  `;
  headerBar.innerHTML = `
    <span>TVBox M3U Collector</span>
    <button id="tvbox-close-modal" style="background: transparent; border: none; color: #ff9d9d; cursor: pointer; font-size: 16px; font-weight: bold;">✕</button>
  `;

  const iframe = document.createElement("iframe");
  iframe.src = chrome.runtime.getURL("popup.html");
  iframe.style.cssText = `
    width: 100%;
    height: 550px;
    border: none;
    background: #12101a;
  `;

  modalContainer.appendChild(headerBar);
  modalContainer.appendChild(iframe);
  document.body.appendChild(modalContainer);

  document.getElementById("tvbox-close-modal").addEventListener("click", () => {
    modalContainer.remove();
    modalContainer = null;
  });
}