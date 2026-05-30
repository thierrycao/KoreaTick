const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const quotes = require('./netlify/functions/quotes');
const leaders = require('./netlify/functions/leaders');
const insights = require('./netlify/functions/insights');
const news = require('./netlify/functions/news');

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8'
  }[ext] || 'application/octet-stream';
}

async function runFunction(handler, req, res) {
  const url = new URL(req.url, 'http://127.0.0.1:4173');
  const event = {
    httpMethod: req.method,
    queryStringParameters: Object.fromEntries(url.searchParams.entries())
  };
  const result = await handler.handler(event);
  res.writeHead(result.statusCode || 200, result.headers || {});
  res.end(result.body || '');
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/quotes')) return runFunction(quotes, req, res);
    if (req.url.startsWith('/api/leaders')) return runFunction(leaders, req, res);
    if (req.url.startsWith('/api/insights')) return runFunction(insights, req, res);
    if (req.url.startsWith('/api/news')) return runFunction(news, req, res);

    const url = new URL(req.url, 'http://127.0.0.1:4173');
    const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^\.\.(\/|\\|$)/, '');
    const filePath = path.join(root, safePath === '/' ? 'index.html' : safePath);
    if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': contentType(filePath), 'cache-control': 'no-store' });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(error.stack || String(error));
  }
});

const port = Number(process.env.PORT || 4173);
server.listen(port, () => {
  console.log(`Korea Stock CN running at http://127.0.0.1:${port}`);
});
