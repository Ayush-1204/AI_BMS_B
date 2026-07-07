/**
 * Phase 2 unit test — per-zone Z-Score isolation.
 * Feeds 50 normal readings + 1 spike to two zones independently.
 *
 * Run: npm run test:zscore
 */

const { evaluatePayload, getZoneStats } = require('../aiEngine');

function normalTempPayload(zone, temp) {
  return {
    agentId: `HVAC-${zone}`,
    zone,
    metrics: { ambient_temp_celsius: temp, occupancy_detected: true },
  };
}

function run() {
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.error(`  ✗ ${message}`);
      failed++;
    }
  }

  console.log('\n[TEST] Zone A — warm up with 50 normal readings (~22°C)\n');
  for (let i = 0; i < 50; i++) {
    evaluatePayload(normalTempPayload('ZONE-A1', 22));
  }

  console.log('[TEST] Zone B — warm up with 50 normal readings (~22°C)\n');
  for (let i = 0; i < 50; i++) {
    evaluatePayload(normalTempPayload('ZONE-B1', 22));
  }

  const statsA = getZoneStats('ZONE-A1');
  const statsB = getZoneStats('ZONE-B1');

  assert(statsA.temp.sampleCount === 50, 'ZONE-A1 has 50 temp samples');
  assert(statsB.temp.sampleCount === 50, 'ZONE-B1 has 50 temp samples');
  assert(Math.abs(statsA.temp.mean - 22) < 0.01, 'ZONE-A1 mean ≈ 22');
  assert(Math.abs(statsB.temp.mean - 22) < 0.01, 'ZONE-B1 mean ≈ 22');

  console.log('\n[TEST] Spike ZONE-A1 only (31°C)\n');
  const spikeResult = evaluatePayload(normalTempPayload('ZONE-A1', 31));
  assert(spikeResult.isAnomaly === true, 'ZONE-A1 spike flagged as anomaly');
  assert(spikeResult.faultType === 'CRITICAL_OVERHEATING', 'ZONE-A1 fault type is CRITICAL_OVERHEATING');

  console.log('\n[TEST] Normal reading on ZONE-B1 should NOT be affected\n');
  const normalB = evaluatePayload(normalTempPayload('ZONE-B1', 22));
  assert(normalB === false, 'ZONE-B1 normal reading is not an anomaly');

  const statsBAfter = getZoneStats('ZONE-B1');
  assert(Math.abs(statsBAfter.temp.mean - 22) < 0.01, 'ZONE-B1 mean still ≈ 22 after ZONE-A1 spike');

  console.log(`\n[TEST] Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
