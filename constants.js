// Shared contract constants — single source of truth for all engine configuration.

const ZONE_IDS = ['ZONE-A1', 'ZONE-A2', 'ZONE-A3', 'ZONE-A4', 'ZONE-A5', 'ZONE-A6', 'ZONE-B1', 'ZONE-B2', 'ZONE-B3', 'ZONE-B4', 'ZONE-B5', 'ZONE-B6', 'ZONE-C1', 'ZONE-C2', 'ZONE-C3', 'ZONE-C4', 'ZONE-C5', 'ZONE-C6', 'ZONE-D1', 'ZONE-D2', 'ZONE-D3', 'ZONE-D4'];

// ─── Building Fault Types ──────────────────────────────────────────────────────
const FAULT_TYPES = {
  HVAC_OVERHEAT:      'CRITICAL_OVERHEATING',
  HVAC_UNDERHEAT:     'CRITICAL_UNDERCOOLING',
  LIGHTING_DEFICIENT: 'ILLUMINANCE_DEFICIENCY',
  LIGHTING_EXCESS:    'ILLUMINANCE_EXCESS',
};

// ─── Sensor Fault Types (3-tier, fully isolated from building faults) ──────────
// Level 1 → INVALID_READING  : single physically impossible value
// Level 2 → UNSTABLE         : repeated direction reversals in short window
// Level 3 → FAILURE          : BOTH failureDurationMs AND minimumFailureEvents exceeded
const SENSOR_FAULT_TYPES = {
  INVALID_READING: 'SENSOR_INVALID_READING',
  UNSTABLE:        'SENSOR_UNSTABLE',
  FAILURE:         'SENSOR_FAILURE',
};

// ─── Gate 0: Sensor Sanity Ranges ─────────────────────────────────────────────
// Values outside these are physically impossible — never reach anomaly detection.
const SENSOR_SANITY = {
  temp: { min: -50,  max: 100    },
  lux:  { min: 0,    max: 100000 },
};

// ─── Gate 2: Critical (Tier 1) Thresholds ─────────────────────────────────────
// Breaching these triggers an immediate Work Order with no confidence scoring.
const CRITICAL_THRESHOLDS = {
  temp: { absoluteMax: 55, absoluteMin: 0 },
  lux:  { absoluteMin: 10 },
};

// ─── Gate 2.5: Severe (Tier 1.5) Thresholds ──────────────────────────────────
// Values in the severe band bypass the full confidence bar and alert faster.
// Severe range sits between the soft operational limit and the critical ceiling.
const SEVERE_THRESHOLDS = {
  temp: { severeMax: 50, severeMin: 5 },   // e.g. 50°C < x < 55°C is severe
  lux:  { severeMin: 50 },                  // lux < 50 but > absoluteMin is severe
};

// ─── Gate 3: Standard Anomaly / Confidence Configuration ─────────────────────
const THRESHOLDS = {
  // Soft operational limits (Tier 2 threshold-violation signal)
  maxTempOccupiedC:    28,
  minTempOccupiedC:    17.5,
  minLuxOccupied:      200,

  // Statistical anomaly detection
  zScoreThreshold:     3,
  minSamplesForZScore: 10,
  rollingWindowSize:   50,

  // Work Order deduplication window
  dedupCooldownMs:     60000,

  // ── Confidence model ──────────────────────────────────────────────────────
  // Minimum accumulated score to generate a standard Work Order (0-100)
  minConfidenceScore:        60,
  // Minimum accumulated score for a severe (Tier-1.5) Work Order
  minSevereConfidenceScore:  30,
  // Consecutive readings required in severe path before scoring threshold matters
  severeConsecutiveRequired: 1,

  // Duration (ms) an anomaly must persist to earn the persistence bonus
  persistenceWindowMs: 60000,

  // ── Incident recovery ─────────────────────────────────────────────────────
  // Gap of normal readings below this = same incident (dedup + repeatCount)
  // Gap ≥ this = genuinely new incident (fresh Work Order allowed)
  incidentRecoveryDurationMs: 1800000,  // 30 minutes

  // ── Sensor stability / failure escalation ─────────────────────────────────
  // Short rolling buffer size used for oscillation detection
  stabilityWindowSize:    6,
  // Direction reversals in short window to flag SENSOR_UNSTABLE
  unstableFlipsThreshold: 3,
  // BOTH conditions must be true to escalate to SENSOR_FAILURE.
  // Duration (ms) of continuous instability
  failureDurationMs:      120000,  // 2 minutes
  // AND minimum number of distinct instability events over that duration
  minimumFailureEvents:   10,
};

// ─── Per-Metric Consecutive Anomaly Requirements ──────────────────────────────
// Number of consecutive anomalous readings needed to earn the streak bonus.
// Add new metric keys here when extending the engine to new sensor types.
const CONSECUTIVE_REQUIRED = {
  temp: 3,
  lux:  5,
};

// ─── Confidence Score Weights ─────────────────────────────────────────────────
// Threshold score uses non-linear (power curve) scaling:
//   ratio = clamp((value - softLimit) / (criticalLimit - softLimit), 0, 1)
//   score = thresholdBase + (ratio ^ severityScalingExponent) * thresholdMaxExtra
//
// With exponent = 2 (quadratic):
//   at soft threshold (ratio=0.00): score = 20  (slow start)  e.g. 29°C
//   at ratio 0.25                : score = 23                 e.g. ~35°C
//   at ratio 0.50                : score = 30                 e.g. ~42°C
//   at ratio 0.85                : score = 49                 e.g. ~51°C
//   at Tier-1 ceiling (ratio=1.0): score = 60  (fast end)     e.g. 55°C
const CONFIDENCE_WEIGHTS = {
  thresholdBase:            20,
  thresholdMaxExtra:        40,
  // Exponent for the power curve: 1=linear, 2=quadratic, 3=cubic
  // Higher values = slower increase near soft limit, much faster near critical ceiling
  severityScalingExponent:  2,
  zScoreViolation:          30,
  consecutiveStreak:        20,
  temporalPersistence:      20,
};

module.exports = {
  ZONE_IDS,
  FAULT_TYPES,
  SENSOR_FAULT_TYPES,
  SENSOR_SANITY,
  CRITICAL_THRESHOLDS,
  SEVERE_THRESHOLDS,
  THRESHOLDS,
  CONSECUTIVE_REQUIRED,
  CONFIDENCE_WEIGHTS,
};
