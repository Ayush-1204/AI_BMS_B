# ARBOR — Physical AI Smart Building Gateway (Track B)

Zero-cloud, edge-native Building Management System PoC. Node.js / Express / MongoDB / Socket.io.

## Prerequisites

- Node.js ≥ 18
- MongoDB Community Edition (port `27017`)
- ngrok (optional, for remote simulator traffic)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment config
cp .env.example .env

# 3. Start MongoDB (if not running as a service)
mongod --dbpath ./data/db

# 4. Start the backend
npm start
# → http://localhost:3000

# 5. (Optional) Expose via ngrok
ngrok http 3000
```

## Phase 1–5 — What's Implemented

| Module | Status |
|---|---|
| `constants.js` | Shared zone IDs, fault types, thresholds |
| `server.js` | Express + Socket.io, Mongo retry, telemetry ingestion, dedup/cooldown, `POST /api/simulate/fault`, `GET /api/debug/zscore/:zone` |
| `models.js` | `Telemetry` + `WorkOrder` Mongoose schemas (incl. dedup fields) |
| `aiEngine.js` | Per-zone rolling Z-Score engine + hard rules |
| `fleetSimulator.js` | HVAC (4s) + lighting (5s) loops, F/L fault injector |
| `public/index.html` | Full dashboard: floor plan, incident log, inject button, audio/visual alerts |
| `public/floor_plan.svg` | Static floor plan with zone overlays |
| `scripts/resetDb.js` | Demo reset utility for Telemetry + WorkOrders |

## Verify Phase 4

```bash
# Terminal 1 — backend
npm start

# Browser — open dashboard
# http://localhost:3000

# Click "🔥 Inject Fault" — within ~2s expect:
#   • ZONE-A1 highlighted red on floor plan
#   • Red pulsing alert card in Incident Log
#   • Audible tone (after "🔊 Enable Sound" or clicking Inject Fault)

# Click Inject Fault again within 60s — existing card shows ×2 badge (no second card)
```

## Verify Phase 3

```bash
# Terminal 1 — backend
npm start

# Terminal 2 — dedup integration test (5 faults → 1 WorkOrder, repeatCount=5)
npm run test:dedup

# Terminal 3 — live simulator (localhost or ngrok)
npm run simulate
# Press F for HVAC overheat, L for lighting deficiency

# Or trigger via API (same path as dashboard button will use)
curl -X POST http://localhost:3000/api/simulate/fault \
  -H "Content-Type: application/json" \
  -d '{"type":"HVAC_OVERHEAT","zone":"ZONE-A1"}'
```

## Verify Phase 2

```bash
# Unit test — per-zone Z-Score isolation
npm run test:zscore

# Manual curl — two zones tracked independently
curl -X POST http://localhost:3000/api/telemetry \
  -H "Content-Type: application/json" \
  -d '{"agentId":"HVAC-ZONE-A1","zone":"ZONE-A1","metrics":{"ambient_temp_celsius":22,"occupancy_detected":true}}'

curl http://localhost:3000/api/debug/zscore/ZONE-A1
curl http://localhost:3000/api/debug/zscore/ZONE-B1
```

## Project Structure

```
physical-ai-bms/
├── package.json
├── constants.js          # Shared contract (zones, thresholds)
├── server.js             # Express + Socket.io hub
├── models.js             # Mongoose schemas
├── aiEngine.js           # Per-zone Z-Score anomaly detector
├── fleetSimulator.js     # HVAC + lighting simulator + fault injector
├── scripts/
│   ├── testZScore.js     # Phase 2 isolation test
│   └── testDedup.js      # Phase 3 dedup/cooldown test
├── public/
│   ├── index.html        # Real-time dashboard
│   └── floor_plan.svg    # Floor plan graphic
└── README.md
```

## Scripts

| Command | Description |
|---|---|
| `npm start` | Start Express + Socket.io server |
| `npm run dev` | Start with nodemon auto-reload |
| `npm run test:zscore` | Run Z-Score per-zone isolation test |
| `npm run test:dedup` | Run work-order dedup integration test |
| `npm run simulate` | Run fleet simulator |
| `npm run reset-db` | Clear telemetry + work orders before a rehearsal |

Typical demo flow:

```bash
# 1) Clean slate
npm run reset-db

# 2) Start backend
npm start

# 3) (Optional) Start simulator in another terminal
npm run simulate
```
