# TVBox M3U Collector (Edge)

After installation and host access approval, the extension automatically captures requests from any browser tab whose URL contains `m3u` (up to 300 entries, including duplicates). Requests stay only in the service worker's memory; they are not saved in extension storage and are lost when the service worker stops. Click **Limpar lista** to discard the current in-memory list. Reload pages after installing or updating the extension; then open the popup and click **Atualizar lista** to view matches. You can also paste the `master.txt` or `.m3u8` URL into **URL da playlist** and click **Usar URL colada**. Review the selected URL and item details before clicking **Adicionar ao servidor**.

When **Série / episódio** is selected, the popup loads the series list from `http://164.152.62.129/tvbox/api/series`. Select an existing series, or choose **Criar nova série...**. Use **Atualizar séries** to reload the server catalog.

To add several links, turn on **Modo lote**. Select captured requests with Ctrl/Shift, or paste one playlist URL per line and choose **Carregar links colados**. Review or edit each generated title; for **Série / episódio**, set a separate title for every link while the episode numbers are assigned sequentially from the starting episode. Choose the content type/category (or series and starting episode), then submit the batch. Requests are sent one at a time; the result reports successful items and individual failures.

## Configure the server

1. Generate a strong secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and set it on the TVBox server as `TVBOX_EXTENSION_API_TOKEN`. The server requires at least 32 bytes.
2. Restart the server process so it loads the new environment variable.
3. The extension is fixed to `http://164.152.62.129`. Enter the same secret in the popup; it is stored in this Edge profile's extension storage, so do not share the profile with untrusted users. The extension signs each request with HMAC; the secret itself is not sent.

The API accepts writes only when the request has a valid, unexpired HMAC signature. Nonces prevent replaying the same request. This allows the fixed HTTP server to work without sending the shared secret, but HTTP does not encrypt the item URL or other request data; use a trusted network.

## Install in Edge

1. Open `edge://extensions` and enable **Developer mode**.
2. Select **Load unpacked** and choose this `edge-m3u-extension` folder.
3. Pin the extension. Edge will request permission to read URLs across websites. Approve it, reload pages that were already open, and capture will start automatically. Open the popup and click **Atualizar lista** to see matching requests.
