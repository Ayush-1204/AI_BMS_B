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
      SWITCH_OFF:       'SWITCH_OFF',     // Brief human-controlled off (occupancy set false)
      SWITCH_ON:        'SWITCH_ON',      // Recovery from SWITCH_OFF
      PARTIAL_FAILURE:  'PARTIAL_FAILURE', // Gradual fixture degradation
      COMPLETE_FAILURE: 'COMPLETE_FAILURE', // Dead fixture → near-zero lux
      FLICKERING:       'FLICKERING',     // Loose connection oscillation
      DEFICIENCY:       'DEFICIENCY',     // Sustained sub-threshold lux
      RECOVERING:       'RECOVERING',     // Return to normal
    };

    // ── Event probabilities (per tick, from NORMAL state) ─────────────────────
    // These are independent per zone; most ticks result in NORMAL behaviour.
    const LT_EVENT_P = {
      switchOff:      0.00003,  // Brief human off-event (rare)
      partialFail:    0.00002,  // Gradual fixture degradation
      completeFail:   0.000005, // Dead fixture (very rare)
      flicker:        0.00001,  // Loose connection / power instability
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
        personality:  p,
        simState:     LT_STATES.NORMAL,
        ticksLeft:    Infinity,
        lux:          p.normalLux + jitterL,
        flickerPhase: 0,         // oscillation counter for FLICKERING state
        flickerBase:  p.normalLux, // centre lux around which flickering oscillates
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
      const HVAC_DEF = {
        NORMAL:           { tStep: 0.12, maxTicks: [Infinity, Infinity] },
        WARMING:          { tStep: 0.40, maxTicks: null },
        COOLING:          { tStep: 0.40, maxTicks: null },
        THRESHOLD_BREACH: { tStep: 0.45, maxTicks: [28, 55] },
        SEVERE:           { tStep: 0.50, maxTicks: [18, 35] },
        CRITICAL:         { tStep: 0.40, maxTicks: [8,  18] },
        RECOVERING:       { tStep: 0.80, maxTicks: null },
      };
      const def = HVAC_DEF[newState];
      if (Array.isArray(def.maxTicks)) s.ticksLeft = randInt(def.maxTicks[0], def.maxTicks[1]);
      else s.ticksLeft = def.maxTicks === null ? null : Infinity;
    }

    function tickHvacZone(zoneId) {
      const s = hvacSimStates.get(zoneId);
      if (!s) return null;

      const p = s.personality;
      const HVAC_DEF = {
        NORMAL:           { tStep: 0.12 },
        WARMING:          { tStep: 0.40 },
        COOLING:          { tStep: 0.40 },
        THRESHOLD_BREACH: { tStep: 0.45 },
        SEVERE:           { tStep: 0.50 },
        CRITICAL:         { tStep: 0.40 },
        RECOVERING:       { tStep: 0.80 },
      };
      const def = HVAC_DEF[s.simState];

      // Targets and movement
      const tTarget = targetTemp(s.simState, p, s.heatingUp);
      const tDiff   = tTarget - s.temp;

      if (Math.abs(tDiff) <= def.tStep) {
        if (Math.random() < 0.1) s.temp += (Math.random() > 0.5 ? 0.05 : -0.05);
      } else {
        const tDir   = Math.sign(tDiff);
        const tNoise = (Math.random() - 0.5) * 0.08;
        const tMove  = clamp(tDir * def.tStep + tNoise, -def.tStep * 1.3, def.tStep * 1.3);
        s.temp      += tMove;
        if (tDir > 0) s.temp = Math.min(s.temp, tTarget);
        if (tDir < 0) s.temp = Math.max(s.temp, tTarget);
      }
      
      s.temp = clamp(s.temp, -10, 90);

      // State Transitions
      switch (s.simState) {
        case HVAC_STATES.NORMAL: {
          const r = Math.random();
          if (r < 0.000002) { enterHvacState(s, HVAC_STATES.CRITICAL, true); }
          else if (r < 0.00002) { enterHvacState(s, HVAC_STATES.SEVERE, true); }
          else if (r < 0.00005) { enterHvacState(s, HVAC_STATES.THRESHOLD_BREACH, true); }
          else if (r < 0.00005 + p.p_warm) { enterHvacState(s, HVAC_STATES.WARMING, true); }
          else if (r < 0.00005 + p.p_warm + p.p_cool) { enterHvacState(s, HVAC_STATES.COOLING, false); }
          break;
        }
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

    // ── 2. Lighting Agent Logic (Event-Driven) ────────────────────────────────
    //
    // Unlike HVAC which is a continuous thermal model, lighting is EVENT-DRIVEN:
    //   - Lights switch instantly ON/OFF (human control)
    //   - Fixtures degrade gradually (PARTIAL_FAILURE)
    //   - Fixtures die completely (COMPLETE_FAILURE → near-zero lux)
    //   - Loose connections cause flickering (FLICKERING)
    //   - Long periods below threshold cause DEFICIENCY incidents via Gate-3
    //
    // occupancy_detected is set to false during SWITCH_OFF to prevent
    // Gate-2/3 from generating false ILLUMINANCE_DEFICIENCY on brief human events.

    function enterLtState(s, newState) {
      s.simState    = newState;
      s.flickerPhase = 0;
      switch (newState) {
        case LT_STATES.SWITCH_OFF:
          s.ticksLeft = randInt(5, 20);       // lights off for 5-20 ticks (~10-40s)
          break;
        case LT_STATES.SWITCH_ON:
          s.ticksLeft = randInt(3, 8);        // brief ramp-up period
          break;
        case LT_STATES.PARTIAL_FAILURE:
          s.ticksLeft = randInt(30, 60);      // slow degradation before recovery
          break;
        case LT_STATES.COMPLETE_FAILURE:
          s.ticksLeft = randInt(15, 40);      // dead fixture, stays off
          break;
        case LT_STATES.FLICKERING:
          s.ticksLeft  = randInt(10, 30);     // flickering duration
          s.flickerBase = s.lux;             // oscillate around current level
          break;
        case LT_STATES.DEFICIENCY:
          s.ticksLeft = randInt(20, 50);      // sustained low-lux period
          break;
        case LT_STATES.RECOVERING:
          s.ticksLeft = null;                 // recover until near normal
          break;
        default:
          s.ticksLeft = Infinity;
          break;
      }
    }

    function tickLtZone(zoneId) {
      const s = ltSimStates.get(zoneId);
      if (!s) return null;

      const p = s.personality;
      let occupancy = true; // Default: zone is occupied

      switch (s.simState) {

        case LT_STATES.NORMAL: {
          // Gentle baseline jitter ±2 lux
          s.lux += (Math.random() - 0.5) * 4;
          s.lux  = clamp(s.lux, p.normalLux - 30, p.normalLux + 30);

          // Probabilistic event triggers
          const r = Math.random();
          if      (r < LT_EVENT_P.completeFail)  enterLtState(s, LT_STATES.COMPLETE_FAILURE);
          else if (r < LT_EVENT_P.completeFail + LT_EVENT_P.flicker) enterLtState(s, LT_STATES.FLICKERING);
          else if (r < LT_EVENT_P.completeFail + LT_EVENT_P.flicker + LT_EVENT_P.partialFail) enterLtState(s, LT_STATES.PARTIAL_FAILURE);
          else if (r < LT_EVENT_P.completeFail + LT_EVENT_P.flicker + LT_EVENT_P.partialFail + LT_EVENT_P.switchOff) enterLtState(s, LT_STATES.SWITCH_OFF);
          break;
        }

        case LT_STATES.SWITCH_OFF:
          // Lights OFF — instant drop toward 0, mark unoccupied so engine ignores it
          occupancy = false;
          s.lux = clamp(s.lux - randInt(40, 80), 0, s.lux);
          s.ticksLeft--;
          if (s.ticksLeft <= 0) enterLtState(s, LT_STATES.SWITCH_ON);
          break;

        case LT_STATES.SWITCH_ON:
          // Ramp back up to normal
          s.lux = clamp(s.lux + randInt(30, 60), 0, p.normalLux);
          s.ticksLeft--;
          if (s.ticksLeft <= 0 || s.lux >= p.normalLux - 20) {
            s.lux = p.normalLux;
            enterLtState(s, LT_STATES.NORMAL);
          }
          break;

        case LT_STATES.PARTIAL_FAILURE: {
          // Slow gradual degradation toward DEFICIENCY range (130–190 lux)
          const deficiencyTarget = 130 + Math.random() * 60;
          if (s.lux > deficiencyTarget) {
            s.lux -= clamp((Math.random() * 6 + 1), 1, 8);
          } else {
            s.lux += (Math.random() - 0.5) * 3; // hold with jitter
          }
          s.lux = clamp(s.lux, 50, p.normalLux);
          s.ticksLeft--;
          if (s.ticksLeft <= 0) enterLtState(s, LT_STATES.RECOVERING);
          break;
        }

        case LT_STATES.COMPLETE_FAILURE:
          // Drive lux to near zero and hold there
          s.lux = clamp(s.lux - randInt(20, 50), 0, s.lux);
          if (s.lux < 5) s.lux = Math.random() * 3; // hover near zero with tiny noise
          s.ticksLeft--;
          if (s.ticksLeft <= 0) enterLtState(s, LT_STATES.RECOVERING);
          break;

        case LT_STATES.FLICKERING: {
          // Oscillate ±80 lux around base using a phase-based sine-like pattern
          s.flickerPhase++;
          const flicker = Math.sin(s.flickerPhase * 1.3) * 80 + (Math.random() - 0.5) * 30;
          s.lux = clamp(s.flickerBase + flicker, 20, p.normalLux + 80);
          s.ticksLeft--;
          if (s.ticksLeft <= 0) enterLtState(s, LT_STATES.RECOVERING);
          break;
        }

        case LT_STATES.DEFICIENCY: {
          // Sustained sub-threshold reading — occasionally dip into severe range
          const severeP = 0.15; // 15% chance per tick to go severe
          const targetLuxVal = Math.random() < severeP
            ? (20 + Math.random() * 30)   // severe: 20-50 lux (exercises Gate-2.5)
            : (90 + Math.random() * 80);  // standard deficiency: 90-170 lux (Gate-3)
          s.lux += (targetLuxVal - s.lux) * 0.2 + (Math.random() - 0.5) * 5;
          s.lux  = clamp(s.lux, 15, 200);
          s.ticksLeft--;
          if (s.ticksLeft <= 0) enterLtState(s, LT_STATES.RECOVERING);
          break;
        }

        case LT_STATES.RECOVERING:
          // Gradual ramp back to normal
          s.lux += clamp((p.normalLux - s.lux) * 0.15 + (Math.random() - 0.5) * 5, -20, 40);
          s.lux  = clamp(s.lux, 0, p.normalLux + 20);
          if (Math.abs(s.lux - p.normalLux) < 25) {
            s.lux = p.normalLux;
            enterLtState(s, LT_STATES.NORMAL);
          }
          break;
      }

      return {
        agentId: `LT-${zoneId}`,
        zone:    zoneId,
        metrics: { 
          work_plane_illuminance_lux: parseFloat(s.lux.toFixed(1)),
          occupancy_detected: occupancy
        }
      };
    }

    