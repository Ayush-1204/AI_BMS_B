    // ── DOM refs ────────────────────────────────────────────────────────────
    const socket        = io();
    const logList       = document.getElementById('incident-log');
    const emptyEl       = document.getElementById('incident-empty');
    const statusEl      = document.getElementById('conn-status');
    const connPill      = document.getElementById('conn-pill');
    const soundBtn      = document.getElementById('sound-toggle-btn');
    const floorSelect   = document.getElementById('floor-select');
    const overlayLayer  = document.getElementById('overlay-layer');
    const stageTitle    = document.getElementById('stage-floor-title');
    const activeAlertsEl = document.getElementById('active-alerts');
    const simDot        = document.getElementById('sim-dot');
    const simLabel      = document.getElementById('sim-label');
    const btnRun        = document.getElementById('btn-run');
    const btnStop       = document.getElementById('btn-stop');
    const hvacZonesEl   = document.getElementById('telem-hvac-zones');
    const lightZonesEl  = document.getElementById('telem-light-zones');

    // ── State ───────────────────────────────────────────────────────────────
    const cardsByRefId   = new Map();
    const overlaysByZone = new Map();
    let buildingConfig   = null;
    let currentFloorId   = null;
    let simInterval      = null;
    let isSimRunning     = false;

    // Per-zone simulation states (keyed by zone ID)
    const hvacSimStates  = new Map();
    const ltSimStates    = new Map();
    // Per-zone telemetry buffers for graphs (keyed by zone ID)
    const zoneTempBufs   = new Map();
    const zoneLuxBufs    = new Map();
    const GRAPH_POINTS   = 90;

    // ── Thresholds (mirroring constants.js for graph drawing only) ──────────
    const T = {
      tempSoftMax: 28, tempSoftMin: 17.5,
      tempSevereMax: 50, tempSevereMin: 5,
      tempCritMax: 55, tempCritMin: 0,
      luxSoftMin: 200, luxSevereMin: 50, luxCritMin: 10,
    };

    // ── Connection status ────────────────────────────────────────────────────
    function setConn(state) {
      connPill.className = 'status-pill';
      if (state === 'connected') {
        statusEl.textContent = 'CONNECTED';
        connPill.classList.add('connected');
      } else if (state === 'disconnected') {
        statusEl.textContent = 'CONNECTION LOST';
        connPill.classList.add('disconnected');
      } else {
        statusEl.textContent = 'CONNECTING...';
      }
    }
    setConn('connecting');
    socket.on('connect',    () => setConn('connected'));
    socket.on('disconnect', () => setConn('disconnected'));

    // ── Sound ───────────────────────────────────────────────────────────────
    let audioCtx = null, isSoundEnabled = false;
    soundBtn.addEventListener('click', () => {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      isSoundEnabled = !isSoundEnabled;
      soundBtn.textContent = isSoundEnabled ? 'SOUND: ON' : 'SOUND: OFF';
      isSoundEnabled ? soundBtn.classList.add('active') : soundBtn.classList.remove('active');
    });

    function playAlertTone() {
      if (!audioCtx || !isSoundEnabled) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880; osc.type = 'sine';
      const lfo = audioCtx.createOscillator();
      lfo.frequency.value = 10;
      const lfoGain = audioCtx.createGain();
      lfoGain.gain.value = 200;
      lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
      osc.connect(gain); gain.connect(audioCtx.destination);
      gain.gain.setValueAtTime(0, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.18, audioCtx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      lfo.start(); osc.start(); osc.stop(audioCtx.currentTime + 0.35); lfo.stop(audioCtx.currentTime + 0.35);
    }

    // ── Utilities ────────────────────────────────────────────────────────────
    function escapeHtml(s) {
      const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML;
    }
    function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
    const incidentsByKey = new Map(); // key = zone|faultType

    // ── Zone overlay management ──────────────────────────────────────────────
    function setOverlay(zone, severity, labelText) {
      const ov = overlaysByZone.get(zone);
      if (!ov) return;
      const label = ov.querySelector('.zone-label');
      if (label && labelText) label.textContent = labelText;
      ov.classList.remove('critical', 'warning');
      if (severity === 'critical') ov.classList.add('critical');
      if (severity === 'warning')  ov.classList.add('warning');
      clearTimeout(ov._t);
      ov._t = setTimeout(() => {
        ov.classList.remove('critical', 'warning');
        if (label) label.textContent = zone;
      }, 10000);
    }

    function severityClass(wo) {
      if (wo.priority === 'High')   return 'critical';
      if (wo.priority === 'Medium') return 'warning';
      return 'info';
    }

    function tierLabel(wo) {
      if (wo.tier === 'severe')   return 'severe';
      const ft = wo.faultType || '';
      if (ft.startsWith('SENSOR')) return 'sensor';
      if (wo.priority === 'High') return 'critical';
      return 'standard';
    }

    // ── Incident-Centric Logic ───────────────────────────────────────────────
    function formatDuration(ms) {
      const sec = Math.max(0, Math.floor(ms / 1000));
      if (sec < 60) return `${sec}s`;
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${m}m ${s}s`;
    }

    function formatLiveMetric(zone, faultType) {
      // Fetch latest simulated value dynamically from local graph buffers
      if (faultType.includes('TEMP') || faultType.includes('OVERHEAT') || faultType.includes('UNDERCOOL')) {
        const buf = zoneTempBufs.get(zone);
        if (buf && buf.length) return `${buf[buf.length-1].toFixed(1)}°C`;
      } else {
        const buf = zoneLuxBufs.get(zone);
        if (buf && buf.length) return `${Math.round(buf[buf.length-1])} lx`;
      }
      return '—';
    }

    function processIncidentEvent(wo) {
      const key = `${wo.zone}|${wo.faultType}`;
      const now = Date.now();
      let inc = incidentsByKey.get(key);

      // We might not get a new-work-order for a repeat if we refresh the page, 
      // so handle creation on both new and repeat events seamlessly.
      if (!inc) {
        inc = {
          key,
          zone: wo.zone,
          faultType: wo.faultType,
          description: wo.description,
          tier: wo.tier || tierLabel(wo),
          severity: severityClass(wo),
          confidence: wo.confidence || (wo.priority === 'High' ? 100 : 80),
          firstSeen: now,
          lastSeen: now,
          repeatCount: wo.repeatCount || 1,
          status: 'ACTIVE',
          referenceId: wo.referenceId,
          dom: document.createElement('div')
        };
        inc.dom.className = `inc-card ${inc.severity === 'info' ? 'warning' : inc.severity}`;
        inc.dom.innerHTML = `
          <div class="inc-header">${inc.zone} <span style="float:right;color:inherit"><span class="inc-badge js-repeat" style="display:none"></span></span></div>
          <div class="inc-title">${inc.faultType.replace(/_/g, ' ')} <span style="font-size:10px; color:var(--text-muted); font-family:monospace; margin-left:6px; font-weight:400">#${wo.referenceId}</span></div>
          <div class="inc-metric js-metric"></div>
          <div class="inc-meta">
            <div>DURATION : <span class="js-duration"></span></div>
            <div>CONFIDENCE : <span class="js-confidence"></span></div>
            <div>STATUS : <span class="inc-badge js-status"></span></div>
            <div class="inc-desc">${escapeHtml(inc.description)}</div>
          </div>
        `;
        inc.els = {
          repeat: inc.dom.querySelector('.js-repeat'),
          metric: inc.dom.querySelector('.js-metric'),
          duration: inc.dom.querySelector('.js-duration'),
          confidence: inc.dom.querySelector('.js-confidence'),
          status: inc.dom.querySelector('.js-status')
        };
        incidentsByKey.set(key, inc);
        if (inc.severity === 'critical') playAlertTone();
      } else {
        inc.lastSeen = now;
        inc.status = 'ACTIVE';
        if (wo.repeatCount) inc.repeatCount = wo.repeatCount;
        if (wo.confidence) inc.confidence = wo.confidence;
      }

      const label = `${inc.zone}: ${inc.faultType.replace(/_/g, ' ')}`;
      setOverlay(inc.zone, inc.severity === 'critical' ? 'critical' : 'warning', label);
    }

    socket.on('new-work-order', processIncidentEvent);
    socket.on('work-order-repeat', processIncidentEvent);

    // ── Incident Lifecycle Loop ──────────────────────────────────────────────
    setInterval(() => {
      const now = Date.now();
      let activeCount = 0;
      const listActive = document.getElementById('list-active');
      const listRec    = document.getElementById('list-recovering');
      const listRes    = document.getElementById('list-resolved');
      
      const arr = Array.from(incidentsByKey.values());

      arr.forEach(inc => {
        const age = now - inc.lastSeen;
        
        // 1. State transitions based on silence from backend telemetry stream
        if (inc.status === 'ACTIVE' && age > 15000) {
          inc.status = 'RECOVERING';
          inc.repeatCount = 1; // reset repeat tracking for next time
        } else if (inc.status === 'RECOVERING' && age > 60000) {
          inc.status = 'RESOLVED';
        }

        if (inc.status === 'ACTIVE') activeCount++;

        // 2. Erase from history if old enough
        if (inc.status === 'RESOLVED' && age > 120000) {
          if (inc.dom.parentNode) inc.dom.parentNode.removeChild(inc.dom);
          incidentsByKey.delete(inc.key);
          return;
        }

        // 3. Update DOM content live efficiently without innerHTML destruction
        const metricVal = formatLiveMetric(inc.zone, inc.faultType);
        const duration  = formatDuration(now - inc.firstSeen);
        
        if (inc.repeatCount > 1) {
          inc.els.repeat.style.display = 'inline';
          inc.els.repeat.textContent = `×${inc.repeatCount}`;
        } else {
          inc.els.repeat.style.display = 'none';
        }

        inc.els.metric.textContent = metricVal;
        inc.els.duration.textContent = duration;
        inc.els.confidence.textContent = `${Math.round(inc.confidence)}%`;
        
        if (inc.els.status.textContent !== inc.status) {
          inc.els.status.className = `inc-badge js-status ${inc.status.toLowerCase()}`;
          inc.els.status.textContent = inc.status;
        }
      });

      // Update Global State
      activeAlertsEl.textContent = activeCount;
      const emptyState = document.getElementById('incident-empty');
      if (emptyState) emptyState.style.display = arr.length ? 'none' : 'block';

      // Sort
      const scoreStatus = { ACTIVE: 3, RECOVERING: 2, RESOLVED: 1 };
      const scoreTier   = { critical: 5, severe: 4, warning: 3, sensor: 2, standard: 1, info: 0 };
      
      arr.sort((a, b) => {
        if (a.status !== b.status) return scoreStatus[b.status] - scoreStatus[a.status];
        if (a.tier !== b.tier)     return scoreTier[b.tier] - scoreTier[a.tier];
        return b.firstSeen - a.firstSeen;
      });

      // Distribute to DOM buckets
      if (listActive && listRec && listRes) {
        arr.forEach(inc => {
          if (inc.status === 'ACTIVE') listActive.appendChild(inc.dom);
          else if (inc.status === 'RECOVERING') listRec.appendChild(inc.dom);
          else listRes.appendChild(inc.dom);
        });

        document.getElementById('sec-active').style.display = listActive.children.length ? 'block' : 'none';
        document.getElementById('sec-recovering').style.display = listRec.children.length ? 'block' : 'none';
        document.getElementById('sec-resolved').style.display = listRes.children.length ? 'block' : 'none';
      }
      
    }, 1000);

    // ── Building / Floor rendering ───────────────────────────────────────────
    function buildOverlaysForFloor(floor) {
      overlaysByZone.clear();
      overlayLayer.innerHTML = '';
      for (const z of floor?.zones || []) {
        const ov = document.createElement('div');
        ov.className  = 'zone-block';
        ov.style.left   = z.overlay?.left   || '0%';
        ov.style.top    = z.overlay?.top    || '0%';
        ov.style.width  = z.overlay?.width  || '0%';
        ov.style.height = z.overlay?.height || '0%';
        const lbl = document.createElement('div');
        lbl.className   = 'zone-label';
        lbl.textContent = z.id;
        ov.appendChild(lbl);
        overlayLayer.appendChild(ov);
        overlaysByZone.set(z.id, ov);
      }
    }

    function setFloor(floorId) {
      currentFloorId = floorId;
      const floor = buildingConfig?.floors?.find(f => f.id === floorId) || buildingConfig?.floors?.[0];
      if (!floor) return;
      if (stageTitle) stageTitle.textContent = floor.label || floor.id;
      buildOverlaysForFloor(floor);
      // ── Floor-scoped graphs: rebuild for current floor's zones only ──────
      currentFloorZoneIds = (floor.zones || []).map(z => z.id);
      buildTelemGraphs(currentFloorZoneIds);
      // Re-draw existing buffers immediately if sim is already running
      currentFloorZoneIds.forEach(z => redrawZoneGraph(z));
    }

    // ── Simulation loop ───────────────────────────────────────────────────────
    let currentFloorZoneIds = [];

    async function runSimTick() {
      if (!buildingConfig) return;
      const allZones = buildingConfig.floors.flatMap(f => f.zones.map(z => z.id));
      for (const zoneId of allZones) {
        const hvacPayload = tickHvacZone(zoneId);
        const ltPayload   = tickLtZone(zoneId);

        if (hvacPayload) pushToBuffer(zoneTempBufs, zoneId, hvacPayload.metrics.ambient_temp_celsius);
        if (ltPayload)   pushToBuffer(zoneLuxBufs,  zoneId, ltPayload.metrics.work_plane_illuminance_lux);

        if (currentFloorZoneIds.includes(zoneId)) redrawZoneGraph(zoneId);

        if (hvacPayload) {
          fetch('/api/telemetry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(hvacPayload),
          }).catch(() => {});
        }
        if (ltPayload) {
          fetch('/api/telemetry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ltPayload),
          }).catch(() => {});
        }
      }
    }

    function setSimRunning(running) {
      isSimRunning = running;
      simDot.className     = `sim-dot ${running ? 'running' : 'stopped'}`;
      simLabel.className   = `sim-label ${running ? 'running' : ''}`;
      simLabel.textContent = running ? 'RUNNING' : 'STOPPED';
      btnRun.disabled  = running;
      btnStop.disabled = !running;
    }

    btnRun.addEventListener('click', () => {
      if (isSimRunning) return;
      setSimRunning(true);
      runSimTick();
      simInterval = setInterval(runSimTick, 2000);
    });

    btnStop.addEventListener('click', () => {
      clearInterval(simInterval);
      simInterval = null;
      setSimRunning(false);
    });

    // ── Graph system (Canvas 2D) ─────────────────────────────────────────────
    function pushToBuffer(mapRef, zoneId, val) {
      const buf = mapRef.get(zoneId) || [];
      buf.push(val);
      if (buf.length > GRAPH_POINTS) buf.shift();
      mapRef.set(zoneId, buf);
    }

    function valueColor(val, metric) {
      if (metric === 'temp') {
        if (val >= T.tempCritMax   || val <= T.tempCritMin)   return '#ef4444';
        if (val >= T.tempSevereMax || val <= T.tempSevereMin) return '#f97316';
        if (val >= T.tempSoftMax   || val <= T.tempSoftMin)   return '#f59e0b';
        return '#0ea5e9';
      } else {
        if (val <= T.luxCritMin)   return '#ef4444';
        if (val <= T.luxSevereMin) return '#f97316';
        if (val <= T.luxSoftMin)   return '#f59e0b';
        return '#a78bfa';
      }
    }

    function redrawCanvas(canvas, buf, metric) {
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const W   = canvas.width  = canvas.offsetWidth  * dpr;
      const H   = canvas.height = canvas.offsetHeight * dpr;
      ctx.clearRect(0, 0, W, H);

      let lines = [];
      if (metric === 'temp') {
        lines = [
          { val: T.tempCritMax,   color: '#ef4444' },
          { val: T.tempSevereMax, color: '#f97316' },
          { val: T.tempSoftMax,   color: '#f59e0b' },
          { val: T.tempSoftMin,   color: '#f59e0b' },
        ];
      } else {
        lines = [
          { val: T.luxSoftMin,   color: '#f59e0b' },
          { val: T.luxSevereMin, color: '#f97316' },
          { val: T.luxCritMin,   color: '#ef4444' },
        ];
      }

      // Fixed professional Y-axis ranges to prevent jumping
      let minV, maxV;
      if (metric === 'temp') {
        minV = -5; maxV = 65;
      } else {
        minV = 0; maxV = 800;
      }
      const range = maxV - minV || 1;
      
      // Clamp values so extreme outliers don't break the rendering bounds
      function clampedRenderVal(v) { return clamp(v, minV, maxV); }
      function yOf(v) { return H - ((clampedRenderVal(v) - minV) / range) * H * 0.88 - H * 0.06; }

      // Threshold lines
      lines.forEach(line => {
        ctx.save();
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = line.color + '90';
        ctx.lineWidth   = dpr;
        const y = yOf(line.val);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.restore();
      });

      if (buf.length < 2) return;
      const stepX   = W / (GRAPH_POINTS - 1);
      
      // Lock newest point completely to the right edge to force a sliding window even before buffer fills
      const startX = W - (buf.length - 1) * stepX;
      
      const lastVal = buf[buf.length - 1];
      const col     = valueColor(lastVal, metric);

      // Filled gradient area
      ctx.beginPath();
      buf.forEach((v, i) => { 
        const x = startX + i * stepX; 
        const y = yOf(v); 
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); 
      });
      ctx.lineTo(startX + (buf.length - 1) * stepX, H); 
      ctx.lineTo(startX, H); 
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, col + '40'); grad.addColorStop(1, col + '05');
      ctx.fillStyle = grad; ctx.fill();

      // Line
      ctx.beginPath();
      buf.forEach((v, i) => { 
        const x = startX + i * stepX; 
        const y = yOf(v); 
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); 
      });
      ctx.strokeStyle = col; ctx.lineWidth = 1.5 * dpr; ctx.lineJoin = 'round'; ctx.stroke();

      // Latest-value dot
      const lx = startX + (buf.length - 1) * stepX; 
      const ly = yOf(lastVal);
      ctx.beginPath(); ctx.arc(lx, ly, 3 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
    }

    const tempCanvases = new Map();
    const luxCanvases  = new Map();
    const tempValEls   = new Map();
    const luxValEls    = new Map();

    function redrawZoneGraph(zoneId) {
      const tBuf = zoneTempBufs.get(zoneId);
      const lBuf = zoneLuxBufs.get(zoneId);
      const tc = tempCanvases.get(zoneId);
      const lc = luxCanvases.get(zoneId);
      const tv = tempValEls.get(zoneId);
      const lv = luxValEls.get(zoneId);

      if (tc && tBuf && tBuf.length) {
        redrawCanvas(tc, tBuf, 'temp');
        const last = tBuf[tBuf.length - 1];
        if (tv) {
          tv.textContent = `${last.toFixed(1)}°C`;
          tv.className   = 'telem-current-val ' + (
            last >= T.tempCritMax   || last <= T.tempCritMin   ? 'crit'   :
            last >= T.tempSevereMax || last <= T.tempSevereMin ? 'severe' :
            last >= T.tempSoftMax   || last <= T.tempSoftMin   ? 'warn'   : ''
          );
        }
      }
      if (lc && lBuf && lBuf.length) {
        redrawCanvas(lc, lBuf, 'lux');
        const last = lBuf[lBuf.length - 1];
        if (lv) {
          lv.textContent = `${Math.round(last)} lx`;
          lv.className   = 'telem-current-val ' + (
            last <= T.luxCritMin   ? 'crit'   :
            last <= T.luxSevereMin ? 'severe' :
            last <= T.luxSoftMin   ? 'warn'   : ''
          );
        }
      }
    }

    // buildTelemGraphs: scoped to the zones passed in (current floor only)
    function buildTelemGraphs(floorZones) {
      hvacZonesEl.innerHTML  = '';
      lightZonesEl.innerHTML = '';
      tempCanvases.clear(); luxCanvases.clear();
      tempValEls.clear();   luxValEls.clear();

      floorZones.forEach(zoneId => {
        const p = resolvePersonality(zoneId);
        ['temp', 'lux'].forEach(metric => {
          const container = metric === 'temp' ? hvacZonesEl : lightZonesEl;
          const block = document.createElement('div');
          block.className = 'telem-zone-block';

          const nameRow = document.createElement('div');
          nameRow.className = 'telem-zone-name';

          const nameSpan = document.createElement('span');
          nameSpan.innerHTML = `${zoneId} <span style="font-size:9px;color:var(--text-muted);font-weight:400;letter-spacing:0">${p.label}</span>`;

          const valSpan = document.createElement('span');
          valSpan.className   = 'telem-current-val';
          valSpan.textContent = '—';

          nameRow.appendChild(nameSpan);
          nameRow.appendChild(valSpan);

          const canvas = document.createElement('canvas');
          canvas.className = 'telem-canvas';

          block.appendChild(nameRow);
          block.appendChild(canvas);
          container.appendChild(block);

          if (metric === 'temp') { tempCanvases.set(zoneId, canvas); tempValEls.set(zoneId, valSpan); }
          else                   { luxCanvases.set(zoneId, canvas);  luxValEls.set(zoneId, valSpan);  }
        });
      });

      window.addEventListener('resize', () => floorZones.forEach(z => redrawZoneGraph(z)));
    }

    // ── Load building config ──────────────────────────────────────────────────
    async function loadBuilding() {
      try {
        const res = await fetch('/api/building');
        buildingConfig = await res.json();

        floorSelect.innerHTML = '';
        for (const f of buildingConfig.floors || []) {
          const opt = document.createElement('option');
          opt.value = f.id; opt.textContent = f.label || f.id;
          floorSelect.appendChild(opt);
        }

        // Init simulation states for ALL zones (sim runs on all floors simultaneously)
        const allZones = buildingConfig.floors.flatMap(f => f.zones.map(z => z.id));
        allZones.forEach(zId => initZoneSimState(zId));

        // Show first floor's graphs
        const initial = buildingConfig.floors?.[0]?.id;
        if (initial) { floorSelect.value = initial; setFloor(initial); }
        floorSelect.addEventListener('change', () => setFloor(floorSelect.value));

      } catch (_) {}
    }

    loadBuilding();
