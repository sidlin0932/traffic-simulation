import { useState, useEffect, useRef, useCallback } from "react";

const CELL_PX = 6;
const LANE_GAP = 1;
const NUM_H = 5;
const NUM_V = 6;
const SEG_LEN = 20;
const SEG_JITTER = 10;
const V_MAX = 5;
const DEFAULT_P_SLOW = 0.3;
const DEFAULT_TURN_P = 0.3;
const LIGHT_CYCLE = 30;
const INJECT_P = 0.3;
const FULL_CYCLE = LIGHT_CYCLE * 2;

const ROAD_W = CELL_PX * 4 + LANE_GAP * 3; // 4 lanes total
const PAD = 20;

function mulberry32(seed) {
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
function mirror(pos, len) { return len - 1 - pos; }

// --- Configuration Schema ---
const DEFAULT_CONFIG = {
  signalMode: "alternating",
  waveSpeed: 4,
  greenCycle: 30,
  pSlow: 0.3,
  turnP: 0.3,
  density: 0.3,
  startupDelay: 0,
  complianceRate: 1.0,
  leftTurnPenalty: 1.0,
  greenWaveCompliance: 1.0,
  // Reversible lanes options per road index
  revModeH: ["none", "none", "none", "none", "none"], // none, peak_fwd (3+1), peak_bwd (1+3)
  revModeV: ["none", "none", "none", "none", "none", "none"],
  // Left-turn pocket options per road index
  leftTurnPocketH: [false, false, false, false, false],
  leftTurnPocketV: [false, false, false, false, false, false],
  pocketLength: 6, // cells before intersection
};

// Check if a cell is in the left turn pocket range
function isInPocketRange(g, heading, laneIdx, pos, pocketLength) {
  if (!g) return false;
  let nextJuncs = [];
  if (heading === "E") nextJuncs = g.hInt;
  else if (heading === "W") nextJuncs = g.hInt.map(p => mirror(p, g.HLEN));
  else if (heading === "S") nextJuncs = g.vInt;
  else nextJuncs = g.vInt.map(p => mirror(p, g.VLEN));

  for (const junc of nextJuncs) {
    if (pos >= junc - pocketLength && pos < junc) {
      return true;
    }
  }
  return false;
}

function buildGeometry(seed, jitterOn, missingOn) {
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

  return { segH, segV, hInt, vInt, HLEN, VLEN, present, tjunc, vBarrier };
}

function canvasSize(g) {
  if (!g) return { w: 800, h: 600 };
  return {
    w: PAD * 2 + g.HLEN * CELL_PX,
    h: PAD * 2 + g.VLEN * CELL_PX,
  };
}
function hRoadY(g, r) { return g ? (PAD + g.vInt[r] * CELL_PX - CELL_PX * 2) : 0; }
function vRoadX(g, c) { return g ? (PAD + g.hInt[c] * CELL_PX - CELL_PX * 2) : 0; }

function makeRoad(len) { return new Array(len).fill(null); }

// Populates a lane
function populate(road, density, excludeSet, rng) {
  let last = -3;
  for (let i = 0; i < road.length; i++) {
    if (excludeSet && excludeSet.has(i)) continue;
    if (rng() < density && i - last > 2) {
      road[i] = { v: Math.floor(rng() * (V_MAX + 1)) };
      last = i;
    }
  }
}

function initLights(g, mode, waveSpeed, greenCycle) {
  const cycle = greenCycle || LIGHT_CYCLE;
  const fullCycle = cycle * 2;
  return Array.from({ length: NUM_H }, (_, r) =>
    Array.from({ length: NUM_V }, (_, c) => {
      let timer = 0, hGreen = true;
      if (mode === "alternating") {
        hGreen = (r + c) % 2 === 0;
      } else if (mode === "green_wave_h") {
        const dist = g.hInt[c];
        const offset = -Math.round(dist / Math.max(waveSpeed, 1));
        timer = ((offset % fullCycle) + fullCycle) % fullCycle;
        hGreen = timer < cycle;
      } else if (mode === "green_wave_v") {
        const dist = g.vInt[r];
        const offset = -Math.round(dist / Math.max(waveSpeed, 1));
        timer = ((offset % fullCycle) + fullCycle) % fullCycle;
        hGreen = !(timer < cycle);
      } else {
        hGreen = true; timer = 0;
      }
      if (timer >= cycle) { timer -= cycle; hGreen = !hGreen; }
      return { hGreen, timer };
    })
  );
}

function buildExcludes(g) {
  const hFwd = new Set(g.hInt);
  const hBwd = new Set(g.hInt.map((p) => mirror(p, g.HLEN)));
  const vFwd = Array.from({ length: NUM_V }, () => new Set());
  const vBwd = Array.from({ length: NUM_V }, () => new Set());
  for (let c = 0; c < NUM_V; c++) {
    g.vInt.forEach((p) => { vFwd[c].add(p); vBwd[c].add(mirror(p, g.VLEN)); });
    if (g.vBarrier) for (const y of g.vBarrier[c]) {
      vFwd[c].add(y);
      vBwd[c].add(mirror(y, g.VLEN));
    }
  }
  return { hFwd, hBwd, vFwd, vBwd };
}

function initState(g, config, seed, routed) {
  const rng = mulberry32(typeof seed === "string" ? hashString(seed) : seed);
  const exc = buildExcludes(g);
  const dens = routed ? 0 : config.density;
  
  const mkH = (e) => Array.from({ length: NUM_H }, () => {
    const l1 = makeRoad(g.HLEN);
    const l2 = makeRoad(g.HLEN);
    const l3 = makeRoad(g.HLEN);
    if (dens) {
      populate(l1, dens * 0.7, e, rng);
      populate(l2, dens * 0.7, e, rng);
    }
    return [l1, l2, l3];
  });
  
  const mkV = (eArr) => Array.from({ length: NUM_V }, (_, c) => {
    const l1 = makeRoad(g.VLEN);
    const l2 = makeRoad(g.VLEN);
    const l3 = makeRoad(g.VLEN);
    if (dens) {
      populate(l1, dens * 0.7, eArr[c], rng);
      populate(l2, dens * 0.7, eArr[c], rng);
    }
    return [l1, l2, l3];
  });

  return {
    hFwd: mkH(exc.hFwd), hBwd: mkH(exc.hBwd),
    vFwd: mkV(exc.vFwd), vBwd: mkV(exc.vBwd),
    lights: initLights(g, config.signalMode, config.waveSpeed, config.greenCycle),
    crossings: 0,
  };
}

function getLaneConfiguration(r, c, config) {
  let hFwdCount = 2, hBwdCount = 2;
  let vFwdCount = 2, vBwdCount = 2;

  if (config) {
    if (r !== -1 && config.revModeH && r < config.revModeH.length) {
      const mode = config.revModeH[r];
      if (mode === "peak_fwd") { hFwdCount = 3; hBwdCount = 1; }
      else if (mode === "peak_bwd") { hFwdCount = 1; hBwdCount = 3; }
    }
    if (c !== -1 && config.revModeV && c < config.revModeV.length) {
      const mode = config.revModeV[c];
      if (mode === "peak_fwd") { vFwdCount = 3; vBwdCount = 1; }
      else if (mode === "peak_bwd") { vFwdCount = 1; vBwdCount = 3; }
    }
  }

  return { hFwdCount, hBwdCount, vFwdCount, vBwdCount };
}

function stepLightsAdaptive(g, state, config) {
  const { hFwd, hBwd, vFwd, vBwd, lights } = state;
  const mode = config.signalMode;
  const cycle = config.greenCycle || LIGHT_CYCLE;
  
  return lights.map((row, r) => row.map((l, c) => {
    if (mode !== "adaptive") {
      const t = l.timer + 1;
      return t >= cycle ? { hGreen: !l.hGreen, timer: 0 } : { hGreen: l.hGreen, timer: t };
    }
    
    if (!g.present[r][c]) return l;
    
    const hp = g.hInt[c], hm = mirror(g.hInt[c], g.HLEN);
    const vp = g.vInt[r], vm = mirror(g.vInt[r], g.VLEN);
    
    let hCars = 0, vCars = 0;
    const SENSOR_RANGE = 8; 
    
    for (let i = 0; i <= SENSOR_RANGE; i++) {
      if (hp - i >= 0 && hFwd[r]) {
        hFwd[r].forEach(lane => { if (lane && lane[hp - i]) hCars++; });
      }
      if (hm - i >= 0 && hBwd[r]) {
        hBwd[r].forEach(lane => { if (lane && lane[hm - i]) hCars++; });
      }
      if (vp - i >= 0 && vFwd[c]) {
        vFwd[c].forEach(lane => { if (lane && lane[vp - i]) vCars++; });
      }
      if (vm - i >= 0 && vBwd[c]) {
        vBwd[c].forEach(lane => { if (lane && lane[vm - i]) vCars++; });
      }
    }
    
    let { hGreen, timer } = l;
    timer++;
    
    const MIN_GREEN = 15;
    const MAX_GREEN = 60;
    
    if (timer >= MIN_GREEN) {
      if (hGreen) {
        if (timer >= MAX_GREEN || (hCars === 0 && vCars > 0) || (vCars > hCars + 3)) {
          hGreen = false; timer = 0;
        }
      } else {
        if (timer >= MAX_GREEN || (vCars === 0 && hCars > 0) || (hCars > vCars + 3)) {
          hGreen = true; timer = 0;
        }
      }
    }
    return { hGreen, timer };
  }));
}

const NK = (r, c) => r * NUM_V + c;
const NK_R = (k) => Math.floor(k / NUM_V);
const NK_C = (k) => k % NUM_V;

function buildGraph(g) {
  const adj = Array.from({ length: NUM_H * NUM_V }, () => []);
  const sev = (r, c) =>
    (g.tjunc && (g.tjunc[r][c] === "down" || g.tjunc[r + 1][c] === "up"));
  for (let r = 0; r < NUM_H; r++) {
    for (let c = 0; c < NUM_V; c++) {
      if (c + 1 < NUM_V) { adj[NK(r, c)].push(NK(r, c + 1)); adj[NK(r, c + 1)].push(NK(r, c)); }
      if (r + 1 < NUM_H && !sev(r, c)) { adj[NK(r, c)].push(NK(r + 1, c)); adj[NK(r + 1, c)].push(NK(r, c)); }
    }
  }
  return adj;
}

function getTurnType(h1, h2) {
  if (h1 === h2) return "straight";
  if ((h1 === "E" && h2 === "N") ||
      (h1 === "W" && h2 === "S") ||
      (h1 === "S" && h2 === "E") ||
      (h1 === "N" && h2 === "W")) return "left";
  if ((h1 === "E" && h2 === "S") ||
      (h1 === "W" && h2 === "N") ||
      (h1 === "S" && h2 === "W") ||
      (h1 === "N" && h2 === "E")) return "right";
  return "u-turn";
}

function dijkstraPath(adj, start, goal, startHeading, leftTurnPenalty, avoidNode) {
  const HEADINGS = ["E", "W", "S", "N"];
  const numNodes = adj.length;
  const numStates = numNodes * 4;
  const dist = new Array(numStates).fill(Infinity);
  const parent = new Array(numStates).fill(null);
  
  const startHIdx = HEADINGS.indexOf(startHeading || "E");
  const startState = start * 4 + (startHIdx === -1 ? 0 : startHIdx);
  dist[startState] = 0;
  
  const q = [startState];
  
  while (q.length > 0) {
    let minIdx = 0;
    for (let i = 1; i < q.length; i++) {
      if (dist[q[i]] < dist[q[minIdx]]) minIdx = i;
    }
    const uState = q.splice(minIdx, 1)[0];
    const uNode = Math.floor(uState / 4);
    const uHIdx = uState % 4;
    const uHeading = HEADINGS[uHIdx];
    
    if (uNode === goal) {
      const path = [];
      let curr = uState;
      while (curr !== null) {
        path.push(Math.floor(curr / 4));
        curr = parent[curr];
      }
      path.reverse();
      return path;
    }
    
    const uDist = dist[uState];
    if (uDist === Infinity) continue;
    
    for (const w of adj[uNode]) {
      if (w === avoidNode) continue;
      
      const wHeading = headingBetween(uNode, w);
      const wHIdx = HEADINGS.indexOf(wHeading);
      const wState = w * 4 + wHIdx;
      
      let cost = 1.0;
      const turn = getTurnType(uHeading, wHeading);
      if (turn === "left") {
        cost += (leftTurnPenalty || 1.0);
      } else if (turn === "right") {
        cost += 0.2;
      } else if (turn === "u-turn") {
        cost += 10.0;
      }
      
      if (dist[uState] + cost < dist[wState]) {
        dist[wState] = dist[uState] + cost;
        parent[wState] = uState;
        if (!q.includes(wState)) {
          q.push(wState);
        }
      }
    }
  }
  
  return null;
}

function bfsPath(adj, start, goal, heading = "E", leftTurnPenalty = 1.0) {
  return dijkstraPath(adj, start, goal, heading, leftTurnPenalty, -1);
}

function bfsPathAvoid(adj, start, goal, avoidFirst, heading = "E", leftTurnPenalty = 1.0) {
  return dijkstraPath(adj, start, goal, heading, leftTurnPenalty, avoidFirst);
}

function headingBetween(a, b) {
  const r1 = NK_R(a), c1 = NK_C(a), r2 = NK_R(b), c2 = NK_C(b);
  if (c2 === c1 + 1) return "E";
  if (c2 === c1 - 1) return "W";
  if (r2 === r1 + 1) return "S";
  return "N";
}

// Builds the routing path plan
function derivePlan(path, exitHeading) {
  const plan = {};
  for (let i = 0; i < path.length; i++)
    plan[path[i]] = i < path.length - 1 ? headingBetween(path[i], path[i + 1]) : exitHeading;
  return plan;
}

function entryInfo(boundary, laneIdx) {
  if (boundary === "W") return { node: NK(laneIdx, 0), heading: "E" };
  if (boundary === "E") return { node: NK(laneIdx, NUM_V - 1), heading: "W" };
  if (boundary === "N") return { node: NK(0, laneIdx), heading: "S" };
  return { node: NK(NUM_H - 1, laneIdx), heading: "N" };
}

function exitInfo(boundary, laneIdx) {
  if (boundary === "E") return { node: NK(laneIdx, NUM_V - 1), heading: "E" };
  if (boundary === "W") return { node: NK(laneIdx, 0), heading: "W" };
  if (boundary === "S") return { node: NK(NUM_H - 1, laneIdx), heading: "S" };
  return { node: NK(0, laneIdx), heading: "N" }; 
}

function allExits() {
  const xs = [];
  for (let r = 0; r < NUM_H; r++) { xs.push(["E", r]); xs.push(["W", r]); }
  for (let c = 0; c < NUM_V; c++) { xs.push(["S", c]); xs.push(["N", c]); }
  return xs;
}

function exitSegmentClear(g, boundary, laneIdx) {
  if (!g || !g.vBarrier) return true;
  if (boundary === "S") { 
    const c = laneIdx; for (let y = g.vInt[NUM_H - 1] + 1; y < g.VLEN; y++) if (g.vBarrier[c].has(y)) return false;
    return true;
  }
  if (boundary === "N") { 
    const c = laneIdx; for (let y = 0; y < g.vInt[0]; y++) if (g.vBarrier[c].has(y)) return false;
    return true;
  }
  return true; 
}

function entrySegmentClear(g, boundary, laneIdx) {
  if (!g || !g.vBarrier) return true;
  if (boundary === "N") { const c = laneIdx; for (let y = 0; y <= g.vInt[0]; y++) if (g.vBarrier[c].has(y)) return false; return true; }
  if (boundary === "S") { const c = laneIdx; for (let y = g.vInt[NUM_H - 1]; y < g.VLEN; y++) if (g.vBarrier[c].has(y)) return false; return true; }
  return true;
}

function intCellFor(g, heading, r, c) {
  if (!g) return 0;
  if (heading === "E") return g.hInt[c];
  if (heading === "W") return mirror(g.hInt[c], g.HLEN);
  if (heading === "S") return g.vInt[r];
  return mirror(g.vInt[r], g.VLEN);
}

function nextStopCell(g, heading, laneIdx, from, plan) {
  if (!g) return Infinity;
  const items = [];
  if (heading === "E") for (let c = 0; c < NUM_V; c++) items.push([g.hInt[c], NK(laneIdx, c)]);
  else if (heading === "W") for (let c = NUM_V - 1; c >= 0; c--) items.push([mirror(g.hInt[c], g.HLEN), NK(laneIdx, c)]);
  else if (heading === "S") for (let r = 0; r < NUM_H; r++) items.push([g.vInt[r], NK(r, laneIdx)]);
  else for (let r = NUM_H - 1; r >= 0; r--) items.push([mirror(g.vInt[r], g.VLEN), NK(r, laneIdx)]);
  for (const [cell, nk] of items)
    if (cell > from && plan[nk] !== heading) return cell; 
  return Infinity;
}

function nodeAtCell(g, heading, laneIdx, cell) {
  if (!g) return null;
  if (heading === "E") { for (let c = 0; c < NUM_V; c++) if (g.hInt[c] === cell) return NK(laneIdx, c); }
  else if (heading === "W") { for (let c = 0; c < NUM_V; c++) if (mirror(g.hInt[c], g.HLEN) === cell) return NK(laneIdx, c); }
  else if (heading === "S") { for (let r = 0; r < NUM_H; r++) if (g.vInt[r] === cell) return NK(r, laneIdx); }
  else { for (let r = 0; r < NUM_H; r++) if (mirror(g.vInt[r], g.VLEN) === cell) return NK(r, laneIdx); }
  return null;
}

// Multi-lane NaSch Step
function naschStepMulti(lanes, activeLanesCount, blockedSet, crossSet, pSlow, rng, counter, key, onExit, leftTurnPocketOn, pocketLength, g, heading, laneIdx, config) {
  const n = (lanes && lanes[0]) ? lanes[0].length : (g ? g.HLEN : 100);
  const nextLanes = Array.from({ length: 3 }, () => new Array(n).fill(null));

  for (let lIdx = 0; lIdx < activeLanesCount; lIdx++) {
    const road = (lanes && lanes[lIdx]) ? lanes[lIdx] : new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const car = road[i];
      if (!car) continue;

      let limitSpeed = V_MAX;
      if (car.followGreenWave && config && config.signalMode && config.signalMode.startsWith("green_wave")) {
        limitSpeed = config.waveSpeed || 4;
      }

      let v = car.v;
      let startupDelayVal = config ? (config.startupDelay || 0) : 0;
      if (v === 0) {
        let initialLimit = Math.min(1, (car.stopCell != null && isFinite(car.stopCell)) ? Math.max(0, car.stopCell - i) : Infinity);
        let initialGap = 0;
        if (initialLimit > 0 && i + 1 < n && road[i + 1] === null && !blockedSet.has(i + 1)) {
          initialGap = 1;
        }
        if (initialGap > 0) {
          if (car.startDelayLeft == null) {
            car.startDelayLeft = startupDelayVal;
          }
          if (car.startDelayLeft > 0) {
            car.startDelayLeft--;
            v = 0;
          } else {
            v = Math.min(v + 1, limitSpeed);
          }
        } else {
          v = 0;
        }
      } else {
        v = Math.min(v + 1, limitSpeed);
        car.startDelayLeft = null;
      }

      const cap = (car.stopCell != null && isFinite(car.stopCell)) ? Math.max(0, car.stopCell - i) : Infinity;
      let limit = Math.min(v, cap);
      
      let gap = limit;
      for (let d = 1; d <= limit; d++) {
        const p = i + d;
        if (p >= n) { gap = d; break; }
        if (road[p] !== null || blockedSet.has(p)) { gap = d - 1; break; }
        gap = d;
      }
      
      let targetLaneIdx = lIdx;
      if (leftTurnPocketOn && car.routed && isInPocketRange(g, heading, laneIdx, i, pocketLength)) {
        const nextNk = nodeAtCell(g, heading, laneIdx, car.stopCell);
        const nextHeading = nextNk ? car.plan[nextNk] : null;
        const isLeftTurn = nextHeading && (
          (heading === "E" && nextHeading === "N") ||
          (heading === "W" && nextHeading === "S") ||
          (heading === "S" && nextHeading === "E") ||
          (heading === "N" && nextHeading === "W")
        );

        if (isLeftTurn) {
          if (lIdx > 0 && lanes && lanes[0] && lanes[0][i] === null) {
            targetLaneIdx = 0;
          }
        } else {
          if (lIdx === 0 && activeLanesCount > 1 && lanes && lanes[1] && lanes[1][i] === null) {
            targetLaneIdx = 1;
          }
        }
      }

      v = Math.min(limit, gap);
      if (v > 0 && rng() < pSlow) v--;
      if (v > 0) {
        car.startDelayLeft = null;
      }
      const np = i + v;
      if (crossSet) for (let p = i + 1; p <= np; p++) if (crossSet.has(p)) { counter[key]++; break; }
      
      if (np < n) {
        car.v = v;
        if (nextLanes[targetLaneIdx][np] === null) {
          nextLanes[targetLaneIdx][np] = car;
        } else {
          nextLanes[lIdx][np] = car;
        }
      }
      else if (onExit) onExit(car); 
    }
  }

  return nextLanes;
}

function injectMulti(lanes, activeLanesCount, rng, wall, pInject) {
  if (wall && (wall.has(0) || wall.has(1))) return;
  for (let l = activeLanesCount - 1; l >= 0; l--) {
    if (lanes && lanes[l] && lanes[l][0] === null && lanes[l][1] === null && rng() < pInject) {
      lanes[l][0] = { v: Math.floor(rng() * 3) + 1 };
    }
  }
}

function injectRoutedMulti(g, adj, lanes, activeLanesCount, rng, wall, pInject, tick, boundary, laneIdx, idRef, config) {
  if (wall && (wall.has(0) || wall.has(1))) return null;
  if (!lanes) return null;
  
  let targetLane = -1;
  for (let l = 0; l < activeLanesCount; l++) {
    if (lanes[l] && lanes[l][0] === null && lanes[l][1] === null) {
      targetLane = l;
      break;
    }
  }
  if (targetLane === -1 || rng() >= pInject) return null;
  if (!entrySegmentClear(g, boundary, laneIdx)) return null; 

  const { node: start, heading } = entryInfo(boundary, laneIdx);
  const exits = allExits().filter(([eb, el]) =>
    !(eb === boundary && el === laneIdx) && exitSegmentClear(g, eb, el));
  
  for (let tries = 0; tries < 8 && exits.length; tries++) {
    const [eb, el] = exits[Math.floor(rng() * exits.length)];
    const { node: goal, heading: exitHeading } = exitInfo(eb, el);
    const penalty = config ? (config.leftTurnPenalty || 1.0) : 1.0;
    const path = bfsPath(adj, start, goal, heading, penalty);
    if (!path) continue;
    const plan = derivePlan(path, exitHeading);
    const compliant = config ? (rng() < (config.complianceRate == null ? 1.0 : config.complianceRate)) : true;
    const followGreenWave = config ? (rng() < (config.greenWaveCompliance == null ? 1.0 : config.greenWaveCompliance)) : true;
    const car = {
      v: Math.floor(rng() * 3) + 1,
      id: idRef.n++, spawn: tick, heading, plan,
      target: goal, exitHeading, routed: true, stopCell: null,
      path,
      compliant,
      followGreenWave
    };
    car.stopCell = nextStopCell(g, heading, laneIdx, 0, plan);
    lanes[targetLane][0] = car;
    return car;
  }
  return null;
}

function clearIntersectionsMulti(g, state, rng) {
  const { hFwd, hBwd, vFwd, vBwd, lights } = state;
  const blocked = (isVertical, col, isFwd, pos) => {
    if (!isVertical || !g || !g.vBarrier || !g.vBarrier[col]) return false;
    const realY = isFwd ? pos : mirror(pos, g.VLEN);
    return g.vBarrier[col].has(realY);
  };

  function tryForward(road, pos) {
    if (!road) return false;
    const nxt = pos + 1;
    if (nxt < road.length && road[nxt] === null) { road[nxt] = { v: 1 }; road[pos] = null; return true; }
    return false;
  }
  function tryForceTurn(srcRoad, srcPos, tRoadGroup, tPos, isVertical, col, isFwd) {
    if (!srcRoad || !srcRoad[srcPos] || !tRoadGroup) return false;
    for (const tRoad of tRoadGroup) {
      if (!tRoad) continue;
      const landing = tPos + 1;
      if (landing < tRoad.length && tRoad[landing] === null && tRoad[tPos] === null
          && !blocked(isVertical, col, isFwd, landing) && !blocked(isVertical, col, isFwd, tPos)) {
        tRoad[landing] = { v: 1 }; srcRoad[srcPos] = null; return true;
      }
    }
    for (const tRoad of tRoadGroup) {
      if (tRoad && tRoad[tPos] === null && !blocked(isVertical, col, isFwd, tPos)) { tRoad[tPos] = { v: 0 }; srcRoad[srcPos] = null; return true; }
    }
    return false;
  }

  for (let r = 0; r < NUM_H; r++) {
    for (let c = 0; c < NUM_V; c++) {
      if (!g || !g.present[r] || !g.present[r][c]) continue; 
      const hp = g.hInt[c], hm = mirror(g.hInt[c], g.HLEN);
      const vp = g.vInt[r], vm = mirror(g.vInt[r], g.VLEN);
      const lightRow = lights && lights[r] && lights[r][c];
      const hg = lightRow ? lightRow.hGreen : true;
      
      const processFreeCar = (lanesGroup, pos, targetLanesA, targetPosA, targetLanesB, targetPosB, isTargetVertical, col) => {
        if (!lanesGroup) return;
        lanesGroup.forEach(lane => {
          if (lane && lane[pos] && !lane[pos].routed) {
            if (!tryForward(lane, pos)) {
              tryForceTurn(lane, pos, targetLanesA, targetPosA, isTargetVertical, col, true) || 
              tryForceTurn(lane, pos, targetLanesB, targetPosB, isTargetVertical, col, false);
            }
          }
        });
      };

      if (!hg) {
        processFreeCar(hFwd[r], hp, vFwd[c], vp, vBwd[c], vm, true, c);
        processFreeCar(hBwd[r], hm, vFwd[c], vp, vBwd[c], vm, true, c);
      } else {
        processFreeCar(vFwd[c], vp, hFwd[r], hp, hBwd[r], hm, false, -1);
        processFreeCar(vBwd[c], vm, hFwd[r], hp, hBwd[r], hm, false, -1);
      }
    }
  }

  if (g && g.tjunc) {
    for (let r = 0; r < NUM_H; r++) {
      for (let c = 0; c < NUM_V; c++) {
        if (!g.tjunc[r] || !g.tjunc[r][c]) continue;
        const hp = g.hInt[c], hm = mirror(g.hInt[c], g.HLEN);
        const vp = g.vInt[r], vm = mirror(g.vInt[r], g.VLEN);
        if (g.tjunc[r][c] === "down" && vFwd[c]) {
          vFwd[c].forEach(lane => {
            if (lane && lane[vp] && !lane[vp].routed) tryForceTurn(lane, vp, hFwd[r], hp, false, -1, true) || tryForceTurn(lane, vp, hBwd[r], hm, false, -1, false);
          });
        }
        if (g.tjunc[r][c] === "up" && vBwd[c]) {
          vBwd[c].forEach(lane => {
            if (lane && lane[vm] && !lane[vm].routed) tryForceTurn(lane, vm, hFwd[r], hp, false, -1, true) || tryForceTurn(lane, vm, hBwd[r], hm, false, -1, false);
          });
        }
      }
    }
  }
}

function processTurnsMulti(g, state, turnProb, rng) {
  const { hFwd, hBwd, vFwd, vBwd, lights } = state;
  const turns = [];
  for (let r = 0; r < NUM_H; r++) {
    for (let c = 0; c < NUM_V; c++) {
      if (!g || !g.present[r] || !g.present[r][c]) continue;
      const hp = g.hInt[c], hm = mirror(g.hInt[c], g.HLEN);
      const vp = g.vInt[r], vm = mirror(g.vInt[r], g.VLEN);
      const lightRow = lights && lights[r] && lights[r][c];
      const hg = lightRow ? lightRow.hGreen : true;
      
      const addTurns = (srcLanes, si, targets) => {
        if (!srcLanes) return;
        srcLanes.forEach(lane => {
          if (lane && lane[si] && rng() < turnProb) {
            turns.push({ srcLane: lane, si, targets });
          }
        });
      };

      if (hg) {
        addTurns(hFwd[r], hp, [
          { roads: vFwd[c], ti: vp, isVertical: true, isFwd: true, col: c }, 
          { roads: vBwd[c], ti: vm, isVertical: true, isFwd: false, col: c }
        ]);
        addTurns(hBwd[r], hm, [
          { roads: vFwd[c], ti: vp, isVertical: true, isFwd: true, col: c }, 
          { roads: vBwd[c], ti: vm, isVertical: true, isFwd: false, col: c }
        ]);
      } else {
        addTurns(vFwd[c], vp, [
          { roads: hFwd[r], ti: hp, isVertical: false }, 
          { roads: hBwd[r], ti: hm, isVertical: false }
        ]);
        addTurns(vBwd[c], vm, [
          { roads: hFwd[r], ti: hp, isVertical: false }, 
          { roads: hBwd[r], ti: hm, isVertical: false }
        ]);
      }
    }
  }
  for (let i = turns.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [turns[i], turns[j]] = [turns[j], turns[i]]; }
  
  for (const t of turns) {
    if (!t.srcLane || !t.srcLane[t.si]) continue;
    const car = t.srcLane[t.si];
    const pick = t.targets[rng() < 0.5 ? 0 : 1];
    const landing = pick.ti + 1;
    
    if (pick.isVertical && g.vBarrier && g.vBarrier[pick.col]) {
      const realY = pick.isFwd ? landing : mirror(landing, g.VLEN);
      if (g.vBarrier[pick.col].has(realY)) continue;
    }
    
    if (pick.roads) {
      for (const tRoad of pick.roads) {
        if (tRoad && landing < tRoad.length && tRoad[landing] === null && tRoad[pick.ti] === null) {
          tRoad[landing] = { v: Math.max(1, Math.min(car.v, 2)) };
          t.srcLane[t.si] = null;
          break;
        }
      }
    }
  }
}

function processRoutesMulti(g, state, rng, config) {
  const { hFwd, hBwd, vFwd, vBwd, lights } = state;
  const adj = state.adj || buildGraph(g);
  const laneOf = (heading, idx) =>
    heading === "E" ? hFwd[idx] : heading === "W" ? hBwd[idx] : heading === "S" ? vFwd[idx] : vBwd[idx];

  const PATIENCE = 12; 

  const stepNode = (nk, h) => {
    const r = NK_R(nk), c = NK_C(nk);
    if (h === "E") return c + 1 < NUM_V ? NK(r, c + 1) : -1;
    if (h === "W") return c - 1 >= 0 ? NK(r, c - 1) : -1;
    if (h === "S") return r + 1 < NUM_H ? NK(r + 1, c) : -1;
    return r - 1 >= 0 ? NK(r - 1, c) : -1; 
  };

  const cand = [];
  const scan = (heading, idx) => {
    const lanes = laneOf(heading, idx);
    if (!lanes) return;
    lanes.forEach((road, laneIndex) => {
      if (!road) return;
      for (let i = 0; i < road.length; i++) {
        const car = road[i];
        if (!car || !car.routed) continue;
        if (!isFinite(car.stopCell) || i !== car.stopCell) continue; 
        const nk = nodeAtCell(g, heading, idx, i);
        if (nk == null) continue;
        const r = NK_R(nk), c = NK_C(nk);
        let out = car.plan[nk];
        if (out == null) { 
          const penalty = config ? (config.leftTurnPenalty || 1.0) : 1.0;
          const path = bfsPath(adj, nk, car.target, heading, penalty);
          if (path) { car.plan = derivePlan(path, car.exitHeading); out = car.plan[nk]; car.path = path; }
        }
        if (out == null || out === heading) { car.wait = 0; continue; } 
        const present = g.present[r] && g.present[r][c];
        const axisH = (heading === "E" || heading === "W");
        const lightRow = lights && lights[r] && lights[r][c];
        const hg = lightRow ? lightRow.hGreen : true;
        const allowed = !present || (axisH ? hg : !hg);
        if (!allowed) continue; 
        cand.push({ srcRoad: road, si: i, car, nk, r, c, out, heading, idx, laneIndex });
      }
    });
  };
  for (let r = 0; r < NUM_H; r++) { scan("E", r); scan("W", r); }
  for (let c = 0; c < NUM_V; c++) { scan("S", c); scan("N", c); }

  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }

  for (const t of cand) {
    if (t.srcRoad[t.si] !== t.car) continue;
    const { car, nk, r, c, out } = t;
    const tRoadLanes = laneOf(out, out === "E" || out === "W" ? r : c);
    const crossCell = intCellFor(g, out, r, c);
    const landing = crossCell + 1;

    let placed = false;
    if (tRoadLanes) {
      for (const tRoad of tRoadLanes) {
        if (!tRoad) continue;
        const blockedLanding = !(landing < tRoad.length && tRoad[landing] === null && tRoad[crossCell] === null);
        if (!blockedLanding) {
          car.heading = out;
          car.v = Math.max(1, Math.min(car.v, 2));
          car.stopCell = nextStopCell(g, out, (out === "E" || out === "W") ? r : c, landing, car.plan);
          car.wait = 0;
          tRoad[landing] = car;
          t.srcRoad[t.si] = null;
          placed = true;
          break;
        }
      }
    }

    if (!placed) {
      car.wait = (car.wait || 0) + 1;
      const isCarCompliant = car.compliant !== false;
      if (isCarCompliant && car.wait >= PATIENCE) {
        const blockedNext = stepNode(nk, out);
        let adopted = false;
        const penalty = config ? (config.leftTurnPenalty || 1.0) : 1.0;
        const alt = bfsPathAvoid(adj, nk, car.target, blockedNext, car.heading, penalty);
        if (alt && alt.length > 1) {
          const newPlan = derivePlan(alt, car.exitHeading);
          const newOut = newPlan[nk];
          if (newOut && newOut !== out) {
            car.plan = newPlan; car.path = alt; car.wait = 0; adopted = true; 
            if (newOut === car.heading) car.stopCell = nextStopCell(g, car.heading, t.idx, t.si, car.plan);
          }
        }
        if (!adopted && car.wait >= PATIENCE * 3 && state.validExits) {
          for (const [eb, el] of state.validExits) {
            const { node: goal, heading: eh } = exitInfo(eb, el);
            if (goal === car.target) continue;
            const p2 = bfsPathAvoid(adj, nk, goal, blockedNext, car.heading, penalty);
            if (p2 && p2.length > 1) {
              const np = derivePlan(p2, eh), no = np[nk];
              if (no && no !== out) {
                car.plan = np; car.target = goal; car.exitHeading = eh; car.wait = 0; car.rerouted = true; car.path = p2; 
                if (no === car.heading) car.stopCell = nextStopCell(g, car.heading, t.idx, t.si, car.plan);
                break;
              }
            }
          }
        }
      }
    }
  }
}

function stepSim(g, state, rng, pInject, config, opts) {
  if (!g || !state) return state;
  const nl = stepLightsAdaptive(g, state, config);
  
  const routed = opts && opts.routed;
  const tick = (opts && opts.tick != null) ? opts.tick : (state.tick || 0);
  const adj = opts && opts.adj;
  const idRef = (opts && opts.idRef) || { n: 0 };
  const timeMode = (opts && opts.timeMode) || "offpeak";
  const isPeakActive = timeMode === "morning" || timeMode === "evening";

  let hFwdMul = 1.0, hBwdMul = 1.0, vFwdMul = 1.0, vBwdMul = 1.0;
  if (timeMode === "morning") {
    hFwdMul = 10.0; // Eastbound - Heavy
    vBwdMul = 10.0; // Northbound - Heavy
    hBwdMul = 0.05; // Westbound - Very light
    vFwdMul = 0.05; // Southbound - Very light
  } else if (timeMode === "evening") {
    hBwdMul = 10.0; // Westbound - Heavy
    vFwdMul = 10.0; // Southbound - Heavy
    hFwdMul = 0.05; // Eastbound - Very light
    vBwdMul = 0.05; // Northbound - Very light
  }

  let arrTick = 0, ttSumTick = 0, arrWin = 0, ttWin = 0;
  const countFrom = (opts && opts.countFrom != null) ? opts.countFrom : -1; 
  const onExit = routed ? (car) => {
    if (!car.routed) return;
    const tt = tick - car.spawn;
    arrTick++; ttSumTick += tt;
    if (car.spawn >= countFrom) { arrWin++; ttWin += tt; }
  } : null;

  const blk = (isH, isFwd, idx) => {
    const s = new Set();
    if (isH) {
      for (let c = 0; c < NUM_V; c++)
        if (g.present[idx] && g.present[idx][c] && nl && nl[idx] && nl[idx][c] && !nl[idx][c].hGreen) s.add(isFwd ? g.hInt[c] : mirror(g.hInt[c], g.HLEN));
    } else {
      for (let r = 0; r < NUM_H; r++)
        if (g.present[r] && g.present[r][idx] && nl && nl[r] && nl[r][idx] && nl[r][idx].hGreen) s.add(isFwd ? g.vInt[r] : mirror(g.vInt[r], g.VLEN));
      if (g.vBarrier) for (const y of g.vBarrier[idx]) s.add(isFwd ? y : mirror(y, g.VLEN));
    }
    return s;
  };

  const crossH_f = new Set(), crossH_b = new Set(), crossV_f = new Set(), crossV_b = new Set();
  for (let r = 0; r < NUM_H; r++) for (let c = 0; c < NUM_V; c++) if (g.present[r] && g.present[r][c]) {
    crossH_f.add(g.hInt[c]); crossH_b.add(mirror(g.hInt[c], g.HLEN));
    crossV_f.add(g.vInt[r]); crossV_b.add(mirror(g.vInt[r], g.VLEN));
  }

  const counter = { hF: 0, hB: 0, vF: 0, vB: 0 };
  const vWallF = Array.from({ length: NUM_V }, (_, c) => g.vBarrier ? g.vBarrier[c] : new Set());
  const vWallB = Array.from({ length: NUM_V }, (_, c) => {
    const s = new Set(); if (g.vBarrier) for (const y of g.vBarrier[c]) s.add(mirror(y, g.VLEN)); return s;
  });

  const stepLanes = (grp, isH, isFwd) => {
    if (!grp) return [];
    return grp.map((lanes, idx) => {
      const { hFwdCount, hBwdCount, vFwdCount, vBwdCount } = getLaneConfiguration(isH ? idx : -1, isH ? -1 : idx, config);
      const activeCount = isH ? (isFwd ? hFwdCount : hBwdCount) : (isFwd ? vFwdCount : vBwdCount);
      const blockedSet = blk(isH, isFwd, idx);
      const crossSet = isH ? (isFwd ? crossH_f : crossH_b) : (isFwd ? crossV_f : crossV_b);
      const key = isH ? (isFwd ? "hF" : "hB") : (isFwd ? "vF" : "vB");
      
      const leftPocketOn = isH ? (config.leftTurnPocketH && config.leftTurnPocketH[idx]) : (config.leftTurnPocketV && config.leftTurnPocketV[idx]);
      return naschStepMulti(lanes, activeCount, blockedSet, crossSet, config.pSlow, rng, counter, key, onExit, leftPocketOn, config.pocketLength, g, isH ? (isFwd ? "E" : "W") : (isFwd ? "S" : "N"), idx, config);
    });
  };

  const res = {
    hFwd: stepLanes(state.hFwd, true, true),
    hBwd: stepLanes(state.hBwd, true, false),
    vFwd: stepLanes(state.vFwd, false, true),
    vBwd: stepLanes(state.vBwd, false, false),
    lights: nl,
    crossings: state.crossings + counter.hF + counter.hB + counter.vF + counter.vB,
    lastCrossings: counter.hF + counter.hB + counter.vF + counter.vB,
    lastDir: counter,                 
    vWallF, vWallB,
    adj: adj || (routed ? buildGraph(g) : null),
    validExits: routed ? (g._validExits || (g._validExits = allExits().filter(([eb, el]) => exitSegmentClear(g, eb, el)))) : null,
    tick: tick + 1,
    arrivals: (state.arrivals || 0),
    travelSum: (state.travelSum || 0),
    lastArrivals: 0, lastTravelSum: 0,
  };

  clearIntersectionsMulti(g, res, rng);
  if (routed) processRoutesMulti(g, res, rng, config);
  else processTurnsMulti(g, res, config.turnP, rng);

  const pInj = pInject == null ? INJECT_P : pInject;
  
  if (routed) {
    let inNet = 0;
    const all = [res.hFwd, res.hBwd, res.vFwd, res.vBwd];
    for (const grp of all) {
      if (grp) {
        for (const lanes of grp) {
          if (lanes) lanes.forEach(rd => { if (rd) rd.forEach(cell => { if (cell) inNet++; }); });
        }
      }
    }
    const METER_CAP = isPeakActive ? 750 : 380; 
    const meterP = inNet >= METER_CAP ? 0 : pInj * (1 - inNet / METER_CAP);
    res.metered = inNet >= METER_CAP;
    if (meterP > 0) {
      res.hFwd.forEach((lanes, r) => {
        const { hFwdCount } = getLaneConfiguration(r, -1, config);
        for (let i = 0; i < hFwdCount; i++) {
          injectRoutedMulti(g, adj, lanes, hFwdCount, rng, null, meterP * hFwdMul, tick, "W", r, idRef, config);
        }
      });
      res.hBwd.forEach((lanes, r) => {
        const { hBwdCount } = getLaneConfiguration(r, -1, config);
        for (let i = 0; i < hBwdCount; i++) {
          injectRoutedMulti(g, adj, lanes, hBwdCount, rng, null, meterP * hBwdMul, tick, "E", r, idRef, config);
        }
      });
      res.vFwd.forEach((lanes, c) => {
        const { vFwdCount } = getLaneConfiguration(-1, c, config);
        for (let i = 0; i < vFwdCount; i++) {
          injectRoutedMulti(g, adj, lanes, vFwdCount, rng, vWallF[c], meterP * vFwdMul, tick, "N", c, idRef, config);
        }
      });
      res.vBwd.forEach((lanes, c) => {
        const { vBwdCount } = getLaneConfiguration(-1, c, config);
        for (let i = 0; i < vBwdCount; i++) {
          injectRoutedMulti(g, adj, lanes, vBwdCount, rng, vWallB[c], meterP * vBwdMul, tick, "S", c, idRef, config);
        }
      });
    }
  } else {
    res.hFwd.forEach((lanes, r) => {
      const { hFwdCount } = getLaneConfiguration(r, -1, config);
      injectMulti(lanes, hFwdCount, rng, null, pInj * hFwdMul);
    });
    res.hBwd.forEach((lanes, r) => {
      const { hBwdCount } = getLaneConfiguration(r, -1, config);
      injectMulti(lanes, hBwdCount, rng, null, pInj * hBwdMul);
    });
    res.vFwd.forEach((lanes, c) => {
      const { vFwdCount } = getLaneConfiguration(-1, c, config);
      injectMulti(lanes, vFwdCount, rng, vWallF[c], pInj * vFwdMul);
    });
    res.vBwd.forEach((lanes, c) => {
      const { vBwdCount } = getLaneConfiguration(-1, c, config);
      injectMulti(lanes, vBwdCount, rng, vWallB[c], pInj * vBwdMul);
    });
  }

  res.arrivals += arrTick;
  res.travelSum += ttSumTick;
  res.lastArrivals = arrTick;
  res.lastTravelSum = ttSumTick;
  res.lastArrivalsWin = arrWin;     
  res.lastTravelSumWin = ttWin;
  return res;
}

function densityToInject(density) {
  const lo = 0.03, hi = 0.95;
  const t = Math.max(0, Math.min(1, (density - lo) / (hi - lo)));
  return 0.10 + t * 0.85;
}
function densityToInjectRouted(density) {
  const lo = 0.03, hi = 0.95;
  const t = Math.max(0, Math.min(1, (density - lo) / (hi - lo)));
  return 0.015 + t * 0.40;   
}

function runExperiment(seed, config, ticks, warmup, routed, timeMode) {
  const g = buildGeometry(seed, true, true);
  const rng = mulberry32((typeof seed === "string" ? hashString(seed) : seed) ^ hashString(config.signalMode));
  const pInject = routed ? densityToInjectRouted(config.density) : densityToInject(config.density);
  const adj = routed ? buildGraph(g) : null;
  const idRef = { n: 0 };
  let state = initState(g, config, seed, routed);
  state.tick = 0;
  
  let crossSum = 0, speedSum = 0, speedSamples = 0, measured = 0;
  const dir = { hF: 0, hB: 0, vF: 0, vB: 0 };
  let arrWin = 0, ttWin = 0, spawnAtWarmup = 0;
  
  for (let t = 0; t < ticks; t++) {
    state = stepSim(g, state, rng, pInject, config, {
      routed: !!routed, 
      tick: t, 
      adj, 
      idRef, 
      countFrom: warmup,
      timeMode: timeMode
    });
    if (t === warmup) spawnAtWarmup = idRef.n; 
    if (t >= warmup) {
      crossSum += state.lastCrossings;
      dir.hF += state.lastDir.hF; dir.hB += state.lastDir.hB;
      dir.vF += state.lastDir.vF; dir.vB += state.lastDir.vB;
      arrWin += state.lastArrivalsWin; ttWin += state.lastTravelSumWin;
      let v = 0, n = 0;
      const all = [state.hFwd, state.hBwd, state.vFwd, state.vBwd];
      for (const group of all) {
        if (group) {
          for (const lanes of group) {
            if (lanes) lanes.forEach(rd => { if (rd) rd.forEach(cell => { if (cell) { v += cell.v; n++; } }); });
          }
        }
      }
      if (n) { speedSum += v / n; speedSamples++; }
      measured++;
    }
  }
  const spawnedInWin = routed ? (idRef.n - spawnAtWarmup) : 0;
  return {
    throughput: crossSum / measured,           
    totalCrossings: crossSum,
    avgSpeed: speedSamples ? speedSum / speedSamples : 0,
    tputHF: dir.hF / measured, tputHB: dir.hB / measured,
    tputVF: dir.vF / measured, tputVB: dir.vB / measured,
    tputH: (dir.hF + dir.hB) / measured, tputV: (dir.vF + dir.vB) / measured,
    arrivals: arrWin,
    avgTravelTime: arrWin ? ttWin / arrWin : 0,   
    arrivalRate: arrWin / measured,               
    spawned: spawnedInWin,
    completion: spawnedInWin > 0 ? Math.min(1, arrWin / spawnedInWin) : 0,
  };
}

const SPEED_COLORS = ["#1e1b4b", "#311042", "#581c87", "#701a75", "#a21caf", "#d946ef"];

export default function TrafficSimulation() {
  const [seed, setSeed] = useState("42");
  const [routed, setRouted] = useState(true);
  const [missingOn, setMissingOn] = useState(false); // Default to false so all intersections have traffic lights
  const [timeMode, setTimeMode] = useState("morning"); // "morning", "offpeak", "evening"
  const [simConfig, setSimConfig] = useState(DEFAULT_CONFIG);
  const [configText, setConfigText] = useState(JSON.stringify(DEFAULT_CONFIG, null, 2));
  
  // Highlighted road selected via Canvas click
  const [selectedRoad, setSelectedRoad] = useState({ type: "row", index: 2 });
  
  // Playback states
  const [isPlaying, setIsPlaying] = useState(false);
  const [tickCount, setTickCount] = useState(0);

  // geom is local react state for JSX sizing, populated safely
  const [geom, setGeom] = useState(null);
  
  // Experiment running and results state
  const [expRunning, setExpRunning] = useState(false);
  const [expResults, setExpResults] = useState(null);

  // Simulated Time clock formatting
  const getSimulatedTime = () => {
    let startMin = 8 * 60; // 08:00
    if (timeMode === "offpeak") startMin = 12 * 60; // 12:00
    if (timeMode === "evening") startMin = 18 * 60; // 18:00
    
    const tick = simRef.current ? simRef.current.tick : 0;
    const currentMin = startMin + Math.floor(tick * 0.5); // 1 tick = 30 seconds
    const h = Math.floor(currentMin / 60) % 24;
    const m = Math.floor(currentMin % 60);
    const s = Math.floor((tick * 30) % 60);
    
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  };

  // Refs for Simulation Engine
  const geoRef = useRef(null);
  const simRef = useRef(null);
  const rngRef = useRef(null);
  const adjRef = useRef(null);
  const idRef = useRef({ n: 0 });

  // Synchronize config text
  const updateConfig = (newConf) => {
    setSimConfig(newConf);
    setConfigText(JSON.stringify(newConf, null, 2));
  };

  const resetSimulation = useCallback(() => {
    const g = buildGeometry(seed, true, missingOn);
    geoRef.current = g;
    setGeom(g); // Sync state safely
    simRef.current = initState(g, simConfig, seed, routed);
    simRef.current.tick = 0;
    rngRef.current = mulberry32((typeof seed === "string" ? hashString(seed) : seed) ^ 0x1234);
    adjRef.current = routed ? buildGraph(g) : null;
    idRef.current = { n: 0 };
    setTickCount(0);
  }, [seed, simConfig, routed, timeMode, missingOn]);

  useEffect(() => {
    resetSimulation();
  }, [resetSimulation]);

  // Live Simulation loop using pure refs for stability and speed
  useEffect(() => {
    if (!isPlaying) return;
    const step = () => {
      if (!simRef.current || !geoRef.current) return;
      const pInj = routed ? densityToInjectRouted(simConfig.density) : densityToInject(simConfig.density);
      const t0 = simRef.current.tick || 0;
      
      // Mutate state in Ref
      simRef.current = stepSim(geoRef.current, simRef.current, rngRef.current, pInj, simConfig, {
        routed: !!routed,
        tick: t0,
        adj: adjRef.current,
        idRef: idRef.current,
        timeMode: timeMode
      });
      
      setTickCount(t => t + 1); // Trigger React re-render
    };

    const intervalId = setInterval(step, 100);
    return () => clearInterval(intervalId);
  }, [isPlaying, routed, simConfig, timeMode]);

  // Canvas drawing using Refs
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current || !simRef.current || !geoRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    const geomVal = geoRef.current;
    const simState = simRef.current;
    
    try {
      const { w, h } = canvasSize(geomVal);
      ctx.fillStyle = "#0c0a1c";
      ctx.fillRect(0, 0, w, h);

      const pocketPx = simConfig.pocketLength * CELL_PX;
      const taperPx = 6 * CELL_PX; // Taper zone length

      const getCenterlineYOffsetH = (x, r) => {
        if (!simConfig.leftTurnPocketH || !simConfig.leftTurnPocketH[r]) return 0;
        const dy = CELL_PX + LANE_GAP;
        for (let c = 0; c < NUM_V; c++) {
          if (!geomVal.present[r] || !geomVal.present[r][c]) continue;
          const rx = vRoadX(geomVal, c);
          // Eastbound pocket (left side of intersection rx)
          if (x >= rx - pocketPx && x <= rx) {
            return -dy;
          }
          if (x >= rx - pocketPx - taperPx && x < rx - pocketPx) {
            const ratio = (x - (rx - pocketPx - taperPx)) / taperPx;
            return -dy * ratio;
          }
          // Westbound pocket (right side of intersection rx + ROAD_W)
          if (x >= rx + ROAD_W && x <= rx + ROAD_W + pocketPx) {
            return dy;
          }
          if (x > rx + ROAD_W + pocketPx && x <= rx + ROAD_W + pocketPx + taperPx) {
            const ratio = (rx + ROAD_W + pocketPx + taperPx - x) / taperPx;
            return dy * ratio;
          }
        }
        return 0;
      };

      const getCenterlineXOffsetV = (y, c) => {
        if (!simConfig.leftTurnPocketV || !simConfig.leftTurnPocketV[c]) return 0;
        const dx = CELL_PX + LANE_GAP;
        for (let r = 0; r < NUM_H; r++) {
          if (!geomVal.present[r] || !geomVal.present[r][c]) continue;
          const ry = hRoadY(geomVal, r);
          // Southbound pocket (top side of intersection ry)
          if (y >= ry - pocketPx && y <= ry) {
            return -dx;
          }
          if (y >= ry - pocketPx - taperPx && y < ry - pocketPx) {
            const ratio = (y - (ry - pocketPx - taperPx)) / taperPx;
            return -dx * ratio;
          }
          // Northbound pocket (bottom side of intersection ry + ROAD_W)
          if (y >= ry + ROAD_W && y <= ry + ROAD_W + pocketPx) {
            return dx;
          }
          if (y > ry + ROAD_W + pocketPx && y <= ry + ROAD_W + pocketPx + taperPx) {
            const ratio = (ry + ROAD_W + pocketPx + taperPx - y) / taperPx;
            return dx * ratio;
          }
        }
        return 0;
      };

      // Draw Roads (Grid)
      ctx.fillStyle = "#161427";
      // Draw horizontal streets
      for (let r = 0; r < NUM_H; r++) {
        const y = hRoadY(geomVal, r);
        ctx.fillRect(PAD, y, geomVal.HLEN * CELL_PX, ROAD_W);
      }
      // Draw vertical streets
      for (let c = 0; c < NUM_V; c++) {
        const x = vRoadX(geomVal, c);
        ctx.fillRect(x, PAD, ROAD_W, geomVal.VLEN * CELL_PX);
      }

      // Draw SELECTED ROAD Highlight (Glow box)
      if (selectedRoad) {
        ctx.strokeStyle = "#a855f7";
        ctx.lineWidth = 2.5;
        if (selectedRoad.type === "row") {
          const ry = hRoadY(geomVal, selectedRoad.index);
          ctx.strokeRect(PAD - 2, ry - 2, geomVal.HLEN * CELL_PX + 4, ROAD_W + 4);
        } else {
          const rx = vRoadX(geomVal, selectedRoad.index);
          ctx.strokeRect(rx - 2, PAD - 2, ROAD_W + 4, geomVal.VLEN * CELL_PX + 4);
        }
      }

      // Draw Intersection Lights & Markers
      for (let r = 0; r < NUM_H; r++) {
        for (let c = 0; c < NUM_V; c++) {
          if (!geomVal.present[r]) continue;
          const x = vRoadX(geomVal, c);
          const y = hRoadY(geomVal, r);
          
          const light = simState.lights && simState.lights[r] && simState.lights[r][c];
          const hg = light ? light.hGreen : true;
          
          ctx.fillStyle = hg ? "#22c55e" : "#ef4444";
          ctx.beginPath();
          ctx.arc(x - 5, y + ROAD_W / 2, 3, 0, Math.PI * 2);
          ctx.arc(x + ROAD_W + 5, y + ROAD_W / 2, 3, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = !hg ? "#22c55e" : "#ef4444";
          ctx.beginPath();
          ctx.arc(x + ROAD_W / 2, y - 5, 3, 0, Math.PI * 2);
          ctx.arc(x + ROAD_W / 2, y + ROAD_W + 5, 3, 0, Math.PI * 2);
          ctx.fill();
          
          if (geomVal.tjunc && geomVal.tjunc[r] && geomVal.tjunc[r][c] === "down") {
            ctx.fillStyle = "#ef4444";
            ctx.fillRect(x, y + ROAD_W, ROAD_W, 3);
            const nextY = (r + 1 < NUM_H) ? hRoadY(geomVal, r + 1) : (PAD + geomVal.VLEN * CELL_PX);
            ctx.fillRect(x, nextY - 3, ROAD_W, 3);
          } else if (geomVal.tjunc && geomVal.tjunc[r] && geomVal.tjunc[r][c] === "up") {
            ctx.fillStyle = "#ef4444";
            ctx.fillRect(x, y - 3, ROAD_W, 3);
            const prevY = (r - 1 >= 0) ? (hRoadY(geomVal, r - 1) + ROAD_W) : PAD;
            ctx.fillRect(x, prevY, ROAD_W, 3);
          }
        }
      }

      const isInsideIntersectionH = (x, r) => {
        for (let c = 0; c < NUM_V; c++) {
          if (geomVal.present[r] && geomVal.present[r][c]) {
            const rx = vRoadX(geomVal, c);
            if (x >= rx && x <= rx + ROAD_W) return true;
          }
        }
        return false;
      };

      const isInsideIntersectionV = (y, c) => {
        for (let r = 0; r < NUM_H; r++) {
          if (geomVal.present[r] && geomVal.present[r][c]) {
            const ry = hRoadY(geomVal, r);
            if (y >= ry && y <= ry + ROAD_W) return true;
          }
        }
        return false;
      };

      // Draw Lane Dividers (White dashed lines) & Shifting Centerline (Double Yellow)
      for (let r = 0; r < NUM_H; r++) {
        const yBase = hRoadY(geomVal, r);
        const { hFwdCount, hBwdCount } = getLaneConfiguration(r, -1, simConfig);
        const yCenter = yBase + hBwdCount * (CELL_PX + LANE_GAP) - LANE_GAP / 2;
        
        // 1. Draw dashed lane dividers within each direction
        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        
        // Horizontal Forward (Eastbound) dividers - below centerline
        for (let i = 1; i < hFwdCount; i++) {
          const yDivOffset = i * (CELL_PX + LANE_GAP);
          ctx.beginPath();
          let drawing = false;
          for (let x = PAD; x <= PAD + geomVal.HLEN * CELL_PX; x += 2) {
            if (isInsideIntersectionH(x, r)) {
              drawing = false;
            } else {
              const offset = getCenterlineYOffsetH(x, r);
              const yDiv = yCenter + yDivOffset + offset;
              if (!drawing) {
                ctx.moveTo(x, yDiv);
                drawing = true;
              } else {
                ctx.lineTo(x, yDiv);
              }
            }
          }
          ctx.stroke();
        }
        // Horizontal Backward (Westbound) dividers - above centerline
        for (let i = 1; i < hBwdCount; i++) {
          const yDivOffset = -i * (CELL_PX + LANE_GAP);
          ctx.beginPath();
          let drawing = false;
          for (let x = PAD; x <= PAD + geomVal.HLEN * CELL_PX; x += 2) {
            if (isInsideIntersectionH(x, r)) {
              drawing = false;
            } else {
              const offset = getCenterlineYOffsetH(x, r);
              const yDiv = yCenter + yDivOffset + offset;
              if (!drawing) {
                ctx.moveTo(x, yDiv);
                drawing = true;
              } else {
                ctx.lineTo(x, yDiv);
              }
            }
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
        
        // 2. Draw Shifting Double Yellow Centerline (Curving around left-turn pockets)
        ctx.strokeStyle = "#eab308"; // bright yellow
        ctx.lineWidth = 1.5;
        
        ctx.beginPath();
        let drawing = false;
        for (let x = PAD; x <= PAD + geomVal.HLEN * CELL_PX; x += 2) {
          if (isInsideIntersectionH(x, r)) {
            drawing = false;
          } else {
            const offset = getCenterlineYOffsetH(x, r);
            if (!drawing) {
              ctx.moveTo(x, yCenter - 1 + offset);
              drawing = true;
            } else {
              ctx.lineTo(x, yCenter - 1 + offset);
            }
          }
        }
        drawing = false;
        for (let x = PAD; x <= PAD + geomVal.HLEN * CELL_PX; x += 2) {
          if (isInsideIntersectionH(x, r)) {
            drawing = false;
          } else {
            const offset = getCenterlineYOffsetH(x, r);
            if (!drawing) {
              ctx.moveTo(x, yCenter + 1 + offset);
              drawing = true;
            } else {
              ctx.lineTo(x, yCenter + 1 + offset);
            }
          }
        }
        ctx.stroke();
      }

      for (let c = 0; c < NUM_V; c++) {
        const xBase = vRoadX(geomVal, c);
        const { vFwdCount, vBwdCount } = getLaneConfiguration(-1, c, simConfig);
        const xCenter = xBase + vFwdCount * (CELL_PX + LANE_GAP) - LANE_GAP / 2;
        
        // 1. Draw dashed lane dividers within each direction
        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        
        // Vertical Forward (Southbound) dividers - left of centerline
        for (let i = 1; i < vFwdCount; i++) {
          const xDivOffset = -i * (CELL_PX + LANE_GAP);
          ctx.beginPath();
          let drawing = false;
          for (let y = PAD; y <= PAD + geomVal.VLEN * CELL_PX; y += 2) {
            if (isInsideIntersectionV(y, c)) {
              drawing = false;
            } else {
              const offset = getCenterlineXOffsetV(y, c);
              const xDiv = xCenter + xDivOffset + offset;
              if (!drawing) {
                ctx.moveTo(xDiv, y);
                drawing = true;
              } else {
                ctx.lineTo(xDiv, y);
              }
            }
          }
          ctx.stroke();
        }
        // Vertical Backward (Northbound) dividers - right of centerline
        for (let i = 1; i < vBwdCount; i++) {
          const xDivOffset = i * (CELL_PX + LANE_GAP);
          ctx.beginPath();
          let drawing = false;
          for (let y = PAD; y <= PAD + geomVal.VLEN * CELL_PX; y += 2) {
            if (isInsideIntersectionV(y, c)) {
              drawing = false;
            } else {
              const offset = getCenterlineXOffsetV(y, c);
              const xDiv = xCenter + xDivOffset + offset;
              if (!drawing) {
                ctx.moveTo(xDiv, y);
                drawing = true;
              } else {
                ctx.lineTo(xDiv, y);
              }
            }
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
        
        // 2. Draw Shifting Double Yellow Centerline (Curving around left-turn pockets)
        ctx.strokeStyle = "#eab308"; // bright yellow
        ctx.lineWidth = 1.5;
        
        ctx.beginPath();
        let drawing = false;
        for (let y = PAD; y <= PAD + geomVal.VLEN * CELL_PX; y += 2) {
          if (isInsideIntersectionV(y, c)) {
            drawing = false;
          } else {
            const offset = getCenterlineXOffsetV(y, c);
            if (!drawing) {
              ctx.moveTo(xCenter - 1 + offset, y);
              drawing = true;
            } else {
              ctx.lineTo(xCenter - 1 + offset, y);
            }
          }
        }
        drawing = false;
        for (let y = PAD; y <= PAD + geomVal.VLEN * CELL_PX; y += 2) {
          if (isInsideIntersectionV(y, c)) {
            drawing = false;
          } else {
            const offset = getCenterlineXOffsetV(y, c);
            if (!drawing) {
              ctx.moveTo(xCenter + 1 + offset, y);
              drawing = true;
            } else {
              ctx.lineTo(xCenter + 1 + offset, y);
            }
          }
        }
        ctx.stroke();
      }

      // Draw Left Turn Pocket Ranges & Paint Channelization Zones
      ctx.lineWidth = 1;
      for (let r = 0; r < NUM_H; r++) {
        const yBase = hRoadY(geomVal, r);
        const { hFwdCount, hBwdCount } = getLaneConfiguration(r, -1, simConfig);
        const yCenter = yBase + hBwdCount * (CELL_PX + LANE_GAP) - LANE_GAP / 2;
        
        for (let c = 0; c < NUM_V; c++) {
          if (!geomVal.present[r] || !geomVal.present[r][c]) continue;
          const rx = vRoadX(geomVal, c);
          
          if (simConfig.leftTurnPocketH && simConfig.leftTurnPocketH[r]) {
            // Eastbound left-turn pocket (approaching from West, bottom-left of intersection, drawn next to centerline)
            const ebPocketXStart = rx - pocketPx;
            const ebY = yCenter; // top of pocket lane (at centerline)
            ctx.strokeStyle = "rgba(168, 85, 247, 0.6)";
            ctx.strokeRect(ebPocketXStart, ebY, pocketPx, CELL_PX);
            
            // Solid white divider for pocket lane
            ctx.strokeStyle = "#ffffff";
            ctx.beginPath();
            ctx.moveTo(ebPocketXStart, ebY + CELL_PX + LANE_GAP / 2);
            ctx.lineTo(rx, ebY + CELL_PX + LANE_GAP / 2);
            ctx.stroke();

            // Yellow Channelization Zone (槽化線) at entry taper
            ctx.strokeStyle = "#eab308";
            for (let i = 0; i < taperPx; i += 4) {
              ctx.beginPath();
              ctx.moveTo(ebPocketXStart - taperPx + i, ebY + CELL_PX);
              ctx.lineTo(ebPocketXStart - taperPx + i + 4, ebY);
              ctx.stroke();
            }

            // Westbound left-turn pocket (approaching from East, top-right of intersection, drawn next to centerline)
            const wbPocketXStart = rx + ROAD_W;
            const wbY = yCenter - CELL_PX; // bottom of pocket lane (at centerline)
            ctx.strokeStyle = "rgba(168, 85, 247, 0.6)";
            ctx.strokeRect(wbPocketXStart, wbY, pocketPx, CELL_PX);

            // Solid white divider for pocket lane
            ctx.strokeStyle = "#ffffff";
            ctx.beginPath();
            ctx.moveTo(wbPocketXStart, wbY - LANE_GAP / 2);
            ctx.lineTo(wbPocketXStart + pocketPx, wbY - LANE_GAP / 2);
            ctx.stroke();

            // Yellow Channelization Zone (槽化線) at entry taper
            ctx.strokeStyle = "#eab308";
            for (let i = 0; i < taperPx; i += 4) {
              ctx.beginPath();
              ctx.moveTo(wbPocketXStart + pocketPx + i, wbY);
              ctx.lineTo(wbPocketXStart + pocketPx + i + 4, wbY + CELL_PX);
              ctx.stroke();
            }
          }
          
          if (simConfig.leftTurnPocketV && simConfig.leftTurnPocketV[c]) {
            const ry = hRoadY(geomVal, r);
            const { vFwdCount, vBwdCount } = getLaneConfiguration(-1, c, simConfig);
            const xCenter = rx + vFwdCount * (CELL_PX + LANE_GAP) - LANE_GAP / 2;
            
            // Southbound left-turn pocket (approaching from North, top-left of intersection, next to centerline)
            const sbPocketYStart = ry - pocketPx;
            const sbX = xCenter - CELL_PX;
            ctx.strokeStyle = "rgba(168, 85, 247, 0.6)";
            ctx.strokeRect(sbX, sbPocketYStart, CELL_PX, pocketPx);

            // Solid white divider
            ctx.strokeStyle = "#ffffff";
            ctx.beginPath();
            ctx.moveTo(sbX - LANE_GAP / 2, sbPocketYStart);
            ctx.lineTo(sbX - LANE_GAP / 2, ry);
            ctx.stroke();

            // Northbound left-turn pocket (approaching from South, bottom-right of intersection, next to centerline)
            const nbPocketYStart = ry + ROAD_W;
            const nbX = xCenter;
            ctx.strokeStyle = "rgba(168, 85, 247, 0.6)";
            ctx.strokeRect(nbX, nbPocketYStart, CELL_PX, pocketPx);

            // Solid white divider
            ctx.strokeStyle = "#ffffff";
            ctx.beginPath();
            ctx.moveTo(nbX + CELL_PX + LANE_GAP / 2, nbPocketYStart);
            ctx.lineTo(nbX + CELL_PX + LANE_GAP / 2, nbPocketYStart + pocketPx);
            ctx.stroke();
          }
        }
      }

      // Draw Cars
      const drawCar = (car, x, y) => {
        if (!car) return;
        ctx.fillStyle = SPEED_COLORS[Math.min(car.v, SPEED_COLORS.length - 1)];
        ctx.fillRect(x - 2, y - 2, 4, 4);
        if (car.routed && car.path) {
          ctx.fillStyle = "#3b82f6";
          ctx.fillRect(x - 1, y - 1, 2, 2);
        }
      };

      if (simState.hFwd) {
        simState.hFwd.forEach((lanes, r) => {
          const yBase = hRoadY(geomVal, r);
          const { hFwdCount, hBwdCount } = getLaneConfiguration(r, -1, simConfig);
          const yCenter = yBase + hBwdCount * (CELL_PX + LANE_GAP) - LANE_GAP / 2;
          if (lanes) {
            lanes.forEach((road, laneIdx) => {
              if (road && (laneIdx < 2 || (laneIdx === 2 && hFwdCount === 3))) {
                road.forEach((car, pos) => {
                  if (car) {
                    const x = PAD + pos * CELL_PX + CELL_PX / 2;
                    const offset = getCenterlineYOffsetH(x, r);
                    const y = yCenter + LANE_GAP / 2 + laneIdx * (CELL_PX + LANE_GAP) + CELL_PX / 2 + offset;
                    drawCar(car, x, y);
                  }
                });
              }
            });
          }
        });
      }

      if (simState.hBwd) {
        simState.hBwd.forEach((lanes, r) => {
          const yBase = hRoadY(geomVal, r);
          const { hBwdCount } = getLaneConfiguration(r, -1, simConfig);
          const yCenter = yBase + hBwdCount * (CELL_PX + LANE_GAP) - LANE_GAP / 2;
          if (lanes) {
            lanes.forEach((road, laneIdx) => {
              if (road && (laneIdx < 2 || (laneIdx === 2 && hBwdCount === 3))) {
                road.forEach((car, pos) => {
                  if (car) {
                    const x = PAD + (geomVal.HLEN - 1 - pos) * CELL_PX + CELL_PX / 2;
                    const offset = getCenterlineYOffsetH(x, r);
                    const y = yCenter - LANE_GAP / 2 - laneIdx * (CELL_PX + LANE_GAP) - CELL_PX / 2 + offset;
                    drawCar(car, x, y);
                  }
                });
              }
            });
          }
        });
      }

      if (simState.vFwd) {
        simState.vFwd.forEach((lanes, c) => {
          const xBase = vRoadX(geomVal, c);
          const { vFwdCount } = getLaneConfiguration(-1, c, simConfig);
          const xCenter = xBase + vFwdCount * (CELL_PX + LANE_GAP) - LANE_GAP / 2;
          if (lanes) {
            lanes.forEach((road, laneIdx) => {
              if (road && (laneIdx < 2 || (laneIdx === 2 && vFwdCount === 3))) {
                road.forEach((car, pos) => {
                  if (car) {
                    const y = PAD + pos * CELL_PX + CELL_PX / 2;
                    const offset = getCenterlineXOffsetV(y, c);
                    const x = xCenter - LANE_GAP / 2 - laneIdx * (CELL_PX + LANE_GAP) - CELL_PX / 2 + offset;
                    drawCar(car, x, y);
                  }
                });
              }
            });
          }
        });
      }

      if (simState.vBwd) {
        simState.vBwd.forEach((lanes, c) => {
          const xBase = vRoadX(geomVal, c);
          const { vFwdCount, vBwdCount } = getLaneConfiguration(-1, c, simConfig);
          const xCenter = xBase + vFwdCount * (CELL_PX + LANE_GAP) - LANE_GAP / 2;
          if (lanes) {
            lanes.forEach((road, laneIdx) => {
              if (road && (laneIdx < 2 || (laneIdx === 2 && vBwdCount === 3))) {
                road.forEach((car, pos) => {
                  if (car) {
                    const y = PAD + (geomVal.VLEN - 1 - pos) * CELL_PX + CELL_PX / 2;
                    const offset = getCenterlineXOffsetV(y, c);
                    const x = xCenter + LANE_GAP / 2 + laneIdx * (CELL_PX + LANE_GAP) + CELL_PX / 2 + offset;
                    drawCar(car, x, y);
                  }
                });
              }
            });
          }
        });
      }
    } catch (e) {
      console.warn("Canvas drawing state mismatch, skipped frame.", e);
    }
  }, [tickCount, geom, simConfig, selectedRoad]);

  // Click detector on Canvas to select specific row/col
  const handleCanvasClick = (e) => {
    if (!canvasRef.current || !geoRef.current) return;
    const geomVal = geoRef.current;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvasSize(geomVal).w;
    const y = ((e.clientY - rect.top) / rect.height) * canvasSize(geomVal).h;

    // Detect closest row
    let minRowDist = Infinity, bestRowIdx = -1;
    for (let r = 0; r < NUM_H; r++) {
      const ry = hRoadY(geomVal, r) + ROAD_W / 2;
      const d = Math.abs(y - ry);
      if (d < minRowDist) { minRowDist = d; bestRowIdx = r; }
    }

    // Detect closest col
    let minColDist = Infinity, bestColIdx = -1;
    for (let c = 0; c < NUM_V; c++) {
      const rx = vRoadX(geomVal, c) + ROAD_W / 2;
      const d = Math.abs(x - rx);
      if (d < minColDist) { minColDist = d; bestColIdx = c; }
    }

    // Select row or col based on proximity
    if (minRowDist < minColDist && minRowDist < 30) {
      setSelectedRoad({ type: "row", index: bestRowIdx });
    } else if (minColDist < minRowDist && minColDist < 30) {
      setSelectedRoad({ type: "col", index: bestColIdx });
    }
  };

  // Run A/B experiment
  const runAB = () => {
    setExpRunning(true);
    setExpResults(null);
    
    setTimeout(() => {
      const baselineConfig = {
        ...DEFAULT_CONFIG,
        signalMode: "alternating",
        density: 0.3,
        pSlow: 0.3,
        turnP: 0.3,
        revModeH: ["none", "none", "none", "none", "none"],
        revModeV: ["none", "none", "none", "none", "none", "none"],
        leftTurnPocketH: [false, false, false, false, false],
        leftTurnPocketV: [false, false, false, false, false, false],
      };

      const ticks = 10000;
      const warmup = 2000;

      try {
        const parsedTreatmentConfig = JSON.parse(configText);
        const resA = runExperiment(seed, baselineConfig, ticks, warmup, routed, timeMode);
        const resB = runExperiment(seed, parsedTreatmentConfig, ticks, warmup, routed, timeMode);

        setExpResults({
          a: resA,
          b: resB,
          opts: { ticks, warmup, seed, routed, configA: baselineConfig, configB: parsedTreatmentConfig, timeMode }
        });
      } catch (err) {
        alert("JSON Config Parse Error: " + err.message);
      } finally {
        setExpRunning(false);
      }
    }, 100);
  };

  const handleApplyConfig = () => {
    try {
      const parsed = JSON.parse(configText);
      setSimConfig(parsed);
    } catch (err) {
      alert("Invalid JSON format.");
    }
  };

  const handleExportCSV = () => {
    if (!expResults) return;
    const { a, b, opts } = expResults;
    let csv = `Condition,Overall Throughput/tick,Avg Speed,Avg Travel Time,Arrival Rate,Completion Rate,Seed,Ticks\n`;
    
    csv += `Baseline (A),${a.throughput.toFixed(4)},${a.avgSpeed.toFixed(4)},${a.avgTravelTime.toFixed(2)},${a.arrivalRate.toFixed(4)},${(a.completion*100).toFixed(2)}%,${opts.seed},${opts.ticks}\n`;
    csv += `Treatment (B),${b.throughput.toFixed(4)},${b.avgSpeed.toFixed(4)},${b.avgTravelTime.toFixed(2)},${b.arrivalRate.toFixed(4)},${(b.completion*100).toFixed(2)}%,${opts.seed},${opts.ticks}\n`;
    
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `traffic_experiment_report_${seed}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Compare results
  let tputChange = 0, speedChange = 0, ttChange = 0, completionChange = 0;
  if (expResults) {
    const { a, b } = expResults;
    tputChange = ((b.throughput - a.throughput) / Math.max(a.throughput, 1e-9)) * 100;
    speedChange = ((b.avgSpeed - a.avgSpeed) / Math.max(a.avgSpeed, 1e-9)) * 100;
    if (a.avgTravelTime > 0) {
      ttChange = ((b.avgTravelTime - a.avgTravelTime) / a.avgTravelTime) * 100;
    }
    completionChange = ((b.completion - a.completion) / Math.max(a.completion, 1e-9)) * 100;
  }

  // GUI handlers for selected road attributes
  const updateSelectedRoadAttribute = (key, value) => {
    if (!selectedRoad) return;
    const isRow = selectedRoad.type === "row";
    const idx = selectedRoad.index;

    if (key === "reversible") {
      const modeArr = isRow ? [...simConfig.revModeH] : [...simConfig.revModeV];
      modeArr[idx] = value;
      updateConfig({
        ...simConfig,
        [isRow ? "revModeH" : "revModeV"]: modeArr
      });
    } else if (key === "leftTurn") {
      const pocketArr = isRow ? [...simConfig.leftTurnPocketH] : [...simConfig.leftTurnPocketV];
      pocketArr[idx] = value;
      updateConfig({
        ...simConfig,
        [isRow ? "leftTurnPocketH" : "leftTurnPocketV"]: pocketArr
      });
    }
  };

  // Get configuration values for currently selected road
  const getSelectedRoadConfig = () => {
    if (!selectedRoad) return { reversible: "none", leftTurn: false };
    const isRow = selectedRoad.type === "row";
    const idx = selectedRoad.index;
    return {
      reversible: isRow ? simConfig.revModeH[idx] : simConfig.revModeV[idx],
      leftTurn: isRow ? simConfig.leftTurnPocketH[idx] : simConfig.leftTurnPocketV[idx],
    };
  };

  const roadConf = getSelectedRoadConfig();

  return (
    <div style={{ background: "#060411", color: "#a5b4fc", minHeight: "100vh", fontFamily: "'Outfit', 'Inter', sans-serif", padding: "20px" }}>
      
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1e1b4b", paddingBottom: "15px", marginBottom: "20px" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: "700", color: "#e0e7ff", margin: 0, letterSpacing: "-0.5px" }}>城市路網 A/B 實驗模擬平台 v2.0</h1>
          <span style={{ fontSize: "11px", color: "#6366f1" }}>實體多車道 (2+2 變 3+1) · 地圖直觀點擊交互 · 論文級量化指標對比系統</span>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <label style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ color: "#818cf8" }}>🕒 時間與通勤流向：</span>
            <select value={timeMode} onChange={(e) => setTimeMode(e.target.value)}
              style={{ background: "#0c0a1c", border: "1px solid #312e81", color: "#e0e7ff", padding: "4px 8px", borderRadius: "4px", fontSize: "11px", cursor: "pointer" }}>
              <option value="morning">🌅 08:00 (上班尖峰 - 往東與往北)</option>
              <option value="offpeak">☀️ 12:00 (一般離峰 - 對稱分流)</option>
              <option value="evening">🌇 18:00 (下班尖峰 - 往西與往南)</option>
            </select>
          </label>
          <label style={{ fontSize: "12px" }}>
            Seed
            <input value={seed} onChange={(e) => setSeed(e.target.value)}
              style={{ marginLeft: "5px", width: "50px", background: "#0c0a1c", border: "1px solid #312e81", color: "#e0e7ff", padding: "3px 6px", borderRadius: "4px" }} />
          </label>
          <label style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
            <input type="checkbox" checked={routed} onChange={(e) => setRouted(e.target.checked)} />
            給定起訖點 (Routed)
          </label>
          <label style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
            <input type="checkbox" checked={missingOn} onChange={(e) => setMissingOn(e.target.checked)} />
            隨機 T 字路口
          </label>
        </div>
      </div>

      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
        {/* Left Side: Interactive Canvas with Click Selector */}
        <div style={{ flex: "1 1 500px" }}>
          <div style={{ background: "#0c0a1c", border: "1px solid #1e1b4b", borderRadius: "10px", padding: "12px", position: "relative" }}>
            <div style={{ fontSize: "11px", color: "#6366f1", marginBottom: "6px" }}>👉 點擊地圖上任意一條道路，即可在右側 Inspector 針對該道路直接配置調撥或左轉專用道。</div>
            <canvas ref={canvasRef} onClick={handleCanvasClick}
              width={canvasSize(geom).w} height={canvasSize(geom).h}
              style={{ width: "100%", height: "auto", display: "block", borderRadius: "6px", cursor: "pointer" }} />
            
            {/* Simulation controls */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", fontSize: "12px" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => setIsPlaying(!isPlaying)} style={{ background: "#4f46e5", color: "#fff", border: "none", borderRadius: "6px", padding: "6px 12px", fontSize: "12px", cursor: "pointer" }}>
                  {isPlaying ? "Pause" : "Run Live"}
                </button>
                <button onClick={resetSimulation} style={{ background: "#1e1b4b", color: "#a5b4fc", border: "1px solid #3730a3", borderRadius: "6px", padding: "5px 10px", fontSize: "12px", cursor: "pointer" }}>Reset</button>
              </div>
              <div style={{ color: "#4f46e5" }}>
                ⏰ {getSimulatedTime()} | Step: {simRef.current ? simRef.current.tick : 0} | Crossings: {simRef.current ? simRef.current.crossings : 0}
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Tabbed Experiment Workbench */}
        <div style={{ flex: "1 1 400px", display: "flex", flexDirection: "column", gap: "15px" }}>
          
          {/* Road Inspector - Configured by Canvas click */}
          <div style={{ background: "#0c0a1c", border: "1px solid #1e1b4b", borderRadius: "10px", padding: "15px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <span style={{ fontSize: "13px", fontWeight: "700", color: "#e0e7ff" }}>開關與調撥 (Road Inspector)</span>
              <span style={{ fontSize: "11px", background: "#312e81", color: "#818cf8", padding: "2px 6px", borderRadius: "4px" }}>
                已選定: {selectedRoad ? `${selectedRoad.type === "row" ? "水平道路" : "垂直道路"} Index ${selectedRoad.index}` : "無"}
              </span>
            </div>

            {selectedRoad ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {/* Reversible setting */}
                <div>
                  <label style={{ display: "block", fontSize: "12px", marginBottom: "4px" }}>調撥車道配置</label>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button onClick={() => updateSelectedRoadAttribute("reversible", "none")}
                      style={{ background: "#1e1b4b", color: "#a5b4fc", border: roadConf.reversible === "none" ? "2px solid #818cf8" : "1px solid #3730a3", borderRadius: "6px", padding: "5px 10px", flex: 1, cursor: "pointer" }}>無調撥</button>
                    <button onClick={() => updateSelectedRoadAttribute("reversible", "peak_fwd")}
                      style={{ background: "#1e1b4b", color: "#a5b4fc", border: roadConf.reversible === "peak_fwd" ? "2px solid #818cf8" : "1px solid #3730a3", borderRadius: "6px", padding: "5px 10px", flex: 1, cursor: "pointer" }}>尖峰向 (3+1)</button>
                    <button onClick={() => updateSelectedRoadAttribute("reversible", "peak_bwd")}
                      style={{ background: "#1e1b4b", color: "#a5b4fc", border: roadConf.reversible === "peak_bwd" ? "2px solid #818cf8" : "1px solid #3730a3", borderRadius: "6px", padding: "5px 10px", flex: 1, cursor: "pointer" }}>反向 (1+3)</button>
                  </div>
                </div>

                {/* Left turn pocket setting */}
                <div>
                  <label style={{ display: "block", fontSize: "12px", marginBottom: "4px" }}>左轉專用道 (轉彎車道分流)</label>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button onClick={() => updateSelectedRoadAttribute("leftTurn", false)}
                      style={{ background: "#1e1b4b", color: "#a5b4fc", border: !roadConf.leftTurn ? "2px solid #a855f7" : "1px solid #3730a3", borderRadius: "6px", padding: "5px 10px", flex: 1, cursor: "pointer" }}>停用</button>
                    <button onClick={() => updateSelectedRoadAttribute("leftTurn", true)}
                      style={{ background: "#1e1b4b", color: "#a5b4fc", border: roadConf.leftTurn ? "2px solid #a855f7" : "1px solid #3730a3", borderRadius: "6px", padding: "5px 10px", flex: 1, cursor: "pointer" }}>啟用</button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: "11px", color: "#64748b", textAlign: "center", padding: "10px" }}>請在地圖上點擊一條道路以進行配置。</div>
            )}
          </div>

          {/* Global Parameters Panel */}
          <div style={{ background: "#0c0a1c", border: "1px solid #1e1b4b", borderRadius: "10px", padding: "15px" }}>
            <span style={{ fontSize: "13px", fontWeight: "700", color: "#e0e7ff", display: "block", marginBottom: "10px" }}>🚦 全域號誌與環境參數</span>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "12px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "4px" }}>號誌控制模式</label>
                <select value={simConfig.signalMode} onChange={(e) => updateConfig({ ...simConfig, signalMode: e.target.value })}
                  style={{ width: "100%", background: "#060411", color: "#e0e7ff", border: "1px solid #1e1b4b", padding: "6px", borderRadius: "4px" }}>
                  <option value="alternating">Alternating (Baseline 固定時制)</option>
                  <option value="green_wave_h">Green Wave Horizontal (水平綠波帶)</option>
                  <option value="green_wave_v">Green Wave Vertical (垂直綠波帶)</option>
                  <option value="adaptive">Adaptive Signal (智慧自適應感應)</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "4px" }}>車流密度 ({simConfig.density})</label>
                  <input type="range" min={0.1} max={0.95} step={0.05} value={simConfig.density}
                    onChange={(e) => updateConfig({ ...simConfig, density: +e.target.value })} style={{ width: "100%" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "4px" }}>減速機率 ({simConfig.pSlow})</label>
                  <input type="range" min={0.1} max={0.6} step={0.05} value={simConfig.pSlow}
                    onChange={(e) => updateConfig({ ...simConfig, pSlow: +e.target.value })} style={{ width: "100%" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "4px" }}>起步延遲 ({simConfig.startupDelay} ticks)</label>
                  <input type="range" min={0} max={5} step={1} value={simConfig.startupDelay || 0}
                    onChange={(e) => updateConfig({ ...simConfig, startupDelay: +e.target.value })} style={{ width: "100%" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "4px" }}>導航順從率 ({Math.round((simConfig.complianceRate || 0) * 100)}%)</label>
                  <input type="range" min={0} max={1} step={0.1} value={simConfig.complianceRate || 0}
                    onChange={(e) => updateConfig({ ...simConfig, complianceRate: +e.target.value })} style={{ width: "100%" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "4px" }}>左轉懲罰權重 ({simConfig.leftTurnPenalty || 1})</label>
                  <input type="range" min={1} max={20} step={1} value={simConfig.leftTurnPenalty || 1}
                    onChange={(e) => updateConfig({ ...simConfig, leftTurnPenalty: +e.target.value })} style={{ width: "100%" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "4px" }}>綠波順從度 ({Math.round((simConfig.greenWaveCompliance || 0) * 100)}%)</label>
                  <input type="range" min={0} max={1} step={0.1} value={simConfig.greenWaveCompliance || 0}
                    onChange={(e) => updateConfig({ ...simConfig, greenWaveCompliance: +e.target.value })} style={{ width: "100%" }} />
                </div>
              </div>
            </div>
          </div>

          {/* JSON Config Editor - Hidden by default */}
          <details style={{ background: "#0c0a1c", border: "1px solid #1e1b4b", borderRadius: "10px", padding: "12px" }}>
            <summary style={{ fontSize: "12px", fontWeight: "600", cursor: "pointer", color: "#64748b" }}>🛠️ 顯示底層 JSON 配置檔 (Advanced)</summary>
            <div style={{ marginTop: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <span style={{ fontSize: "11px", color: "#64748b" }}>JSON Config Text</span>
                <button onClick={handleApplyConfig} style={{ background: "#1e1b4b", color: "#a5b4fc", border: "1px solid #3730a3", borderRadius: "6px", padding: "3px 6px", fontSize: "10px", cursor: "pointer" }}>Apply</button>
              </div>
              <textarea value={configText} onChange={(e) => setConfigText(e.target.value)}
                style={{ width: "95%", height: "120px", background: "#060411", color: "#a5b4fc", border: "1px solid #1e1b4b", borderRadius: "6px", fontFamily: "monospace", fontSize: "10px", padding: "8px", resize: "none" }} />
            </div>
          </details>

          {/* Quantized Comparison Report */}
          <div style={{ background: "#0c0a1c", border: "1px solid #1e1b4b", borderRadius: "10px", padding: "15px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
              <div>
                <span style={{ fontSize: "14px", fontWeight: "700", color: "#e0e7ff" }}>📊 A/B 量化實驗結果</span>
                <div style={{ fontSize: "10px", color: "#64748b" }}>Baseline (10k ticks) vs. Treatment (B)</div>
              </div>
              <button onClick={runAB} disabled={expRunning} style={{ background: "#4f46e5", color: "#fff", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "12px", cursor: "pointer" }}>
                {expRunning ? "執行中..." : "Run Experiment"}
              </button>
            </div>

            {expResults ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div style={{ background: "#111029", border: "1px solid #312e81", borderRadius: "8px", padding: "8px 12px" }}>
                    <div style={{ fontSize: "10px", color: "#818cf8" }}>吞吐量增幅 (Throughput)</div>
                    <div style={{ fontSize: "18px", fontWeight: "700", color: tputChange >= 0 ? "#10b981" : "#ef4444" }}>
                      {tputChange >= 0 ? "+" : ""}{tputChange.toFixed(1)}%
                    </div>
                  </div>
                  <div style={{ background: "#111029", border: "1px solid #312e81", borderRadius: "8px", padding: "8px 12px" }}>
                    <div style={{ fontSize: "10px", color: "#818cf8" }}>平均車速變幅 (Avg Speed)</div>
                    <div style={{ fontSize: "18px", fontWeight: "700", color: speedChange >= 0 ? "#10b981" : "#ef4444" }}>
                      {speedChange >= 0 ? "+" : ""}{speedChange.toFixed(1)}%
                    </div>
                  </div>
                </div>

                {routed && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <div style={{ background: "#111029", border: "1px solid #312e81", borderRadius: "8px", padding: "8px 12px" }}>
                      <div style={{ fontSize: "10px", color: "#c084fc" }}>旅行時間減幅 (Travel Time)</div>
                      <div style={{ fontSize: "18px", fontWeight: "700", color: ttChange <= 0 ? "#10b981" : "#ef4444" }}>
                        {ttChange.toFixed(1)}%
                      </div>
                    </div>
                    <div style={{ background: "#111029", border: "1px solid #312e81", borderRadius: "8px", padding: "8px 12px" }}>
                      <div style={{ fontSize: "10px", color: "#c084fc" }}>完成率增幅 (Completion)</div>
                      <div style={{ fontSize: "18px", fontWeight: "700", color: completionChange >= 0 ? "#10b981" : "#ef4444" }}>
                        {completionChange >= 0 ? "+" : ""}{completionChange.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                )}

                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", marginTop: "5px" }}>
                  <thead>
                    <tr style={{ color: "#818cf8", borderBottom: "1px solid #1e1b4b", textAlign: "left" }}>
                      <th style={{ padding: "4px" }}>指標</th>
                      <th style={{ padding: "4px" }}>Baseline (A)</th>
                      <th style={{ padding: "4px" }}>Treatment (B)</th>
                    </tr>
                  </thead>
                  <tbody style={{ color: "#e0e7ff" }}>
                    <tr style={{ borderBottom: "1px solid #111029" }}>
                      <td style={{ padding: "6px 4px" }}>透過車數/tick</td>
                      <td style={{ padding: "6px 4px" }}>{expResults.a.throughput.toFixed(3)}</td>
                      <td style={{ padding: "6px 4px" }}>{expResults.b.throughput.toFixed(3)}</td>
                    </tr>
                    <tr style={{ borderBottom: "1px solid #111029" }}>
                      <td style={{ padding: "6px 4px" }}>平均速度 (cells/s)</td>
                      <td style={{ padding: "6px 4px" }}>{expResults.a.avgSpeed.toFixed(2)}</td>
                      <td style={{ padding: "6px 4px" }}>{expResults.b.avgSpeed.toFixed(2)}</td>
                    </tr>
                    {routed && (
                      <>
                        <tr style={{ borderBottom: "1px solid #111029" }}>
                          <td style={{ padding: "6px 4px" }}>平均旅行時間 (s)</td>
                          <td style={{ padding: "6px 4px" }}>{expResults.a.avgTravelTime.toFixed(1)}s</td>
                          <td style={{ padding: "6px 4px" }}>{expResults.b.avgTravelTime.toFixed(1)}s</td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid #111029" }}>
                          <td style={{ padding: "6px 4px" }}>完成率 (%)</td>
                          <td style={{ padding: "6px 4px" }}>{(expResults.a.completion * 100).toFixed(1)}%</td>
                          <td style={{ padding: "6px 4px" }}>{(expResults.b.completion * 100).toFixed(1)}%</td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>

                <button onClick={handleExportCSV} style={{ background: "#1e1b4b", color: "#a5b4fc", border: "1px solid #3730a3", borderRadius: "6px", padding: "5px 10px", width: "100%", marginTop: "5px", cursor: "pointer" }}>
                  📥 匯出 A/B 對比數據 (.CSV)
                </button>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "30px", color: "#64748b", fontSize: "12px", background: "#070515", border: "1px dashed #1e1b4b", borderRadius: "8px" }}>
                尚未執行 A/B 實驗。點擊右上角按鈕即可在 0.1 秒內跑完 10,000 steps 並匯出精準對照組數據。
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
