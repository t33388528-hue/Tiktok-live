# TikTok LIVE API for Railway

A small HTTP and Server-Sent Events wrapper around the unofficial [tiktok-live-connector](https://www.npmjs.com/package/tiktok-live-connector) library. It connects to public TikTok LIVE rooms by username and streams events to your client.

## Deploy to Railway

1. Create a Railway service from this GitHub repository.
2. Railway detects railway.json and runs npm start.
3. Set API_KEY in Railway variables to a long random secret. API routes accept Authorization: Bearer <API_KEY>. /health stays public for Railway health checks.
4. Optionally set MAX_CONNECTIONS (default 10). Railway supplies PORT automatically.

The connector depends on TikTok's unofficial, reverse-engineered LIVE interface and a third-party signing provider. TikTok may change it, and availability is not guaranteed. This service reads public LIVE events; it does not implement login or chat sending.

## API

All API routes require the bearer key when API_KEY is set.

| Method | Path | Description |
| --- | --- | --- |
| GET | /health | Railway health check |
| GET | /api/live | List active connections |
| GET | /api/live/:username | Connection state |
| POST | /api/live/:username/connect | Connect to a creator's LIVE room |
| GET | /api/live/:username/events | Subscribe to events using SSE |
| DELETE | /api/live/:username | Disconnect and close event clients |

Handles can include or omit @. SSE emits events such as chat, gift, like, member, social, roomUser, questionNew, and subscribe. Each message is JSON with type, username, timestamp, and data.

```sh
curl -H "Authorization: Bearer $API_KEY" -X POST https://YOUR-RAILWAY-DOMAIN/api/live/example/connect
curl -N -H "Authorization: Bearer $API_KEY" https://YOUR-RAILWAY-DOMAIN/api/live/example/events
curl -H "Authorization: Bearer $API_KEY" -X DELETE https://YOUR-RAILWAY-DOMAIN/api/live/example
```

Connections live in memory on one service instance. Use one Railway replica for predictable SSE routing; reconnect after a restart or deployment.
