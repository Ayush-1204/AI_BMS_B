/**
 * ARBOR AI Engine — Production-Grade Anomaly Detection (v3)
 *
 * 4-Gate Pipeline (+ Gate 2.5 Severe):
 *   Gate 0   — Sensor Sanity        : Physically impossible → SENSOR_INVALID_READING
 *   Gate 1   — Metric Stability     : METRIC-SPECIFIC (see below)
 *     └─ temp → Oscillation → SENSOR_UNSTABLE → SENSOR_FAILURE
 *     └─ lux  → Lighting event → LIGHT_FLICKERING → PARTIAL/COMPLETE_LIGHTING_FAILURE
 *   Gate 2   — Critical  (Tier 1)   : Absolute breach         → Immediate Work Order
 *   Gate 2.5 — Severe    (Tier 1.5) : Severe range breach     → Low-bar Work Order
 *   Gate 3   — Confidence (Tier 2)  : Accumulated evidence    → Work Order if ≥ minConfidenceScore
 *
 * Key invariants:
 *   - Statistics always run on the PREVIOUS window (insert happens AFTER decision).
 *   - Sensor fault paths are fully isolated from building fault paths.
 *   - Lux stability generates LIGHTING SUBSYSTEM faults, not sensor faults.
 *   - All thresholds and weights are read from constants.js — zero magic numbers here.
 */

const {
  FAULT_TYPES,
  SENSOR_FAULT_TYPES,
  SENSOR_SANITY,
  CRITICAL_THRESHOLDS,
  SEVERE_THRESHOLDS,
  THRESHOLDS,
  CONSECUTIVE_REQUIRED,
  CONFIDENCE_WEIGHTS,
} = require('./constants');

// Destructure all config once at module load — no runtime property lookups in hot paths
const {
  zScoreThreshold:            Z_THRESHOLD,
  minSamplesForZScore:        MIN_SAMPLES,
  rollingWindowSize:          WINDOW_SIZE,
  maxTempOccupiedC:           MAX_TEMP,
  minTempOccupiedC:           MIN_TEMP,
  minLuxOccupied:             MIN_LUX,
  minConfidenceScore:         MIN_CONFIDENCE,
  minSevereConfidenceScore:   MIN_SEVERE_CONFIDENCE,
  severeConsecutiveRequired:  SEVERE_CONSECUTIVE,
  persistenceWindowMs:        PERSISTENCE_WINDOW_MS,
  incidentRecoveryDurationMs: INCIDENT_RECOVERY_MS,
  // Temp sensor stability
  stabilityWindowSize:        STABILITY_WINDOW_SIZE,
  unstableFlipsThreshold:     UNSTABLE_FLIPS,
  failureDurationMs:          FAILURE_DURATION_MS,
  minimumFailureEvents:       MIN_FAILURE_EVENTS,
  // Lux lighting stability
  luxStabilityWindowSize:      LUX_STABILITY_WINDOW,
  luxFlickerFlipsThreshold:    LUX_FLICKER_FLIPS,
  luxFlickerMinAmplitude:      LUX_FLICKER_AMP,
  luxInstabilityDurationMs:    LUX_INSTABILITY_DURATION_MS,
  luxInstabilityMinEvents:     LUX_INSTABILITY_MIN_EVENTS,
  luxCompleteFailureThreshold: LUX_COMPLETE_FAIL_THRESHOLD,
} = THRESHOLDS;

const {
  thresholdBase:            W_THRESHOLD_BASE,
  thresholdMaxExtra:        W_THRESHOLD_EXTRA,
  severityScalingExponent:  SEVERITY_EXPONENT,
  zScoreViolation:          W_ZSCORE,
  consecutiveStreak:        W_STREAK,
  temporalPersistence:      W_PERSISTENCE,
} = CONFIDENCE_WEIGHTS;

// ─── Per-Zone State ────────────────────────────────────────────────────────────

const zoneWindows = new Map();

function getWindowsFor(zone) {
  if (!zoneWindows.has(zone)) {
    zoneWindows.set(zone, {
      temp: _createMetricState(),
      lux:  _createMetricState(),
    });
  }
  return zoneWindows.get(zone);
}

function _createMetricState() {
  return {
    // Statistical baseline (previous readings only — current inserted after decision)
    window:          [],

    // Short buffer for oscillation detection (Gate 1)
    recentRaw:       [],

    // Consecutive anomaly tracking
    anomalyStreak:   0,

    // Temporal persistence — when the current anomaly streak began
    firstAnomalyAt:  null,

    // Incident recovery — when this zone last fired a Work Order
    lastAlertAt:     null,

    // Incident recovery — when the zone last fully recovered (streak reset to 0)
    recoveredAt:     null,

    // Temp sensor stability escalation fields
    firstUnstableAt:    null,
    unstableEventCount: 0,

    // Lux lighting stability escalation fields (unused by temp — zero overhead)
    // firstFlickerAt / flickerEventCount track the lighting instability escalation window.
    firstFlickerAt:    null,
    flickerEventCount: 0,
  };
}

// ─── Math Utilities ────────────────────────────────────────────────────────────

function meanOf(arr) {
  if (!arr.length) return 0;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

function stdDevOf(arr, mean) {
  if (arr.length < 2) return 0;
  const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function zScore(value, window) {
  if (window.length < MIN_SAMPLES) return 0;
  const mean = meanOf(window);
  const sd   = stdDevOf(window, mean);
  if (sd === 0) return 0;
  return (value - mean) / sd;
}

/**
 * Clamps a value between min and max (inclusive).
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// ─── Gate 0: Sensor Sanity Check ──────────────────────────────────────────────

function runSanityCheck(value, metricType) {
  const range = SENSOR_SANITY[metricType];
  if (!range) return null;
  if (value < range.min || value > range.max) {
    return {
      isAnomaly:   true,
      faultType:   SENSOR_FAULT_TYPES.INVALID_READING,
      priority:    'Medium',
      zScoreValue: null,
      confidence:  100,
      reason:      `${metricType} value ${value} is outside physical sanity range [${range.min}, ${range.max}]`,
    };
  }
  return null;
}

// ─── Gate 1a: Temp Sensor Stability Check (3-tier escalation) ─────────────────────
//
// Applied exclusively to temperature readings.
// Tier 1 → SENSOR_UNSTABLE  : flips ≥ UNSTABLE_FLIPS in short window
// Tier 2 → SENSOR_FAILURE   : BOTH failureDurationMs AND minimumFailureEvents exceeded

function runTempStabilityCheck(state) {
  const raw = state.recentRaw;
  if (raw.length < STABILITY_WINDOW_SIZE) return null;

  let flips = 0;
  for (let i = 2; i < raw.length; i++) {
    const prevDir = Math.sign(raw[i - 1] - raw[i - 2]);
    const currDir = Math.sign(raw[i]     - raw[i - 1]);
    if (prevDir !== 0 && currDir !== 0 && prevDir !== currDir) flips++;
  }

  if (flips < UNSTABLE_FLIPS) {
    // Sensor stable — clear both escalation counters
    state.firstUnstableAt    = null;
    state.unstableEventCount = 0;
    return null;
  }

  // Sensor is unstable — start or advance the escalation window
  if (!state.firstUnstableAt) state.firstUnstableAt = Date.now();
  state.unstableEventCount++;

  const unstableDuration = Date.now() - state.firstUnstableAt;

  // Escalate to SENSOR_FAILURE only when BOTH conditions are met simultaneously
  if (unstableDuration >= FAILURE_DURATION_MS && state.unstableEventCount >= MIN_FAILURE_EVENTS) {
    return {
      isAnomaly:   true,
      faultType:   SENSOR_FAULT_TYPES.FAILURE,
      priority:    'High',
      zScoreValue: null,
      confidence:  100,
      reason:      `Sensor failure: ${state.unstableEventCount} instability events over ${Math.round(unstableDuration / 1000)}s (${flips} flips in last ${raw.length} readings)`,
    };
  }

  return {
    isAnomaly:   true,
    faultType:   SENSOR_FAULT_TYPES.UNSTABLE,
    priority:    'Medium',
    zScoreValue: null,
    confidence:  100,
    reason:      `Sensor unstable: ${flips} direction reversals in last ${raw.length} readings (event #${state.unstableEventCount}, ${Math.round(unstableDuration / 1000)}s elapsed)`,
  };
}

// ─── Gate 1b: Lux Lighting Stability Check (lighting-event classification) ──────────
//
// Applied exclusively to illuminance (lux) readings.
// Lux measures a LIGHTING SUBSYSTEM, so anomalous lux behaviour should generate
// LIGHTING EVENTS rather than sensor faults.
//
// Rapid lux oscillations with sufficient amplitude = LIGHT_FLICKERING
// Persistent flickering that meets BOTH duration+event thresholds = PARTIAL_LIGHTING_FAILURE
// Sustained near-zero lux = COMPLETE_LIGHTING_FAILURE

function runLuxStabilityCheck(state, currentValue) {
  const raw = state.recentRaw;

  // ── Complete failure: lux at/near zero — fast path before flip analysis ───────
  if (currentValue <= LUX_COMPLETE_FAIL_THRESHOLD) {
    const recentNearZero = raw.filter(v => v <= LUX_COMPLETE_FAIL_THRESHOLD * 3).length;
    if (recentNearZero >= 3) {
      state.firstFlickerAt    = null;
      state.flickerEventCount = 0;
      return {
        isAnomaly:   true,
        faultType:   FAULT_TYPES.COMPLETE_LIGHTING_FAILURE,
        priority:    'High',
        zScoreValue: null,
        confidence:  100,
        reason:      `Complete lighting failure: illuminance at ${currentValue} lux (${recentNearZero} consecutive near-zero readings)`,
      };
    }
    return null;
  }

  // ── Flicker detection: amplitude-gated direction reversal analysis ─────────
  if (raw.length < LUX_STABILITY_WINDOW) return null;

  let qualifiedFlips = 0;
  for (let i = 2; i < raw.length; i++) {
    const prevDir = Math.sign(raw[i - 1] - raw[i - 2]);
    const currDir = Math.sign(raw[i]     - raw[i - 1]);
    const swingAmp = Math.abs(raw[i] - raw[i - 1]);
    if (prevDir !== 0 && currDir !== 0 && prevDir !== currDir && swingAmp >= LUX_FLICKER_AMP) {
      qualifiedFlips++;
    }
  }

  if (qualifiedFlips < LUX_FLICKER_FLIPS) {
    state.firstFlickerAt    = null;
    state.flickerEventCount = 0;
    return null;
  }

  // Flickering detected — start or advance escalation window
  if (!state.firstFlickerAt) state.firstFlickerAt = Date.now();
  state.flickerEventCount++;

  const flickerDuration = Date.now() - state.firstFlickerAt;

  if (flickerDuration >= LUX_INSTABILITY_DURATION_MS && state.flickerEventCount >= LUX_INSTABILITY_MIN_EVENTS) {
    return {
      isAnomaly:   true,
      faultType:   FAULT_TYPES.PARTIAL_LIGHTING_FAILURE,
      priority:    'High',
      zScoreValue: null,
      confidence:  100,
      reason:      `Partial lighting failure: ${state.flickerEventCount} flicker events over ${Math.round(flickerDuration / 1000)}s (${qualifiedFlips} amplitude-qualified flips in window)`,
    };
  }

  return {
    isAnomaly:   true,
    faultType:   FAULT_TYPES.LIGHT_FLICKERING,
    priority:    'Medium',
    zScoreValue: null,
    confidence:  100,
    reason:      `Light flickering: ${qualifiedFlips} amplitude-qualified direction reversals in last ${raw.length} readings (event #${state.flickerEventCount}, ${Math.round(flickerDuration / 1000)}s elapsed)`,
  };
}

// ─── Gate 2: Critical (Tier 1) Check ──────────────────────────────────────────

function runCriticalCheck(value, metricType, occupied) {
  if (!occupied) return null;
  const limits = CRITICAL_THRESHOLDS[metricType];
  if (!limits) return null;

  if (metricType === 'temp') {
    if (value > limits.absoluteMax) {
      return {
        isAnomaly:   true,
        faultType:   FAULT_TYPES.HVAC_OVERHEAT,
        priority:    'High',
        zScoreValue: null,
        confidence:  100,
        reason:      `CRITICAL: Temperature ${value}°C exceeds absolute ceiling ${limits.absoluteMax}°C`,
      };
    }
    if (value < limits.absoluteMin) {
      return {
        isAnomaly:   true,
        faultType:   FAULT_TYPES.HVAC_UNDERHEAT,
        priority:    'High',
        zScoreValue: null,
        confidence:  100,
        reason:      `CRITICAL: Temperature ${value}°C is below absolute floor ${limits.absoluteMin}°C`,
      };
    }
  }

  if (metricType === 'lux' && value < limits.absoluteMin) {
    return {
      isAnomaly:   true,
      faultType:   FAULT_TYPES.LIGHTING_DEFICIENT,
      priority:    'High',
      zScoreValue: null,
      confidence:  100,
      reason:      `CRITICAL: Illuminance ${value} lux is below absolute floor ${limits.absoluteMin} lux`,
    };
  }

  return null;
}

// ─── Gate 2.5: Severe (Tier 1.5) Check ────────────────────────────────────────
// Fully self-contained: does NOT depend on streak/persistence state from Gate 3.
// Fires after a single reading in the severe range meeting the lower confidence bar.
// Alerts significantly faster than standard anomalies.

function runSevereCheck(value, metricType, z, occupied) {
  if (!occupied) return null;
  const severe = SEVERE_THRESHOLDS[metricType];
  if (!severe) return null;

  let inSevereRange = false;
  if (metricType === 'temp') {
    inSevereRange = (severe.severeMax !== undefined && value > severe.severeMax) ||
                    (severe.severeMin !== undefined && value < severe.severeMin);
  } else if (metricType === 'lux') {
    inSevereRange = (severe.severeMin !== undefined && value < severe.severeMin);
  }

  if (!inSevereRange) return null;

  // Score purely from the current reading's severity and z-score.
  // No streak or persistence requirements — this is the fast-alert path.
  const severityScore = _computeSeverityScore(value, metricType);
  const zContrib      = Math.abs(z) > Z_THRESHOLD ? W_ZSCORE : 0;
  const totalScore    = severityScore + zContrib;

  if (totalScore < MIN_SEVERE_CONFIDENCE) return null;

  const { faultType, priority } = _resolveFault(value, metricType);
  return {
    isAnomaly:   true,
    faultType,
    priority,
    zScoreValue: z,
    confidence:  totalScore,
    tier:        'severe',
    reason:      `SEVERE: ${metricType}=${value} in severe range — severity ${severityScore} + z-contrib ${zContrib} = ${totalScore}/100`,
  };
}

// ─── Gate 3: Confidence Model ─────────────────────────────────────────────────

function scoreAnomaly(value, metricType, z, state, occupied) {
  let score = 0;
  const reasons = [];

  // Signal 1 — Severity-scaled threshold violation
  const thresholdBroken = _checkSoftThreshold(value, metricType, occupied);
  if (thresholdBroken) {
    const severityScore = _computeSeverityScore(value, metricType);
    score += severityScore;
    reasons.push(`threshold(severity-scaled:+${severityScore})`);
  }

  // Signal 2 — Z-Score statistical anomaly
  const zViolation = Math.abs(z) > Z_THRESHOLD;
  if (zViolation) {
    score += W_ZSCORE;
    reasons.push(`z-score=${z.toFixed(2)}(+${W_ZSCORE})`);
  }

  const isCurrentlyAnomalous = thresholdBroken || zViolation;

  // Update streak and persistence timer
  if (isCurrentlyAnomalous) {
    state.anomalyStreak++;
    if (!state.firstAnomalyAt) state.firstAnomalyAt = Date.now();
  } else {
    // Reading is normal — full reset of streak state
    if (state.anomalyStreak > 0) {
      state.recoveredAt = Date.now();  // Record recovery time for incident recovery logic
    }
    state.anomalyStreak  = 0;
    state.firstAnomalyAt = null;
    return null; // No evidence — fast exit
  }

  // Signal 3 — Consecutive streak (per-metric threshold)
  const requiredStreak = CONSECUTIVE_REQUIRED[metricType] ?? 3;
  if (state.anomalyStreak >= requiredStreak) {
    score += W_STREAK;
    reasons.push(`streak=${state.anomalyStreak}/${requiredStreak}(+${W_STREAK})`);
  }

  // Signal 4 — Temporal persistence
  const durationMs = state.firstAnomalyAt ? Date.now() - state.firstAnomalyAt : 0;
  if (durationMs >= PERSISTENCE_WINDOW_MS) {
    score += W_PERSISTENCE;
    reasons.push(`persistence=${Math.round(durationMs / 1000)}s(+${W_PERSISTENCE})`);
  }

  if (score < MIN_CONFIDENCE) return null;

  // ── Incident Recovery Check ────────────────────────────────────────────────
  // If the zone recovered recently, this is the SAME incident (let server.js dedup handle it).
  // Only allow a fresh Work Order if recovery gap ≥ INCIDENT_RECOVERY_MS.
  if (state.recoveredAt && state.lastAlertAt) {
    const timeSinceRecovery = Date.now() - state.recoveredAt;
    if (timeSinceRecovery < INCIDENT_RECOVERY_MS) {
      reasons.push('same-incident(suppressed)');
      return null; // Dedup in server.js will handle repeatCount
    }
  }

  const { faultType, priority } = _resolveFault(value, metricType);
  // Record that we're about to generate an alert
  state.lastAlertAt = Date.now();

  return {
    isAnomaly:   true,
    faultType,
    priority,
    zScoreValue: z,
    confidence:  score,
    reason:      reasons.join(', '),
  };
}

// ─── Confidence Helpers ────────────────────────────────────────────────────────

/**
 * Non-linear (power curve) severity score.
 *
 * ratio = how far the value has moved from the soft operational limit
 *         toward the absolute critical ceiling/floor (clamped 0–1).
 *
 * score = thresholdBase + (ratio ^ severityScalingExponent) * thresholdMaxExtra
 *
 * With the default quadratic exponent (2), the curve grows slowly near the soft
 * limit and accelerates sharply as the value approaches critical levels.
 */
function _computeSeverityScore(value, metricType) {
  let ratio = 0;

  if (metricType === 'temp') {
    if (value > MAX_TEMP) {
      const ceiling = CRITICAL_THRESHOLDS.temp.absoluteMax;
      ratio = clamp((value - MAX_TEMP) / (ceiling - MAX_TEMP), 0, 1);
    } else if (value < MIN_TEMP) {
      const floor = CRITICAL_THRESHOLDS.temp.absoluteMin;
      ratio = clamp((MIN_TEMP - value) / (MIN_TEMP - floor), 0, 1);
    }
  } else if (metricType === 'lux') {
    if (value < MIN_LUX) {
      const floor = CRITICAL_THRESHOLDS.lux.absoluteMin;
      ratio = clamp((MIN_LUX - value) / (MIN_LUX - floor), 0, 1);
    }
  }

  // Apply power curve: small exponent → linear; larger exponent → slow start, fast finish
  const curved = Math.pow(ratio, SEVERITY_EXPONENT);
  return Math.round(W_THRESHOLD_BASE + curved * W_THRESHOLD_EXTRA);
}

function _checkSoftThreshold(value, metricType, occupied) {
  if (!occupied) return false;
  if (metricType === 'temp') return value > MAX_TEMP || value < MIN_TEMP;
  if (metricType === 'lux')  return value < MIN_LUX;
  return false;
}

function _resolveFault(value, metricType) {
  if (metricType === 'temp') {
    return value > MAX_TEMP
      ? { faultType: FAULT_TYPES.HVAC_OVERHEAT,  priority: 'High' }
      : { faultType: FAULT_TYPES.HVAC_UNDERHEAT, priority: 'High' };
  }
  if (metricType === 'lux') {
    return { faultType: FAULT_TYPES.LIGHTING_DEFICIENT, priority: 'Medium' };
  }
  return { faultType: FAULT_TYPES.HVAC_OVERHEAT, priority: 'Medium' };
}

// ─── Window Helpers ────────────────────────────────────────────────────────────

function _pushToWindow(arr, value, maxSize) {
  arr.push(value);
  if (arr.length > maxSize) arr.shift();
}

// ─── Core Evaluator ───────────────────────────────────────────────────────────

function _evaluateMetric(value, metricType, state, occupied) {
  // Gate 0 — Sanity (no stats update)
  const sanityFault = runSanityCheck(value, metricType);
  if (sanityFault) return sanityFault;

  // Update short stability buffer
  _pushToWindow(state.recentRaw, value, Math.max(STABILITY_WINDOW_SIZE, LUX_STABILITY_WINDOW));

  // Gate 1 — METRIC-SPECIFIC stability check
  //   temp → sensor oscillation detection (SENSOR_UNSTABLE / SENSOR_FAILURE)
  //   lux  → lighting event classification (LIGHT_FLICKERING / PARTIAL/COMPLETE_LIGHTING_FAILURE)
  const stabilityFault = (metricType === 'lux')
    ? runLuxStabilityCheck(state, value)
    : runTempStabilityCheck(state);
  if (stabilityFault) return stabilityFault;

  // Gate 2 — Critical Tier-1 (stats updated; streak state reset)
  const criticalFault = runCriticalCheck(value, metricType, occupied);
  if (criticalFault) {
    _pushToWindow(state.window, value, WINDOW_SIZE);
    state.anomalyStreak  = 0;
    state.firstAnomalyAt = null;
    state.lastAlertAt    = Date.now();
    return criticalFault;
  }

  // Calculate z-score on PREVIOUS window (before inserting current reading)
  const z = zScore(value, state.window);

  // Gate 2.5 — Severe Tier-1.5: fully self-contained, no streak dependency.
  // Runs directly on the current value and z-score; does NOT touch streak state.
  const severeFault = runSevereCheck(value, metricType, z, occupied);
  if (severeFault) {
    _pushToWindow(state.window, value, WINDOW_SIZE);
    state.lastAlertAt = Date.now();
    return severeFault;
  }

  // Gate 3 — Full Confidence Model
  // Streak and persistence are managed entirely inside scoreAnomaly.
  const result = scoreAnomaly(value, metricType, z, state, occupied);
  _pushToWindow(state.window, value, WINDOW_SIZE); // Insert AFTER decision
  return result;
}

/**
 * Public API — entry point called by server.js.
 * Signature preserved for full backward compatibility.
 */
function evaluatePayload(payload) {
  const zone = payload.zone;
  const { temp: tempState, lux: luxState } = getWindowsFor(zone);
  const {
    ambient_temp_celsius:       temp,
    work_plane_illuminance_lux: lux,
    occupancy_detected:         occupied,
  } = payload.metrics || {};

  if (typeof temp === 'number') {
    const result = _evaluateMetric(temp, 'temp', tempState, occupied === true);
    if (result) return result;
  }

  if (typeof lux === 'number') {
    const result = _evaluateMetric(lux, 'lux', luxState, occupied === true);
    if (result) return result;
  }

  return false;
}

/**
 * Public API — diagnostic endpoint.
 * Extended with new state fields (backward compatible — additive only).
 */
function getZoneStats(zone) {
  const { temp, lux } = getWindowsFor(zone);
  const tempMean = meanOf(temp.window);
  const luxMean  = meanOf(lux.window);

  return {
    zone,
    temp: {
      sampleCount:     temp.window.length,
      mean:            temp.window.length ? tempMean : null,
      stdDev:          temp.window.length ? stdDevOf(temp.window, tempMean) : null,
      anomalyStreak:   temp.anomalyStreak,
      persistingSince: temp.firstAnomalyAt,
      lastAlertAt:     temp.lastAlertAt,
      recoveredAt:     temp.recoveredAt,
    },
    lux: {
      sampleCount:     lux.window.length,
      mean:            lux.window.length ? luxMean : null,
      stdDev:          lux.window.length ? stdDevOf(lux.window, luxMean) : null,
      anomalyStreak:   lux.anomalyStreak,
      persistingSince: lux.firstAnomalyAt,
      lastAlertAt:     lux.lastAlertAt,
      recoveredAt:     lux.recoveredAt,
    },
  };
}

module.exports = { evaluatePayload, getZoneStats };
