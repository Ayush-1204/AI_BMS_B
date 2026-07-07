const { FAULT_TYPES, THRESHOLDS } = require('./constants');

const {
  zScoreThreshold: Z_THRESHOLD,
  minSamplesForZScore: MIN_SAMPLES,
  rollingWindowSize: WINDOW_SIZE,
  maxTempOccupiedC: MAX_TEMP,
  minLuxOccupied: MIN_LUX,
} = THRESHOLDS;

// Per-zone rolling windows — prevents cross-zone baseline contamination
const zoneWindows = new Map();

function getWindowsFor(zone) {
  if (!zoneWindows.has(zone)) {
    zoneWindows.set(zone, { temp: [], lux: [] });
  }
  return zoneWindows.get(zone);
}

function pushReading(window, value) {
  window.push(value);
  if (window.length > WINDOW_SIZE) window.shift();
}

function meanOf(arr) {
  if (!arr.length) return 0;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

function stdDevOf(arr, mean) {
  if (!arr.length) return 0;
  const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function zScore(value, window) {
  const mean = meanOf(window);
  const sd = stdDevOf(window, mean);
  if (sd === 0) return 0;
  return (value - mean) / sd;
}

function evaluatePayload(payload) {
  const zone = payload.zone;
  const { temp: tempWindow, lux: luxWindow } = getWindowsFor(zone);
  const {
    ambient_temp_celsius: temp,
    work_plane_illuminance_lux: lux,
    occupancy_detected: occupied,
  } = payload.metrics || {};

  if (typeof temp === 'number') {
    pushReading(tempWindow, temp);
    const hardRuleBroken = temp > MAX_TEMP && occupied === true;

    if (tempWindow.length >= MIN_SAMPLES) {
      const z = zScore(temp, tempWindow);
      if (Math.abs(z) > Z_THRESHOLD || hardRuleBroken) {
        return {
          isAnomaly: true,
          faultType: FAULT_TYPES.HVAC_OVERHEAT,
          priority: 'High',
          zScoreValue: z,
        };
      }
    } else if (hardRuleBroken) {
      return {
        isAnomaly: true,
        faultType: FAULT_TYPES.HVAC_OVERHEAT,
        priority: 'High',
        zScoreValue: null,
      };
    }
  }

  if (typeof lux === 'number') {
    pushReading(luxWindow, lux);
    const hardRuleBroken = lux < MIN_LUX && occupied === true;

    if (luxWindow.length >= MIN_SAMPLES) {
      const z = zScore(lux, luxWindow);
      if (Math.abs(z) > Z_THRESHOLD || hardRuleBroken) {
        return {
          isAnomaly: true,
          faultType: FAULT_TYPES.LIGHTING_DEFICIENT,
          priority: 'Medium',
          zScoreValue: z,
        };
      }
    } else if (hardRuleBroken) {
      return {
        isAnomaly: true,
        faultType: FAULT_TYPES.LIGHTING_DEFICIENT,
        priority: 'Medium',
        zScoreValue: null,
      };
    }
  }

  return false;
}

function getZoneStats(zone) {
  const { temp, lux } = getWindowsFor(zone);
  const tempMean = meanOf(temp);
  const luxMean = meanOf(lux);

  return {
    zone,
    temp: {
      sampleCount: temp.length,
      mean: temp.length ? tempMean : null,
      stdDev: temp.length ? stdDevOf(temp, tempMean) : null,
    },
    lux: {
      sampleCount: lux.length,
      mean: lux.length ? luxMean : null,
      stdDev: lux.length ? stdDevOf(lux, luxMean) : null,
    },
  };
}

module.exports = { evaluatePayload, getZoneStats };
