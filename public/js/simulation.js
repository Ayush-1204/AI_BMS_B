// ═══════════════════════════════════════════════════════════════════════════
    // STATE-DRIVEN SIMULATION ENGINE
    // ═══════════════════════════════════════════════════════════════════════════

    // ── Zone personality profiles ─────────────────────────────────────────────
    const PERSONALITIES = {
      conference: { normalTemp: 22.0, normalLux: 480, p_warm: 0.00008, p_cool: 0.00002, p_lux_drop: 0.00006, label: 'Conference' },
      lobby:      { normalTemp: 21.0, normalLux: 380, p_warm: 0.00002, p_cool: 0.00001, p_lux_drop: 0.00002, label: 'Lobby' },
      storage:    { normalTemp: 18.5, normalLux: 120, p_warm: 0.00001, p_cool: 0.00003, p_lux_drop: 0.0003,  label: 'Storage' },
      server:     { normalTemp: 25.5, normalLux: 210, p_warm: 0.00015, p_cool: 0.00001, p_lux_drop: 0.00002, label: 'Server Room' },
      office:     { normalTemp: 22.0, normalLux: 430, p_warm: 0.00004, p_cool: 0.00002, p_lux_drop: 0.00004, label: 'Office' },
      lab:        { normalTemp: 23.0, normalLux: 500, p_warm: 0.00005, p_cool: 0.00002, p_lux_drop: 0.00016, label: 'Lab' },
      executive:  { normalTemp: 21.5, normalLux: 350, p_warm: 0.00002, p_cool: 0.00001, p_lux_drop: 0.00001, label: 'Executive' },
    };

    function resolvePersonality(zoneId) {
      const id = zoneId.toUpperCase();
      if (id === 'ZONE-A3' || id === 'ZONE-D1')                              return PERSONALITIES.lobby;
      if (id === 'ZONE-A4' || id === 'ZONE-A5' || id === 'ZONE-B4' || id === 'ZONE-B5') return PERSONALITIES.storage;
      if (id === 'ZONE-A6' || id === 'ZONE-C3' || id === 'ZONE-C4')         return PERSONALITIES.server;
      if (id === 'ZONE-A1' || id === 'ZONE-A2' || id === 'ZONE-B1' || id === 'ZONE-B2') return PERSONALITIES.conference;
      if (id === 'ZONE-C5' || id === 'ZONE-C6')                             return PERSONALITIES.lab;
      if (id === 'ZONE-D2' || id === 'ZONE-D3' || id === 'ZONE-D4')         return PERSONALITIES.executive;
      return PERSONALITIES.office;
    }

    // ── State machine constants ───────────────────────────────────────────────
    const HVAC_STATES = {
      NORMAL:           'NORMAL',
      WARMING:          'WARMING',
      COOLING:          'COOLING',
      THRESHOLD_BREACH: 'THRESHOLD_BREACH',
      SEVERE:           'SEVERE',
      CRITICAL:         'CRITICAL',
      RECOVERING:       'RECOVERING',
    };

    const LT_STATES = {
      NORMAL:           'NORMAL',
      LIGHT_DROP:       'LIGHT_DROP',
      THRESHOLD_BREACH: 'THRESHOLD_BREACH',
      RECOVERING:       'RECOVERING',
    };

    const HVAC_DEF = {
      NORMAL:           { tStep: 0.12, maxTicks: Infinity },
      WARMING:          { tStep: 0.40, maxTicks: null },
      COOLING:          { tStep: 0.40, maxTicks: null },
      THRESHOLD_BREACH: { tStep: 0.45, maxTicks: [28, 55] },
      SEVERE:           { tStep: 0.50, maxTicks: [18, 35] },
      CRITICAL:         { tStep: 0.40, maxTicks: [8,  18] },
      RECOVERING:       { tStep: 0.80, maxTicks: null },
    };

    const LT_DEF = {
      NORMAL:           { lStep: 4,  maxTicks: Infinity },
      LIGHT_DROP:       { lStep: 15, maxTicks: null },
      THRESHOLD_BREACH: { lStep: 8,  maxTicks: [20, 50] },
      RECOVERING:       { lStep: 12, maxTicks: null },
    };

    function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

    // ── Initialise zone state ─────────────────────────────────────────────────
    function initZoneSimState(zoneId) {
      const p = resolvePersonality(zoneId);
      const jitterT = (Math.random() - 0.5) * 1.2;
      const jitterL = (Math.random() - 0.5) * 30;
      
      hvacSimStates.set(zoneId, {
        personality: p,
        simState:    HVAC_STATES.NORMAL,
        ticksLeft:   Infinity,
        temp:        p.normalTemp + jitterT,
        heatingUp:   true,
      });

      ltSimStates.set(zoneId, {
        personality: p,
        simState:    LT_STATES.NORMAL,
        ticksLeft:   Infinity,
        lux:         p.normalLux + jitterL,
      });

      zoneTempBufs.set(zoneId, []);
      zoneLuxBufs.set(zoneId,  []);
    }

    // ── 1. HVAC Agent Logic ──────────────────────────────────────────────────
    function targetTemp(state, p, heatingUp) {
      switch (state) {
        case HVAC_STATES.NORMAL:           return p.normalTemp;
        case HVAC_STATES.WARMING:          return T.tempSoftMax + 3;
        case HVAC_STATES.COOLING:          return T.tempSoftMin - 3;
        case HVAC_STATES.THRESHOLD_BREACH: return heatingUp ? T.tempSoftMax + 6 : T.tempSoftMin - 5;
        case HVAC_STATES.SEVERE:           return heatingUp ? T.tempSevereMax + 1 : T.tempSevereMin - 1;
        case HVAC_STATES.CRITICAL:         return heatingUp ? T.tempCritMax - 0.8 : T.tempCritMin + 0.8;
        case HVAC_STATES.RECOVERING:       return p.normalTemp;
        default:                           return p.normalTemp;
      }
    }

    function enterHvacState(s, newState, heatingUp = true) {
      s.simState  = newState;
      s.heatingUp = heatingUp;
      const def = HVAC_DEF[newState];
      if (Array.isArray(def.maxTicks)) s.ticksLeft = randInt(def.maxTicks[0], def.maxTicks[1]);
      else s.ticksLeft = def.maxTicks === null ? null : Infinity;
    }

    function tickHvacZone(zoneId) {
      const s = hvacSimStates.get(zoneId);
      if (!s) return null;

      const p   = s.personality;
      const def = HVAC_DEF[s.simState];

      // Targets and movement
      const tTarget = targetTemp(s.simState, p, s.heatingUp);
      const tDiff   = tTarget - s.temp;

      if (Math.abs(tDiff) <= def.tStep) {
        // We are at target. Vibrate slowly to bypass artificial high-frequency instability detection.
        if (Math.random() < 0.1) s.temp += (Math.random() > 0.5 ? 0.05 : -0.05);
      } else {
        const tDir    = Math.sign(tDiff);
        const tNoise  = (Math.random() - 0.5) * 0.08;
        const tMove   = clamp(tDir * def.tStep + tNoise, -def.tStep * 1.3, def.tStep * 1.3);
        s.temp       += tMove;

        // Perfect clamp at target to prevent mathematical rubber-banding
        if (tDir > 0) s.temp = Math.min(s.temp, tTarget);
        if (tDir < 0) s.temp = Math.max(s.temp, tTarget);
      }
      
      s.temp = clamp(s.temp, -10, 90);

      // State Transitions
      switch (s.simState) {
        case HVAC_STATES.NORMAL:
          const r = Math.random();
          if (r < 0.000002) { enterHvacState(s, HVAC_STATES.CRITICAL, true); }
          else if (r < 0.00002) { enterHvacState(s, HVAC_STATES.SEVERE, true); }
          else if (r < 0.00005) { enterHvacState(s, HVAC_STATES.THRESHOLD_BREACH, true); }
          else if (r < 0.00005 + p.p_warm) { enterHvacState(s, HVAC_STATES.WARMING, true); }
          else if (r < 0.00005 + p.p_warm + p.p_cool) { enterHvacState(s, HVAC_STATES.COOLING, false); }
          break;
        case HVAC_STATES.WARMING:
          if (s.temp >= T.tempSoftMax) enterHvacState(s, HVAC_STATES.THRESHOLD_BREACH, true);
          break;
        case HVAC_STATES.COOLING:
          if (s.temp <= T.tempSoftMin) enterHvacState(s, HVAC_STATES.THRESHOLD_BREACH, false);
          break;
        case HVAC_STATES.THRESHOLD_BREACH:
          s.ticksLeft--;
          if (s.ticksLeft <= 0) {
            if (Math.random() < 0.15) enterHvacState(s, HVAC_STATES.SEVERE, s.heatingUp);
            else enterHvacState(s, HVAC_STATES.RECOVERING);
          }
          break;
        case HVAC_STATES.SEVERE:
          s.ticksLeft--;
          if (s.ticksLeft <= 0) {
            if (Math.random() < 0.1) enterHvacState(s, HVAC_STATES.CRITICAL, s.heatingUp);
            else enterHvacState(s, HVAC_STATES.RECOVERING);
          }
          break;
        case HVAC_STATES.CRITICAL:
          s.ticksLeft--;
          if (s.ticksLeft <= 0) enterHvacState(s, HVAC_STATES.RECOVERING);
          break;
        case HVAC_STATES.RECOVERING:
          if (Math.abs(s.temp - p.normalTemp) < 1.0) enterHvacState(s, HVAC_STATES.NORMAL);
          break;
      }

      return {
        agentId: `HVAC-${zoneId}`,
        zone:    zoneId,
        metrics: { 
          ambient_temp_celsius: parseFloat(s.temp.toFixed(2)),
          occupancy_detected: true
        }
      };
    }

    // ── 2. Lighting Agent Logic ──────────────────────────────────────────────
    function targetLux(state, p) {
      switch (state) {
        case LT_STATES.NORMAL:           return p.normalLux;
        case LT_STATES.LIGHT_DROP:       return T.luxSoftMin - 10;
        case LT_STATES.THRESHOLD_BREACH: return T.luxSevereMin - 10;
        case LT_STATES.RECOVERING:       return p.normalLux;
        default:                         return p.normalLux;
      }
    }

    function enterLtState(s, newState) {
      s.simState = newState;
      const def = LT_DEF[newState];
      if (Array.isArray(def.maxTicks)) s.ticksLeft = randInt(def.maxTicks[0], def.maxTicks[1]);
      else s.ticksLeft = def.maxTicks === null ? null : Infinity;
    }

    function tickLtZone(zoneId) {
      const s = ltSimStates.get(zoneId);
      if (!s) return null;

      const p   = s.personality;
      const def = LT_DEF[s.simState];

      // Movement
      const lTarget = targetLux(s.simState, p);
      const lDiff   = lTarget - s.lux;

      if (Math.abs(lDiff) <= def.lStep) {
        // At target
        if (Math.random() < 0.1) s.lux += (Math.random() > 0.5 ? 2 : -2);
      } else {
        const lDir    = Math.sign(lDiff);
        const lNoise  = (Math.random() - 0.5) * 4;
        const lMove   = clamp(lDir * def.lStep + lNoise, -def.lStep * 1.4, def.lStep * 1.4);
        s.lux        += lMove;

        // Prevent rubber-banding
        if (lDir > 0) s.lux = Math.min(s.lux, lTarget);
        if (lDir < 0) s.lux = Math.max(s.lux, lTarget);
      }

      if (s.simState === LT_STATES.NORMAL && Math.random() < p.p_lux_drop) {
        enterLtState(s, LT_STATES.LIGHT_DROP);
      }

      s.lux = clamp(s.lux, 5, 900);

      // State Transitions
      switch (s.simState) {
        case LT_STATES.NORMAL:
          break;
        case LT_STATES.LIGHT_DROP:
          if (s.lux <= T.luxSoftMin) enterLtState(s, LT_STATES.THRESHOLD_BREACH);
          break;
        case LT_STATES.THRESHOLD_BREACH:
          s.ticksLeft--;
          if (s.ticksLeft <= 0) enterLtState(s, LT_STATES.RECOVERING);
          break;
        case LT_STATES.RECOVERING:
          if (Math.abs(s.lux - p.normalLux) < 30) enterLtState(s, LT_STATES.NORMAL);
          break;
      }

      return {
        agentId: `LT-${zoneId}`,
        zone:    zoneId,
        metrics: { 
          work_plane_illuminance_lux: parseFloat(s.lux.toFixed(1)),
          occupancy_detected: true
        }
      };
    }

    