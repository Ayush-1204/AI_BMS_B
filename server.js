require('dotenv').config();

const http = require('http');
const express = require('express');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const { THRESHOLDS } = require('./constants');
const { ZONE_IDS, FAULT_TYPES } = require('./constants');
const { Telemetry, WorkOrder } = require('./models');
const { evaluatePayload, getZoneStats } = require('./aiEngine');

const COOLDOWN_MS = THRESHOLDS.dedupCooldownMs;

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/arborBMS';

function log(tag, message) {
  console.log(`[${new Date().toISOString()}] [${tag}] ${message}`);
}

function generateReferenceId(agentId) {
  const prefix = agentId.toUpperCase().includes('HVAC') ? 'HVAC' : 'LT';
  const suffix = Math.floor(10000 + Math.random() * 90000);
  return `WO-${prefix}-${suffix}`;
}

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

const app = express();
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

async function handleTelemetry(payload) {
  await new Telemetry(payload).save();
  log('TELEMETRY', `${payload.agentId} (${payload.zone}) saved`);

  const result = evaluatePayload(payload);
  const stats = getZoneStats(payload.zone);
  log(
    'ZSCORE',
    `${payload.zone} temp: n=${stats.temp.sampleCount} μ=${stats.temp.mean?.toFixed(2) ?? '—'} σ=${stats.temp.stdDev?.toFixed(2) ?? '—'} | lux: n=${stats.lux.sampleCount} μ=${stats.lux.mean?.toFixed(2) ?? '—'} σ=${stats.lux.stdDev?.toFixed(2) ?? '—'}`
  );

  if (!result || !result.isAnomaly) {
    return { anomaly: false };
  }

  const existing = await WorkOrder.findOne({
    zone: payload.zone,
    faultType: result.faultType,
    lastSeenAt: { $gte: new Date(Date.now() - COOLDOWN_MS) },
  }).sort({ lastSeenAt: -1 });

  if (existing) {
    existing.repeatCount += 1;
    existing.lastSeenAt = new Date();
    await existing.save();
    io.emit('work-order-repeat', {
      referenceId: existing.referenceId,
      repeatCount: existing.repeatCount,
    });
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

app.post('/api/simulate/fault', async (req, res) => {
  const { type = 'HVAC_OVERHEAT', zone = 'ZONE-A1' } = req.body;
  const payload =
    type === 'HVAC_OVERHEAT'
      ? {
          agentId: `HVAC-${zone}`,
          zone,
          metrics: { ambient_temp_celsius: 31.0, occupancy_detected: true },
        }
      : {
          agentId: `LT-${zone}`,
          zone,
          metrics: { work_plane_illuminance_lux: 90, occupancy_detected: true },
        };

  try {
    const result = await handleTelemetry(payload);
    res.status(202).json(result);
  } catch (err) {
    log('ERROR', `simulate/fault failed: ${err.message}`);
    res.status(400).json({ error: 'Could not simulate fault' });
  }
});

app.get('/api/contract', (_req, res) => {
  res.json({ ZONE_IDS, FAULT_TYPES, THRESHOLDS });
});

app.get('/api/building', (_req, res) => {
  try {
    const configPath = path.join(__dirname, 'building.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: 'building config not available', message: err.message });
  }
});

app.get('/api/debug/zscore/:zone', (req, res) => {
  res.json(getZoneStats(req.params.zone));
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

io.on('connection', (socket) => {
  log('SOCKET', `Client connected (${socket.id})`);
  socket.on('disconnect', () => {
    log('SOCKET', `Client disconnected (${socket.id})`);
  });
});

async function start() {
  await connectWithRetry(MONGO_URI);
  server.listen(PORT, () => {
    log('SERVER', `ARBOR listening on http://localhost:${PORT}`);
  });
}

start();

module.exports = { app, server, io, handleTelemetry, log };
