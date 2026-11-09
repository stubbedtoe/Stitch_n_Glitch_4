// Tiny static server + result collection for the S2 spike.
// Serves the harness page; receives POSTed results at /result/<browser>.

import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export function createServer(resultsDir = join(ROOT, "results")) {
  const completed = new Map(); // browser -> result JSON (also written to disk)

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    try {
      if (req.method === "POST" && url.pathname.startsWith("/result/")) {
        const browser = decodeURIComponent(url.pathname.slice("/result/".length));
        let body = "";
        for await (const chunk of req) body += chunk;
        const result = JSON.parse(body);
        completed.set(browser, result);
        await mkdir(resultsDir, { recursive: true });
        await writeFile(join(resultsDir, `${browser}.json`), JSON.stringify(result, null, 2));
        console.log(`[server] received results for "${browser}" (${body.length} bytes)`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
        return;
      }
      if (req.method === "GET" && url.pathname === "/log") {
        console.log(`[beacon] ${url.searchParams.get("m") ?? ""}`);
        res.writeHead(204).end();
        return;
      }
      if (req.method !== "GET") {
        res.writeHead(405).end();
        return;
      }
      let path = url.pathname === "/" ? "/src/harness.html" : url.pathname;
      const filePath = normalize(join(ROOT, path));
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403).end();
        return;
      }
      const data = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(data);
    } catch (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500).end(String(err));
    }
  });

  return { server, completed };
}

// Standalone mode: `npm run serve` — serve and wait for browsers to be opened manually.
if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const { server } = createServer();
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    console.log(`S2 harness: http://127.0.0.1:${port}/?browser=YOUR_BROWSER`);
    console.log("Open it in Chrome, Firefox, and Safari; results land in ./results");
  });
}
