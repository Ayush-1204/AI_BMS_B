const readline = require('readline');
const { ZONE_IDS } = require('./constants');

const API_URL = process.env.API_URL || 'http://localhost:3000/api/telemetry';

function log(tag, message) {
  console.log(`[${new Date().toISOString()}] [${tag}] ${message}`);
}

function generateHvacPayload(zone, spiked = false) {
  const temp = spiked ? 31.0 : +(21 + Math.random() * 2).toFixed(1);
  return {
    agentId: `HVAC-${zone}`,
    zone,
    metrics: { ambient_temp_celsius: temp, occupancy_detected: true },
  };
}

function generateLightingPayload(zone, spiked = false) {
  const lux = spiked ? 90 : +(400 + Math.random() * 100).toFixed(0);
  return {
    agentId: `LT-${zone}`,
    zone,
    metrics: { work_plane_illuminance_lux: lux, occupancy_detected: true },
  };
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

log('SIMULATOR', `Sending to ${API_URL}`);
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
