const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// Add JSON body parser middleware
app.use(express.json());

// --- WebSocket handling ---
wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.on('message', (message) => {
    console.log('Received:', message.toString());
    if (message.toString() === 'echo') ws.send('echo');
  });
  ws.on('close', () => console.log('Client disconnected'));
});

// Upgrade HTTP to WebSocket only for /wsstest
server.on('upgrade', (request, socket, head) => {
  if (request.url === '/wsstest') {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  } else socket.destroy();
});

// --- Express routes ---

app.get('/', (req, res) => res.send('yo'));

// Dynamic API routing
let cachedDynamicOrigins = [];
let cacheTimestamp = 0;
const CACHE_DURATION_MS = 60 * 1000;

async function getDynamicOrigins() {
  const now = Date.now();
  if (now - cacheTimestamp < CACHE_DURATION_MS) return cachedDynamicOrigins;
  try {
    const resp = await fetch('https://somestuffserver.koyeb.app/api/domains');
    if (resp.ok) {
      const text = await resp.text();
      cachedDynamicOrigins = text.split('\n').map(d => d.trim()).filter(Boolean);
      cacheTimestamp = now;
      return cachedDynamicOrigins;
    }
  } catch (err) {
    console.error('[Dynamic API] Failed to fetch dynamic origins:', err);
  }
  return [];
}

// Handle preflight requests
app.options('/api/:name', async (req, res) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id');
  return res.status(204).end();
});

// Handle dynamic API endpoints - GET
app.get('/api/:name', async (req, res, next) => {
  const { name } = req.params;
  const apiFile = path.join(__dirname, `${name}.js`);

  if (!fs.existsSync(apiFile)) return res.status(404).send(`API '${name}' not found`);

  try {
    const origin = req.headers.origin || '*';
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id');

    const handler = require(apiFile);
    if (typeof handler !== 'function') return res.status(500).send(`API '${name}' does not export a function`);

    try {
      if (name !== 'views') console.log(`[${name} API] starting (GET)`);
      await handler(req, res, next);
      if (name !== 'views') console.log(`[${name} API] finished (GET)`);
    } catch (err) {
      console.error(`[${name} API] Error:`, err);
      throw err;
    }
  } catch (err) {
    console.error(`[Dynamic API] Error in ${name}:`, err);
    res.status(500).send('Internal Server Error');
  }
});

// Handle dynamic API endpoints - POST
app.post('/api/:name', async (req, res, next) => {
  const { name } = req.params;
  const apiFile = path.join(__dirname, `${name}.js`);

  if (!fs.existsSync(apiFile)) return res.status(404).send(`API '${name}' not found`);

  try {
    const origin = req.headers.origin || '*';
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id');

    const handler = require(apiFile);
    if (typeof handler !== 'function') return res.status(500).send(`API '${name}' does not export a function`);

    try {
      if (name !== 'views') console.log(`[${name} API] starting (POST)`);
      await handler(req, res, next);
      if (name !== 'views') console.log(`[${name} API] finished (POST)`);
    } catch (err) {
      console.error(`[${name} API] Error:`, err);
      throw err;
    }
  } catch (err) {
    console.error(`[Dynamic API] Error in ${name}:`, err);
    res.status(500).send('Internal Server Error');
  }
});

// --- Start the Express server ---
server.listen(8000, () => console.log('Server running on http://localhost:8000'));
