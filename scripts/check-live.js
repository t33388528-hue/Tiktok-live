const baseUrl = process.env.RENDER_SERVICE_URL;
const monitorToken = process.env.MONITOR_TOKEN;
const username = process.env.TIKTOK_USERNAME || 'ChilledLuck';

if (!baseUrl || !monitorToken) {
  console.error('RENDER_SERVICE_URL and MONITOR_TOKEN are required');
  process.exit(1);
}

const endpoint = `${baseUrl.replace(/\/$/, '')}/api/live/${encodeURIComponent(username)}/connect`;
const headers = { Authorization: `Bearer ${monitorToken}` };
let lastError;

for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(45_000)
    });

    if (response.status === 502 && response.headers.get('content-type')?.includes('application/json')) {
      console.log(`@${username} is offline; the next scheduled check will retry.`);
      process.exit(0);
    }
    if (response.status === 401 || response.status === 403) {
      console.error('Render rejected the monitor credentials.');
      process.exit(1);
    }
    if (!response.ok && response.status !== 202) {
      throw new Error(`Render returned HTTP ${response.status}`);
    }

    const state = await response.json();
    console.log(`@${username}: ${state.connected ? 'connected' : 'connection in progress'}.`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

console.error('LIVE status check failed after retries:', lastError?.message || lastError);
process.exit(1);

