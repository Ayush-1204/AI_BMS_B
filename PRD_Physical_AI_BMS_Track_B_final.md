# Product Requirements Document
## Physical AI — Smart HVAC & Ambient Lighting BMS Command Center
### Track B: Zero-Cloud, Edge-Native Building Intelligence Platform

---

| Field | Detail |
|---|---|
| **Document Version** | v2.1 |
| **Status** | Draft — Hardened & Demo-Ready, Ready for Intern Review |
| **Date** | June 19, 2026 |
| **Project Codename** | ARBOR (Autonomous Real-time Building Operations & Response) |
| **Track** | Track B — Smart HVAC & Ambient Lighting Optimization |
| **Blueprint Reference** | Physical AI & Smart Building Gateway — Intern PoC Implementation Guide |
| **Stack Reference** | Master Project Prompt — Strict "Option A" Blueprint (Node.js / Express / MongoDB / Socket.io) |
| **Deployment Model** | 100% Local (BYOL — Bring Your Own Localhost), public reachability via ngrok |

---

> **⚠️ v2.1 Hardening Notice:** This version builds directly on v2.0's Node.js/Express/MongoDB/Socket.io/Z-Score stack — no stack change. Seven targeted improvements were added based on a risk-driven review of the v2.0 Risk Register: **(1)** work-order dedup/cooldown, **(2)** per-zone Z-Score buffers, **(3)** a dashboard backup fault-trigger button, **(4)** MongoDB connection retry + a live debug introspection endpoint, **(5)** structured timestamped console logging, **(6)** a `scripts/resetDb.js` rehearsal-reset script, and **(7)** audio/visual escalation on High-priority alerts. Each is flagged inline as **[v2.1]** wherever it appears.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement & Context](#2-problem-statement--context)
3. [Goals & Success Metrics](#3-goals--success-metrics)
4. [Scope](#4-scope)
5. [Environment Setup & Stack Decision](#5-environment-setup--stack-decision)
6. [Collaboration & Git Workflow](#6-collaboration--git-workflow)
7. [Resourcefulness Rule](#7-resourcefulness-rule)
8. [Personas & Stakeholders](#8-personas--stakeholders)
9. [User Stories](#9-user-stories)
10. [System Architecture](#10-system-architecture)
11. [Functional Requirements](#11-functional-requirements)
12. [Non-Functional Requirements](#12-non-functional-requirements)
13. [Data Schemas & Models (Mongoose)](#13-data-schemas--models-mongoose)
14. [API & Socket.io Contracts](#14-api--socketio-contracts)
15. [Dashboard UI Specifications](#15-dashboard-ui-specifications)
16. [Simulation & Fault Library](#16-simulation--fault-library)
17. [Anomaly Detection Specification (Z-Score Engine)](#17-anomaly-detection-specification-z-score-engine)
18. [Work Order Generation Logic](#18-work-order-generation-logic)
19. [Implementation Phases](#19-implementation-phases)
20. [Acceptance Criteria & Demo Checklist](#20-acceptance-criteria--demo-checklist)
21. [Technology Stack](#21-technology-stack)
22. [Risk Register](#22-risk-register)
23. [Open Questions & Future Enhancements](#23-open-questions--future-enhancements)

---

## 1. Executive Summary

**ARBOR** is an intern proof-of-concept (PoC) Physical AI command center that ingests mock telemetry from simulated HVAC and ambient lighting agents over the public internet (via ngrok), detects anomalies using a **per-zone Rolling Z-Score statistical model**, automatically generates maintenance work orders (with duplicate suppression for sustained faults), and broadcasts them to a real-time browser dashboard.

```
[fleetSimulator.js]              [ngrok public URL]              [Express + Socket.io]
  HVAC loop  (4s) ──┐                    │                              │
  Lighting loop(5s)─┼── fetch() POST ───►│── forwards to localhost ───►│ server.js
  readline "F" key ─┘                    │                              │
                                                                          ▼
                                                       aiEngine.js — Rolling Z-Score
                                                       (per-zone buffers) [v2.1]
                                                                          │
                                                              anomaly? ──►│── MongoDB (Mongoose)
                                                                          │      Telemetry + WorkOrder
                                                                          │   dedup/cooldown check [v2.1]
                                                                          ▼
                                                          io.emit('new-work-order', ...)
                                                                          │
                                                                          ▼
                                              public/index.html — Incident Log + floor plan
                                              + backup "Inject Fault" button [v2.1]
                                              + audio/visual escalation on High priority [v2.1]
```

This remains a five-file core repository (`server.js`, `models.js`, `aiEngine.js`, `fleetSimulator.js`, `public/index.html`), plus a small `scripts/resetDb.js` utility added in this hardening pass. Built entirely on free, locally-runnable tools — Node.js, Express, MongoDB Community Edition, Socket.io, vanilla HTML/CSS/JS, and ngrok. Zero cloud spend, zero paid SaaS.

---

## 2. Problem Statement & Context

### 2.1 The Gap in Traditional BMS

Modern Building Management Systems (BMS) suffer from three structural deficiencies:

1. **Cloud Latency:** Telemetry round-trips to cloud endpoints introduce 200–800ms latency, making real-time actuation effectively impossible for fast-moving physical faults like HVAC vent failures.
2. **Data Sovereignty Risks:** Transmitting granular occupant behavioral telemetry to third-party SaaS platforms violates data privacy policy in sensitive environments.
3. **Vendor Lock-In on Analytics:** Commercial BMS anomaly detection is usually a black-box, paid add-on. Facility teams cannot inspect, tune, or extend the logic.

### 2.2 The Physical AI Opportunity

ARBOR addresses all three using a deliberately lightweight, fully-inspectable architecture:

- **Latency:** All compute happens in-process inside a single Node.js event loop on localhost. Anomaly evaluation per payload completes in sub-millisecond time.
- **Privacy:** Telemetry never leaves the developer's machine except via the team's own ngrok tunnel.
- **Transparency:** The "AI" is a **Rolling Z-Score** — a textbook statistical control-chart technique implemented in plain JavaScript, fully visible and tunable, unlike a vendor's black box.
- **Operational Robustness [v2.1]:** Connection retries, duplicate suppression, and a live debug endpoint mean the system behaves predictably under the exact conditions a live demo actually creates — sustained faults, a Mongo service that starts a beat late, and an audience that wants to see the numbers behind the alert.

### 2.3 PoC Scope

This is an intern-led PoC. Real hardware sensors are replaced by a single Node.js script (`fleetSimulator.js`) that runs two concurrent timer loops across multiple zones and exposes a live, terminal-based fault injector — pressing **F** instantly fires a spiked, anomalous payload. A dashboard button provides a second, terminal-independent way to trigger the same scenario **[v2.1]**.

---

## 3. Goals & Success Metrics

### 3.1 Primary Goals (Blueprint + Master Prompt Mandated)

| # | Goal | Source |
|---|---|---|
| G1 | **Live Dual-Loop Ingestion** — `fleetSimulator.js` runs both an HVAC loop (4s) and a Lighting loop (5s) concurrently, across multiple zones, both POSTing to the same Express endpoint. | Blueprint §6 Criterion 1 / Master Prompt §4 |
| G2 | **Dashboard Visuals** — `public/index.html` renders a floor plan and a live Incident Log that updates the instant a Socket.io event arrives. | Blueprint §6 Criterion 2 / Master Prompt §5 |
| G3 | **Crisis Scenario** — pressing **F** (or clicking the dashboard's backup trigger **[v2.1]**) creates a MongoDB `WorkOrder` document and a red alert card within ~2 seconds. | Blueprint §6 Criterion 3 / Master Prompt §2, §4 |
| G4 | **Automated Work Order Generation** — every anomaly produces a `WorkOrder` document with a unique `referenceId`, `priority`, `faultType`, `description`, and `createdAt`; sustained faults increment a `repeatCount` instead of flooding the collection **[v2.1]**. | Master Prompt §1 |
| G5 | **Zero Cloud Dependency** — MongoDB, Express, and the dashboard all run on `localhost`. | Blueprint §2 |
| G6 | **Operational Resilience [v2.1]** — the backend survives a slow-starting MongoDB instance, isolates anomaly baselines per zone, and exposes its internal statistical state for live inspection. | Risk-driven addition |

### 3.2 Key Performance Indicators

| Metric | Target |
|---|---|
| Time from fault-key press (or button click) to dashboard red alert | ≤ 2 seconds |
| `POST /api/telemetry` average response time | ≤ 150ms |
| Z-Score false positive rate during normal operation (post warm-up) | ≤ 5% |
| Work order generation success rate | 100% of confirmed anomalies |
| Duplicate WorkOrder documents created for one sustained fault episode **[v2.1]** | 0 (must increment `repeatCount` on the same document instead) |
| Demo setup time from README on a clean machine | ≤ 15 minutes |

---

## 4. Scope

### 4.1 In Scope

- `models.js` — Mongoose schemas for `Telemetry` and `WorkOrder` (with dedup-support fields **[v2.1]**)
- `aiEngine.js` — per-zone Rolling Z-Score statistical anomaly detector + hard physical rules + debug introspection export **[v2.1]**
- `server.js` — Express HTTP server, Mongoose/MongoDB connection with retry **[v2.1]**, Socket.io hub, telemetry ingestion, dedup/cooldown logic **[v2.1]**, backup fault-trigger endpoint **[v2.1]**, debug endpoint **[v2.1]**
- `fleetSimulator.js` — unified Node.js script with concurrent HVAC (4s) and Lighting (5s) `setInterval` loops across multiple zones, plus a `readline`-based live fault injector
- `public/index.html` — single-page vanilla HTML/CSS/JS dashboard: header, floor plan, live Incident Log, backup "Inject Fault" button **[v2.1]**, audio/visual escalation **[v2.1]**
- `scripts/resetDb.js` — clears `Telemetry`/`WorkOrder` collections for clean rehearsal runs **[v2.1]**
- ngrok HTTP tunnel for routing the simulator's traffic to the locally-running Express server
- GitHub repository with two feature branches and PR-based merge workflow

### 4.2 Out of Scope (Current Version)

- Cloud hosting of any component — see Section 23 for an optional opt-in path
- User authentication / access control
- Multi-building support beyond the demo floor plan
- Mobile application
- Email/SMS alerting (dashboard-only notification)
- The Python/FastAPI/PMV-PPD/River/PySAD ML pipeline from PRD v1.1 — documented Phase II upgrade path only
- Production hardening (TLS certificates, rate limiting, horizontal scaling)

---

## 5. Environment Setup & Stack Decision

### 5.1 Strict Stack (Master Prompt — "Option A")

| Layer | Technology | Notes |
|---|---|---|
| Backend Runtime | Node.js ≥ 18 | Required for native global `fetch()`. |
| Web Framework | Express.js | Serves both the REST API and the static `/public` dashboard. |
| Database | MongoDB Community Edition | Local install, default port `27017`. |
| ODM | Mongoose | Schema definitions in `models.js`. |
| Real-Time Comms | Socket.io | Attached to the same HTTP server instance as Express. |
| Frontend | Vanilla HTML/CSS/JS | No React, no build step, no bundler. |
| Tunneling | ngrok | Routes public internet traffic to `localhost:3000`. |

### 5.2 Prerequisites (Install Before Day 1)

```bash
node --version       # v18.x or higher
mongod --version     # MongoDB Community Edition
ngrok version
git --version
```

### 5.3 `package.json` **[v2.1: added `reset-db` script]**

```json
{
  "name": "physical-ai-bms",
  "version": "2.1.0",
  "description": "ARBOR — Zero-Cloud Physical AI Smart Building Gateway PoC",
  "main": "server.js",
  "engines": { "node": ">=18.0.0" },
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "simulate": "node fleetSimulator.js",
    "reset-db": "node scripts/resetDb.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "mongoose": "^8.4.0",
    "socket.io": "^4.7.5",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "nodemon": "^3.1.0"
  }
}
```

### 5.4 Required File Structure **[v2.1: added `scripts/resetDb.js`]**

```text
/physical-ai-bms
├── package.json
├── .env                       (optional — MONGO_URI, PORT)
├── server.js                  (Express server, Socket.io hub, retry-connect, debug + fault-trigger routes)
├── models.js                  (Mongoose schemas)
├── aiEngine.js                 (Per-zone statistical anomaly detection)
├── fleetSimulator.js           (Unified HVAC & Lighting agent scripts)
├── scripts/
│   └── resetDb.js               (NEW v2.1 — clears collections before a rehearsal/demo)
├── README.md
└── public/
    └── index.html                (Real-time dashboard + backup trigger + audio/visual alerts)
```

### 5.5 Starting the Stack

```bash
# Terminal 1 — start MongoDB (if not running as a system service)
mongod --dbpath ./data/db

# Terminal 2 — (optional, before each rehearsal) clear old demo data
npm run reset-db

# Terminal 3 — start the Express + Socket.io backend
npm start
# Server listening on http://localhost:3000

# Terminal 4 — expose the backend publicly
ngrok http 3000
# Forwarding  https://abc123.ngrok-free.app -> http://localhost:3000

# Terminal 5 — run the unified fleet simulator
API_URL=https://abc123.ngrok-free.app/api/telemetry node fleetSimulator.js
# Press F to inject an HVAC overheat fault, L for a lighting fault.
# (Or click "🔥 Inject Fault" directly on the dashboard as a backup trigger.)
```

---

## 6. Collaboration & Git Workflow

### 6.1 Branch Strategy

```
main
 ├── feature/agent-stream-1    ← Intern A: server.js, models.js, HVAC loop logic
 └── feature/agent-stream-2    ← Intern B: aiEngine.js, public/index.html, Lighting loop logic
```

| File | Primary Owner | Contribution |
|---|---|---|
| `server.js` | Intern A | Express app, MongoDB connect+retry **[v2.1]**, Socket.io, `POST /api/telemetry`, dedup logic **[v2.1]**, `POST /api/simulate/fault` **[v2.1]**, `GET /api/debug/zscore/:zone` **[v2.1]** |
| `models.js` | Intern A | `Telemetry` and `WorkOrder` schemas, including `repeatCount`/`lastSeenAt` **[v2.1]** |
| `aiEngine.js` | Intern B | Per-zone Rolling Z-Score **[v2.1]**, hard rule checks, `evaluatePayload()`, `getZoneStats()` **[v2.1]** |
| `fleetSimulator.js` → `runHvacLoop()` | Intern A | HVAC payload generator across zones + `setInterval` (4s) |
| `fleetSimulator.js` → `runLightingLoop()` | Intern B | Lighting payload generator across zones + `setInterval` (5s) |
| `fleetSimulator.js` → fault injector | Shared | `readline` raw-mode keypress listener |
| `public/index.html` | Intern B | Dashboard layout, Socket.io client, backup trigger button **[v2.1]**, audio/visual escalation **[v2.1]** |
| `scripts/resetDb.js` | Intern A | Rehearsal reset utility **[v2.1]** |

**Rules:** no direct commits to `main`; all work via Pull Requests, reviewed by the other intern; `fleetSimulator.js` is scaffolded together on Day 1 to avoid merge conflicts.

### 6.2 Day 1 Mandatory Shared Contract

```javascript
// constants.js — Shared Contract Constants. Commit to main BEFORE branching.

const ZONE_IDS = ["ZONE-A1", "ZONE-A2", "ZONE-B1"];

const FAULT_TYPES = {
  HVAC_OVERHEAT:      "CRITICAL_OVERHEATING",
  HVAC_UNDERHEAT:     "CRITICAL_UNDERCOOLING",
  LIGHTING_DEFICIENT: "ILLUMINANCE_DEFICIENCY",
  LIGHTING_EXCESS:    "ILLUMINANCE_EXCESS",
};

const THRESHOLDS = {
  maxTempOccupiedC: 28,
  minTempOccupiedC: 17.5,
  minLuxOccupied:   200,
  zScoreThreshold:  3,
  minSamplesForZScore: 10,   // [v2.1]
  dedupCooldownMs:  60000,   // [v2.1]
};

module.exports = { ZONE_IDS, FAULT_TYPES, THRESHOLDS };
```

### 6.3 Sprint Timeline

| Day | Intern A | Intern B | Shared |
|---|---|---|---|
| 1 | `server.js` skeleton + Mongo retry-connect **[v2.1]** | `aiEngine.js` skeleton, per-zone Map structure **[v2.1]** | `constants.js` merge. ngrok test. |
| 2 | `models.js` schemas (incl. dedup fields **[v2.1]**), `POST /api/telemetry` | Z-Score math + `getZoneStats()` **[v2.1]** | Confirm payload shape with `curl` against two different zones |
| 3 | `fleetSimulator.js` HVAC loop + readline injector, dedup/cooldown logic **[v2.1]**, debug + fault-trigger routes **[v2.1]** | `fleetSimulator.js` Lighting loop, Socket.io wiring | First live fault injection test, verify per-zone isolation |
| 4 | Work order dedup edge cases | `public/index.html` dashboard, backup button **[v2.1]**, audio/visual escalation **[v2.1]** | End-to-end demo rehearsal |
| 5 | `scripts/resetDb.js` **[v2.1]**, structured logging pass **[v2.1]**, README | Polish: alert card styling, zone highlight animation | Final PR merges, stress test (sustained-fault dedup check) |
| Demo | HVAC fault live trigger | Lighting fault live trigger + dashboard walkthrough | Live screen-share demo |

---

## 7. Resourcefulness Rule

| Enterprise Capability | Typical Cost | ARBOR Free Alternative |
|---|---|---|
| Cloud IoT Platform | $$$$ | `fetch()` HTTP POST to a local Express server |
| Inter-office network / VPN | $$ | `ngrok http 3000` |
| Managed cloud database | $$$ | MongoDB Community Edition, local |
| Real hardware sensors | $$$ | `Math.random()` + baseline ranges |
| Commercial anomaly-detection SaaS | $$$$ | A Rolling Z-Score algorithm in pure JavaScript, with per-zone isolation **[v2.1]** |
| Cloud monitoring/observability tools (Datadog, New Relic) | $$$ | `GET /api/debug/zscore/:zone` live introspection endpoint **[v2.1]** |
| Real-time push infrastructure | $$ | Socket.io |
| Mapping APIs | $$$$ | Static floor plan JPEG + CSS overlays |
| Commercial BMS dashboard | $$$$ | A single vanilla `index.html` file |
| Database GUI reset/seed tooling | $ | `scripts/resetDb.js` — a 15-line Node script **[v2.1]** |

---

## 8. Personas & Stakeholders

### Persona 1 — The Facility Manager
> **Goal:** Know which zones are unhealthy, why, and what action is being taken.
> **Needs from Dashboard:** A red alert the instant a fault is confirmed; a repeat counter so a sustained issue reads as "one ongoing incident," not five unrelated ones **[v2.1]**.

### Persona 2 — The Building Operator
> **Goal:** Understand exactly what is broken and where.
> **Needs from Dashboard:** A clear `faultType` and `description` field on every card.

### Persona 3 — The Intern Developer
> **Goal:** A demo that survives real-world hiccups — a Mongo service that starts a beat late, a terminal that doesn't support raw-mode keypresses, a fault that needs to be held for 20 seconds without flooding the screen.
> **Needs from Dashboard:** A guaranteed-to-work backup trigger button, and confidence the backend won't crash on a slow `mongod` startup **[v2.1]**.

---

## 9. User Stories

### Epic 1: Data Ingestion

| ID | Story | Priority |
|---|---|---|
| US-01 | As **Intern A**, I want a `setInterval` loop POSTing HVAC telemetry every 4s, cycling across multiple zones. | P0 |
| US-02 | As **Intern B**, I want a concurrent Lighting loop POSTing every 5s across the same zones. | P0 |
| US-03 | As a **developer**, I want to press **F** to immediately inject a spiked HVAC fault, bypassing the timer. | P0 |
| US-03b *(v2.1)* | As a **developer**, I want a dashboard button that triggers the exact same fault scenario as the **F** key, in case the demo terminal doesn't support raw-mode keypress detection. | P0 |
| US-04 | As a **developer**, I want `API_URL` to be the ngrok forwarding URL so the simulator can reach the backend from a different laptop. | P0 |

### Epic 2: Anomaly Detection

| ID | Story | Priority |
|---|---|---|
| US-05 | As a **facility manager**, I want every temperature/lighting reading scored against a rolling 50-sample statistical baseline. | P0 |
| US-05b *(v2.1)* | As a **facility manager**, I want each zone's baseline computed independently, so an anomaly in ZONE-A1 never skews what counts as "normal" in ZONE-B1. | P0 |
| US-06 | As a **facility manager**, I want a hard rule (temp > 28°C while occupied) to fire instantly even before the Z-Score model has warmed up. | P0 |
| US-06b *(v2.1)* | As a **developer**, I want to query a live endpoint showing each zone's current mean, standard deviation, and sample count, so I can explain or debug the AI's behavior on demand. | P1 |

### Epic 3: Work Order Generation

| ID | Story | Priority |
|---|---|---|
| US-08 | As a **facility manager**, I want every confirmed anomaly to create a `WorkOrder` document with a unique `referenceId`, `priority`, `faultType`, `description`, and `createdAt`. | P0 |
| US-08b *(v2.1)* | As a **facility manager**, I want a fault that persists for multiple ticks to increment a `repeatCount` on the *same* work order rather than creating a new one every few seconds. | P0 |
| US-09 | As a **building operator**, I want the `referenceId` to follow a predictable pattern (e.g. `WO-HVAC-12345`). | P1 |

### Epic 4: Dashboard

| ID | Story | Priority |
|---|---|---|
| US-10 | As a **facility manager**, I want the dashboard to prepend a red alert card the instant `new-work-order` fires. | P0 |
| US-11 | As a **facility manager**, I want the affected zone highlighted on the floor plan. | P0 |
| US-11b *(v2.1)* | As a **facility manager**, I want a High-priority alert to be unmistakable — a pulsing glow and an audible tone — not just another card in a list. | P1 |
| US-12 | As a **developer**, I want the dashboard to be a single static HTML file with no build step. | P0 |

### Epic 5: Operational Reliability *(v2.1)*

| ID | Story | Priority |
|---|---|---|
| US-16 | As a **developer**, I want the backend to retry its MongoDB connection a few times before giving up, so a `mongod` that's still starting up doesn't crash the server. | P0 |
| US-17 | As a **developer**, I want a one-command way to wipe demo data before a rehearsal so old work orders don't confuse the next run-through. | P1 |
| US-18 | As a **developer**, I want all console output timestamped and clearly tagged, so I can tell at a glance which subsystem logged what during a live demo. | P2 |

---

## 10. System Architecture

### 10.1 High-Level Data Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                      fleetSimulator.js  (Node.js)                      │
│   HVAC Loop (4s, round-robin across ZONE_IDS)                          │
│   Lighting Loop (5s, round-robin across ZONE_IDS)                      │
│   readline raw-mode "F"/"L" fault injector                             │
│   Structured log() helper — timestamped, tagged console output [v2.1]  │
└────────────────────────┬─────────────────────────────────────────────-─┘
                          │  fetch() POST  {API_URL}/api/telemetry
                          ▼
                ┌──────────────────────┐
                │   ngrok public URL   │
                └──────────┬───────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    server.js  (Express + Socket.io)  :3000            │
│                                                                        │
│  mongoose.connect() with retry + exponential backoff [v2.1]           │
│                                                                        │
│  POST /api/telemetry  ──┐                                             │
│  POST /api/simulate/fault [v2.1] ──┤──► handleTelemetry(payload)      │
│                          └──────────►   (shared ingestion function)  │
│       1. new Telemetry(payload).save()  ──────────► MongoDB           │
│       2. evaluatePayload(payload)  ──────────────► aiEngine.js        │
│          (per-zone Rolling Z-Score + hard rules) [v2.1]               │
│       3. if anomaly:                                                  │
│            dedup/cooldown check against recent WorkOrders [v2.1]      │
│              duplicate?  → increment repeatCount, emit                │
│                            'work-order-repeat'                        │
│              new fault?  → create WorkOrder, emit 'new-work-order'    │
│                                                                        │
│  GET /api/debug/zscore/:zone [v2.1]  ──► getZoneStats(zone)           │
└──────────────────────────────┬─────────────────────────────────────-─┘
                                │ Socket.io push
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│              public/index.html  (Browser — vanilla JS)                │
│   socket.on('new-work-order', ...)      → prepend red card           │
│   socket.on('work-order-repeat', ...)   → update existing card [v2.1]│
│   "🔥 Inject Fault" backup button → POST /api/simulate/fault [v2.1]  │
│   High priority → CSS pulse + Web Audio beep [v2.1]                  │
└──────────────────────────────────────────────────────────────────────┘
```

### 10.2 Component Responsibilities

| File | Role |
|---|---|
| `fleetSimulator.js` | Mocks the physical agent fleet across multiple zones; only file with outbound network calls. |
| `server.js` | Express + Socket.io process; owns the HTTP API, Mongo connection (with retry), dedup logic, and the WebSocket hub. |
| `models.js` | Defines everything stored in MongoDB, including dedup-support fields. |
| `aiEngine.js` | Pure statistical evaluator; per-zone in-memory state; no knowledge of Express, Mongo, or Socket.io. |
| `public/index.html` | The only file a browser loads; includes the backup trigger and escalation effects. |
| `scripts/resetDb.js` | Standalone one-shot script; connects to Mongo, clears collections, exits. |

---

## 11. Functional Requirements

### 11.1 Module F1 — Database Schemas (`models.js`)

> **Owner:** Intern A

| Req ID | Requirement | Notes |
|---|---|---|
| F1.01 | `Telemetry` schema: `agentId` (String), `zone` (String), `timestamp` (Date, default `Date.now`), `metrics` (Object: `ambient_temp_celsius`, `work_plane_illuminance_lux`, `occupancy_detected`). | Per Master Prompt §1. |
| F1.02 | `WorkOrder` schema: `referenceId` (String, unique), `priority` (String enum High/Medium/Low), `faultType` (String), `description` (String), `createdAt` (Date). | Per Master Prompt §1. |
| F1.03 *(v2.1)* | `WorkOrder` schema SHALL additionally include `repeatCount` (Number, default `1`) and `lastSeenAt` (Date, default `Date.now`) to support duplicate suppression (Section 18.1). | New in this version — directly enables the dedup/cooldown feature. |
| F1.04 *(v2.1)* | `WorkOrder` schema SHALL additionally include `zone` (String) and `zScore` (Number, nullable) for richer debugging and dashboard zone-targeting. | |
| F1.05 *(Advanced — additive, optional)* | `Telemetry` schema MAY include a TTL index (`expireAfterSeconds: 86400`) on `timestamp`. | Housekeeping only. |

### 11.2 Module F2 — The AI Anomaly Engine (`aiEngine.js`)

> **Owner:** Intern B

| Req ID | Requirement | Notes |
|---|---|---|
| F2.01 *(v2.1 — revised)* | `aiEngine.js` SHALL maintain rolling arrays of the last 50 temperature readings and 50 lighting readings, **keyed independently per zone** via an in-memory `Map<zone, {temp: [], lux: []}>`. | The literal Master Prompt text describes a single global array; keying per zone is a deliberate, requested refinement that prevents one zone's anomaly from corrupting another zone's baseline, while remaining behaviorally identical to the literal spec in a single-zone deployment. |
| F2.02 | `aiEngine.js` SHALL export `evaluatePayload(payload)`, accepting an incoming telemetry payload (now including its `zone`). | |
| F2.03 | The function SHALL calculate mean (μ) and standard deviation (σ) of the **current zone's** rolling window for the relevant metric. | |
| F2.04 | The function SHALL calculate `Z = (x − μ) / σ` for the incoming reading against its own zone's window. | |
| F2.05 | **Logic:** if `|Z| > 3` OR a hard rule is broken (e.g. `temp > 28` while occupied), return `{ isAnomaly: true, faultType: "CRITICAL_OVERHEATING", priority: "High", zScoreValue }`. Otherwise return `false`. | |
| F2.06 *(v2.1)* | If the relevant zone's window has fewer than 10 readings, Z-Score evaluation SHALL be skipped for that tick (hard rules still apply); `zScoreValue` is reported as `null` in that case. | Prevents unstable σ on a near-empty window. |
| F2.07 *(v2.1)* | If σ computes to `0`, Z-Score evaluation SHALL be skipped for that tick (divide-by-zero guard). | |
| F2.08 *(v2.1)* | `aiEngine.js` SHALL export `getZoneStats(zone)`, returning `{ zone, temp: { sampleCount, mean, stdDev }, lux: { sampleCount, mean, stdDev } }` for live introspection. | Powers the `/api/debug/zscore/:zone` endpoint (F3.07). |
| F2.09 *(Advanced — additive, optional)* | The engine MAY use Welford's online algorithm per zone instead of recomputing from the array each call, for O(1) per-tick cost. | See Section 17.3. |

### 11.3 Module F3 — The Backend Server (`server.js`)

> **Owner:** Intern A

| Req ID | Requirement | Notes |
|---|---|---|
| F3.01 | Initialize Express; connect to MongoDB at `mongodb://localhost:27017/arborBMS` via Mongoose. | |
| F3.02 *(v2.1)* | The MongoDB connection SHALL retry on failure with exponential backoff (e.g. 5 attempts: 2s, 4s, 8s, 16s, 32s) before logging a fatal error and exiting, rather than crashing immediately on the first failed connection attempt. | Directly mitigates Risk R-01 (Mongo not yet running when `server.js` starts). |
| F3.03 | Serve static files from `/public`. | |
| F3.04 | Attach Socket.io to the same HTTP server instance as Express. | |
| F3.05 *(v2.1 — revised)* | The core ingestion logic (save Telemetry → evaluate → conditionally create/update WorkOrder → emit) SHALL be implemented as a single reusable function `handleTelemetry(payload)`, called by both `POST /api/telemetry` and `POST /api/simulate/fault` (F3.06), so the two entry points can never drift out of sync. | Refactor for maintainability — both the real simulator and the dashboard's backup button go through identical logic. |
| F3.06 *(v2.1)* | `server.js` SHALL expose `POST /api/simulate/fault`, accepting `{ type, zone }`, internally constructing the equivalent spiked payload `fleetSimulator.js`'s fault injector would have sent, and passing it through `handleTelemetry()`. | Backup demo trigger — directly mitigates Risk R-04 (raw-mode keypress inconsistency across terminals). |
| F3.07 *(v2.1)* | `server.js` SHALL expose `GET /api/debug/zscore/:zone`, returning the live output of `aiEngine.getZoneStats(zone)`. | Live introspection for demo Q&A and debugging. |
| F3.08 *(v2.1)* | Within `handleTelemetry()`, before creating a new `WorkOrder`, the server SHALL check for an existing `WorkOrder` with the same `zone` and `faultType` whose `lastSeenAt` is within the last 60 seconds. If found, increment its `repeatCount`, update `lastSeenAt`, and emit `work-order-repeat` instead of creating a new document. | See Section 18.1 for full logic. |
| F3.09 *(v2.1)* | All `server.js` console output SHALL use a shared `log(tag, message)` helper that prefixes a timestamp and tag, e.g. `[2026-06-19T10:35:22.145Z] [TELEMETRY] ...`. | Structured logging. |
| F3.10 | The route SHALL respond `202` on accepted ingestion regardless of anomaly outcome. | |
| F3.11 *(Advanced — additive, optional)* | `server.js` MAY expose `GET /api/work-orders` and `GET /health`. | |

### 11.4 Module F4 — The Unified Fleet Simulator (`fleetSimulator.js`)

> **Owners:** Intern A (HVAC loop) + Intern B (Lighting loop)

| Req ID | Requirement | Notes |
|---|---|---|
| F4.01 | Store an `API_URL` pointing to the ngrok forwarding URL. | |
| F4.02 | Use `setInterval` for two concurrent loops. | |
| F4.03 *(v2.1 — revised)* | **HVAC Loop (4s):** generates a normal baseline payload (`ambient_temp_celsius` 21–23, `occupancy_detected: true`), cycling round-robin through `ZONE_IDS` on each tick so every zone receives regular HVAC readings. | Multi-zone support, needed for F2.01's per-zone isolation to matter. |
| F4.04 *(v2.1 — revised)* | **Lighting Loop (5s):** generates a normal baseline payload (`work_plane_illuminance_lux` 400–500), cycling round-robin through `ZONE_IDS`. | |
| F4.05 | **Fault Injector:** raw-mode `readline` keypress listener. Pressing **F** immediately POSTs a spiked HVAC payload, bypassing the interval. | |
| F4.06 *(Advanced — additive)* | Pressing **L** injects a spiked lighting payload. | |
| F4.07 *(v2.1)* | All simulator console output SHALL use the shared `log(tag, message)` structured-logging helper (mirrors F3.09). | |
| F4.08 *(Advanced — additive)* | On `fetch()` failure, log a retry message and continue rather than crashing. | |

### 11.5 Module F5 — The Real-Time Dashboard (`public/index.html`)

> **Owner:** Intern B

| Req ID | Requirement | Notes |
|---|---|---|
| F5.01 | Single-page layout: header, static floor plan image, empty Incident Log `<div>`. | |
| F5.02 | Import `socket.io/socket.io.js`. | |
| F5.03 | Listen for `new-work-order`; prepend a red alert card with `referenceId`, `faultType`, `description`. | |
| F5.04 | Highlight the affected zone on the floor plan on event receipt. | |
| F5.05 *(v2.1)* | The page SHALL include a visible **"🔥 Inject Fault"** button in the header that, on click, sends `POST /api/simulate/fault` with a default `{ type: 'HVAC_OVERHEAT', zone: '<currently selected or first zone>' }` body. | Backup trigger, independent of the simulator terminal. |
| F5.06 *(v2.1)* | The page SHALL listen for `work-order-repeat` and update the existing card matching that `referenceId` (tracked via an in-memory `Map<referenceId, HTMLElement>`) with a visible repeat badge (e.g. `×4`), rather than prepending a new card. | |
| F5.07 *(v2.1)* | Work order cards with `priority === "High"` SHALL receive a CSS pulsing-glow animation, and the page SHALL play a short audible tone via the Web Audio API (`AudioContext` + `OscillatorNode` — no external audio file needed). | Audio/visual escalation. |
| F5.08 *(v2.1 — implementation note)* | Because browsers require a user gesture before audio can play, the page SHALL include a one-time **"🔊 Enable Sound"** toggle in the header that calls `audioCtx.resume()` on click. Clicking the Inject Fault button also satisfies this requirement implicitly. | Works around the Web Audio autoplay policy. |
| F5.09 *(Advanced — additive, optional)* | The page MAY render `<canvas>`-based sparklines per zone. | |

### 11.6 Module F6 — Operational Tooling (`scripts/resetDb.js`) **[v2.1, new module]**

> **Owner:** Intern A

| Req ID | Requirement | Notes |
|---|---|---|
| F6.01 | `scripts/resetDb.js` SHALL connect to the same MongoDB instance as `server.js`, delete all documents from the `telemetries` and `workorders` collections, log a confirmation count, and exit cleanly. | |
| F6.02 | The script SHALL be runnable via `npm run reset-db` and SHALL NOT require `server.js` to be running. | |
| F6.03 | The script SHALL refuse to run (with a clear error) if `MONGO_URI`/connection string cannot be reached within 5 seconds, rather than hanging indefinitely. | |

---

## 12. Non-Functional Requirements

### 12.1 Performance

| NFR ID | Requirement |
|---|---|
| NFR-P01 | `POST /api/telemetry` SHALL respond in ≤ 150ms under normal load. |
| NFR-P02 | The backend SHALL handle the simulator's combined multi-zone load with zero queue buildup. |
| NFR-P03 | Socket.io SHALL deliver events to all connected clients within 100ms of emission. |
| NFR-P04 | The dashboard SHALL render a new/updated card within 1 second of receiving the corresponding event. |
| NFR-P05 *(v2.1)* | The dedup-check Mongo query (F3.08) SHALL complete in ≤ 50ms (a single indexed lookup on `zone` + `faultType` + `lastSeenAt`). |

### 12.2 Reliability

| NFR ID | Requirement |
|---|---|
| NFR-R01 | The backend SHALL NOT crash on a malformed `POST /api/telemetry` body. |
| NFR-R02 | The Z-Score engine's rolling state SHALL NOT need to be reset between fault injections. |
| NFR-R03 *(v2.1)* | The backend SHALL retry its initial MongoDB connection at least 5 times with exponential backoff before exiting with a fatal log — it SHALL NOT crash on the very first failed attempt. |
| NFR-R04 *(v2.1)* | A single sustained fault (multiple anomalous ticks within 60 seconds, same zone + faultType) SHALL result in exactly one `WorkOrder` document with an incrementing `repeatCount`, never multiple documents. |
| NFR-R05 *(v2.1)* | `POST /api/simulate/fault` SHALL produce byte-for-byte the same downstream behavior (Telemetry save, evaluation, WorkOrder creation/update, Socket.io emission) as an equivalent payload arriving from `fleetSimulator.js`, since both paths share `handleTelemetry()`. |

### 12.3 Usability

| NFR ID | Requirement |
|---|---|
| NFR-U01 | The dashboard SHALL be reachable at `http://localhost:3000` with zero extensions. |
| NFR-U02 | Anomaly cards SHALL use both color AND text — never color alone. |
| NFR-U03 *(v2.1)* | The "🔥 Inject Fault" button SHALL be visually distinct and always visible without scrolling. |
| NFR-U04 *(v2.1)* | All console logs (both `server.js` and `fleetSimulator.js`) SHALL share a consistent `[ISO-timestamp] [TAG] message` format so interleaved output from multiple processes remains readable during a live demo. |

### 12.4 Portability

| NFR ID | Requirement |
|---|---|
| NFR-PO01 | Stack runs on Windows 10+, macOS 12+, Ubuntu 22.04+ with Node ≥ 18 and MongoDB Community Edition. |
| NFR-PO02 | All dependencies install via a single `npm install`. |
| NFR-PO03 | `README.md` covers MongoDB startup, `npm install`, `npm start`, `npm run reset-db`, ngrok setup, and fault-injector keys/button. |
| NFR-PO04 | Raw-mode keypress detection varies across terminals; the dashboard's backup button (F5.05) exists specifically so this is never a hard demo blocker. |

---

## 13. Data Schemas & Models (Mongoose)

### 13.1 `Telemetry` Schema

```javascript
// models.js
const mongoose = require('mongoose');

const telemetrySchema = new mongoose.Schema({
  agentId: { type: String, required: true },
  zone: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  metrics: {
    ambient_temp_celsius: Number,
    work_plane_illuminance_lux: Number,
    occupancy_detected: Boolean,
  },
});

telemetrySchema.index({ timestamp: 1 }, { expireAfterSeconds: 86400 }); // optional housekeeping

const Telemetry = mongoose.model('Telemetry', telemetrySchema);
```

### 13.2 `WorkOrder` Schema **[v2.1: dedup fields added]**

```javascript
const workOrderSchema = new mongoose.Schema({
  referenceId: { type: String, required: true, unique: true },
  priority: { type: String, enum: ['High', 'Medium', 'Low'], required: true },
  faultType: { type: String, required: true },
  description: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },

  // ── v2.1 additions ──────────────────────────────────────────────
  zone: String,
  zScore: Number,
  repeatCount: { type: Number, default: 1 },
  lastSeenAt: { type: Date, default: Date.now },
  acknowledged: { type: Boolean, default: false },
});

// Speeds up the dedup lookup in handleTelemetry()
workOrderSchema.index({ zone: 1, faultType: 1, lastSeenAt: -1 });

const WorkOrder = mongoose.model('WorkOrder', workOrderSchema);

module.exports = { Telemetry, WorkOrder };
```

### 13.3 Example: a Work Order After a 20-Second Sustained Fault **[v2.1]**

```json
{
  "_id": "665f1c8f9b1e4a0012ab3501",
  "referenceId": "WO-HVAC-30142",
  "priority": "High",
  "faultType": "CRITICAL_OVERHEATING",
  "description": "Ambient temperature spiked to 31.0°C in ZONE-A1 while occupied (threshold: 28°C).",
  "createdAt": "2026-06-19T10:35:22.145Z",
  "zone": "ZONE-A1",
  "zScore": 4.82,
  "repeatCount": 5,
  "lastSeenAt": "2026-06-19T10:35:42.310Z",
  "acknowledged": false
}
```
*Five anomalous ticks over 20 seconds produced exactly **one** document — `repeatCount: 5` — instead of five separate work orders.*

---

## 14. API & Socket.io Contracts

### 14.1 REST API Endpoints

| Method | Path | Description | Version |
|---|---|---|---|
| `POST` | `/api/telemetry` | Receive a telemetry payload; routes through `handleTelemetry()`. | Strict |
| `POST` | `/api/simulate/fault` | Backup demo trigger — `{ type, zone }`; routes through the **same** `handleTelemetry()`. | **[v2.1]** |
| `GET` | `/api/debug/zscore/:zone` | Live `{ mean, stdDev, sampleCount }` for both metrics in the given zone. | **[v2.1]** |
| `GET` | `/health` | Backend + MongoDB connection status. | Advanced |
| `GET` | `/api/work-orders` | Recent work orders (`?limit=20`). | Advanced |
| `PATCH` | `/api/work-orders/:id/acknowledge` | Mark a work order as acknowledged. | Advanced |

**`server.js` — shared ingestion + dedup logic [v2.1]:**
```javascript
const { Telemetry, WorkOrder } = require('./models');
const { evaluatePayload, getZoneStats } = require('./aiEngine');

function log(tag, message) {
  console.log(`[${new Date().toISOString()}] [${tag}] ${message}`);
}

const COOLDOWN_MS = 60 * 1000;

async function handleTelemetry(payload) {
  await new Telemetry(payload).save();
  log('TELEMETRY', `${payload.agentId} (${payload.zone}) saved`);

  const result = evaluatePayload(payload);
  if (!result || !result.isAnomaly) return { anomaly: false };

  const existing = await WorkOrder.findOne({
    zone: payload.zone,
    faultType: result.faultType,
    lastSeenAt: { $gte: new Date(Date.now() - COOLDOWN_MS) },
  }).sort({ lastSeenAt: -1 });

  if (existing) {
    existing.repeatCount += 1;
    existing.lastSeenAt = new Date();
    await existing.save();
    io.emit('work-order-repeat', { referenceId: existing.referenceId, repeatCount: existing.repeatCount });
    log('ANOMALY', `Duplicate suppressed — ${existing.referenceId} now repeatCount=${existing.repeatCount}`);
    return { anomaly: true, workOrder: existing, duplicate: true };
  }

  const workOrder = new WorkOrder({
    referenceId: generateReferenceId(payload.agentId),
    priority: result.priority,
    faultType: result.faultType,
    description: buildDescription(payload, result),
    zone: payload.zone,
    zScore: result.zScoreValue,
  });
  await workOrder.save();
  io.emit('new-work-order', workOrder);
  log('ANOMALY', `New work order created — ${workOrder.referenceId}`);
  return { anomaly: true, workOrder, duplicate: false };
}

app.post('/api/telemetry', async (req, res) => {
  try {
    const result = await handleTelemetry(req.body);
    res.status(202).json(result);
  } catch (err) {
    log('ERROR', `telemetry ingestion failed: ${err.message}`);
    res.status(400).json({ error: 'Invalid payload' });
  }
});

// [v2.1] Backup demo trigger — identical downstream behavior to a real fault
app.post('/api/simulate/fault', async (req, res) => {
  const { type = 'HVAC_OVERHEAT', zone = 'ZONE-A1' } = req.body;
  const payload = type === 'HVAC_OVERHEAT'
    ? { agentId: `HVAC-${zone}`, zone, metrics: { ambient_temp_celsius: 31.0, occupancy_detected: true } }
    : { agentId: `LT-${zone}`, zone, metrics: { work_plane_illuminance_lux: 90, occupancy_detected: true } };

  try {
    const result = await handleTelemetry(payload);
    res.status(202).json(result);
  } catch (err) {
    log('ERROR', `simulate/fault failed: ${err.message}`);
    res.status(400).json({ error: 'Could not simulate fault' });
  }
});

// [v2.1] Live debug introspection
app.get('/api/debug/zscore/:zone', (req, res) => {
  res.json(getZoneStats(req.params.zone));
});
```

**MongoDB connect with retry [v2.1]:**
```javascript
const mongoose = require('mongoose');

async function connectWithRetry(uri, attempt = 1, maxAttempts = 5) {
  try {
    await mongoose.connect(uri);
    log('MONGO', 'Connected successfully');
  } catch (err) {
    if (attempt >= maxAttempts) {
      log('MONGO', `FATAL — could not connect after ${maxAttempts} attempts. Is mongod running?`);
      process.exit(1);
    }
    const delay = 2000 * attempt; // 2s, 4s, 6s, 8s...
    log('MONGO', `Connection attempt ${attempt} failed, retrying in ${delay}ms...`);
    setTimeout(() => connectWithRetry(uri, attempt + 1, maxAttempts), delay);
  }
}

connectWithRetry(process.env.MONGO_URI || 'mongodb://localhost:27017/arborBMS');
```

### 14.2 Socket.io Events

| Event | Direction | Trigger | Payload | Version |
|---|---|---|---|---|
| `new-work-order` | server → all | A brand-new `WorkOrder` was saved | Full `WorkOrder` object | Strict |
| `work-order-repeat` | server → all | A sustained fault updated an existing `WorkOrder` instead of creating a new one | `{ referenceId, repeatCount }` | **[v2.1]** |
| `work-order-acknowledged` | server → all | `PATCH .../acknowledge` succeeds | `{ workOrderId, acknowledgedAt }` | Advanced |
| `telemetry-update` | server → all | Every valid payload | `{ zone, metrics, timestamp }` | Advanced |

---

## 15. Dashboard UI Specifications

### 15.1 Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  ARBOR — Physical AI Command Center   🟢 Connected  🔊 Enable Sound│
│                                          [🔥 Inject Fault]          │
├───────────────────────────┬──────────────────────────────────────┤
│   FLOOR PLAN (static img) │  INCIDENT LOG                        │
│     [ZONE-A1] 🔴(pulsing)  │  ┌──────────────────────────────┐   │
│     [ZONE-A2]              │  │ 🔴 WO-HVAC-30142   ×5          │   │
│     [ZONE-B1]              │  │ CRITICAL_OVERHEATING           │   │
│                            │  │ Ambient temp spiked to 31.0°C  │   │
│                            │  └──────────────────────────────┘   │
└───────────────────────────┴──────────────────────────────────────┘
```

### 15.2 Core HTML/CSS/JS (full, with v2.1 additions)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>ARBOR — Physical AI Command Center</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
    header { padding: 16px 24px; background: #1e293b; display: flex; justify-content: space-between; align-items: center; }
    header .actions { display: flex; gap: 10px; align-items: center; }
    button { background: #334155; color: #e2e8f0; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; }
    #inject-fault-btn { background: #b91c1c; }
    #inject-fault-btn:hover { background: #991b1b; }
    .layout { display: flex; gap: 16px; padding: 16px; }
    .floor-plan-wrap { position: relative; flex: 1; }
    .floor-plan-wrap img { width: 100%; border-radius: 8px; }
    .zone-overlay { position: absolute; opacity: 0.55; border-radius: 4px; transition: background-color 0.3s ease; }
    .incident-log { flex: 1; max-height: 80vh; overflow-y: auto; }
    .alert-card {
      background: #7f1d1d; border-left: 6px solid #ef4444;
      padding: 12px 16px; margin-bottom: 10px; border-radius: 6px;
      animation: flash-in 0.4s ease; position: relative;
    }
    .alert-card.priority-high { animation: flash-in 0.4s ease, pulse-glow 1.5s ease-in-out infinite; }
    .alert-card .ref-id { font-weight: bold; font-size: 0.9rem; }
    .alert-card .repeat-badge {
      position: absolute; top: 10px; right: 12px; background: #fbbf24;
      color: #1e293b; font-size: 0.75rem; font-weight: bold;
      padding: 2px 8px; border-radius: 10px;
    }
    .alert-card .fault-type { color: #fca5a5; font-size: 0.8rem; }
    .alert-card .desc { margin-top: 4px; font-size: 0.85rem; }
    @keyframes flash-in { from { transform: translateY(-12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    @keyframes pulse-glow {
      0%, 100% { box-shadow: 0 0 4px 0 rgba(239,68,68,0.4); }
      50%      { box-shadow: 0 0 18px 4px rgba(239,68,68,0.8); }
    }
  </style>
</head>
<body>
  <header>
    <h1>ARBOR — Physical AI Command Center</h1>
    <div class="actions">
      <span id="conn-status">🟡 Connecting...</span>
      <button id="sound-toggle-btn">🔊 Enable Sound</button>
      <button id="inject-fault-btn">🔥 Inject Fault</button>
    </div>
  </header>

  <div class="layout">
    <div class="floor-plan-wrap">
      <img src="floor_plan.jpg" alt="Office Floor Plan" />
      <div class="zone-overlay" id="zone-ZONE-A1" style="left:60px; top:40px; width:80px; height:60px;"></div>
      <div class="zone-overlay" id="zone-ZONE-A2" style="left:160px; top:40px; width:80px; height:60px;"></div>
      <div class="zone-overlay" id="zone-ZONE-B1" style="left:60px; top:120px; width:80px; height:60px;"></div>
    </div>
    <div class="incident-log" id="incident-log"></div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const log = document.getElementById('incident-log');
    const statusEl = document.getElementById('conn-status');
    const cardsByRefId = new Map(); // [v2.1] referenceId -> DOM element, for repeat updates

    socket.on('connect', () => { statusEl.textContent = '🟢 Connected'; });
    socket.on('disconnect', () => { statusEl.textContent = '🔴 Disconnected'; });

    // ── [v2.1] Web Audio API beep — no external audio file needed ──────
    let audioCtx = null;
    document.getElementById('sound-toggle-btn').addEventListener('click', () => {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.resume();
    });
    function playAlertTone() {
      if (!audioCtx) return; // user hasn't enabled sound yet
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880; // A5 — short, attention-getting, not jarring
      osc.connect(gain); gain.connect(audioCtx.destination);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.2);
    }

    // ── [v2.1] Backup fault-trigger button ──────────────────────────────
    document.getElementById('inject-fault-btn').addEventListener('click', () => {
      fetch('/api/simulate/fault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'HVAC_OVERHEAT', zone: 'ZONE-A1' }),
      });
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.resume(); // clicking this button also satisfies the audio-gesture requirement
    });

    socket.on('new-work-order', (wo) => {
      const card = document.createElement('div');
      card.className = 'alert-card' + (wo.priority === 'High' ? ' priority-high' : '');
      card.innerHTML = `
        <span class="repeat-badge" style="display:none;">×1</span>
        <div class="ref-id">${wo.referenceId}</div>
        <div class="fault-type">${wo.faultType} — ${wo.priority} priority</div>
        <div class="desc">${wo.description}</div>
      `;
      log.prepend(card);
      cardsByRefId.set(wo.referenceId, card);

      const zoneEl = document.getElementById(`zone-${wo.zone}`);
      if (zoneEl) {
        zoneEl.style.backgroundColor = '#ef4444';
        setTimeout(() => { zoneEl.style.backgroundColor = ''; }, 8000);
      }
      if (wo.priority === 'High') playAlertTone();
    });

    // ── [v2.1] Update existing card instead of spamming new ones ───────
    socket.on('work-order-repeat', ({ referenceId, repeatCount }) => {
      const card = cardsByRefId.get(referenceId);
      if (!card) return;
      const badge = card.querySelector('.repeat-badge');
      badge.style.display = 'inline-block';
      badge.textContent = `×${repeatCount}`;
    });
  </script>
</body>
</html>
```

### 15.3 Color & Priority Coding

| Priority | Card Border Color | Hex | Escalation |
|---|---|---|---|
| High | Red | `#ef4444` | Pulsing glow + audio tone **[v2.1]** |
| Medium | Amber | `#f59e0b` | Static card only |
| Low | Slate/Grey | `#64748b` | Static card only |

---

## 16. Simulation & Fault Library

### 16.1 `fleetSimulator.js` — Full Skeleton **[v2.1: multi-zone + structured logging]**

```javascript
// fleetSimulator.js
const readline = require('readline');
const { ZONE_IDS } = require('./constants');

const API_URL = process.env.API_URL || 'https://xxxx.ngrok-free.app/api/telemetry';

function log(tag, message) {
  console.log(`[${new Date().toISOString()}] [${tag}] ${message}`);
}

function generateHvacPayload(zone, spiked = false) {
  const temp = spiked ? 31.0 : +(21 + Math.random() * 2).toFixed(1);
  return { agentId: `HVAC-${zone}`, zone, metrics: { ambient_temp_celsius: temp, occupancy_detected: true } };
}

function generateLightingPayload(zone, spiked = false) {
  const lux = spiked ? 90 : +(400 + Math.random() * 100).toFixed(0);
  return { agentId: `LT-${zone}`, zone, metrics: { work_plane_illuminance_lux: lux, occupancy_detected: true } };
}

async function sendPayload(payload, label) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    log(label, `zone=${payload.zone} status=${res.status} metrics=${JSON.stringify(payload.metrics)}`);
  } catch (err) {
    log(`${label}-RETRY`, `fetch failed: ${err.message}`);
  }
}

// [v2.1] Round-robin across zones so per-zone Z-Score buffers actually get exercised
let hvacZoneIdx = 0;
setInterval(() => {
  const zone = ZONE_IDS[hvacZoneIdx % ZONE_IDS.length];
  hvacZoneIdx++;
  sendPayload(generateHvacPayload(zone), 'HVAC-TX');
}, 4000);

let lightZoneIdx = 0;
setInterval(() => {
  const zone = ZONE_IDS[lightZoneIdx % ZONE_IDS.length];
  lightZoneIdx++;
  sendPayload(generateLightingPayload(zone), 'LT-TX');
}, 5000);

// ── Fault Injector ──────────────────────────────────────────────────
log('SIMULATOR', 'Press F to inject HVAC overheat. Press L for lighting deficiency. Ctrl+C to quit.');

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);

process.stdin.on('keypress', (str, key) => {
  if (key.ctrl && key.name === 'c') process.exit();

  if (str === 'f' || str === 'F') {
    log('FAULT', `Injecting HVAC overheat in ${ZONE_IDS[0]}`);
    sendPayload(generateHvacPayload(ZONE_IDS[0], true), 'HVAC-TX');
  }
  if (str === 'l' || str === 'L') {
    log('FAULT', `Injecting lighting deficiency in ${ZONE_IDS[0]}`);
    sendPayload(generateLightingPayload(ZONE_IDS[0], true), 'LT-TX');
  }
});
```

### 16.2 Fault Scenarios

| Fault | Trigger | Payload Change | Expected Response |
|---|---|---|---|
| `CRITICAL_OVERHEATING` | Press **F** or click Inject Fault | `ambient_temp_celsius: 31.0`, occupied | Hard rule fires instantly; dedup engine ensures repeated ticks increment `repeatCount`, not new docs **[v2.1]** |
| `ILLUMINANCE_DEFICIENCY` | Press **L** | `work_plane_illuminance_lux: 90` | Z-Score + hard rule on that zone's own lighting window |
| `SENSOR_DRIFT` *(advanced)* | — | Gradual +0.3°C/tick ramp | Only the Z-Score model (not the hard rule) should flag it, once that zone's σ has stabilized |

### 16.3 `scripts/resetDb.js` **[v2.1]**

```javascript
// scripts/resetDb.js
const mongoose = require('mongoose');
const { Telemetry, WorkOrder } = require('../models');

async function reset() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/arborBMS';
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const tCount = await Telemetry.deleteMany({});
    const wCount = await WorkOrder.deleteMany({});
    console.log(`[RESET] Cleared ${tCount.deletedCount} telemetry docs, ${wCount.deletedCount} work orders.`);
  } catch (err) {
    console.error(`[RESET] Failed — is mongod running? ${err.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

reset();
```

---

## 17. Anomaly Detection Specification (Z-Score Engine)

### 17.1 Per-Zone Algorithm **[v2.1 — revised from the literal global-array spec]**

```javascript
// aiEngine.js
const Z_THRESHOLD = 3;
const WINDOW_SIZE = 50;
const MIN_SAMPLES = 10;     // [v2.1] guard against unstable early Z-Scores

// [v2.1] Per-zone rolling windows — prevents cross-zone baseline contamination
const zoneWindows = new Map(); // zone -> { temp: [], lux: [] }

function getWindowsFor(zone) {
  if (!zoneWindows.has(zone)) zoneWindows.set(zone, { temp: [], lux: [] });
  return zoneWindows.get(zone);
}

function pushReading(window, value) {
  window.push(value);
  if (window.length > WINDOW_SIZE) window.shift();
}

function meanOf(arr) {
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

function stdDevOf(arr, mean) {
  const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function zScore(value, window) {
  const mean = meanOf(window);
  const sd = stdDevOf(window, mean);
  if (sd === 0) return 0; // [v2.1] divide-by-zero guard
  return (value - mean) / sd;
}

function evaluatePayload(payload) {
  const zone = payload.zone;
  const { temp: tempWindow, lux: luxWindow } = getWindowsFor(zone);
  const { ambient_temp_celsius: temp, work_plane_illuminance_lux: lux, occupancy_detected: occupied } = payload.metrics || {};

  if (typeof temp === 'number') {
    pushReading(tempWindow, temp);
    const hardRuleBroken = temp > 28 && occupied === true;
    if (tempWindow.length >= MIN_SAMPLES) {
      const z = zScore(temp, tempWindow);
      if (Math.abs(z) > Z_THRESHOLD || hardRuleBroken) {
        return { isAnomaly: true, faultType: 'CRITICAL_OVERHEATING', priority: 'High', zScoreValue: z };
      }
    } else if (hardRuleBroken) {
      // [v2.1] Hard rule still fires even before the window has warmed up
      return { isAnomaly: true, faultType: 'CRITICAL_OVERHEATING', priority: 'High', zScoreValue: null };
    }
  }

  if (typeof lux === 'number') {
    pushReading(luxWindow, lux);
    const hardRuleBroken = lux < 200 && occupied === true;
    if (luxWindow.length >= MIN_SAMPLES) {
      const z = zScore(lux, luxWindow);
      if (Math.abs(z) > Z_THRESHOLD || hardRuleBroken) {
        return { isAnomaly: true, faultType: 'ILLUMINANCE_DEFICIENCY', priority: 'Medium', zScoreValue: z };
      }
    } else if (hardRuleBroken) {
      return { isAnomaly: true, faultType: 'ILLUMINANCE_DEFICIENCY', priority: 'Medium', zScoreValue: null };
    }
  }

  return false;
}

// [v2.1] Live introspection — powers GET /api/debug/zscore/:zone
function getZoneStats(zone) {
  const { temp, lux } = getWindowsFor(zone);
  const tempMean = meanOf(temp.length ? temp : [0]);
  const luxMean = meanOf(lux.length ? lux : [0]);
  return {
    zone,
    temp: { sampleCount: temp.length, mean: temp.length ? tempMean : null, stdDev: temp.length ? stdDevOf(temp, tempMean) : null },
    lux:  { sampleCount: lux.length,  mean: lux.length ? luxMean : null,  stdDev: lux.length ? stdDevOf(lux, luxMean) : null },
  };
}

module.exports = { evaluatePayload, getZoneStats };
```

> **Why this deviates from the literal Master Prompt text:** the original spec describes a single global rolling array per metric. With `constants.js` defining three zones, a global array would let an anomaly in ZONE-A1 skew the baseline ZONE-B1 is judged against — a real correctness bug, not a stylistic preference. Keying the `Map` by `zone` fixes this while staying behaviorally identical to the literal spec whenever only one zone is active.

### 17.2 Dual-Consensus Priority Tiers *(Advanced — additive, optional)*

| Condition | Priority |
|---|---|
| Hard rule broken | **High** (always) |
| `\|Z\| > 3` | **High** |
| `2 < \|Z\| ≤ 3` | **Medium** |
| `1.5 < \|Z\| ≤ 2` | **Low** |

### 17.3 Welford's Algorithm — Per-Zone O(1) Variant *(Advanced — additive, optional)*

```javascript
class RollingStats {
  constructor(windowSize = 50) {
    this.windowSize = windowSize;
    this.buffer = [];
    this.mean = 0;
    this.m2 = 0;
  }
  push(value) {
    this.buffer.push(value);
    const n = this.buffer.length;
    const delta = value - this.mean;
    this.mean += delta / n;
    this.m2 += delta * (value - this.mean);
    if (this.buffer.length > this.windowSize) {
      const removed = this.buffer.shift();
      const n2 = this.buffer.length;
      const deltaR = removed - this.mean;
      this.mean -= deltaR / n2;
      this.m2 -= deltaR * (removed - this.mean);
    }
  }
  get stdDev() { const n = this.buffer.length; return n > 1 ? Math.sqrt(this.m2 / n) : 0; }
  zScoreOf(value) { const sd = this.stdDev; return sd === 0 ? 0 : (value - this.mean) / sd; }
}

// One RollingStats instance per zone, per metric — same Map-keyed pattern as 17.1
const zoneStats = new Map(); // zone -> { temp: RollingStats, lux: RollingStats }
```

### 17.4 Minimum Sample Size Guard — now baked into the strict implementation **[v2.1]**

Section 17.1's `evaluatePayload()` already enforces `MIN_SAMPLES = 10` per zone before trusting a Z-Score, falling back to hard rules only until then. This is no longer an optional add-on — it's part of the default behavior in this version.

---

## 18. Work Order Generation Logic

### 18.1 Decision Flow **[v2.1 — dedup/cooldown added]**

```
evaluatePayload(payload) returns truthy result?
        │
       No ──► No WorkOrder. Telemetry already saved.
        │
       Yes
        │
        ▼
Query: WorkOrder.findOne({ zone, faultType, lastSeenAt: { $gte: now - 60s } })
        │
   ┌────┴────┐
 Found      Not found
   │             │
   ▼             ▼
repeatCount++   Generate referenceId
lastSeenAt=now  Build description
save()          new WorkOrder({...}).save()
   │             │
   ▼             ▼
emit            emit
'work-order-     'new-work-order'
 repeat'
```

This logic lives in the shared `handleTelemetry()` function (Section 14.1) so it applies identically whether the anomaly came from `fleetSimulator.js` or the dashboard's backup trigger.

### 18.2 Reference ID Generation

```javascript
function generateReferenceId(agentId) {
  const prefix = agentId.toUpperCase().includes('HVAC') ? 'HVAC' : 'LT';
  const suffix = Math.floor(10000 + Math.random() * 90000);
  return `WO-${prefix}-${suffix}`;
}
```

*(The atomic-counter, collision-proof variant from v2.0 §18.2 remains available as an optional upgrade if the team wants guaranteed uniqueness — not required given the very low collision probability in a PoC's traffic volume.)*

### 18.3 Description Template

```javascript
function buildDescription(payload, result) {
  const { zone, metrics } = payload;
  if (result.faultType === 'CRITICAL_OVERHEATING') {
    return `Ambient temperature spiked to ${metrics.ambient_temp_celsius.toFixed(1)}°C in ${zone} while occupied (threshold: 28°C).`;
  }
  if (result.faultType === 'ILLUMINANCE_DEFICIENCY') {
    return `Work-plane illuminance dropped to ${metrics.work_plane_illuminance_lux} lux in ${zone} while occupied (threshold: 200 lux).`;
  }
  return `Anomaly detected in ${zone}: ${result.faultType}.`;
}
```

---

## 19. Implementation Phases

### Phase 1 — Day 1: Scaffolding & Shared Contract

| Task | Owner |
|---|---|
| Create GitHub repo, feature branches. | Intern A |
| `npm init`; install `express`, `mongoose`, `socket.io`, `dotenv`, `nodemon`. | Intern A |
| Write `constants.js` (`ZONE_IDS`, `FAULT_TYPES`, `THRESHOLDS` — incl. `minSamplesForZScore`, `dedupCooldownMs` **[v2.1]**). | Both |
| `server.js` skeleton with `connectWithRetry()` **[v2.1]**, Express static serving, Socket.io attach. | Intern A |
| `aiEngine.js` skeleton with the per-zone `Map` structure stubbed out **[v2.1]**. | Intern B |
| ngrok test. | Both |

**✅ Go/No-Go:** `npm start` connects to Mongo (showing retry behavior if `mongod` isn't ready yet), serves a blank dashboard via ngrok.

---

### Phase 2 — Day 2: Models + Telemetry Ingestion

| Task | Owner |
|---|---|
| Write `models.js` with dedup fields (`repeatCount`, `lastSeenAt`) **[v2.1]**. | Intern A |
| Implement `handleTelemetry()` and `POST /api/telemetry` (no dedup logic yet). | Intern A |
| Implement the per-zone Rolling Z-Score (§17.1) including `getZoneStats()` **[v2.1]**. | Intern B |
| Unit-test: feed 50 normal readings + 1 spike to **two different zones** independently; confirm each zone's anomaly judgment is unaffected by the other zone's data **[v2.1]**. | Intern B |

**✅ Go/No-Go:** `curl` against two different `zone` values shows independently-tracked statistics via a temporary debug `console.log`.

---

### Phase 3 — Day 3: Fleet Simulator, Dedup, Debug & Backup Endpoints

| Task | Owner |
|---|---|
| `fleetSimulator.js`: multi-zone round-robin loops + structured `log()` **[v2.1]**. | Intern A / Intern B |
| Raw-mode keypress fault injector; test on each intern's actual terminal. | Both |
| Implement dedup/cooldown check inside `handleTelemetry()` **[v2.1]**. | Intern A |
| Implement `POST /api/simulate/fault` and `GET /api/debug/zscore/:zone` **[v2.1]**. | Intern A |
| Wire Socket.io: `new-work-order` and `work-order-repeat` **[v2.1]** emissions. | Intern A |

**✅ Go/No-Go:** Holding **F** down (or repeatedly triggering it) for 20+ seconds produces exactly **one** `WorkOrder` document with an incrementing `repeatCount` — verify via `mongosh`.

---

### Phase 4 — Day 4: Dashboard

| Task | Owner |
|---|---|
| Build `public/index.html` core layout. | Intern B |
| Wire Socket.io client, `new-work-order` and `work-order-repeat` handlers **[v2.1]**. | Intern B |
| Add the "🔥 Inject Fault" backup button **[v2.1]**. | Intern B |
| Add the pulsing-glow CSS + Web Audio beep for High priority, and the "🔊 Enable Sound" toggle **[v2.1]**. | Intern B |
| Floor plan JPEG + zone overlays. | Intern A |

**✅ Go/No-Go:** Clicking the dashboard button alone (no terminal interaction) produces a red, pulsing, audible alert within 2 seconds.

---

### Phase 5 — Day 5: Hardening, Tooling, Demo Prep

| Task | Owner |
|---|---|
| Write `scripts/resetDb.js`, wire `npm run reset-db` **[v2.1]**. | Intern A |
| Structured-logging pass: replace any remaining raw `console.log` with the shared `log()` helper across `server.js` and `fleetSimulator.js` **[v2.1]**. | Both |
| 15-minute stress test: confirm dedup holds, retry logic recovers from a deliberately-delayed `mongod` start, debug endpoint returns sane numbers for all 3 zones. | Both |
| Write `README.md` covering all of the above. | Both |
| Merge feature branches via reviewed PRs. | Both |

---

## 20. Acceptance Criteria & Demo Checklist

### ✅ Criterion 1 — Live Ingestion
Same as v2.0 — both loops pumping data, now visibly round-robining across multiple zones in the console output.

### ✅ Criterion 2 — Dashboard Visuals
Same as v2.0 — floor plan + empty Incident Log, plus the now-visible "Inject Fault" button and "Enable Sound" toggle in the header.

### ✅ Criterion 3 — The Crisis Scenario

**Demo Steps (updated for v2.1):**
1. Press **F** in the simulator terminal **— or, if the terminal's raw-mode keypress isn't behaving, simply click "🔥 Inject Fault" on the dashboard instead.** Both produce identical results since they share `handleTelemetry()`.
2. Within ~2 seconds: the zone overlay turns red, a card prepends to the Incident Log with a pulsing glow and an audible tone (assuming sound was enabled), showing `referenceId`, `faultType`, `description`.
3. Trigger the same fault again within 60 seconds (press **F** again, or click the button again). Point out that **no second card appears** — instead, the existing card's `×N` badge increments, demonstrating dedup/cooldown live.
4. Open `mongosh` and confirm exactly one `WorkOrder` document exists for that incident, with `repeatCount` matching the number of triggers.
5. *(Optional)* `curl localhost:3000/api/debug/zscore/ZONE-A1` live, showing the evaluator the actual μ/σ/sample-count numbers behind the alert.

**Pass condition:** evaluator sees the live alert AND the dedup behavior AND can independently verify both in MongoDB.

### ✅ Stretch Goals

- [ ] **Cross-Zone Isolation Demo:** trigger a fault in ZONE-A1, then show ZONE-B1's `/api/debug/zscore/ZONE-B1` is completely unaffected.
- [ ] **Mongo Resilience Demo:** start `server.js` *before* `mongod`, show the retry log lines, then start `mongod` and watch the backend recover without a restart.
- [ ] **Sensor Drift Demo:** show a gradual ramp evading the hard rule but eventually being caught by the Z-Score model once warmed up.

---

## 21. Technology Stack

| Layer | Tool | Version | Role |
|---|---|---|---|
| Runtime | Node.js | ≥ 18 LTS | Backend + simulator |
| Backend Framework | Express.js | ^4.19 | HTTP server, static serving, REST routes |
| Database | MongoDB Community Edition | 7.x | Telemetry + work order storage |
| ODM | Mongoose | ^8.4 | Schema + queries, incl. dedup lookup index |
| Real-Time Comms | Socket.io | ^4.7 | `new-work-order`, `work-order-repeat` **[v2.1]** |
| Frontend | Vanilla HTML/CSS/JS | — | Dashboard, incl. Web Audio API **[v2.1]** (native, no package) |
| Config | dotenv | ^16.4 | `.env` for `MONGO_URI`/`PORT` |
| Dev Tooling | nodemon | ^3.1 | Auto-restart during development |
| Tunneling | ngrok | 3.x free tier | Public routing to `localhost:3000` |
| Version Control | Git + GitHub | — | Two-branch PR workflow |

> No new npm dependencies were introduced in v2.1 — every addition (retry logic, dedup, debug endpoint, structured logging, reset script, audio/visual escalation) uses only Node's standard library, Mongoose, and native browser APIs.

---

## 22. Risk Register

| Risk ID | Risk | Mitigation | Status |
|---|---|---|---|
| R-01 | `mongod` not running when `server.js` starts | **Resolved [v2.1]** — exponential-backoff retry connect (§14.1) | Resolved |
| R-02 | Node < 18 — `fetch()` undefined | `"engines"` pin in `package.json` | Open (process control) |
| R-03 | ngrok URL changes between sessions | Read `API_URL` from env var, re-test before demo | Open (process control) |
| R-04 | Raw-mode keypress inconsistent across terminals | **Resolved [v2.1]** — dashboard "Inject Fault" button is a fully equivalent, terminal-independent trigger | Resolved |
| R-05 | Z-Score unreliable during first ~40s of warm-up | **Resolved [v2.1]** — `MIN_SAMPLES` guard + hard-rule fallback (§17.1) | Resolved |
| R-06 | `referenceId` collision under naive random suffix | Low likelihood for PoC traffic; atomic-counter variant documented as optional upgrade (§18.2) | Open (low impact) |
| R-07 | Socket.io CORS rejection via ngrok origin | Explicit `cors: { origin: '*' }` config | Open (process control) |
| R-08 | Two `setInterval` loops drift apart over a long session | Cosmetic only | Open (negligible) |
| R-09 | Demo laptop crash/battery loss | Keep plugged in; `scripts/resetDb.js` **[v2.1]** makes it trivial to start clean if a restart is needed | Mitigated |
| R-10 | Merge conflicts in shared `fleetSimulator.js` | Function-boundary ownership split (§6.1) | Open (process control) |
| R-11 *(v2.1, new)* | Global (non-zone-keyed) rolling buffer would let one zone's anomaly skew another zone's baseline | **Resolved [v2.1]** — per-zone `Map`-keyed buffers (§17.1) | Resolved |
| R-12 *(v2.1, new)* | A sustained fault (many anomalous ticks in a row) floods the `WorkOrder` collection with near-duplicate documents | **Resolved [v2.1]** — 60-second dedup/cooldown window, `repeatCount` increment instead of new document (§18.1) | Resolved |
| R-13 *(v2.1, new)* | Browser blocks audio playback until a user gesture occurs (Web Audio autoplay policy) | Explicit "🔊 Enable Sound" toggle button; clicking "Inject Fault" also satisfies the gesture requirement (§15.2) | Mitigated |

---

## 23. Open Questions & Future Enhancements

### 23.1 Open Questions (Resolve Before Phase 1)

| # | Question | Owner | Deadline |
|---|---|---|---|
| OQ-01 | Which laptop hosts MongoDB and `server.js`? | Both | Day 1 |
| OQ-02 | Confirm Node ≥ 18 on both laptops. | Both | Day 1 |
| OQ-03 | Where does `fleetSimulator.js` run — same machine as `server.js`, or the second intern's laptop via ngrok? | Both | Day 2 |
| OQ-04 | Floor plan JPEG source? | Intern B | Day 3 |
| OQ-05 | Naive random-suffix `referenceId`, or the atomic-counter variant? | Both | Day 2 |
| OQ-06 *(v2.1)* | Should `DELETE`-style dedup cooldown be 60s flat, or should it scale with `Z` severity (e.g. shorter cooldown for more extreme spikes)? Recommended: keep flat 60s for PoC simplicity. | Both | Day 3 |

### 23.2 Future Enhancements — Phase II: Advanced ML Upgrade Path

Unchanged from v2.0 — PMV/PPD thermal comfort modeling, multivariate online ML (River/PySAD), dual-consensus ensembles, and Brick Schema semantic ontology all remain documented as an optional, non-required evolution. Because `aiEngine.js` exposes a clean `evaluatePayload(payload)` / `getZoneStats(zone)` interface, swapping its internals for a more advanced model requires zero changes to `server.js`, `models.js`, `fleetSimulator.js`, or the dashboard.

### 23.3 Future Enhancements — Infrastructure & Convenience

- **Docker Compose:** bundle the Node app + MongoDB container.
- **Optional Cloud Sync Toggle:** opt-in MongoDB Atlas free tier via `MONGO_URI`.
- **CMMS Integration:** push work orders to a real asset management system's REST API.
- **Authentication:** minimal login if the dashboard is ever shown beyond the evaluation panel.
- **Severity-scaled dedup cooldown** *(from OQ-06)* — a natural follow-up to the flat 60s window implemented in v2.1.

---

*End of Document*

---

**Version History**

| Version | Date | Changes |
|---|---|---|
| v1.0 | June 15, 2026 | Initial draft (Python/FastAPI/SQLite/MQTT stack) |
| v1.1 | June 15, 2026 | Blueprint alignment: HTTP POST transport, Git workflow, Resourcefulness Rule, exact demo criteria mapping |
| v2.0 | June 17, 2026 | Full stack migration per Master Project Prompt: Node.js + Express + MongoDB/Mongoose + Socket.io + vanilla JS dashboard, Rolling Z-Score engine, unified `fleetSimulator.js` with raw-mode fault injection |
| v2.1 | June 19, 2026 | **Hardening pass** (risk-driven): work-order dedup/cooldown with `repeatCount`; per-zone Z-Score buffers (`Map`-keyed, fixes cross-zone baseline contamination); dashboard backup "Inject Fault" button + `POST /api/simulate/fault`; MongoDB connect retry with exponential backoff; `GET /api/debug/zscore/:zone` live introspection endpoint; structured timestamped console logging across `server.js` and `fleetSimulator.js`; `scripts/resetDb.js` rehearsal-reset utility; audio/visual escalation (CSS pulse + Web Audio tone) on High-priority alerts |
