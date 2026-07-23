// ═══════════════════════════════════════════════════════════════════════════
    // STATE-DRIVEN SIMULATION ENGINE (v3 — Demo-Tuned + Physics-Correct Lighting)
    // ═══════════════════════════════════════════════════════════════════════════
    //
    // Architecture:
    //   - HVAC uses a continuous thermal model (gradual — has thermal mass)
    //   - Lighting uses an event-driven model (instantaneous — electrical physics)
    //   - Each zone is assigned a DEMO ROLE that biases it toward a specific
    //     incident type, ensuring every scenario fires within a 5-minute window.
    //   - Demo zones cycle their scenarios on recovery → demonstrating repeatedly.

    // ── Zone personality profiles ─────────────────────────────────────────────
    const PERSONALITIES = {
      conference: { normalTemp: 22.0, normalLux: 480, p_warm: 0.00008, p_cool: 0.00002, label: 'Conference' },
      lobby:      { normalTemp: 21.0, normalLux: 380, p_warm: 0.00002, p_cool: 0.00001, label: 'Lobby' },
      storage:    { normalTemp: 18.5, normalLux: 120, p_warm: 0.00001, p_cool: 0.00003, label: 'Storage' },
      server:     { normalTemp: 25.5, normalLux: 210, p_warm: 0.00015, p_cool: 0.00001, label: 'Server Room' },
      office:     { normalTemp: 22.0, normalLux: 430, p_warm: 0.00004, p_cool: 0.00002, label: 'Office' },
      lab:        { normalTemp: 23.0, normalLux: 500, p_warm: 0.00005, p_cool: 0.00002, label: 'Lab' },
      executive:  { normalTemp: 21.5, normalLux: 350, p_warm: 0.00002, p_cool: 0.00001, label: 'Executive' },
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

    // ── Demo Zone Scenario Roles ──────────────────────────────────────────────
    // Zones in this map demonstrate a specific incident type with elevated
    // probability. All other zones run at normal production-level frequencies.
    const ZONE_DEMO_ROLES = {
      'ZONE-A1': 'hvac_warming',            // Gradual overheat → CRITICAL_OVERHEATING (Gate-3 → Gate-2)
      'ZONE-A2': 'hvac_critical_overheat',  // Direct critical spike → CRITICAL_OVERHEATING (Gate-2)
      'ZONE-A3': 'lt_switch_off',           // Brief human OFF/ON → no incident (occupancy=false)
      'ZONE-A4': 'lt_complete_failure',     // Fixture dead → COMPLETE_LIGHTING_FAILURE (Gate-1b)
      'ZONE-A5': 'lt_flickering',           // Loose connection → LIGHT_FLICKERING (Gate-1b)
      'ZONE-A6': 'lt_partial_failure',      // Circuit leg fails → PARTIAL_LIGHTING_FAILURE (Gate-1b escalation)
      'ZONE-B1': 'hvac_severe',             // Reaches severe band → CRITICAL_OVERHEATING (Gate-2.5)
      'ZONE-B2': 'hvac_critical_undercool', // Freezing → CRITICAL_UNDERCOOLING (Gate-2)
      'ZONE-B3': 'lt_deficiency',           // Sustained dim → ILLUMINANCE_DEFICIENCY (Gate-3)
      'ZONE-B4': 'lt_severe_deficiency',    // 20-50 lux → ILLUMINANCE_DEFICIENCY (Gate-2.5)
      'ZONE-B5': 'lt_critical_blackout',    // 6-9 lux occupied → ILLUMINANCE_DEFICIENCY (Gate-2)
      'ZONE-C1': 'hvac_sensor_unstable',    // Wild temp oscillations → SENSOR_UNSTABLE (Gate-1a)
    };

    // ── HVAC State Machine ────────────────────────────────────────────────────
    const HVAC_STATES = {
      NORMAL:           'NORMAL',
      WARMING:          'WARMING',
      COOLING:          'COOLING',
      THRESHOLD_BREACH: 'THRESHOLD_BREACH',
      SEVERE:           'SEVERE',
      CRITICAL:         'CRITICAL',
      RECOVERING:       'RECOVERING',
      SENSOR_FAULT:     'SENSOR_FAULT',  // Zig-zag oscillations to trigger Gate-1a SENSOR_UNSTABLE
    };

    const HVAC_DEF = {
      NORMAL:           { tStep: 0.12 },
      WARMING:          { tStep: 0.40 },
      COOLING:          { tStep: 0.40 },
      THRESHOLD_BREACH: { tStep: 0.45 },
      SEVERE:           { tStep: 0.50 },
      CRITICAL:         { tStep: 0.40 },
      RECOVERING:       { tStep: 0.80 },
      SENSOR_FAULT:     { tStep: 0.0  },  // no thermal step — raw noise injected instead
    };

    // ── Lighting Event States ─────────────────────────────────────────────────
    const LT_STATES = {
      NORMAL:            'NORMAL',
      SWITCH_OFF:        'SWITCH_OFF',        // Human off → instant → occupancy=false
      SWITCH_ON:         'SWITCH_ON',         // Human on  → instant → occupancy=true
      PARTIAL_FAILURE:   'PARTIAL_FAILURE',   // One circuit leg → step-drop → jitter
      COMPLETE_FAILURE:  'COMPLETE_FAILURE',  // Fuse/fixture dead → instant near-zero
      FLICKERING:        'FLICKERING',        // Square-wave oscillation
      DEFICIENCY:        'DEFICIENCY',        // Sustained 90–180 lux → Gate-3
      SEVERE_DEFICIENCY: 'SEVERE_DEFICIENCY', // Sustained 20–50 lux → Gate-2.5
      CRITICAL_BLACKOUT: 'CRITICAL_BLACKOUT', // 6–9 lux while occupied → Gate-2
      RECOVERING:        'RECOVERING',        // Ramp back to normalLux
    };

    // ── Demo lighting event probability resolver ──────────────────────────────
    // Returns per-event probabilities (per tick from NORMAL) for a given zone.
    function getLtEventP(zoneId) {
      const role = ZONE_DEMO_ROLES[zoneId];
      // Production baseline (very rare — healthy by default)
      const prod = { switchOff: 0.00003, completeFail: 0.000005, flicker: 0.00001, partialFail: 0.00002, deficiency: 0.00001, severeDeficiency: 0.000005, criticalBlackout: 0.000002 };
      switch (role) {
        case 'lt_switch_off':        return { ...prod, switchOff: 0.030 };
        case 'lt_complete_failure':  return { ...prod, completeFail: 0.022 };
        case 'lt_flickering':        return { ...prod, flicker: 0.028 };
        case 'lt_partial_failure':   return { ...prod, partialFail: 0.024 };
        case 'lt_deficiency':        return { ...prod, deficiency: 0.025 };
        case 'lt_severe_deficiency': return { ...prod, severeDeficiency: 0.025 };
        case 'lt_critical_blackout': return { ...prod, criticalBlackout: 0.025 };
        default:                     return prod;
      }
    }

    // ── Demo HVAC probability resolver ────────────────────────────────────────
    // Returns adjusted HVAC probabilities for demo zones.
    function getHvacDemoRates(zoneId) {
      const role = ZONE_DEMO_ROLES[zoneId];
      return {
        pCriticalUp:   role === 'hvac_critical_overheat' ? 0.018 : 0.000002,
        pCriticalDown: role === 'hvac_critical_undercool' ? 0.018 : 0.000001,
        pSevere:       role === 'hvac_severe'             ? 0.020 : 0.00002,
        pBreach:       role === 'hvac_warming'            ? 0.00005 : 0.00005,
        pWarm:         role === 'hvac_warming'            ? 0.025 : null, // null = use personality
        pSensorFault:  role === 'hvac_sensor_unstable'    ? 0.022 : 0.000001,
      };
    }

    function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

    // ── Initialise zone state ─────────────────────────────────────────────────
    function initZoneSimState(zoneId) {
      const p = resolvePersonality(zoneId);
      const jitterT = (Math.random() - 0.5) * 1.2;
      const jitterL = (Math.random() - 0.5) * 30;
      
      hvacSimStates.set(zoneId, {
        personality:      p,
        simState:         HVAC_STATES.NORMAL,
        ticksLeft:        Infinity,
        temp:             p.normalTemp + jitterT,
        heatingUp:        true,
        // Sensor fault oscillation: tracks which direction to jump next
        _malfuncDir:      1,
      });

      ltSimStates.set(zoneId, {
        personality:  p,
        simState:     LT_STATES.NORMAL,
        ticksLeft:    Infinity,
        lux:          p.normalLux + jitterL,
        flickerPhase: 0,
        flickerBase:  p.normalLux,
        // Physics flag: true on the very first tick of a new state
        _firstTick:   false,
      });

      zoneTempBufs.set(zoneId, []);
      zoneLuxBufs.set(zoneId,  []);
    }

    // ── 1. HVAC Agent Logic ───────────────────────────────────────────────────
    function targetTemp(simState, p, heatingUp) {
      switch (simState) {
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
      const maxTicksMap = {
        THRESHOLD_BREACH: [28, 55],
        SEVERE:           [18, 35],
        CRITICAL:         [8,  18],
        SENSOR_FAULT:     [20, 45],  // runs for 20-45 ticks before recovering
      };
      const range = maxTicksMap[newState];
      s.ticksLeft = range ? randInt(range[0], range[1]) : Infinity;
    }

    function tickHvacZone(zoneId) {
      const s = hvacSimStates.get(zoneId);
      if (!s) return null;

      const p    = s.personality;
      const dr   = getHvacDemoRates(zoneId);
      const def  = HVAC_DEF[s.simState];

      // ── SENSOR_FAULT state: zig-zag oscillation to trigger Gate-1a ──────────
      // Physics: sensor hardware is malfunctioning — readings jump wildly in
      // alternating directions regardless of actual ambient temperature.
      if (s.simState === HVAC_STATES.SENSOR_FAULT) {
        // Alternate direction each tick: +4.5°C, −4.8°C, +4.2°C, −5.1°C, ...
        // This guarantees maximum direction flips in the stability window.
        const jump = (3.5 + Math.random() * 2.0) * s._malfuncDir;
        s.temp    += jump;
        s.temp     = clamp(s.temp, p.normalTemp - 12, p.normalTemp + 12);
        s._malfuncDir *= -1;  // flip direction every tick
        s.ticksLeft--;
        if (s.ticksLeft <= 0) {
          s.temp = p.normalTemp;  // snap back to sane value on recovery
          enterHvacState(s, HVAC_STATES.RECOVERING);
        }
        return {
          agentId: `HVAC-${zoneId}`,
          zone:    zoneId,
          metrics: { ambient_temp_celsius: parseFloat(s.temp.toFixed(2)), occupancy_detected: true }
        };
      }

      // ── Standard thermal physics ─────────────────────────────────────────────
      const tTarget = targetTemp(s.simState, p, s.heatingUp);
      const tDiff   = tTarget - s.temp;

      if (Math.abs(tDiff) <= def.tStep) {
        if (Math.random() < 0.1) s.temp += (Math.random() > 0.5 ? 0.05 : -0.05);
      } else {
        const tDir  = Math.sign(tDiff);
        const noise = (Math.random() - 0.5) * 0.08;
        const move  = clamp(tDir * def.tStep + noise, -def.tStep * 1.3, def.tStep * 1.3);
        s.temp     += move;
        if (tDir > 0) s.temp = Math.min(s.temp, tTarget);
        if (tDir < 0) s.temp = Math.max(s.temp, tTarget);
      }
      s.temp = clamp(s.temp, -10, 90);

      // ── State transitions ────────────────────────────────────────────────────
      switch (s.simState) {
        case HVAC_STATES.NORMAL: {
          const r = Math.random();
          if      (r < dr.pCriticalUp)                                 { enterHvacState(s, HVAC_STATES.CRITICAL, true);         }
          else if (r < dr.pCriticalUp + dr.pCriticalDown)             { enterHvacState(s, HVAC_STATES.CRITICAL, false);        }
          else if (r < dr.pCriticalUp + dr.pCriticalDown + dr.pSevere){ enterHvacState(s, HVAC_STATES.SEVERE, true);           }
          else if (r < dr.pCriticalUp + dr.pCriticalDown + dr.pSevere + dr.pBreach) { enterHvacState(s, HVAC_STATES.THRESHOLD_BREACH, true); }
          else if (r < dr.pCriticalUp + dr.pCriticalDown + dr.pSevere + dr.pBreach + dr.pSensorFault) { enterHvacState(s, HVAC_STATES.SENSOR_FAULT); }
          else {
            // Normal personality-driven events
            const r2 = Math.random();
            const pWarm = dr.pWarm ?? p.p_warm;
            if      (r2 < pWarm)            enterHvacState(s, HVAC_STATES.WARMING, true);
            else if (r2 < pWarm + p.p_cool) enterHvacState(s, HVAC_STATES.COOLING, false);
          }
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
        metrics: { ambient_temp_celsius: parseFloat(s.temp.toFixed(2)), occupancy_detected: true }
      };
    }

    // ── 2. Lighting Agent Logic (Event-Driven, Physics-Correct) ──────────────
    //
    // KEY PHYSICS PRINCIPLE: lighting is ELECTRICAL, not thermal.
    //   - Switch events → lux changes INSTANTLY (tick #1), not gradually
    //   - Fixture failures → lux drops INSTANTLY (fuse or arc fault)
    //   - Flickering → sharp SQUARE-WAVE alternation, not a smooth sine curve
    //   - Partial failure → immediate STEP-DROP to ~45% (one circuit leg dead)
    //
    // occupancy_detected = false during SWITCH_OFF so Gate-2/3 don't generate
    // false ILLUMINANCE_DEFICIENCY incidents on brief human-controlled events.

    function enterLtState(s, newState) {
      s.simState    = newState;
      s.flickerPhase = 0;
      s._firstTick  = true;  // physics flag — first tick of this state
      switch (newState) {
        case LT_STATES.SWITCH_OFF:        s.ticksLeft = randInt(5, 18);   break;
        case LT_STATES.SWITCH_ON:         s.ticksLeft = randInt(2, 5);    break;
        case LT_STATES.PARTIAL_FAILURE:   s.ticksLeft = randInt(25, 55);  break;
        case LT_STATES.COMPLETE_FAILURE:  s.ticksLeft = randInt(12, 35);  break;
        case LT_STATES.FLICKERING:
          s.ticksLeft  = randInt(12, 32);
          s.flickerBase = s.lux;
          break;
        case LT_STATES.DEFICIENCY:        s.ticksLeft = randInt(18, 45);  break;
        case LT_STATES.SEVERE_DEFICIENCY: s.ticksLeft = randInt(15, 35);  break;
        case LT_STATES.CRITICAL_BLACKOUT: s.ticksLeft = randInt(10, 28);  break;
        case LT_STATES.RECOVERING:        s.ticksLeft = null;             break;
        default:                          s.ticksLeft = Infinity;         break;
      }
    }

    function tickLtZone(zoneId) {
      const s = ltSimStates.get(zoneId);
      if (!s) return null;

      const p   = s.personality;
      const ep  = getLtEventP(zoneId);
      let occupancy = true;

      switch (s.simState) {

        // ── NORMAL: gentle jitter + probabilistic event triggers ──────────────
        case LT_STATES.NORMAL: {
          s.lux += (Math.random() - 0.5) * 4;
          s.lux  = clamp(s.lux, p.normalLux - 30, p.normalLux + 30);

          const r = Math.random();
          let cum = 0;
          if      (r < (cum += ep.completeFail))    enterLtState(s, LT_STATES.COMPLETE_FAILURE);
          else if (r < (cum += ep.flicker))          enterLtState(s, LT_STATES.FLICKERING);
          else if (r < (cum += ep.partialFail))      enterLtState(s, LT_STATES.PARTIAL_FAILURE);
          else if (r < (cum += ep.switchOff))        enterLtState(s, LT_STATES.SWITCH_OFF);
          else if (r < (cum += ep.criticalBlackout)) enterLtState(s, LT_STATES.CRITICAL_BLACKOUT);
          else if (r < (cum += ep.severeDeficiency)) enterLtState(s, LT_STATES.SEVERE_DEFICIENCY);
          else if (r < (cum += ep.deficiency))       enterLtState(s, LT_STATES.DEFICIENCY);
          break;
        }

        // ── SWITCH_OFF: INSTANT blackout (electrical circuit opened) ──────────
        // Physics: circuit breaker or wall switch → current stops immediately.
        // Occupancy set false → Gates 2/3 skip this event (intended human action).
        case LT_STATES.SWITCH_OFF:
          occupancy = false;
          s.lux = Math.random() * 2.5;  // near-zero immediately, every tick
          s.ticksLeft--;
          if (s.ticksLeft <= 0) enterLtState(s, LT_STATES.SWITCH_ON);
          break;

        // ── SWITCH_ON: INSTANT recovery (LED = no warmup; 1-2 tick model) ────
        case LT_STATES.SWITCH_ON:
          if (s._firstTick) {
            s.lux = p.normalLux * 0.88;  // LEDs reach ~88% on first energise tick
            s._firstTick = false;
          } else {
            s.lux = p.normalLux + (Math.random() - 0.5) * 10;
            enterLtState(s, LT_STATES.NORMAL);
          }
          break;

        // ── COMPLETE_FAILURE: INSTANT blackout (fuse blow / fixture death) ───
        // Physics: arc fault or overcurrent → protection trips in <20ms.
        // Occupancy stays TRUE — zone is occupied, fixture just died.
        // Gate-1b will detect sustained near-zero → COMPLETE_LIGHTING_FAILURE.
        case LT_STATES.COMPLETE_FAILURE:
          s.lux = Math.random() * 1.8;  // dead, hover near zero with sensor noise
          s.ticksLeft--;
          if (s.ticksLeft <= 0) enterLtState(s, LT_STATES.RECOVERING);
          break;

        // ── PARTIAL_FAILURE: STEP-DROP on first tick, then jitter ────────────
        // Physics: one circuit leg in a multi-fixture room fails instantly.
        // Lux drops to ~45% of normal immediately, then holds with jitter.
        // Gate-1b amplitude gate (60 lux swing) will detect this on entry.
        case LT_STATES.PARTIAL_FAILURE:
          if (s._firstTick) {
            s.lux = p.normalLux * 0.45 + (Math.random() - 0.5) * 20;
            s._firstTick = false;
          } else {
            // Hold at degraded level with realistic noise from remaining fixtures
            s.lux += (Math.random() - 0.5) * 10;
            s.lux  = clamp(s.lux, p.normalLux * 0.35, p.normalLux * 0.58);
          }
          s.ticksLeft--;
          if (s.ticksLeft <= 0) enterLtState(s, LT_STATES.RECOVERING);
          break;

        // ── FLICKERING: sharp SQUARE-WAVE oscillation ─────────────────────────
        // Physics: loose connection or driver failure → lux alternates between
        // HIGH and LOW every few hundred milliseconds. NOT a smooth sine curve.
        // Amplitude is always > 80 lux so Gate-1b's amplitude gate fires.
        case LT_STATES.FLICKERING: {
          s.flickerPhase++;
          const isHigh = s.flickerPhase % 2 === 0;
          if (isHigh) {
            // HIGH phase: near or above normal
            s.lux = s.flickerBase + 95 + (Math.random() - 0.5) * 25;
          } else {
            // LOW phase: well below normal (fixtures not receiving full power)
            s.lux = s.flickerBase - 120 + (Math.random() - 0.5) * 30;
          }
          s.lux = clamp(s.lux, 5, p.normalLux + 120);
          s.ticksLeft--;
          if (s.ticksLeft <= 0) enterLtState(s, LT_STATES.RECOVERING);
          break;
        }

        // ── DEFICIENCY: sustained sub-threshold lux (Gate-3 accumulates) ─────
        // Physics: gradual lamp aging, dirty fixtures, or voltage drop.
        // Held between 90–180 lux — below the 200 lux soft minimum.
        case LT_STATES.DEFICIENCY:
          s.lux += (((130 + Math.random() * 50) - s.lux) * 0.18) + (Math.random() - 0.5) * 6;
          s.lux  = clamp(s.lux, 85, 195);
          s.ticksLeft--;
          if (s.ticksLeft <= 0) enterLtState(s, LT_STATES.RECOVERING);
          break;

        // ── SEVERE_DEFICIENCY: 20-50 lux while occupied (Gate-2.5) ───────────
        // Physics: most fixtures offline, only partial emergency lighting.
        case LT_STATES.SEVERE_DEFICIENCY:
          s.lux += (((25 + Math.random() * 25) - s.lux) * 0.18) + (Math.random() - 0.5) * 4;
          s.lux  = clamp(s.lux, 15, 52);
          s.ticksLeft--;
          if (s.ticksLeft <= 0) enterLtState(s, LT_STATES.RECOVERING);
          break;

        // ── CRITICAL_BLACKOUT: 6-9 lux while occupied (Gate-2 fires) ─────────
        // Physics: near-total loss of lighting above Gate-1b complete threshold.
        // At 6-9 lux, Gate-1b does NOT fire (threshold is ≤5 for 3+ ticks).
        // Gate-2 absoluteMin=10 catches this immediately.
        case LT_STATES.CRITICAL_BLACKOUT:
          s.lux += (((7.5 + Math.random() * 1.5) - s.lux) * 0.25) + (Math.random() - 0.5) * 1.5;
          s.lux  = clamp(s.lux, 5.5, 9.8);
          s.ticksLeft--;
          if (s.ticksLeft <= 0) enterLtState(s, LT_STATES.RECOVERING);
          break;

        // ── RECOVERING: gradual ramp back to normalLux ────────────────────────
        // Even though lighting events are instantaneous, recovery can be modelled
        // as a technician restoring power / replacing a fixture (takes time).
        case LT_STATES.RECOVERING:
          s.lux += clamp((p.normalLux - s.lux) * 0.20 + (Math.random() - 0.5) * 5, -15, 45);
          s.lux  = clamp(s.lux, 0, p.normalLux + 20);
          if (Math.abs(s.lux - p.normalLux) < 20) {
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

    