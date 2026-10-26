import express from 'express';
import { TikTokLiveConnection } from 'tiktok-live-connector';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

const port = Number(process.env.PORT || 3000);
const apiKey = process.env.API_KEY;
const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;
const discordEvents = new Set((process.env.DISCORD_EVENTS || 'chat,gift,member,social,subscribe,streamEnd')
  .split(',').map((event) => event.trim()).filter(Boolean));
let discordQueue = Promise.resolve();
const maxConnections = Math.max(1, Number(process.env.MAX_CONNECTIONS || 10));
const streams = new Map();

function authorize(req, res, next) {
  if (!apiKey) return next();
  const supplied = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (supplied !== apiKey) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
function normalizeUsername(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}
function publicState(stream) {
  return {
    username: stream.username,
    connected: Boolean(stream.connection?.isConnected),
    roomId: stream.connection?.roomId || null,
    startedAt: stream.startedAt,
    clients: stream.clients.size,
    error: stream.error || null
  };
}
function formatDiscordData(data) {
  const text = JSON.stringify(data, null, 2) || '{}';
  return text.length > 3_800 ? text.slice(0, 3_797) + '...' : text;
}
async function postToDiscord(stream, type, data) {
  if (!discordWebhookUrl || !discordEvents.has(type)) return;
  const body = {
    embeds: [{
      title: 'TikTok LIVE · ' + type,
      description: '```json\n' + formatDiscordData(data) + '\n```',
      color: type === 'gift' ? 0xF1C40F : type === 'chat' ? 0x5865F2 : 0x2ECC71,
      footer: { text: '@' + stream.username },
      timestamp: new Date().toISOString()
    }],
    allowed_mentions: { parse: [] }
  };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response;
    try {
      response = await fetch(discordWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000)
      });
    } catch (error) {
      console.error('Discord webhook request failed:', error?.message || error);
      return;
    }
    if (response.ok) return;
    if (response.status === 429 && attempt < 3) {
      let retryMs = 1_000;
      try {
        const result = await response.json();
        retryMs = Math.min(10_000, Math.ceil(Number(result.retry_after || 1) * 1_000));
      } catch { /* use fallback delay */ }
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      continue;
    }
    console.error('Discord webhook returned HTTP ' + response.status);
    return;
  }
}
function publish(stream, type, data = {}) {
  const payload = JSON.stringify({ type, username: stream.username, timestamp: new Date().toISOString(), data });
  for (const client of stream.clients) {
    if (!client.writableEnded) client.write(`event: ${type}\ndata: ${payload}\n\n`);
  }
  discordQueue = discordQueue.then(() => postToDiscord(stream, type, data)).catch((error) => {
    console.error('Discord webhook delivery failed:', error?.message || error);
  });
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api', authorize);

app.post('/api/test/discord', async (_req, res) => {
  if (!discordWebhookUrl) return res.status(503).json({ error: 'Discord webhook is not configured' });
  try {
    const response = await fetch(discordWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Test message: TikTok LIVE Discord webhook delivery check.',
        allowed_mentions: { parse: [] }
      }),
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) {
      console.error('Discord test webhook returned HTTP ' + response.status);
      return res.status(502).json({ error: 'Discord webhook delivery failed' });
    }
    return res.json({ status: 'sent' });
  } catch (error) {
    console.error('Discord test webhook request failed:', error?.message || error);
    return res.status(502).json({ error: 'Discord webhook delivery failed' });
  }
});

app.get('/api/live', (_req, res) => {
  res.json({ streams: [...streams.values()].map(publicState), maxConnections });
});
app.get('/api/live/:username', (req, res) => {
  const stream = streams.get(normalizeUsername(req.params.username));
  if (!stream) return res.status(404).json({ error: 'No connection for this username' });
  res.json(publicState(stream));
});
app.post('/api/live/:username/connect', async (req, res) => {
  const username = normalizeUsername(req.params.username);
  if (!/^[a-zA-Z0-9._]{2,24}$/.test(username)) {
    return res.status(400).json({ error: 'username must be a TikTok handle without @' });
  }
  const existing = streams.get(username);
  if (existing?.connecting) return res.status(202).json(publicState(existing));
  if (existing?.connection?.isConnected) return res.json(publicState(existing));
  if (streams.size >= maxConnections && !existing) {
    return res.status(429).json({ error: `Connection limit reached (${maxConnections})` });
  }

  const stream = existing || { username, clients: new Set(), startedAt: null, error: null };
  stream.error = null;
  stream.connecting = true;
  stream.connection = new TikTokLiveConnection(username, { processInitialData: false });
  streams.set(username, stream);
  for (const event of ['chat', 'gift', 'like', 'member', 'social', 'roomUser', 'questionNew', 'subscribe', 'streamEnd', 'connected', 'disconnected']) {
    stream.connection.on(event, (data) => {
      if (event === 'connected') stream.startedAt = new Date().toISOString();
      if (event === 'disconnected' || event === 'streamEnd') stream.startedAt = null;
      publish(stream, event, data && typeof data === 'object' ? data : { value: data });
    });
  }
  stream.connection.on('error', (error) => {
    stream.error = error?.message || String(error);
    publish(stream, 'error', { message: stream.error });
  });
  try {
    await stream.connection.connect();
    stream.connecting = false;
    stream.startedAt ||= new Date().toISOString();
    return res.status(201).json(publicState(stream));
  } catch (error) {
    stream.connecting = false;
    stream.error = error?.message || 'Unable to connect to TikTok LIVE';
    publish(stream, 'error', { message: stream.error });
    return res.status(502).json({ error: 'TikTok connection failed', detail: stream.error });
  }
});
app.delete('/api/live/:username', async (req, res) => {
  const username = normalizeUsername(req.params.username);
  const stream = streams.get(username);
  if (!stream) return res.status(404).json({ error: 'No connection for this username' });
  try { await stream.connection?.disconnect(); } catch { /* cleanup continues */ }
  publish(stream, 'closed');
  for (const client of stream.clients) client.end();
  streams.delete(username);
  res.json({ status: 'disconnected', username });
});
app.get('/api/live/:username/events', (req, res) => {
  const stream = streams.get(normalizeUsername(req.params.username));
  if (!stream) return res.status(404).json({ error: 'Connect to the LIVE first' });
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify(publicState(stream))}\n\n`);
  stream.clients.add(res);
  const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': keep-alive\n\n'); }, 25_000);
  req.on('close', () => { clearInterval(heartbeat); stream.clients.delete(res); });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: 'Invalid request' });
});
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`TikTok LIVE API listening on ${port}`);
  const autoConnectUsername = normalizeUsername(process.env.AUTO_CONNECT_USERNAME);
  if (autoConnectUsername) {
    setTimeout(async () => {
      try {
        const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
        const response = await fetch(`http://127.0.0.1:${port}/api/live/${encodeURIComponent(autoConnectUsername)}/connect`, { method: 'POST', headers });
        if (!response.ok) console.error(`Startup connection to @${autoConnectUsername} failed:`, await response.text());
      } catch (error) {
        console.error(`Startup connection to @${autoConnectUsername} failed:`, error);
      }
    }, 0);
  }
});

async function shutdown() {
  server.close();
  await Promise.all([...streams.values()].map(async (stream) => {
    try { await stream.connection?.disconnect(); } catch { /* shutting down */ }
    for (const client of stream.clients) client.end();
  }));
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
