// Shared contract constants — commit before feature work branches diverge.

const ZONE_IDS = ['ZONE-A1', 'ZONE-A2', 'ZONE-A3', 'ZONE-A4', 'ZONE-A5', 'ZONE-A6', 'ZONE-B1', 'ZONE-B2', 'ZONE-B3', 'ZONE-B4', 'ZONE-B5', 'ZONE-B6', 'ZONE-C1', 'ZONE-C2', 'ZONE-C3', 'ZONE-C4', 'ZONE-C5', 'ZONE-C6', 'ZONE-D1', 'ZONE-D2', 'ZONE-D3', 'ZONE-D4'];

const FAULT_TYPES = {
  HVAC_OVERHEAT: 'CRITICAL_OVERHEATING',
  HVAC_UNDERHEAT: 'CRITICAL_UNDERCOOLING',
  LIGHTING_DEFICIENT: 'ILLUMINANCE_DEFICIENCY',
  LIGHTING_EXCESS: 'ILLUMINANCE_EXCESS',
};

const THRESHOLDS = {
  maxTempOccupiedC: 28,
  minTempOccupiedC: 17.5,
  minLuxOccupied: 200,
  zScoreThreshold: 3,
  minSamplesForZScore: 10,
  dedupCooldownMs: 60000,
  rollingWindowSize: 50,
};

module.exports = { ZONE_IDS, FAULT_TYPES, THRESHOLDS };
