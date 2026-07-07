/**
 * Phase 3 integration test — work-order dedup/cooldown.
 * Repeated faults within 60s should produce one WorkOrder with incrementing repeatCount.
 *
 * Run: npm run test:dedup  (requires MongoDB + server running, or uses in-process server)
 */

require('dotenv').config();

const mongoose = require('mongoose');
const { WorkOrder } = require('../models');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/arborBMS';

async function simulateFault(n) {
  const res = await fetch(`${BASE}/api/simulate/fault`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'HVAC_OVERHEAT', zone: 'ZONE-A1' }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function run() {
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

  await mongoose.connect(MONGO_URI);
  await WorkOrder.deleteMany({ zone: 'ZONE-A1', faultType: 'CRITICAL_OVERHEATING' });

  console.log('\n[TEST] Fire 5 HVAC overheat faults in quick succession\n');

  let firstRefId = null;
  for (let i = 0; i < 5; i++) {
    const { status, body } = await simulateFault(i);
    assert(status === 202, `Request ${i + 1} returned 202`);
    assert(body.anomaly === true, `Request ${i + 1} flagged anomaly`);
    if (i === 0) {
      assert(body.duplicate === false, 'First fault creates new work order');
      firstRefId = body.workOrder.referenceId;
    } else {
      assert(body.duplicate === true, `Request ${i + 1} suppressed as duplicate`);
      assert(body.workOrder.referenceId === firstRefId, `Request ${i + 1} reuses same referenceId`);
    }
  }

  const docs = await WorkOrder.find({
    zone: 'ZONE-A1',
    faultType: 'CRITICAL_OVERHEATING',
  });
  assert(docs.length === 1, 'Exactly one WorkOrder document in MongoDB');
  assert(docs[0].repeatCount === 5, `repeatCount is 5 (got ${docs[0].repeatCount})`);
  assert(docs[0].referenceId === firstRefId, 'referenceId matches first fault');

  console.log(`\n[TEST] Results: ${passed} passed, ${failed} failed\n`);

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('[TEST] Failed — is the server running? (`npm start`)', err.message);
  process.exit(1);
});
