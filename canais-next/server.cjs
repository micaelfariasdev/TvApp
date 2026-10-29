const { createServer } = require("node:http");
const next = require("next");

const hostname = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4555);
const app = next({ dev: false, hostname, port });

app.prepare()
  .then(() => {
    const handle = app.getRequestHandler();
    createServer((request, response) => {
      if (!request.url) {
        response.writeHead(400).end();
        return;
      }

      const normalizedRequestUrl = request.url.replace(/^\/{2,}/, "/");
      const incomingUrl = new URL(normalizedRequestUrl, `http://${hostname}`);
      if (incomingUrl.pathname === "/") {
        incomingUrl.pathname = "/cinedark";
      } else if (!incomingUrl.pathname.startsWith("/cinedark/") && incomingUrl.pathname !== "/cinedark") {
        incomingUrl.pathname = `/cinedark${incomingUrl.pathname}`;
      }
      request.url = `${incomingUrl.pathname}${incomingUrl.search}`;
      void handle(request, response);
    }).listen(port, hostname, () => {
      console.log(`CineDark Next.js listening on http://${hostname}:${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start CineDark Next.js:", error);
    process.exit(1);
  });
