require('dotenv').config();

const http = require('http');
const express = require('express');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const {
  THRESHOLDS,
  ZONE_IDS,
  FAULT_TYPES,
  SENSOR_FAULT_TYPES,
  SEVERE_THRESHOLDS,
  CRITICAL_THRESHOLDS,
} = require('./constants');
const { Telemetry, WorkOrder } = require('./models');
const { evaluatePayload, getZoneStats } = require('./aiEngine');

const COOLDOWN_MS = THRESHOLDS.dedupCooldownMs;
const PORT       = process.env.PORT     || 3000;
const MONGO_URI  = process.env.MONGO_URI || 'mongodb://localhost:27017/arborBMS';

// ─── Logging ───────────────────────────────────────────────────────────────────

function log(tag, message) {
  console.log(`[${new Date().toISOString()}] [${tag}] ${message}`);
}

// Structured anomaly log — explains WHY an alert fired.
function logAnomaly(result, zone, incidentType, refId, repeatCount) {
  const tier       = result.tier       ?? (isSensorFault(result.faultType) ? 'sensor' : 'standard');
  const confidence = result.confidence ?? 'N/A';
  const z          = result.zScoreValue != null ? result.zScoreValue.toFixed(2) : '—';
  let line = `zone=${zone} fault=${result.faultType} tier=${tier} confidence=${confidence} z=${z} incident=${incidentType}`;
  if (incidentType === 'EXISTING' && refId) line += ` ref=${refId} repeat=${repeatCount}`;
  log('ANOMALY', line);
}

function isSensorFault(faultType) {
  return Object.values(SENSOR_FAULT_TYPES).includes(faultType);
}

// ─── Reference ID Generation ───────────────────────────────────────────────────

function generateReferenceId(agentId) {
  const prefix = agentId.toUpperCase().includes('HVAC') ? 'HVAC'
    : agentId.toUpperCase().includes('LT') ? 'LT'
    : 'SN'; // sensor faults
  const suffix = Math.floor(10000 + Math.random() * 90000);
  return `WO-${prefix}-${suffix}`;
}

// ─── Human-Readable Description Builder ───────────────────────────────────────
// server.js builds WHAT happened in plain English.
// aiEngine.js already explains WHY (via result.reason).
// We combine both for the most informative description.

function buildDescription(payload, result) {
  const { zone, metrics } = payload;
  const temp = metrics?.ambient_temp_celsius;
  const lux  = metrics?.work_plane_illuminance_lux;
  const conf = result.confidence != null ? ` [confidence: ${result.confidence}/100]` : '';

  // ── Sensor faults ──────────────────────────────────────────────────────────
  if (result.faultType === SENSOR_FAULT_TYPES.INVALID_READING) {
    const val = temp != null ? `${temp}°C` : `${lux} lux`;
    return `SENSOR FAULT in ${zone}: physically impossible reading (${val}) — rejected before anomaly detection.`;
  }
  if (result.faultType === SENSOR_FAULT_TYPES.UNSTABLE) {
    return `SENSOR FAULT in ${zone}: sensor is producing oscillating readings. Maintenance recommended. ${result.reason ?? ''}`.trim();
  }
  if (result.faultType === SENSOR_FAULT_TYPES.FAILURE) {
    return `SENSOR FAILURE in ${zone}: sustained instability confirmed. Sensor requires immediate inspection. ${result.reason ?? ''}`.trim();
  }

  // ── Critical incidents (Gate 2 — Tier 1) ──────────────────────────────────
  if (result.faultType === FAULT_TYPES.HVAC_OVERHEAT && result.tier !== 'severe') {
    return `CRITICAL: Ambient temperature ${temp?.toFixed(1)}°C in ${zone} has breached the absolute ceiling of ${CRITICAL_THRESHOLDS.temp.absoluteMax}°C. Immediate HVAC intervention required.`;
  }
  if (result.faultType === FAULT_TYPES.HVAC_UNDERHEAT && result.tier !== 'severe') {
    return `CRITICAL: Ambient temperature ${temp?.toFixed(1)}°C in ${zone} has fallen below the absolute floor of ${CRITICAL_THRESHOLDS.temp.absoluteMin}°C. Heating system intervention required.`;
  }

  // ── Severe incidents (Gate 2.5 — Tier 1.5) ────────────────────────────────
  if (result.tier === 'severe') {
    if (result.faultType === FAULT_TYPES.HVAC_OVERHEAT) {
      return `SEVERE: Temperature ${temp?.toFixed(1)}°C in ${zone} is in the danger zone (>${SEVERE_THRESHOLDS.temp.severeMax}°C). Escalating without waiting for full confirmation${conf}.`;
    }
    if (result.faultType === FAULT_TYPES.HVAC_UNDERHEAT) {
      return `SEVERE: Temperature ${temp?.toFixed(1)}°C in ${zone} is severely low (<${SEVERE_THRESHOLDS.temp.severeMin}°C)${conf}.`;
    }
    if (result.faultType === FAULT_TYPES.LIGHTING_DEFICIENT) {
      return `SEVERE: Illuminance ${lux} lux in ${zone} is in the danger zone (<${SEVERE_THRESHOLDS.lux.severeMin} lux)${conf}.`;
    }
  }

  // ── Standard anomalies (Gate 3 — Confidence model) ────────────────────────
  if (result.faultType === FAULT_TYPES.HVAC_OVERHEAT) {
    return `ALERT: Temperature ${temp?.toFixed(1)}°C in ${zone} exceeds the operational limit of ${THRESHOLDS.maxTempOccupiedC}°C while occupied${conf}. ${result.reason ?? ''}`.trim();
  }
  if (result.faultType === FAULT_TYPES.HVAC_UNDERHEAT) {
    return `ALERT: Temperature ${temp?.toFixed(1)}°C in ${zone} is below the operational floor of ${THRESHOLDS.minTempOccupiedC}°C while occupied${conf}. ${result.reason ?? ''}`.trim();
  }
  if (result.faultType === FAULT_TYPES.LIGHTING_DEFICIENT) {
    return `ALERT: Work-plane illuminance ${lux} lux in ${zone} is below the occupancy threshold of ${THRESHOLDS.minLuxOccupied} lux${conf}. ${result.reason ?? ''}`.trim();
  }

  // Fallback (should not be reached in practice)
  return `Anomaly detected in ${zone}: ${result.faultType}${conf}. ${result.reason ?? ''}`.trim();
}

// ─── MongoDB Connection ────────────────────────────────────────────────────────

async function connectWithRetry(uri, attempt = 1, maxAttempts = 5) {
  try {
    await mongoose.connect(uri);
    log('MONGO', 'Connected successfully');
  } catch (err) {
    if (attempt >= maxAttempts) {
      log('MONGO', `FATAL — could not connect after ${maxAttempts} attempts. Is mongod running?`);
      process.exit(1);
    }
    const delay = 2000 * Math.pow(2, attempt - 1);
    log('MONGO', `Connection attempt ${attempt} failed (${err.message}), retrying in ${delay}ms...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return connectWithRetry(uri, attempt + 1, maxAttempts);
  }
}

// ─── Express + Socket.io Setup ─────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ─── Core Telemetry Handler ────────────────────────────────────────────────────

async function handleTelemetry(payload) {
  await new Telemetry(payload).save();
  log('TELEMETRY', `${payload.agentId} (${payload.zone}) saved`);

  // aiEngine.js is the single source of truth — server only consumes the result.
  const result = evaluatePayload(payload);

  // Log rolling stats for every reading (diagnostic visibility)
  const stats = getZoneStats(payload.zone);
  log(
    'STATS',
    `${payload.zone} temp: n=${stats.temp.sampleCount} μ=${stats.temp.mean?.toFixed(2) ?? '—'} σ=${stats.temp.stdDev?.toFixed(2) ?? '—'} streak=${stats.temp.anomalyStreak}` +
    ` | lux: n=${stats.lux.sampleCount} μ=${stats.lux.mean?.toFixed(2) ?? '—'} σ=${stats.lux.stdDev?.toFixed(2) ?? '—'} streak=${stats.lux.anomalyStreak}`
  );

  if (!result || !result.isAnomaly) {
    return { anomaly: false };
  }

  // ── Incident management ──────────────────────────────────────────────────
  const existing = await WorkOrder.findOne({
    zone:      payload.zone,
    faultType: result.faultType,
    lastSeenAt: { $gte: new Date(Date.now() - COOLDOWN_MS) },
  }).sort({ lastSeenAt: -1 });

  if (existing) {
    existing.repeatCount += 1;
    existing.lastSeenAt   = new Date();
    await existing.save();

    io.emit('work-order-repeat', {
      referenceId: existing.referenceId,
      repeatCount: existing.repeatCount,
      faultType:   existing.faultType,
      zone:        existing.zone,
      confidence:  result.confidence ?? null,
      tier:        result.tier ?? null,
    });

    logAnomaly(result, payload.zone, 'EXISTING', existing.referenceId, existing.repeatCount);
    return { anomaly: true, workOrder: existing, duplicate: true, incidentType: 'EXISTING' };
  }

  // ── New Work Order ────────────────────────────────────────────────────────
  const workOrder = new WorkOrder({
    referenceId: generateReferenceId(payload.agentId),
    priority:    result.priority,
    faultType:   result.faultType,
    description: buildDescription(payload, result),
    zone:        payload.zone,
    zScore:      result.zScoreValue,
  });
  await workOrder.save();

  io.emit('new-work-order', {
    ...workOrder.toObject(),
    // Engine metadata enrichment sent to dashboard (not persisted in DB)
    confidence:   result.confidence  ?? null,
    tier:         result.tier        ?? null,
    incidentType: 'NEW',
  });

  logAnomaly(result, payload.zone, 'NEW');
  return { anomaly: true, workOrder, duplicate: false, incidentType: 'NEW' };
}

// ─── API Routes ────────────────────────────────────────────────────────────────

app.post('/api/telemetry', async (req, res) => {
  try {
    const result = await handleTelemetry(req.body);
    res.status(202).json(result);
  } catch (err) {
    log('ERROR', `telemetry ingestion failed: ${err.message}`);
    res.status(400).json({ error: 'Invalid payload' });
  }
});

app.post('/api/simulate/fault', async (req, res) => {
  const { type = 'HVAC_OVERHEAT', zone = 'ZONE-A1' } = req.body;
  const payload =
    type === 'HVAC_OVERHEAT'
      ? { agentId: `HVAC-${zone}`, zone, metrics: { ambient_temp_celsius: 31.0, occupancy_detected: true } }
      : { agentId: `LT-${zone}`,   zone, metrics: { work_plane_illuminance_lux: 90, occupancy_detected: true } };

  try {
    const result = await handleTelemetry(payload);
    res.status(202).json(result);
  } catch (err) {
    log('ERROR', `simulate/fault failed: ${err.message}`);
    res.status(400).json({ error: 'Could not simulate fault' });
  }
});

// Contract endpoint — exposes all constants the dashboard needs
app.get('/api/contract', (_req, res) => {
  res.json({ ZONE_IDS, FAULT_TYPES, SENSOR_FAULT_TYPES, THRESHOLDS });
});

// Building layout config
app.get('/api/building', (_req, res) => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'building.json'), 'utf8');
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: 'building config not available', message: err.message });
  }
});

// Zone diagnostics — full engine stats + computed summary
app.get('/api/debug/zscore/:zone', (req, res) => {
  const stats = getZoneStats(req.params.zone);

  // Computed summary derived entirely from engine-provided stats — no AI logic here
  const maxStreak          = Math.max(stats.temp.anomalyStreak ?? 0, stats.lux.anomalyStreak ?? 0);
  const hasPersistingAnomaly = !!(stats.temp.persistingSince || stats.lux.persistingSince);

  res.json({
    ...stats,
    summary: {
      hasActiveAnomalyStreak: maxStreak > 0,
      maxStreak,
      hasPersistingAnomaly,
      lastTempAlert:  stats.temp.lastAlertAt  ?? null,
      lastLuxAlert:   stats.lux.lastAlertAt   ?? null,
      tempRecoveredAt: stats.temp.recoveredAt ?? null,
      luxRecoveredAt:  stats.lux.recoveredAt  ?? null,
    },
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    mongo:  mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  log('SOCKET', `Client connected (${socket.id})`);
  socket.on('disconnect', () => log('SOCKET', `Client disconnected (${socket.id})`));
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function start() {
  await connectWithRetry(MONGO_URI);
  server.listen(PORT, () => log('SERVER', `ARBOR listening on http://localhost:${PORT}`));
}

start();

module.exports = { app, server, io, handleTelemetry, log };
