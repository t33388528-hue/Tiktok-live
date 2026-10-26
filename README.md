# TikTok LIVE API for Railway

A small HTTP and Server-Sent Events wrapper around the unofficial [tiktok-live-connector](https://www.npmjs.com/package/tiktok-live-connector) library. It connects to public TikTok LIVE rooms by username and streams events to your client.

## Deploy to Render

1. In Render, create a Blueprint from this GitHub repository; Render reads render.yaml to configure the web service.
2. Render installs dependencies with npm install and starts the API with npm start.
3. render.yaml generates a random API_KEY for bearer authentication. You can replace it in the Render Dashboard. /health stays public for Render health checks.
4. `AUTO_CONNECT_USERNAME` is set to `ChilledLuck`, so the service attempts to connect to `@ChilledLuck` after each startup. Change or clear it in Render to select a different creator or disable auto-connect. `MAX_CONNECTIONS` defaults to 10, and Render supplies `PORT` automatically.

The connector depends on TikTok's unofficial, reverse-engineered LIVE interface and a third-party signing provider. TikTok may change it, and availability is not guaranteed. This service reads public LIVE events; it does not implement login or chat sending.

## Discord webhook

Create an incoming webhook in the Discord channel where you want LIVE updates, then set its URL as `DISCORD_WEBHOOK_URL` in the Render service's environment settings. The URL is a secret; do not commit it to the repository. The Render Blueprint marks it as a value to enter during initial setup.

By default, Discord receives chat, gift, member, social, subscription, and stream-end events from the configured TikTok LIVE connection. Set `DISCORD_EVENTS` to a comma-separated list of event names to customize this (for example, `chat,gift,like`). Mentions from LIVE content are disabled so event text cannot trigger Discord pings.

## API

All API routes require the bearer key when API_KEY is set.

| Method | Path | Description |
| --- | --- | --- |
| GET | /health | Render health check |
| GET | /api/live | List active connections |
| GET | /api/live/:username | Connection state |
| POST | /api/live/:username/connect | Connect to a creator's LIVE room |
| GET | /api/live/:username/events | Subscribe to events using SSE |
| DELETE | /api/live/:username | Disconnect and close event clients |

Handles can include or omit @. SSE emits events such as chat, gift, like, member, social, roomUser, questionNew, and subscribe. Each message is JSON with type, username, timestamp, and data.

```sh
curl -H "Authorization: Bearer $API_KEY" -X POST https://YOUR-RENDER-SERVICE.onrender.com/api/live/example/connect
curl -N -H "Authorization: Bearer $API_KEY" https://YOUR-RAILWAY-DOMAIN/api/live/example/events
curl -H "Authorization: Bearer $API_KEY" -X DELETE https://YOUR-RAILWAY-DOMAIN/api/live/example
```

Connections live in memory on one service instance. Use one Railway replica for predictable SSE routing; reconnect after a restart or deployment.
