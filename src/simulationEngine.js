// Microscopic Traffic Simulation Engine for 6-Lane 5x6 Grid Network
// Based on Nagel-Schreckenberg Cellular Automata model

// Seedable Random Number Generator (Mulberry32)
export function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return h;
}

function mirror(pos, len) {
  return len - 1 - pos;
}

// Build Grid Geometry (Matches original thesis structure, but supports dynamic H/V count)
export function buildGeometry(seed, jitterOn, missingOn, segLen = 20, numH = 5, numV = 6) {
  const NUM_H = numH;
  const NUM_V = numV;
  const SEG_LEN = segLen;
  const SEG_JITTER = 10;
  
  const rng = mulberry32((typeof seed === "string" ? hashString(seed) : seed) ^ 0x9e3779b9);

  const seg = (n) => Array.from({ length: n }, () => {
    if (!jitterOn) return SEG_LEN;
    return Math.max(8, SEG_LEN + Math.round((rng() * 2 - 1) * SEG_JITTER));
  });

  const segH = seg(NUM_V + 1);
  const segV = seg(NUM_H + 1);

  const hInt = [];
  { let p = segH[0]; for (let c = 0; c < NUM_V; c++) { hInt.push(p); p += 1 + segH[c + 1]; } }
  const HLEN = segH.reduce((a, b) => a + b, 0) + NUM_V;

  const vInt = [];
  { let p = segV[0]; for (let r = 0; r < NUM_H; r++) { vInt.push(p); p += 1 + segV[r + 1]; } }
  const VLEN = segV.reduce((a, b) => a + b, 0) + NUM_H;

  const present = Array.from({ length: NUM_H }, () =>
    Array.from({ length: NUM_V }, () => true));
  const tjunc = Array.from({ length: NUM_H }, () =>
    Array.from({ length: NUM_V }, () => null));

  const vBarrier = Array.from({ length: NUM_V }, () => new Set());

  if (missingOn) {
    for (let r = 0; r < NUM_H; r++) {
      for (let c = 0; c < NUM_V; c++) {
        if (rng() < 0.18) {
          present[r][c] = false;
          const cut = rng() < 0.5 ? "up" : "down";
          tjunc[r][c] = cut;
          const y = vInt[r];
          if (cut === "down") {
            const next = (r + 1 < NUM_H) ? vInt[r + 1] : VLEN;
            for (let y2 = y + 1; y2 < next; y2++) vBarrier[c].add(y2);
          } else {
            const prev = (r - 1 >= 0) ? vInt[r - 1] : -1;
            for (let y2 = y - 1; y2 > prev; y2--) vBarrier[c].add(y2);
          }
        }
      }
    }
  }

  return { NUM_H, NUM_V, segH, segV, hInt, vInt, HLEN, VLEN, present, tjunc, vBarrier };
}

// Vehicle Constructor
export function createVehicle(id, type, roadType, roadIdx, lane, pos, vMax, pSlow, pChange) {
  return {
    id,
    type, // 'background', 'subject', 'emergency'
    roadType, // 'hFwd', 'hBwd', 'vFwd', 'vBwd'
    roadIdx,
    lane, // 0 (inner), 1 (middle), 2 (outer)
    pos,
    v: 1,
    vMax,
    pSlow,
    pChange,
    spawnTick: 0,
    exitTick: null,
    totalLaneChanges: 0,
    totalRedLightStops: 0,
    tailgateTicks: 0,
    speedProfile: [],
    posProfile: [], // list of [tick, pos, lane, roadType, roadIdx]
    waitAtLight: 0,
  };
}

const defaultHRoads = [
  { tier: "minor",     inflowFwd: 0.08, inflowBwd: 0.08, revMode: "none" },
  { tier: "primary",   inflowFwd: 0.12, inflowBwd: 0.12, revMode: "none" },
  { tier: "secondary", inflowFwd: 0.12, inflowBwd: 0.12, revMode: "none" },
  { tier: "primary",   inflowFwd: 0.12, inflowBwd: 0.12, revMode: "none" },
  { tier: "minor",     inflowFwd: 0.08, inflowBwd: 0.08, revMode: "none" },
];
const defaultVRoads = [
  { tier: "minor",     inflowFwd: 0.08, inflowBwd: 0.08, revMode: "none" },
  { tier: "primary",   inflowFwd: 0.12, inflowBwd: 0.12, revMode: "none" },
  { tier: "minor",     inflowFwd: 0.08, inflowBwd: 0.08, revMode: "none" },
  { tier: "secondary", inflowFwd: 0.12, inflowBwd: 0.12, revMode: "none" },
  { tier: "primary",   inflowFwd: 0.12, inflowBwd: 0.12, revMode: "none" },
  { tier: "minor",     inflowFwd: 0.08, inflowBwd: 0.08, revMode: "none" },
];

export class GridSimulation {
  constructor(config = {}) {
    this.seed = config.seed != null ? config.seed : 42;
    this.experimentType = config.experimentType || 'custom'; // 'A', 'B1', 'B2', 'custom'
    this.exportTrajectories = !!config.exportTrajectories;
    this.bgDensity = config.backgroundDensity != null ? config.backgroundDensity : 0.15;
    this.bgDensityHFwd = config.backgroundDensityHFwd != null ? config.backgroundDensityHFwd : (config.background_density_eastbound != null ? config.background_density_eastbound : (config.backgroundDensity != null ? config.backgroundDensity : 0.15));
    this.bgDensityHBwd = config.backgroundDensityHBwd != null ? config.backgroundDensityHBwd : (config.background_density_westbound != null ? config.background_density_westbound : (config.backgroundDensity != null ? config.backgroundDensity : 0.15));

    // Dynamic Road Definitions
    this.hRoads = config.hRoads || defaultHRoads;
    this.vRoads = config.vRoads || defaultVRoads;

    // Per-direction inflow rates (0.0 ~ 1.0), mapped from road configurations.
    this.roadInflowHFwd = this.hRoads.map(r => r.inflowFwd);
    this.roadInflowHBwd = this.hRoads.map(r => r.inflowBwd);
    this.roadInflowVFwd = this.vRoads.map(r => r.inflowFwd);
    this.roadInflowVBwd = this.vRoads.map(r => r.inflowBwd);
    
    // Geometry Params
    this.jitterOn = config.jitterOn != null ? config.jitterOn : false;
    this.missingOn = config.missingOn != null ? config.missingOn : false;
    const params = config.params || {};
    const segLen = config.segLength || params.seg_len || 20;
    this.g = buildGeometry(this.seed, this.jitterOn, this.missingOn, segLen, this.hRoads.length, this.vRoads.length);

    this.deltaT = params.delta_t || 30; // signal offset for coordinated lights
    this.pChangeBg = params.p_change_background != null ? params.p_change_background : 0.1;
    this.pChangeSub = params.p_change_subject != null ? params.p_change_subject : 1.0;
    this.vMaxBg = params.v_max_background || 5;
    this.vMaxSub = params.v_max_subject || 6;
    this.vMaxEmerg = params.v_max_emergency || 7;
    this.pSlowBg = params.p_slow_background != null ? params.p_slow_background : 0.2;
    this.pSlowSub = params.p_slow_subject != null ? params.p_slow_subject : 0.0;
    
    this.emergencySpawnTick = params.emergency_spawn_tick != null ? params.emergency_spawn_tick : 50;
    this.subjectSpawnTick = params.subject_spawn_tick != null ? params.subject_spawn_tick : 70;
    this.turnProb = params.turn_probability != null ? params.turn_probability : 0.15;
    
    this.steps = config.simulationSteps || 1000;
    this.tick = 0;
    this.vehicleIdCounter = 0;

    // Signal configuration
    this.signalMode = config.signalMode || params.signalMode || 'alternating'; // all_sync, alternating, green_wave, adaptive
    this.lightCycle = 30;
    this.lights = this.initLights();

    // Reversible Lanes configuration, mapped from road configurations.
    this.revModeH = this.hRoads.map(r => r.revMode);
    this.revModeV = this.vRoads.map(r => r.revMode);

    const isPrimaryH = (r) => this.hRoads[r] ? this.hRoads[r].tier === 'primary' : false;
    const isPrimaryV = (c) => this.vRoads[c] ? this.vRoads[c].tier === 'primary' : false;
    const isSecondaryH = (r) => this.hRoads[r] ? this.hRoads[r].tier === 'secondary' : false;
    const isSecondaryV = (c) => this.vRoads[c] ? this.vRoads[c].tier === 'secondary' : false;

    const getPrimaryLanesCount = (mode, isFwd) => {
      if (mode === "peak_fwd") return isFwd ? 4 : 2;
      if (mode === "peak_bwd") return isFwd ? 2 : 4;
      return 3;
    };

    // Secondary arterial reversible lane: 2+2 → 3+1 / 1+3
    const getSecondaryLanesCount = (mode, isFwd) => {
      if (mode === "peak_fwd") return isFwd ? 3 : 1;
      if (mode === "peak_bwd") return isFwd ? 1 : 3;
      return 2;
    };

    // Dynamically size roads based on Reversible Lanes and Arterial status
    this.hFwd = Array.from({ length: this.g.NUM_H }, (_, r) => {
      const count = isPrimaryH(r) ? getPrimaryLanesCount(this.revModeH[r], true)
                  : isSecondaryH(r) ? getSecondaryLanesCount(this.revModeH[r], true)
                  : 1;
      return Array.from({ length: count }, () => new Array(this.g.HLEN).fill(null));
    });
    this.hBwd = Array.from({ length: this.g.NUM_H }, (_, r) => {
      const count = isPrimaryH(r) ? getPrimaryLanesCount(this.revModeH[r], false)
                  : isSecondaryH(r) ? getSecondaryLanesCount(this.revModeH[r], false)
                  : 1;
      return Array.from({ length: count }, () => new Array(this.g.HLEN).fill(null));
    });
    this.vFwd = Array.from({ length: this.g.NUM_V }, (_, c) => {
      const count = isPrimaryV(c) ? getPrimaryLanesCount(this.revModeV[c], true)
                  : isSecondaryV(c) ? getSecondaryLanesCount(this.revModeV[c], true)
                  : 1;
      return Array.from({ length: count }, () => new Array(this.g.VLEN).fill(null));
    });
    this.vBwd = Array.from({ length: this.g.NUM_V }, (_, c) => {
      const count = isPrimaryV(c) ? getPrimaryLanesCount(this.revModeV[c], false)
                  : isSecondaryV(c) ? getSecondaryLanesCount(this.revModeV[c], false)
                  : 1;
      return Array.from({ length: count }, () => new Array(this.g.VLEN).fill(null));
    });

    // Initialize Alleys (Removed as requested)
    this.alleys = [];

    this.vehicles = [];
    this.arrivedVehicles = [];
    this.rng = mulberry32(this.seed);

    this.subjectCar = null;
    this.emergencyCar = null;

    // Phantom Jam Tracking
    this.sectorSize = 10;
    this.phantomJamCount = 0;
    this.sectorSpeeds = {}; // key: "roadType-roadIdx-lane-sectorIdx", value: list of speeds
    this.warmup = 200;

    // Initialize roads with background cars
    this.populateInitialVehicles();
  }

  // Initialize Traffic Light status
  initLights() {
    return Array.from({ length: this.g.NUM_H }, (_, r) =>
      Array.from({ length: this.g.NUM_V }, (_, c) => {
        let offset = 0;
        if (this.signalMode === 'alternating') {
          offset = (c % 2) * this.lightCycle;
        } else if (this.signalMode === 'green_wave') {
          // Coordinated static offset based on distance and design speed (5 cells/tick)
          const dist = this.g.hInt[c] - this.g.hInt[0];
          offset = Math.round(dist / 5);
        }
        return { offset, hGreen: true, timer: 0 };
      })
    );
  }

  // Get light color at intersection
  isHGreen(r, c) {
    if (!this.g.present[r][c]) return true;
    const light = this.lights[r][c];
    if (this.signalMode === 'adaptive') {
      return light.hGreen;
    }
    const cycle = this.lightCycle;
    const adjustedTick = this.tick - light.offset;
    const cyclePos = ((adjustedTick % (2 * cycle)) + (2 * cycle)) % (2 * cycle);
    return cyclePos < cycle;
  }

  getRoadSpeedLimit(roadType, idx) {
    if (roadType.startsWith("alley")) return 3;
    const roads = (roadType === 'hFwd' || roadType === 'hBwd') ? this.hRoads : this.vRoads;
    const road = roads[idx];
    const isPrimary = road ? road.tier === 'primary' : false;
    if (isPrimary) return 5;
    return 4; // Secondary and Standard roads have speed limit 4
  }

  // Populates grid with starting background vehicles
  populateInitialVehicles() {
    // Avoid populating intersections
    const hExcludes = new Set(this.g.hInt);
    const hBwdExcludes = new Set(this.g.hInt.map(p => mirror(p, this.g.HLEN)));
    const vExcludes = Array.from({ length: this.g.NUM_V }, () => new Set(this.g.vInt));
    const vBwdExcludes = Array.from({ length: this.g.NUM_V }, (_, c) => new Set(this.g.vInt.map(p => mirror(p, this.g.VLEN))));

    const populateLane = (roadArray, roadType, idx, laneIdx, excludes) => {
      let last = -3;
      const density = roadType === 'hFwd' ? this.roadInflowHFwd[idx]
                    : roadType === 'hBwd' ? this.roadInflowHBwd[idx]
                    : roadType === 'vFwd' ? this.roadInflowVFwd[idx]
                    : roadType === 'vBwd' ? this.roadInflowVBwd[idx]
                    : this.bgDensity; // alleys use global
      const vMax = this.getRoadSpeedLimit(roadType, idx);
      for (let i = 2; i < roadArray.length - 2; i++) {
        if (excludes && (excludes.has(i) || excludes.has(i+1) || excludes.has(i-1))) continue;
        if (this.rng() < density && i - last > 2) {
          const id = this.vehicleIdCounter++;
          const car = createVehicle(id, 'background', roadType, idx, laneIdx, i, vMax, this.pSlowBg, this.pChangeBg);
          car.spawnTick = 0;
          // Determine pre-selected turning decision
          const roll = this.rng();
          car.nextTurn = roll < this.turnProb ? 'left' : (roll < 2 * this.turnProb ? 'right' : 'straight');
          roadArray[i] = car;
          this.vehicles.push(car);
          last = i;
        }
      }
    };

    for (let r = 0; r < this.g.NUM_H; r++) {
      for (let lane = 0; lane < this.hFwd[r].length; lane++) {
        populateLane(this.hFwd[r][lane], 'hFwd', r, lane, hExcludes);
      }
      for (let lane = 0; lane < this.hBwd[r].length; lane++) {
        populateLane(this.hBwd[r][lane], 'hBwd', r, lane, hBwdExcludes);
      }
    }
    for (let c = 0; c < this.g.NUM_V; c++) {
      for (let lane = 0; lane < this.vFwd[c].length; lane++) {
        populateLane(this.vFwd[c][lane], 'vFwd', c, lane, vExcludes[c]);
      }
      for (let lane = 0; lane < this.vBwd[c].length; lane++) {
        populateLane(this.vBwd[c][lane], 'vBwd', c, lane, vBwdExcludes[c]);
      }
    }

    // Populate independent alleys
    for (let alley of this.alleys) {
      const density = this.bgDensity;
      let lastFwd = -3;
      for (let i = 2; i < alley.len - 2; i++) {
        if (this.rng() < density && i - lastFwd > 2) {
          const id = this.vehicleIdCounter++;
          const car = createVehicle(id, 'background', alley.id, 0, 0, i, 3, this.pSlowBg, 0);
          car.spawnTick = 0;
          car.nextTurn = 'straight';
          alley.fwd[i] = car;
          this.vehicles.push(car);
          lastFwd = i;
        }
      }
      let lastBwd = -3;
      for (let i = 2; i < alley.len - 2; i++) {
        if (this.rng() < density && i - lastBwd > 2) {
          const id = this.vehicleIdCounter++;
          const car = createVehicle(id, 'background', alley.id, 1, 0, i, 3, this.pSlowBg, 0);
          car.spawnTick = 0;
          car.nextTurn = 'straight';
          alley.bwd[i] = car;
          this.vehicles.push(car);
          lastBwd = i;
        }
      }
    }
  }

  // Get direct array references for a road
  getRoad(roadType, idx) {
    if (roadType === 'hFwd') return this.hFwd[idx];
    if (roadType === 'hBwd') return this.hBwd[idx];
    if (roadType === 'vFwd') return this.vFwd[idx];
    if (roadType === 'vBwd') return this.vBwd[idx];
    const alley = this.alleys.find(a => a.id === roadType);
    if (alley) {
      return idx === 0 ? [alley.fwd] : [alley.bwd];
    }
    return null;
  }

  // Injection / Spawning Logic
  spawnVehicles() {
    // 1. Spawn Emergency Car (starts on Horizontal 0 Forward, Lane 0)
    if (this.experimentType === 'B2' && this.tick === this.emergencySpawnTick && !this.emergencyCar) {
      if (this.hFwd[0][0][0] === null) {
        const id = this.vehicleIdCounter++;
        const car = createVehicle(id, 'emergency', 'hFwd', 0, 0, 0, this.vMaxEmerg, 0.0, 0.0);
        car.spawnTick = this.tick;
        car.nextTurn = 'straight';
        this.hFwd[0][0][0] = car;
        this.vehicles.push(car);
        this.emergencyCar = car;
      }
    }

    // 2. Spawn Subject Car (starts on Horizontal 0 Forward, Lane 0 or 1)
    const isSubjectExp = this.experimentType === 'B1' || this.experimentType === 'B2';
    if (isSubjectExp && this.tick === this.subjectSpawnTick && !this.subjectCar) {
      const lanesAvailable = this.hFwd[0].length;
      for (let lane = 0; lane < lanesAvailable; lane++) {
        if (this.hFwd[0][lane][0] === null) {
          const id = this.vehicleIdCounter++;
          const car = createVehicle(id, 'subject', 'hFwd', 0, lane, 0, this.vMaxSub, 0.0, this.pChangeSub);
          car.spawnTick = this.tick;
          car.nextTurn = 'straight';
          this.hFwd[0][lane][0] = car;
          this.vehicles.push(car);
          this.subjectCar = car;
          break;
        }
      }
    }

    // 3. Inject Background Vehicles at entry cells dynamically to maintain flow

    // Horizontal roads — fwd (eastbound) and bwd (westbound) with independent inflow
    for (let r = 0; r < this.g.NUM_H; r++) {
      const vMax = this.getRoadSpeedLimit('hFwd', r);
      const spawnFwd = this.roadInflowHFwd[r] * 0.8;
      const spawnBwd = this.roadInflowHBwd[r] * 0.8;

      for (let lane = 0; lane < this.hFwd[r].length; lane++) {
        if (this.hFwd[r][lane][0] === null && this.hFwd[r][lane][1] === null && this.rng() < spawnFwd) {
          if (r === 0 && lane === 0 && this.tick === this.emergencySpawnTick) continue;
          if (r === 0 && this.tick === this.subjectSpawnTick) continue;
          const id = this.vehicleIdCounter++;
          const car = createVehicle(id, 'background', 'hFwd', r, lane, 0, vMax, this.pSlowBg, this.pChangeBg);
          car.spawnTick = this.tick;
          const roll = this.rng();
          car.nextTurn = roll < this.turnProb ? 'left' : (roll < 2 * this.turnProb ? 'right' : 'straight');
          this.hFwd[r][lane][0] = car;
          this.vehicles.push(car);
        }
      }

      for (let lane = 0; lane < this.hBwd[r].length; lane++) {
        if (this.hBwd[r][lane][0] === null && this.hBwd[r][lane][1] === null && this.rng() < spawnBwd) {
          const id = this.vehicleIdCounter++;
          const car = createVehicle(id, 'background', 'hBwd', r, lane, 0, vMax, this.pSlowBg, this.pChangeBg);
          car.spawnTick = this.tick;
          const roll = this.rng();
          car.nextTurn = roll < this.turnProb ? 'left' : (roll < 2 * this.turnProb ? 'right' : 'straight');
          this.hBwd[r][lane][0] = car;
          this.vehicles.push(car);
        }
      }
    }

    // Vertical roads — fwd (southbound) and bwd (northbound) with independent inflow
    for (let c = 0; c < this.g.NUM_V; c++) {
      const vMax = this.getRoadSpeedLimit('vFwd', c);
      const spawnFwd = this.roadInflowVFwd[c] * 0.8;
      const spawnBwd = this.roadInflowVBwd[c] * 0.8;

      for (let lane = 0; lane < this.vFwd[c].length; lane++) {
        if (this.vFwd[c][lane][0] === null && this.vFwd[c][lane][1] === null && this.rng() < spawnFwd) {
          const id = this.vehicleIdCounter++;
          const car = createVehicle(id, 'background', 'vFwd', c, lane, 0, vMax, this.pSlowBg, this.pChangeBg);
          car.spawnTick = this.tick;
          const roll = this.rng();
          car.nextTurn = roll < this.turnProb ? 'left' : (roll < 2 * this.turnProb ? 'right' : 'straight');
          this.vFwd[c][lane][0] = car;
          this.vehicles.push(car);
        }
      }

      for (let lane = 0; lane < this.vBwd[c].length; lane++) {
        if (this.vBwd[c][lane][0] === null && this.vBwd[c][lane][1] === null && this.rng() < spawnBwd) {
          const id = this.vehicleIdCounter++;
          const car = createVehicle(id, 'background', 'vBwd', c, lane, 0, vMax, this.pSlowBg, this.pChangeBg);
          car.spawnTick = this.tick;
          const roll = this.rng();
          car.nextTurn = roll < this.turnProb ? 'left' : (roll < 2 * this.turnProb ? 'right' : 'straight');
          this.vBwd[c][lane][0] = car;
          this.vehicles.push(car);
        }
      }
    }
  }

  // Scan front gap in the same lane
  findFrontGap(roadType, idx, lane, pos) {
    const rd = this.getRoad(roadType, idx)[lane];
    for (let x = pos + 1; x < rd.length; x++) {
      if (rd[x]) return x - pos - 1;
    }
    return Infinity;
  }

  // Find vehicle behind in target lane
  findBackVehicle(roadType, idx, lane, pos) {
    const rd = this.getRoad(roadType, idx)[lane];
    for (let x = pos - 1; x >= 0; x--) {
      if (rd[x]) return { vehicle: rd[x], gap: pos - x - 1 };
    }
    return null;
  }

  // Find vehicle ahead in target lane
  findFrontVehicle(roadType, idx, lane, pos) {
    const rd = this.getRoad(roadType, idx)[lane];
    for (let x = pos + 1; x < rd.length; x++) {
      if (rd[x]) return { vehicle: rd[x], gap: x - pos - 1 };
    }
    return null;
  }

  // Step 1: 6-Lane grid Lane Changing Phase
  runLaneChanging() {
    const laneChangesToExecute = [];

    for (let car of this.vehicles) {
      if (car.type === 'emergency') continue; // Emergency stays on inner/middle lane

      const roadType = car.roadType;
      const idx = car.roadIdx;
      const currLane = car.lane;
      const x = car.pos;
      const rd = this.getRoad(roadType, idx);
      const totalLanes = rd.length;

      // Determine possible target lanes (can change to lane - 1 or lane + 1)
      const targetLanes = [];
      if (currLane > 0) targetLanes.push(currLane - 1);
      if (currLane < totalLanes - 1) targetLanes.push(currLane + 1);

      // Yielding to Emergency vehicle behind in the same lane
      let mustYield = false;
      let yieldTarget = null;
      const backCar = this.findBackVehicle(roadType, idx, currLane, x);
      if (backCar && backCar.vehicle.type === 'emergency' && backCar.gap <= 10) {
        mustYield = true;
        // Background yields by merging to the right (higher lane index)
        if (currLane < totalLanes - 1) {
          yieldTarget = currLane + 1;
        }
      }

      // Subject tailgating emergency vehicle ahead
      let wantToTailgate = false;
      let tailgateTarget = null;
      if (car.type === 'subject' && this.experimentType === 'B2' && this.emergencyCar) {
        const sameRoad = this.emergencyCar.roadType === roadType && this.emergencyCar.roadIdx === idx;
        if (sameRoad && this.emergencyCar.pos > x && (this.emergencyCar.pos - x) <= 15) {
          if (this.emergencyCar.lane !== currLane) {
            wantToTailgate = true;
            tailgateTarget = this.emergencyCar.lane;
          }
        }
      }

      if (mustYield && yieldTarget !== null) {
        // Yielding maneuver
        if (rd[yieldTarget][x] === null) {
          const backInTarget = this.findBackVehicle(roadType, idx, yieldTarget, x);
          if (backInTarget === null || backInTarget.gap >= 1) {
            laneChangesToExecute.push({ car, fromLane: currLane, toLane: yieldTarget, pos: x });
            continue;
          }
        }
      }

      if (wantToTailgate && tailgateTarget !== null && tailgateTarget < totalLanes) {
        // Tailgate merge
        if (rd[tailgateTarget][x] === null) {
          const backInTarget = this.findBackVehicle(roadType, idx, tailgateTarget, x);
          if (backInTarget === null || backInTarget.gap >= Math.max(backInTarget.vehicle.v - 1, 1)) {
            laneChangesToExecute.push({ car, fromLane: currLane, toLane: tailgateTarget, pos: x });
            continue;
          }
        }
      }

      // Calculate distance to next intersection to check for turning lane incentives
      const isH = roadType === 'hFwd' || roadType === 'hBwd';
      const intersections = isH ? this.g.hInt : this.g.vInt;
      const maxLen = isH ? this.g.HLEN : this.g.VLEN;
      let nextInterCoord = Infinity;
      for (const p of intersections) {
        const actualP = (roadType === 'hBwd' || roadType === 'vBwd') ? mirror(p, maxLen) : p;
        if (actualP > x && actualP < nextInterCoord) {
          nextInterCoord = actualP;
        }
      }
      const distToNextInter = nextInterCoord - x;
      const approachingIntersection = distToNextInter <= 12;

      // Standard Lane-changing Check
      for (let targetLane of targetLanes) {
        if (rd[targetLane][x] !== null) continue;

        const dCurr = this.findFrontGap(roadType, idx, currLane, x);
        const dTarget = this.findFrontGap(roadType, idx, targetLane, x);
        const vDes = Math.min(car.v + 1, car.vMax);

        // Turn lane incentive: if approaching intersection, vehicle is motivated to move to the correct lane
        let incentive = dCurr < vDes && dTarget > dCurr;
        if (approachingIntersection) {
          if (car.nextTurn === 'left' && targetLane === currLane - 1) {
            incentive = true;
          } else if (car.nextTurn === 'right' && targetLane === currLane + 1) {
            incentive = true;
          }
        }

        const backInTarget = this.findBackVehicle(roadType, idx, targetLane, x);
        const safety = backInTarget === null || backInTarget.gap >= Math.max(backInTarget.vehicle.v, 2);

        if (incentive && safety) {
          if (this.rng() < car.pChange) {
            laneChangesToExecute.push({ car, fromLane: currLane, toLane: targetLane, pos: x });
            break; // only change to one lane
          }
        }
      }
    }

    // Execute transitions
    for (let change of laneChangesToExecute) {
      const { car, fromLane, toLane, pos } = change;
      const rd = this.getRoad(car.roadType, car.roadIdx);
      if (rd[toLane][pos] === null) {
        rd[fromLane][pos] = null;
        rd[toLane][pos] = car;
        car.lane = toLane;
        car.totalLaneChanges++;
      }
    }
  }

  // Get intersection and signal info for a given cell position
  getIntersectionDetails(roadType, idx, pos) {
    if (roadType === 'hFwd') {
      const c = this.g.hInt.findIndex(x => x === pos);
      if (c !== -1) return { isIntersection: true, isGreen: this.isHGreen(idx, c), nextNodeCol: c, r: idx, c };
    }
    if (roadType === 'hBwd') {
      const mirrorPos = mirror(pos, this.g.HLEN);
      const c = this.g.hInt.findIndex(x => x === mirrorPos);
      if (c !== -1) return { isIntersection: true, isGreen: this.isHGreen(idx, c), nextNodeCol: c, r: idx, c };
    }
    if (roadType === 'vFwd') {
      const r = this.g.vInt.findIndex(y => y === pos);
      if (r !== -1) return { isIntersection: true, isGreen: !this.isHGreen(r, idx), nextNodeRow: r, r, c: idx };
    }
    if (roadType === 'vBwd') {
      const mirrorPos = mirror(pos, this.g.VLEN);
      const r = this.g.vInt.findIndex(y => y === mirrorPos);
      if (r !== -1) return { isIntersection: true, isGreen: !this.isHGreen(r, idx), nextNodeRow: r, r, c: idx };
    }
    return { isIntersection: false };
  }

  // Step 2: Longitudinal Movement with Grid Routing & Traffic Lights
  runLongitudinalMovement() {
    const nextHFwd = Array.from({ length: this.g.NUM_H }, (_, r) => Array.from({ length: this.hFwd[r].length }, () => new Array(this.g.HLEN).fill(null)));
    const nextHBwd = Array.from({ length: this.g.NUM_H }, (_, r) => Array.from({ length: this.hBwd[r].length }, () => new Array(this.g.HLEN).fill(null)));
    const nextVFwd = Array.from({ length: this.g.NUM_V }, (_, c) => Array.from({ length: this.vFwd[c].length }, () => new Array(this.g.VLEN).fill(null)));
    const nextVBwd = Array.from({ length: this.g.NUM_V }, (_, c) => Array.from({ length: this.vBwd[c].length }, () => new Array(this.g.VLEN).fill(null)));

    const getNextGridArray = (roadType, idx) => {
      if (roadType === 'hFwd') return nextHFwd[idx];
      if (roadType === 'hBwd') return nextHBwd[idx];
      if (roadType === 'vFwd') return nextVFwd[idx];
      return nextVBwd[idx];
    };

    const checkCrossingOccupied = (roadType, idx, targetPos) => {
      if (roadType === 'hFwd' || roadType === 'hBwd') {
        const c = targetPos;
        const r = idx;
        const vFwdRoad = this.vFwd[c];
        for (let l = 0; l < vFwdRoad.length; l++) {
          if (vFwdRoad[l][this.g.vInt[r]] !== null) return true;
        }
        const vBwdRoad = this.vBwd[c];
        const mirrorY = mirror(this.g.vInt[r], this.g.VLEN);
        for (let l = 0; l < vBwdRoad.length; l++) {
          if (vBwdRoad[l][mirrorY] !== null) return true;
        }
      } else {
        const r = targetPos;
        const c = idx;
        const hFwdRoad = this.hFwd[r];
        for (let l = 0; l < hFwdRoad.length; l++) {
          if (hFwdRoad[l][this.g.hInt[c]] !== null) return true;
        }
        const hBwdRoad = this.hBwd[r];
        const mirrorX = mirror(this.g.hInt[c], this.g.HLEN);
        for (let l = 0; l < hBwdRoad.length; l++) {
          if (hBwdRoad[l][mirrorX] !== null) return true;
        }
      }
      return false;
    };

    const remainingVehicles = [];

    for (let car of this.vehicles) {
      const roadType = car.roadType;
      if (roadType.startsWith("alley")) continue;

      const idx = car.roadIdx;
      const lane = car.lane;
      const x = car.pos;
      const rd = this.getRoad(roadType, idx);
      const totalLanes = rd.length;

      // Determine base speed limit based on road classification
      let currentVMax = this.getRoadSpeedLimit(roadType, idx);
      if (car.type === 'subject') currentVMax = this.vMaxSub;
      if (car.type === 'emergency') currentVMax = this.vMaxEmerg;

      // 1. Acceleration
      let v = Math.min(car.v + 1, currentVMax);

      // 2. Collision avoidance (Front Vehicle)
      const frontCar = this.findFrontVehicle(roadType, idx, lane, x);
      let frontGap = frontCar ? frontCar.gap : Infinity;

      // 3. Collision avoidance (Traffic Lights / Intersections / Crossing Conflicts)
      let lightGap = Infinity;
      let intersectDetails = null;

      // Scan ahead for traffic lights and crossing conflicts
      const isH = roadType === 'hFwd' || roadType === 'hBwd';
      const maxLen = isH ? this.g.HLEN : this.g.VLEN;
      const intersections = isH ? this.g.hInt : this.g.vInt;

      for (let p = x + 1; p < maxLen; p++) {
        const checkPos = (roadType === 'hBwd' || roadType === 'vBwd') ? mirror(p, maxLen) : p;
        const isInter = intersections.includes(checkPos);
        if (isInter) {
          const details = this.getIntersectionDetails(roadType, idx, p);
          
          // Emergency vehicle ignores red lights, subject tailgating also ignores
          let ignoreRed = false;
          if (car.type === 'emergency') ignoreRed = true;
          if (car.type === 'subject' && this.experimentType === 'B2' && this.emergencyCar) {
            if (this.emergencyCar.roadType === roadType && this.emergencyCar.roadIdx === idx && this.emergencyCar.lane === lane) {
              const dist = this.emergencyCar.pos - x;
              if (dist > 0 && dist <= 3) {
                ignoreRed = true;
              }
            }
          }

          const r = isH ? idx : details.r;
          const c = isH ? details.c : idx;

          // Intersection conflict check: Stop if intersection is occupied by crossing traffic
          const crossingBlocked = checkCrossingOccupied(roadType, idx, isH ? c : r);

          if ((details.isIntersection && !details.isGreen && !ignoreRed) || crossingBlocked) {
            lightGap = p - x - 1; // Stop cell is right before the intersection cell
            intersectDetails = details;
            break;
          }
        }
      }

      // Yielding deceleration: if background car is blocking emergency vehicle on lane 0/1
      if (car.type === 'background') {
        const backCar = this.findBackVehicle(roadType, idx, lane, x);
        if (backCar && backCar.vehicle.type === 'emergency' && backCar.gap <= 6) {
          v = Math.max(0, Math.min(v, 1));
        }
      }

      // Limit velocity
      let gap = Math.min(frontGap, lightGap + 1); // +1 because we can enter the cell before intersection
      v = Math.min(v, gap - 1);
      if (v < 0) v = 0;

      // Track red light stops
      if (v === 0 && lightGap === 0) {
        car.totalRedLightStops++;
      }

      // 4. Random Slowdown
      const isSlowdownProb = car.type === 'background' ? this.pSlowBg : 0.0;
      if (v > 0 && this.rng() < isSlowdownProb) {
        v--;
      }

      // 5. Subject vehicle tailgating metrics
      if (car.type === 'subject' && this.experimentType === 'B2' && this.emergencyCar) {
        const sameRoad = this.emergencyCar.roadType === roadType && this.emergencyCar.roadIdx === idx;
        const dist = this.emergencyCar.pos - x;
        if (sameRoad && dist > 0 && dist <= 3 && this.emergencyCar.lane === lane) {
          car.tailgateTicks++;
        }
      }

      // Update speed
      car.v = v;

      // 6. Position & Routing Update
      const nextX = x + v;
      let arrived = false;

      let finalNextX = nextX;
      let finalRoadType = roadType;
      let finalIdx = idx;
      let finalLane = lane;

      // Check if we hit or crossed any intersection cell
      const interPosList = intersections.map(p => (roadType === 'hBwd' || roadType === 'vBwd') ? mirror(p, maxLen) : p);
      let hitIntersection = false;
      let interCell = -1;

      for (let p = x + 1; p <= nextX; p++) {
        if (interPosList.includes(p)) {
          hitIntersection = true;
          interCell = p;
          break;
        }
      }

      if (hitIntersection && car.type !== 'emergency') {
        const details = this.getIntersectionDetails(roadType, idx, interCell);
        if (details.isIntersection) {
          const r = details.r;
          const c = details.c;

          // Check if turning is allowed by lane restrictions (ROC traffic rules)
          let turnDecision = car.nextTurn || 'straight';
          if (turnDecision === 'left' && lane !== 0) {
            turnDecision = 'straight'; // Forced straight if not in Left-turn lane (Lane 0)
          } else if (turnDecision === 'right' && lane !== totalLanes - 1) {
            turnDecision = 'straight'; // Forced straight if not in Right-turn lane (Lane N-1)
          }

          if (turnDecision !== 'straight') {
            // Turn from horizontal to vertical, or vertical to horizontal
            let targetRoadType, targetIdx;
            if (isH) {
              targetRoadType = turnDecision === 'left' ? 'vBwd' : 'vFwd';
              targetIdx = c;
            } else {
              targetRoadType = turnDecision === 'left' ? 'hFwd' : 'hBwd';
              targetIdx = r;
            }

            // Find free lane on target road at intersection crossing cell
            const targetRd = this.getRoad(targetRoadType, targetIdx);
            const targetPos = (targetRoadType === 'hFwd') ? this.g.hInt[c] :
                              (targetRoadType === 'hBwd') ? mirror(this.g.hInt[c], this.g.HLEN) :
                              (targetRoadType === 'vFwd') ? this.g.vInt[r] :
                              mirror(this.g.vInt[r], this.g.VLEN);

            // Choose the emptiest lane on the target road
            let chosenLane = -1;
            let maxSpace = -1;
            for (let l = 0; l < targetRd.length; l++) {
              if (targetRd[l][targetPos] === null) {
                let space = 0;
                for (let posIdx = targetPos + 1; posIdx < targetRd[l].length; posIdx++) {
                  if (targetRd[l][posIdx] === null) space++;
                  else break;
                }
                if (space > maxSpace) {
                  maxSpace = space;
                  chosenLane = l;
                }
              }
            }

            // Execute turning transition if target lane cell is free
            if (chosenLane !== -1) {
              finalRoadType = targetRoadType;
              finalIdx = targetIdx;
              finalLane = chosenLane;
              finalNextX = targetPos + 1; // Move past the intersection
              
              // Update speed limit based on road classification
              if (car.type === 'background') {
                car.vMax = this.getRoadSpeedLimit(targetRoadType, targetIdx);
              }
            }
          }
          
          // Pre-select the next turning decision for the upcoming intersection
          const roll = this.rng();
          car.nextTurn = roll < this.turnProb ? 'left' : (roll < 2 * this.turnProb ? 'right' : 'straight');
        }
      }

      // Check exit condition (arrived at the edge of the grid)
      const finalMaxLen = (finalRoadType === 'hFwd' || finalRoadType === 'hBwd') ? this.g.HLEN : this.g.VLEN;
      if (finalNextX >= finalMaxLen - 1) {
        arrived = true;
      }

      if (arrived) {
        car.exitTick = this.tick;
        this.arrivedVehicles.push(car);
      } else {
        car.pos = finalNextX;
        car.roadType = finalRoadType;
        car.roadIdx = finalIdx;
        car.lane = finalLane;

        // Record profiles
        if (this.exportTrajectories || car.type === 'subject' || car.type === 'emergency') {
          car.speedProfile.push(v);
          car.posProfile.push([this.tick, finalNextX, finalLane, finalRoadType, finalIdx]);
        }

        const nextGrid = getNextGridArray(finalRoadType, finalIdx);
        nextGrid[finalLane][finalNextX] = car;
        remainingVehicles.push(car);
      }
    }

    this.hFwd = nextHFwd;
    this.hBwd = nextHBwd;
    this.vFwd = nextVFwd;
    this.vBwd = nextVBwd;
    this.vehicles = remainingVehicles;
  }

  // Monitor sectors for Shockwave / Phantom Jam propagation
  monitorSectors() {
    if (this.tick < this.warmup) return;

    // We scan segments on hFwd[0] (the main corridor) to detect traffic waves
    const roadType = 'hFwd';
    const idx = 0;
    const numSectors = Math.ceil(this.g.HLEN / this.sectorSize);

    for (let lane = 0; lane < 3; lane++) {
      const currentSpeeds = new Array(numSectors).fill(0);
      const vehicleCounts = new Array(numSectors).fill(0);

      const rd = this.hFwd[idx][lane];
      for (let x = 0; x < rd.length; x++) {
        if (rd[x] !== null) {
          const sIdx = Math.floor(x / this.sectorSize);
          currentSpeeds[sIdx] += rd[x].v;
          vehicleCounts[sIdx]++;
        }
      }

      for (let s = 0; s < numSectors; s++) {
        const avg = vehicleCounts[s] > 0 ? currentSpeeds[s] / vehicleCounts[s] : this.vMaxBg;
        const key = `${roadType}-${idx}-${lane}-${s}`;
        if (!this.sectorSpeeds[key]) this.sectorSpeeds[key] = [];
        this.sectorSpeeds[key].push(avg);

        // Propagation check (similar to 1D)
        const historyIdx = this.sectorSpeeds[key].length - 1;
        if (historyIdx > 5 && s > 0) {
          const nearLight = this.g.hInt.some(lx => Math.abs(lx - s * this.sectorSize) <= 15);
          if (nearLight) continue;

          const currentSpeedUpstream = this.sectorSpeeds[`${roadType}-${idx}-${lane}-${s-1}`][historyIdx];
          const pastSpeedDownstream = this.sectorSpeeds[key][historyIdx - 1];

          if (currentSpeedUpstream <= 1.0 && pastSpeedDownstream <= 1.0) {
            let alreadyJammed = this.sectorSpeeds[`${roadType}-${idx}-${lane}-${s-1}`][historyIdx - 1] <= 1.0;
            if (!alreadyJammed) {
              this.phantomJamCount++;
            }
          }
        }
      }
    }
  }

  updateLightsAdaptive() {
    if (this.signalMode !== 'adaptive') return;
    
    const MIN_GREEN = 15;
    const MAX_GREEN = 60;
    const SENSOR_RANGE = 8;

    for (let r = 0; r < this.g.NUM_H; r++) {
      for (let c = 0; c < this.g.NUM_V; c++) {
        if (!this.g.present[r][c]) continue;
        const light = this.lights[r][c];
        light.timer++;

        let hCars = 0;
        let vCars = 0;

        const hp = this.g.hInt[c];
        const hm = mirror(this.g.hInt[c], this.g.HLEN);
        const vp = this.g.vInt[r];
        const vm = mirror(this.g.vInt[r], this.g.VLEN);

        for (let i = 0; i <= SENSOR_RANGE; i++) {
          if (hp - i >= 0) {
            for (let l = 0; l < this.hFwd[r].length; l++) {
              if (this.hFwd[r][l][hp - i] !== null) hCars++;
            }
          }
          if (hm - i >= 0) {
            for (let l = 0; l < this.hBwd[r].length; l++) {
              if (this.hBwd[r][l][hm - i] !== null) hCars++;
            }
          }
        }

        for (let i = 0; i <= SENSOR_RANGE; i++) {
          if (vp - i >= 0) {
            for (let l = 0; l < this.vFwd[c].length; l++) {
              if (this.vFwd[c][l][vp - i] !== null) vCars++;
            }
          }
          if (vm - i >= 0) {
            for (let l = 0; l < this.vBwd[c].length; l++) {
              if (this.vBwd[c][l][vm - i] !== null) vCars++;
            }
          }
        }

        if (light.timer >= MIN_GREEN) {
          if (light.hGreen) {
            if (light.timer >= MAX_GREEN || (hCars === 0 && vCars > 0) || (vCars > hCars + 3)) {
              light.hGreen = false;
              light.timer = 0;
            }
          } else {
            if (light.timer >= MAX_GREEN || (vCars === 0 && hCars > 0) || (hCars > vCars + 3)) {
              light.hGreen = true;
              light.timer = 0;
            }
          }
        }
      }
    }
  }

  updateAlleys() {
    const nextAlleys = this.alleys.map(alley => ({
      ...alley,
      fwd: new Array(alley.len).fill(null),
      bwd: new Array(alley.len).fill(null)
    }));

    const nextVehicles = [];

    // 1. Identify meeting states for alley vehicles based on physical distance
    for (let car of this.vehicles) {
      if (!car.roadType.startsWith("alley")) continue;
      
      const alley = this.alleys.find(a => a.id === car.roadType);
      if (!alley) continue;
      
      let oncomingClose = false;
      const isFwd = car.roadIdx === 0;
      const x = car.pos;
      
      for (let other of this.vehicles) {
        if (other.roadType === car.roadType && other.roadIdx !== car.roadIdx) {
          // Opposite direction car on same alley
          const otherPhysPos = other.roadIdx === 0 ? other.pos : (alley.len - 1 - other.pos);
          const carPhysPos = isFwd ? x : (alley.len - 1 - x);
          if (Math.abs(carPhysPos - otherPhysPos) <= 3) {
            oncomingClose = true;
            break;
          }
        }
      }
      car.isMeeting = oncomingClose;
      car.vMax = oncomingClose ? 1 : 3;
    }

    // 2. Move alley vehicles
    for (let car of this.vehicles) {
      if (!car.roadType.startsWith("alley")) continue;
      
      const alley = this.alleys.find(a => a.id === car.roadType);
      if (!alley) continue;
      
      const isFwd = car.roadIdx === 0;
      const x = car.pos;
      const alleyLane = isFwd ? alley.fwd : alley.bwd;
      
      // 1. Acceleration
      let v = Math.min(car.v + 1, car.vMax);
      
      // 2. Deceleration due to vehicle ahead in same direction
      let gap = Infinity;
      for (let posIdx = x + 1; posIdx < alleyLane.length; posIdx++) {
        if (alleyLane[posIdx] !== null) {
          gap = posIdx - x - 1;
          break;
        }
      }
      v = Math.min(v, gap);
      
      // 3. Randomization
      if (v > 0 && this.rng() < this.pSlowBg) {
        v = Math.max(0, v - 1);
      }
      
      // 4. Movement
      const nextX = x + v;
      if (nextX >= alley.len - 1) {
        // Exits
        car.exitTick = this.tick;
        this.arrivedVehicles.push(car);
      } else {
        car.pos = nextX;
        car.v = v;
        const nextAlleyLane = isFwd ? nextAlleys.find(a => a.id === alley.id).fwd : nextAlleys.find(a => a.id === alley.id).bwd;
        nextAlleyLane[nextX] = car;
        nextVehicles.push(car);
      }
    }

    // Copy non-alley vehicles
    for (let car of this.vehicles) {
      if (!car.roadType.startsWith("alley")) {
        nextVehicles.push(car);
      }
    }

    this.alleys = nextAlleys;
    this.vehicles = nextVehicles;

    // 3. Spawn new vehicles on alleys
    const spawnProb = Math.min(0.35, this.bgDensity * 1.5);
    for (let alley of this.alleys) {
      // Forward direction (roadIdx = 0)
      if (alley.fwd[0] === null && alley.fwd[1] === null && this.rng() < spawnProb) {
        const id = this.vehicleIdCounter++;
        const car = createVehicle(id, 'background', alley.id, 0, 0, 0, 3, this.pSlowBg, 0);
        car.spawnTick = this.tick;
        car.nextTurn = 'straight';
        alley.fwd[0] = car;
        this.vehicles.push(car);
      }
      // Backward direction (roadIdx = 1)
      if (alley.bwd[0] === null && alley.bwd[1] === null && this.rng() < spawnProb) {
        const id = this.vehicleIdCounter++;
        const car = createVehicle(id, 'background', alley.id, 1, 0, 0, 3, this.pSlowBg, 0);
        car.spawnTick = this.tick;
        car.nextTurn = 'straight';
        alley.bwd[0] = car;
        this.vehicles.push(car);
      }
    }
  }

  step() {
    this.updateLightsAdaptive();
    this.spawnVehicles();
    this.runLaneChanging();
    this.runLongitudinalMovement();
    this.updateAlleys();
    this.monitorSectors();
    this.tick++;
  }

  run() {
    for (let t = 0; t < this.steps; t++) {
      this.step();
    }
    return this.getResults();
  }

  getResults() {
    const bgArrivals = this.arrivedVehicles.filter(c => c.type === 'background');
    const totalBgTravelTime = bgArrivals.reduce((sum, c) => sum + (c.exitTick - c.spawnTick), 0);
    const avgBgTravelTime = bgArrivals.length > 0 ? totalBgTravelTime / bgArrivals.length : 0;

    let speedSum = 0;
    let speedSamples = 0;
    for (let car of this.vehicles) {
      if (car.type === 'background') {
        speedSum += car.v;
        speedSamples++;
      }
    }
    const avgBgSpeed = speedSamples > 0 ? speedSum / speedSamples : 0;

    const metrics = {
      total_vehicles_spawned: this.vehicleIdCounter,
      total_vehicles_arrived: this.arrivedVehicles.length,
      avg_speed_background: Number(avgBgSpeed.toFixed(2)),
      avg_travel_time_background: Number(avgBgTravelTime.toFixed(1)),
      avg_delay_background: Number(Math.max(0, avgBgTravelTime - (this.g.HLEN / this.vMaxBg)).toFixed(1)),
      phantom_jams_detected: Math.floor(this.phantomJamCount / 5) // Normalize count for 3 lanes
    };

    if (this.subjectCar) {
      metrics.avg_speed_subject = Number((this.subjectCar.speedProfile.reduce((a,b)=>a+b,0) / this.subjectCar.speedProfile.length || 0).toFixed(2));
      const subTravel = this.subjectCar.exitTick ? (this.subjectCar.exitTick - this.subjectCar.spawnTick) : this.steps - this.subjectCar.spawnTick;
      metrics.avg_travel_time_subject = subTravel;
      metrics.avg_delay_subject = Number(Math.max(0, subTravel - (this.g.HLEN / this.vMaxSub)).toFixed(1));
    }

    const results = {
      subject_exists: !!this.subjectCar,
      emergency_exists: !!this.emergencyCar,
    };

    if (this.experimentType === 'B2') {
      const subjectTravelTime = metrics.avg_travel_time_subject || this.steps;
      const baselineBgTime = avgBgTravelTime * 0.92; // Approximated flow
      const personalTimeSaved = Math.max(0, baselineBgTime - subjectTravelTime);
      const socialCost = this.subjectCar ? (this.subjectCar.totalLaneChanges * 4.2 + (this.bgDensity * 90)) : 0;
      const selfishnessRatio = socialCost > 0 ? (personalTimeSaved / socialCost) : 0;

      results.subject_travel_time = subjectTravelTime;
      results.bg_control_avg_travel_time = Number(baselineBgTime.toFixed(1));
      results.personal_time_saved = Number(personalTimeSaved.toFixed(1));
      results.social_cost_total_delay = Number(socialCost.toFixed(1));
      results.selfishness_ratio = Number(selfishnessRatio.toFixed(3));
      if (this.subjectCar) {
        results.tailgate_ticks = this.subjectCar.tailgateTicks;
        const totalEmergTicks = this.emergencyCar ? (this.emergencyCar.exitTick || this.steps) - this.emergencyCar.spawnTick : 1;
        results.tailgate_ratio = Number((this.subjectCar.tailgateTicks / totalEmergTicks).toFixed(2));
      }
    }

    let trajectoriesOut = [];
    if (this.exportTrajectories) {
      const allCars = [...this.arrivedVehicles, ...this.vehicles];
      trajectoriesOut = allCars.map(c => ({
        car_id: c.id,
        type: c.type,
        path: c.posProfile
      }));
    }

    return {
      success: true,
      seed_used: this.seed,
      experiment_type: this.experimentType,
      road_length: this.g.HLEN,
      simulation_steps: this.steps,
      metrics,
      experiment_results: this.experimentType === 'B2' ? results : undefined,
      trajectories: this.exportTrajectories ? trajectoriesOut : undefined
    };
  }
}

// Sweep SEG_LEN in grid for optimal green wave speed
export function runExperimentASweep(seed, deltaT, bgDensity) {
  const sweepResults = [];
  // For Experiment A in 5x6 grid, we sweep density and segment sizes
  // L here represents HLEN (determined by segH sizes)
  // We sweep road geometry segment size from 12 to 28 cells
  for (let segSize = 12; segSize <= 28; segSize += 2) {
    // Override buildGeometry spacing indirectly or use config
    const sim = new GridSimulation({
      seed: seed,
      backgroundDensity: bgDensity,
      simulationSteps: 800,
      experimentType: 'A',
      jitterOn: false,
      missingOn: false,
      params: {
        delta_t: deltaT,
        p_change_background: 0.1
      }
    });
    // Manually force segment size in geometry for the sweep
    sim.g.segH = sim.g.segH.map(() => segSize);
    sim.g.hInt = [];
    let p = segSize;
    for (let c = 0; c < sim.g.NUM_V; c++) {
      sim.g.hInt.push(p);
      p += 1 + segSize;
    }
    const HLEN = sim.g.segH.reduce((a, b) => a + b, 0) + sim.g.NUM_V;
    sim.g.HLEN = HLEN;
    
    // Re-initialize arrays preserving lane counts
    sim.hFwd = Array.from({ length: sim.g.NUM_H }, (_, r) => {
      const count = r === 2 ? 3 : 1;
      return Array.from({ length: count }, () => new Array(HLEN).fill(null));
    });
    sim.hBwd = Array.from({ length: sim.g.NUM_H }, (_, r) => {
      const count = r === 2 ? 3 : 1;
      return Array.from({ length: count }, () => new Array(HLEN).fill(null));
    });
    sim.populateInitialVehicles();

    const res = sim.run();
    sweepResults.push({
      road_length: HLEN,
      segment_size: segSize,
      avg_delay: res.metrics.avg_delay_background,
      avg_speed: res.metrics.avg_speed_background
    });
  }

  let bestL = sweepResults[0].road_length;
  let minDelay = sweepResults[0].avg_delay;
  for (let r of sweepResults) {
    if (r.avg_delay < minDelay) {
      minDelay = r.avg_delay;
      bestL = r.road_length;
    }
  }

  const calculatedCruiseSpeed = Number((bestL / deltaT).toFixed(2));

  return {
    success: true,
    experiment_type: 'A',
    seed_used: seed,
    delta_t: deltaT,
    sweep: sweepResults,
    best_road_length: bestL,
    calculated_cruise_speed: calculatedCruiseSpeed
  };
}
