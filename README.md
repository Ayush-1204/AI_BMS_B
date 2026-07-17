# ARBOR — AI Smart Building Gateway 🏢🚀

**ARBOR** is a state-of-the-art, edge-native Building Management System (BMS) Proof-of-Concept. It is built to demonstrate how a local-first, zero-cloud architecture can monitor building telemetry (HVAC and Lighting), execute sophisticated anomaly detection algorithms, and dispatch actionable automated Work Orders—strictly mirroring the operations of a professional Network Operations Center (NOC).

![ARBOR Platform](public/favicon.ico) *A fully self-contained smart building gateway.*

---

## 🌟 What makes ARBOR unique?

1. **Edge-Native:** ARBOR does not depend on cloud providers. It runs locally, keeping telemetry securely on-premises.
2. **Incident-Centric UI:** Rather than a chaotic log of numbers, ARBOR squashes duplicates and tracks live incidents. If an HVAC unit overheats 50 times, ARBOR creates exactly **one** persistently updating Work Order.
3. **Multi-Agent Simulation:** The repository comes shipped with its own physical simulator. Dedicated Agents emulate thermal and photometric dynamics dynamically directly in the browser to validate backend performance in real-time.
4. **Deterministic Anomaly Pipeline:** Outliers are strictly graded by an AI Engine utilizing sliding standard deviations (Z-Scores) layered beneath absolute ceiling thresholds, filtering out sensor jitter natively.

---

## 🛠 Tech Stack

ARBOR is built purely on robust, unopinionated technologies without heavy UI framework bloat:

- **Backend / Routing:** Node.js, Express.js
- **Database / Persistence:** MongoDB (via Mongoose)
- **Real-Time Pub/Sub:** Socket.io
- **Frontend Core:** Vanilla HTML/CSS/JavaScript
- **Visualization:** Native HTML5 `<canvas>` (ensuring 0-lag hardware-accelerated rendering)

---

## ⚙️ Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/en/) (v18 or higher)
- [MongoDB](https://www.mongodb.com/) (running locally on port `27017` or via a valid connection URI)

### Installation & Launch

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Ayush-1204/AI_BMS_B.git
   cd AI_BMS_B
   ```

2. **Install all dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment:**
   *(Optional)* Duplicate `.env.example` as `.env` and fill in your variables. By default, it connects to `mongodb://localhost:27017/arborBMS`.

4. **Start the Engine:**
   ```bash
   node server.js
   ```

5. **Open the Dashboard:**
   Click here to view your Edge node: [http://localhost:3000](http://localhost:3000)

---

## 🏗 System Architecture & Component Mapping

The system is highly decoupled to separate concerns efficiently:

```text
AI_BMS_B/
├── server.js              # 🔗 Express API & Socket server initialization
├── aiEngine.js            # 🧠 Anomaly Logic (Z-Scores, Tier filtering)
├── constants.js           # ⚙️ Single Source of Truth (zones, thresholds)
├── models.js              # 💾 MongoDB Schemas (Telemetry, WorkOrder)
├── building.json          # 🗺️ Spatial layout configurations
│
└── public/                # 🖥️ Frontend Gateway Assets
    ├── index.html         # Shell template
    ├── css/
    │   └── styles.css     # CSS Variables, Grids, and Glassmorphism 
    └── js/
        ├── app.js         # UI Orchestrator, Sockets, layout plotting
        └── simulation.js  # Telemetry Generation & Component physics
```

---

## 🧠 The AI Engine (`aiEngine.js`)
Instead of just logging endless sensor values, the backend runs a multi-gated anomaly engine:

- **Gate 1 (Stability):** Analyzes mathematically whether a sensor is oscillating unreliably to cleanly intercept and flag broken physical sensors before they taint the data pipeline.
- **Gate 2 (Critical Bounds):** Intercepts severe outliers (e.g., freezing temperatures or critical overheating) for instant Tier-1 dispatch without requiring sufficient historical averages.
- **Gate 3 (Z-Score Confidence Model):** Contextually grades deviations against recent rolling windows (sliding averages) to provide calculated "Confidence Scores" for subtle anomalies.

### Telemetry Flow
1. `simulation.js` generates a data tick for `ZONE-A1`.
2. The browser POSTs the payload to `/api/telemetry` via HTTP.
3. Express passes the payload to `aiEngine.js`.
4. If an anomaly is detected, `server.js` deduplicates it against MongoDB records spanning the last few minutes.
5. `server.js` emits either a `new-work-order` or `work-order-repeat` to the dashboard via `Socket.io`.
6. `app.js` processes the emission and seamlessly updates the UI without unmounting or exploding the DOM.

---

## 📡 Core API Capabilities

ARBOR natively exposes raw analytical vectors via ReST routes. Use these to interface with external systems.

| Method | Route | Description |
|--------|-------|-------------|
| **POST** | `/api/telemetry` | Ingests external physical sensor data. |
| **GET** | `/api/building` | Acquires topological blueprints defining the facility. |
| **POST** | `/api/simulate/fault` | Triggers synthetic targeted dispatch anomalies. |
| **GET** | `/api/debug/zscore/:zone` | Diagnostic lookup fetching pure statistical engine metrics. |
| **GET** | `/api/contract` | Retrieves all standard zone definitions and system thresholds. |

---

## 👾 Testing The Engine

Want to verify ARBOR operates as intended? Forcefully break a zone:

1. Bring the server online (`node server.js`)
2. Open the UI at `localhost:3000`
3. Click **"▶ Run Simulation"** inside the left control panel to establish baseline standard deviations.
4. Open your terminal or a tool like Postman and forcefully push an anomaly directly into the backend route:
```bash
# Push an ambient heat anomaly into Conference Room A1
curl -X POST http://localhost:3000/api/simulate/fault \
  -H "Content-Type: application/json" \
  -d '{"type":"HVAC_OVERHEAT","zone":"ZONE-A1"}'
```
5. Check the dashboard. ARBOR will intercept the stream, validate the outlier, create a `#WO-HVAC-XXXX` ID, push it to MongoDB, and pulse a `CRITICAL` panel directly onto the Incident Log.

---

## 🤝 Contributing & Modification
Because ARBOR has zero-framework debt (no React/Vue pipelines entirely isolated to `public`), you can directly modify:
- **`constants.js`**: Easily tweak system-wide thresholds and target zone layouts.
- **`public/js/app.js`**: Edit Canvas visualization behaviors.
- **`public/css/styles.css`**: Radically alter the `glassmorphism` aesthetic just by altering root variables.
