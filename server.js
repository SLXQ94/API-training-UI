#!/usr/bin/env node
// ============================================================================
// Acropolis Chat UI server: hands out the files in ./public, nothing else.
// No npm install needed: only Node's built-in modules.
//
//   node server.js                              UI on port 3001, API address from public/config.js
//   node server.js --api-port=3000              the chat API runs on THIS laptop at port 3000
//   node server.js --api=https://my-api.com     use a different API address
//   node server.js --port=4000                  different UI port
//
// (The same options exist as environment variables: PORT, API_PORT, API_BASE.)
//
// "Serving a frontend" is just this: a browser asks GET /style.css, we read the file from
// disk and send it back with the right Content-Type. That's all a static web server is.
// ============================================================================
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

// ---- settings: command line first, then environment, then defaults ----
const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] === undefined ? 'true' : m[2];
}
const PORT = Number(args.port || process.env.PORT || 3001);
const API_BASE = (args.api || process.env.API_BASE || '').replace(/\/+$/, '');
const API_PORT = args['api-port'] || process.env.API_PORT || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const clientIp = (req) => (req.socket.remoteAddress || '?').replace(/^::ffff:/, '');

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

// ---- config.js is special ----
// The UI reads its API address from config.js. When you start this server with --api or --api-port
// we append an override to the file as it is sent (the file on disk is not changed).
//   --api-port=3000 : "the API is on this laptop". Students' browsers can't use "localhost" (that would
//   be THEIR laptop), so we build the address from the IP they used to reach this page.
function serveConfig(req, res, file) {
  fs.readFile(file, 'utf8', (err, text) => {
    if (err) return send(res, 404, 'Not found');
    const override = {};
    if (API_BASE) {
      override.API_BASE = API_BASE;
    } else if (API_PORT) {
      let host = 'localhost';
      try { host = new URL('http://' + req.headers.host).hostname; } catch (e) { /* keep localhost */ }
      override.API_BASE = `http://${host}:${API_PORT}`;
    }
    const body = Object.keys(override).length
      ? `${text}\n;Object.assign(window.CONFIG, ${JSON.stringify(override)});\n`
      : text;
    res.writeHead(200, {
      'Content-Type': TYPES['.js'],
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}

const server = http.createServer((req, res) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`${new Date().toLocaleTimeString()}  ${clientIp(req).padEnd(15)}  ${req.method} ${req.url}  ->  ${res.statusCode}  (${ms.toFixed(1)} ms)`);
  });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    return send(res, 400, 'Bad request');
  }
  if (pathname.includes('\0')) return send(res, 400, 'Bad request');
  if (pathname === '/') pathname = '/index.html';

  // Never leave ./public. A request like GET /../server.js must not be able to read our other files.
  const file = path.join(PUBLIC_DIR, pathname);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  if (pathname.split('/').some((part) => part.startsWith('.'))) return send(res, 404, 'Not found'); // no dotfiles

  if (pathname === '/config.js') return serveConfig(req, res, file);

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache', // always re-check, so your edits show up on refresh
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use (is the UI server already running?).\nTry another port:  node server.js --port=${PORT + 1}\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

// 0.0.0.0 = listen on every network interface, so other laptops and phones on the same network can connect
server.listen(PORT, '0.0.0.0', () => {
  // which API will the UI talk to? (run config.js in a sandbox to read it)
  let api = '(unknown)';
  try {
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(PUBLIC_DIR, 'config.js'), 'utf8'), sandbox);
    api = API_BASE || (API_PORT ? `http://<same address the page was opened on>:${API_PORT}` : sandbox.window.CONFIG.API_BASE || '(same server)');
  } catch (e) { /* ignore */ }

  console.log('\nAcropolis Chat UI is running');
  console.log(`  you:        http://localhost:${PORT}`);
  const lan = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) lan.push([name, a.address]);
  }
  if (lan.length) {
    for (const [name, ip] of lan) console.log(`  classmates: http://${ip}:${PORT}   (${name})`);
    console.log('              (give them the address on the same network as theirs; virtual adapters like docker/vmware can appear too)');
  } else {
    console.log('  classmates: no network connection found. Connect to wifi / a hotspot first.');
  }
  console.log(`  chat API:   ${api}`);
  console.log('\nIf classmates cannot connect: allow Node through your firewall (Windows asks the first time),');
  console.log('and make sure everyone is on the same network (some campus wifi blocks device-to-device traffic).\n');
});
