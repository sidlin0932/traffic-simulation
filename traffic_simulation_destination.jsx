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

const ROAD_W = CELL_PX * 2 + LANE_GAP;
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
  return {
    w: PAD * 2 + g.HLEN * CELL_PX,
    h: PAD * 2 + g.VLEN * CELL_PX,
  };
}
function hRoadY(g, r) { return PAD + g.vInt[r] * CELL_PX - CELL_PX; }
function vRoadX(g, c) { return PAD + g.hInt[c] * CELL_PX - CELL_PX; }

function makeRoad(len) { return new Array(len).fill(null); }

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

function initLights(g, mode, waveSpeed) {
  return Array.from({ length: NUM_H }, (_, r) =>
    Array.from({ length: NUM_V }, (_, c) => {
      let timer = 0, hGreen = true;
      if (mode === "alternating") {
        hGreen = (r + c) % 2 === 0;
      } else if (mode === "green_wave_h") {
        const dist = g.hInt[c];
        const offset = -Math.round(dist / Math.max(waveSpeed, 1));
        timer = ((offset % FULL_CYCLE) + FULL_CYCLE) % FULL_CYCLE;
        hGreen = timer < LIGHT_CYCLE;
      } else if (mode === "green_wave_v") {
        const dist = g.vInt[r];
        const offset = -Math.round(dist / Math.max(waveSpeed, 1));
        timer = ((offset % FULL_CYCLE) + FULL_CYCLE) % FULL_CYCLE;
        hGreen = !(timer < LIGHT_CYCLE);
      } else {
        hGreen = true; timer = 0;
      }
      if (timer >= LIGHT_CYCLE) { timer -= LIGHT_CYCLE; hGreen = !hGreen; }
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

function initState(g, density, signalMode, waveSpeed, seed, routed) {
  const rng = mulberry32(typeof seed === "string" ? hashString(seed) : seed);
  const exc = buildExcludes(g);
  const dens = routed ? 0 : density; 
  const mkH = (e) => Array.from({ length: NUM_H }, () => {
    const r = makeRoad(g.HLEN); if (dens) populate(r, dens, e, rng); return r;
  });
  const mkV = (eArr) => Array.from({ length: NUM_V }, (_, c) => {
    const r = makeRoad(g.VLEN); if (dens) populate(r, dens, eArr[c], rng); return r;
  });
  return {
    hFwd: mkH(exc.hFwd), hBwd: mkH(exc.hBwd),
    vFwd: mkV(exc.vFwd), vBwd: mkV(exc.vBwd),
    lights: initLights(g, signalMode, waveSpeed),
    crossings: 0,
  };
}

function stepLightsAdaptive(g, state, mode) {
  const { hFwd, hBwd, vFwd, vBwd, lights } = state;
  return lights.map((row, r) => row.map((l, c) => {
    if (mode !== "adaptive") {
      const t = l.timer + 1;
      return t >= LIGHT_CYCLE ? { hGreen: !l.hGreen, timer: 0 } : { hGreen: l.hGreen, timer: t };
    }
    
    if (!g.present[r][c]) return l;
    
    const hp = g.hInt[c], hm = mirror(g.hInt[c], g.HLEN);
    const vp = g.vInt[r], vm = mirror(g.vInt[r], g.VLEN);
    
    let hCars = 0, vCars = 0;
    const SENSOR_RANGE = 8; 
    
    for (let i = 0; i <= SENSOR_RANGE; i++) {
      if (hp - i >= 0 && hFwd[r][hp - i]) hCars++;
      if (hm - i >= 0 && hBwd[r][hm - i]) hCars++;
      if (vp - i >= 0 && vFwd[c][vp - i]) vCars++;
      if (vm - i >= 0 && vBwd[c][vm - i]) vCars++;
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

function bfsPath(adj, start, goal) {
  if (start === goal) return [start];
  const prev = new Array(adj.length).fill(-1);
  const seen = new Array(adj.length).fill(false);
  const q = [start]; seen[start] = true;
  while (q.length) {
    const u = q.shift();
    for (const w of adj[u]) {
      if (!seen[w]) {
        seen[w] = true; prev[w] = u;
        if (w === goal) {
          const path = [goal]; let x = goal;
          while (x !== start) { x = prev[x]; path.push(x); }
          return path.reverse();
        }
        q.push(w);
      }
    }
  }
  return null; 
}

function bfsPathAvoid(adj, start, goal, avoidFirst) {
  if (start === goal) return [start];
  const prev = new Array(adj.length).fill(-1);
  const seen = new Array(adj.length).fill(false);
  const q = []; seen[start] = true;
  for (const w of adj[start]) { 
    if (w === avoidFirst) continue;
    if (!seen[w]) { seen[w] = true; prev[w] = start; q.push(w); }
  }
  while (q.length) {
    const u = q.shift();
    if (u === goal) { const p = [goal]; let x = goal; while (x !== start) { x = prev[x]; p.push(x); } return p.reverse(); }
    for (const w of adj[u]) if (!seen[w]) { seen[w] = true; prev[w] = u; q.push(w); }
  }
  return null; 
}

function headingBetween(a, b) {
  const r1 = NK_R(a), c1 = NK_C(a), r2 = NK_R(b), c2 = NK_C(b);
  if (c2 === c1 + 1) return "E";
  if (c2 === c1 - 1) return "W";
  if (r2 === r1 + 1) return "S";
  return "N";
}

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
  if (!g.vBarrier) return true;
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
  if (!g.vBarrier) return true;
  if (boundary === "N") { const c = laneIdx; for (let y = 0; y <= g.vInt[0]; y++) if (g.vBarrier[c].has(y)) return false; return true; }
  if (boundary === "S") { const c = laneIdx; for (let y = g.vInt[NUM_H - 1]; y < g.VLEN; y++) if (g.vBarrier[c].has(y)) return false; return true; }
  return true;
}

function intCellFor(g, heading, r, c) {
  if (heading === "E") return g.hInt[c];
  if (heading === "W") return mirror(g.hInt[c], g.HLEN);
  if (heading === "S") return g.vInt[r];
  return mirror(g.vInt[r], g.VLEN);
}

function nextStopCell(g, heading, laneIdx, from, plan) {
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
  if (heading === "E") { for (let c = 0; c < NUM_V; c++) if (g.hInt[c] === cell) return NK(laneIdx, c); }
  else if (heading === "W") { for (let c = 0; c < NUM_V; c++) if (mirror(g.hInt[c], g.HLEN) === cell) return NK(laneIdx, c); }
  else if (heading === "S") { for (let r = 0; r < NUM_H; r++) if (g.vInt[r] === cell) return NK(r, laneIdx); }
  else { for (let r = 0; r < NUM_H; r++) if (mirror(g.vInt[r], g.VLEN) === cell) return NK(r, laneIdx); }
  return null;
}

function naschStep(road, blockedSet, crossSet, pSlow, rng, counter, key, onExit) {
  const n = road.length;
  const next = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const car = road[i];
    if (!car) continue;
    let v = Math.min(car.v + 1, V_MAX);
    const cap = (car.stopCell != null && isFinite(car.stopCell)) ? Math.max(0, car.stopCell - i) : Infinity;
    let limit = Math.min(v, cap);
    let gap = limit;
    for (let d = 1; d <= limit; d++) {
      const p = i + d;
      if (p >= n) { gap = d; break; }
      if (road[p] !== null || blockedSet.has(p)) { gap = d - 1; break; }
      gap = d;
    }
    v = Math.min(limit, gap);
    if (v > 0 && rng() < pSlow) v--;
    const np = i + v;
    if (crossSet) for (let p = i + 1; p <= np; p++) if (crossSet.has(p)) { counter[key]++; break; }
    if (np < n) { car.v = v; next[np] = car; }
    else if (onExit) onExit(car); 
  }
  return next;
}

function inject(road, rng, wall, pInject) {
  if (wall && (wall.has(0) || wall.has(1))) return;
  if (road[0] === null && road[1] === null && rng() < pInject)
    road[0] = { v: Math.floor(rng() * 3) + 1 };
}

function injectRouted(g, adj, road, rng, wall, pInject, tick, boundary, laneIdx, idRef) {
  if (wall && (wall.has(0) || wall.has(1))) return;
  if (road[0] !== null || road[1] !== null || rng() >= pInject) return;
  if (!entrySegmentClear(g, boundary, laneIdx)) return; 
  const { node: start, heading } = entryInfo(boundary, laneIdx);
  const exits = allExits().filter(([eb, el]) =>
    !(eb === boundary && el === laneIdx) && exitSegmentClear(g, eb, el));
  for (let tries = 0; tries < 8 && exits.length; tries++) {
    const [eb, el] = exits[Math.floor(rng() * exits.length)];
    const { node: goal, heading: exitHeading } = exitInfo(eb, el);
    const path = bfsPath(adj, start, goal);
    if (!path) continue;
    const plan = derivePlan(path, exitHeading);
    const car = {
      v: Math.floor(rng() * 3) + 1,
      id: idRef.n++, spawn: tick, heading, plan,
      target: goal, exitHeading, routed: true, stopCell: null,
      path 
    };
    car.stopCell = nextStopCell(g, heading, laneIdx, 0, plan);
    road[0] = car;
    return car;
  }
  return null;
}

function clearIntersections(g, state, rng) {
  const { hFwd, hBwd, vFwd, vBwd, lights } = state;
  const wallOf = new WeakMap();
  if (state.vWallF) state.vFwd.forEach((rd, c) => wallOf.set(rd, state.vWallF[c]));
  if (state.vWallB) state.vBwd.forEach((rd, c) => wallOf.set(rd, state.vWallB[c]));
  const blocked = (road, pos) => { const w = wallOf.get(road); return w ? w.has(pos) : false; };

  function tryForward(road, pos) {
    const nxt = pos + 1;
    if (nxt < road.length && road[nxt] === null && !blocked(road, nxt)) { road[nxt] = { v: 1 }; road[pos] = null; return true; }
    return false;
  }
  function tryForceTurn(srcRoad, srcPos, tA, pA, tB, pB) {
    if (!srcRoad[srcPos]) return;
    const first = rng() < 0.5;
    const pairs = first ? [[tA, pA], [tB, pB]] : [[tB, pB], [tA, pA]];
    for (const [tRoad, tPos] of pairs) {
      const landing = tPos + 1;
      if (landing < tRoad.length && tRoad[landing] === null && tRoad[tPos] === null
          && !blocked(tRoad, landing) && !blocked(tRoad, tPos)) {
        tRoad[landing] = { v: 1 }; srcRoad[srcPos] = null; return;
      }
    }
    for (const [tRoad, tPos] of pairs)
      if (tRoad[tPos] === null && !blocked(tRoad, tPos)) { tRoad[tPos] = { v: 0 }; srcRoad[srcPos] = null; return; }
  }

  for (let r = 0; r < NUM_H; r++) {
    for (let c = 0; c < NUM_V; c++) {
      if (!g.present[r][c]) continue; 
      const hp = g.hInt[c], hm = mirror(g.hInt[c], g.HLEN);
      const vp = g.vInt[r], vm = mirror(g.vInt[r], g.VLEN);
      const hg = lights[r][c].hGreen;
      const free = (rd, p) => rd[p] && !rd[p].routed; 
      if (!hg) {
        if (free(hFwd[r], hp) && !tryForward(hFwd[r], hp)) tryForceTurn(hFwd[r], hp, vFwd[c], vp, vBwd[c], vm);
        if (free(hBwd[r], hm) && !tryForward(hBwd[r], hm)) tryForceTurn(hBwd[r], hm, vFwd[c], vp, vBwd[c], vm);
      }
      if (hg) {
        if (free(vFwd[c], vp) && !tryForward(vFwd[c], vp)) tryForceTurn(vFwd[c], vp, hFwd[r], hp, hBwd[r], hm);
        if (free(vBwd[c], vm) && !tryForward(vBwd[c], vm)) tryForceTurn(vBwd[c], vm, hFwd[r], hp, hBwd[r], hm);
      }
    }
  }

  if (g.tjunc) {
    for (let r = 0; r < NUM_H; r++) {
      for (let c = 0; c < NUM_V; c++) {
        if (!g.tjunc[r][c]) continue;
        const hp = g.hInt[c], hm = mirror(g.hInt[c], g.HLEN);
        const vp = g.vInt[r], vm = mirror(g.vInt[r], g.VLEN);
        if (g.tjunc[r][c] === "down" && vFwd[c][vp] && !vFwd[c][vp].routed)
          tryForceTurn(vFwd[c], vp, hFwd[r], hp, hBwd[r], hm);
        if (g.tjunc[r][c] === "up" && vBwd[c][vm] && !vBwd[c][vm].routed)
          tryForceTurn(vBwd[c], vm, hFwd[r], hp, hBwd[r], hm);
      }
    }
  }
}

function processTurns(g, state, turnProb, rng) {
  const { hFwd, hBwd, vFwd, vBwd, lights } = state;
  const turns = [];
  for (let r = 0; r < NUM_H; r++) {
    for (let c = 0; c < NUM_V; c++) {
      if (!g.present[r][c]) continue;
      const hp = g.hInt[c], hm = mirror(g.hInt[c], g.HLEN);
      const vp = g.vInt[r], vm = mirror(g.vInt[r], g.VLEN);
      const hg = lights[r][c].hGreen;
      if (hg) {
        if (hFwd[r][hp] && rng() < turnProb) turns.push({ src: hFwd[r], si: hp, targets: [{ road: vFwd[c], ti: vp }, { road: vBwd[c], ti: vm }] });
        if (hBwd[r][hm] && rng() < turnProb) turns.push({ src: hBwd[r], si: hm, targets: [{ road: vFwd[c], ti: vp }, { road: vBwd[c], ti: vm }] });
      } else {
        if (vFwd[c][vp] && rng() < turnProb) turns.push({ src: vFwd[c], si: vp, targets: [{ road: hFwd[r], ti: hp }, { road: hBwd[r], ti: hm }] });
        if (vBwd[c][vm] && rng() < turnProb) turns.push({ src: vBwd[c], si: vm, targets: [{ road: hFwd[r], ti: hp }, { road: hBwd[r], ti: hm }] });
      }
    }
  }
  for (let i = turns.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [turns[i], turns[j]] = [turns[j], turns[i]]; }
  const wallOf = new WeakMap();
  if (state.vWallF) state.vFwd.forEach((rd, c) => wallOf.set(rd, state.vWallF[c]));
  if (state.vWallB) state.vBwd.forEach((rd, c) => wallOf.set(rd, state.vWallB[c]));
  for (const t of turns) {
    if (!t.src[t.si]) continue;
    const car = t.src[t.si];
    const pick = t.targets[rng() < 0.5 ? 0 : 1];
    const landing = pick.ti + 1;
    const w = wallOf.get(pick.road);
    if (w && (w.has(landing) || w.has(pick.ti))) continue;
    if (landing < pick.road.length && pick.road[landing] === null && pick.road[pick.ti] === null) {
      pick.road[landing] = { v: Math.max(1, Math.min(car.v, 2)) };
      t.src[t.si] = null;
    }
  }
}

function processRoutes(g, state, rng) {
  const { hFwd, hBwd, vFwd, vBwd, lights } = state;
  const adj = state.adj || buildGraph(g);
  const laneOf = (heading, idx) =>
    heading === "E" ? hFwd[idx] : heading === "W" ? hBwd[idx] : heading === "S" ? vFwd[idx] : vBwd[idx];
  const wallOf = new WeakMap();
  if (state.vWallF) state.vFwd.forEach((rd, c) => wallOf.set(rd, state.vWallF[c]));
  if (state.vWallB) state.vBwd.forEach((rd, c) => wallOf.set(rd, state.vWallB[c]));

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
    const road = laneOf(heading, idx);
    for (let i = 0; i < road.length; i++) {
      const car = road[i];
      if (!car || !car.routed) continue;
      if (!isFinite(car.stopCell) || i !== car.stopCell) continue; 
      const nk = nodeAtCell(g, heading, idx, i);
      if (nk == null) continue;
      const r = NK_R(nk), c = NK_C(nk);
      let out = car.plan[nk];
      if (out == null) { 
        const path = bfsPath(adj, nk, car.target);
        if (path) { car.plan = derivePlan(path, car.exitHeading); out = car.plan[nk]; car.path = path; }
      }
      if (out == null || out === heading) { car.wait = 0; continue; } 
      const present = g.present[r][c];
      const axisH = (heading === "E" || heading === "W");
      const allowed = !present || (axisH ? lights[r][c].hGreen : !lights[r][c].hGreen);
      if (!allowed) continue; 
      cand.push({ srcRoad: road, si: i, car, nk, r, c, out, heading, idx });
    }
  };
  for (let r = 0; r < NUM_H; r++) { scan("E", r); scan("W", r); }
  for (let c = 0; c < NUM_V; c++) { scan("S", c); scan("N", c); }

  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }

  for (const t of cand) {
    if (t.srcRoad[t.si] !== t.car) continue;
    const { car, nk, r, c, out } = t;
    const tRoad = laneOf(out, out === "E" || out === "W" ? r : c);
    const crossCell = intCellFor(g, out, r, c);
    const landing = crossCell + 1;
    const w = wallOf.get(tRoad);
    const blockedLanding = (w && (w.has(landing) || w.has(crossCell))) ||
      !(landing < tRoad.length && tRoad[landing] === null && tRoad[crossCell] === null);

    if (!blockedLanding) {
      car.heading = out;
      car.v = Math.max(1, Math.min(car.v, 2));
      car.stopCell = nextStopCell(g, out, (out === "E" || out === "W") ? r : c, landing, car.plan);
      car.wait = 0;
      tRoad[landing] = car;
      t.srcRoad[t.si] = null;
    } else {
      car.wait = (car.wait || 0) + 1;
      if (car.wait >= PATIENCE) {
        const blockedNext = stepNode(nk, out);
        let adopted = false;
        const alt = bfsPathAvoid(adj, nk, car.target, blockedNext);
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
            const p2 = bfsPathAvoid(adj, nk, goal, blockedNext);
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

function stepSim(g, state, pSlow, turnProb, rng, pInject, opts) {
  const mode = (opts && opts.signalMode) || "alternating";
  const nl = stepLightsAdaptive(g, state, mode);
  
  const routed = opts && opts.routed;
  const tick = (opts && opts.tick != null) ? opts.tick : (state.tick || 0);
  const adj = opts && opts.adj;
  const idRef = (opts && opts.idRef) || { n: 0 };

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
        if (g.present[idx][c] && !nl[idx][c].hGreen) s.add(isFwd ? g.hInt[c] : mirror(g.hInt[c], g.HLEN));
    } else {
      for (let r = 0; r < NUM_H; r++)
        if (g.present[r][idx] && nl[r][idx].hGreen) s.add(isFwd ? g.vInt[r] : mirror(g.vInt[r], g.VLEN));
      if (g.vBarrier) for (const y of g.vBarrier[idx]) s.add(isFwd ? y : mirror(y, g.VLEN));
    }
    return s;
  };

  const crossH_f = new Set(), crossH_b = new Set(), crossV_f = new Set(), crossV_b = new Set();
  for (let r = 0; r < NUM_H; r++) for (let c = 0; c < NUM_V; c++) if (g.present[r][c]) {
    crossH_f.add(g.hInt[c]); crossH_b.add(mirror(g.hInt[c], g.HLEN));
    crossV_f.add(g.vInt[r]); crossV_b.add(mirror(g.vInt[r], g.VLEN));
  }

  const counter = { hF: 0, hB: 0, vF: 0, vB: 0 };
  const vWallF = Array.from({ length: NUM_V }, (_, c) => g.vBarrier ? g.vBarrier[c] : new Set());
  const vWallB = Array.from({ length: NUM_V }, (_, c) => {
    const s = new Set(); if (g.vBarrier) for (const y of g.vBarrier[c]) s.add(mirror(y, g.VLEN)); return s;
  });
  const res = {
    hFwd: state.hFwd.map((rd, r) => naschStep(rd, blk(true, true, r), crossH_f, pSlow, rng, counter, "hF", onExit)),
    hBwd: state.hBwd.map((rd, r) => naschStep(rd, blk(true, false, r), crossH_b, pSlow, rng, counter, "hB", onExit)),
    vFwd: state.vFwd.map((rd, c) => naschStep(rd, blk(false, true, c), crossV_f, pSlow, rng, counter, "vF", onExit)),
    vBwd: state.vBwd.map((rd, c) => naschStep(rd, blk(false, false, c), crossV_b, pSlow, rng, counter, "vB", onExit)),
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

  clearIntersections(g, res, rng);
  if (routed) processRoutes(g, res, rng);
  else processTurns(g, res, turnProb, rng);

  const pInj = pInject == null ? INJECT_P : pInject;
  if (routed) {
    let inNet = 0;
    for (const grp of [res.hFwd, res.hBwd, res.vFwd, res.vBwd]) for (const rd of grp) for (const cell of rd) if (cell) inNet++;
    const METER_CAP = 220; 
    const meterP = inNet >= METER_CAP ? 0 : pInj * (1 - inNet / METER_CAP);
    res.metered = inNet >= METER_CAP;
    if (meterP > 0) {
      res.hFwd.forEach((rd, r) => injectRouted(g, adj, rd, rng, null, meterP, tick, "W", r, idRef));
      res.hBwd.forEach((rd, r) => injectRouted(g, adj, rd, rng, null, meterP, tick, "E", r, idRef));
      res.vFwd.forEach((rd, c) => injectRouted(g, adj, rd, rng, vWallF[c], meterP, tick, "N", c, idRef));
      res.vBwd.forEach((rd, c) => injectRouted(g, adj, rd, rng, vWallB[c], meterP, tick, "S", c, idRef));
    }
  } else {
    res.hFwd.forEach((rd) => inject(rd, rng, null, pInj));
    res.hBwd.forEach((rd) => inject(rd, rng, null, pInj));
    res.vFwd.forEach((rd, c) => inject(rd, rng, vWallF[c], pInj));
    res.vBwd.forEach((rd, c) => inject(rd, rng, vWallB[c], pInj));
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
  const lo = 0.03, hi = 0.30;
  const t = Math.max(0, Math.min(1, (density - lo) / (hi - lo)));
  return 0.10 + t * 0.80;
}
function densityToInjectRouted(density) {
  const lo = 0.03, hi = 0.30;
  const t = Math.max(0, Math.min(1, (density - lo) / (hi - lo)));
  return 0.015 + t * 0.05;   
}

function runExperiment(seed, mode, { density, pSlow, turnP, waveSpeed, jitterOn, missingOn, ticks, warmup, routed }) {
  const g = buildGeometry(seed, jitterOn, missingOn);
  const rng = mulberry32((typeof seed === "string" ? hashString(seed) : seed) ^ hashString(mode));
  const pInject = routed ? densityToInjectRouted(density) : densityToInject(density);
  const adj = routed ? buildGraph(g) : null;
  const idRef = { n: 0 };
  let state = initState(g, density, mode, waveSpeed, seed, routed);
  state.tick = 0;
  let crossSum = 0, speedSum = 0, speedSamples = 0, measured = 0;
  const dir = { hF: 0, hB: 0, vF: 0, vB: 0 };
  let arrWin = 0, ttWin = 0, spawnAtWarmup = 0;
  for (let t = 0; t < ticks; t++) {
    state = stepSim(g, state, pSlow, turnP, rng, pInject, {
      signalMode: mode,
      routed: !!routed, 
      tick: t, 
      adj, 
      idRef, 
      countFrom: warmup 
    });
    if (t === warmup) spawnAtWarmup = idRef.n; 
    if (t >= warmup) {
      crossSum += state.lastCrossings;
      dir.hF += state.lastDir.hF; dir.hB += state.lastDir.hB;
      dir.vF += state.lastDir.vF; dir.vB += state.lastDir.vB;
      arrWin += state.lastArrivalsWin; ttWin += state.lastTravelSumWin;
      let v = 0, n = 0;
      const all = [state.hFwd, state.hBwd, state.vFwd, state.vBwd];
      for (const group of all) for (const rd of group) for (const cell of rd) if (cell) { v += cell.v; n++; }
      if (n) { speedSum += v / n; speedSamples++; }
      measured++;
    }
  }
  const spawnedInWin = routed ? (idRef.n - spawnAtWarmup) : 0;
  return {
    mode,
    throughput: crossSum / measured,           
    totalCrossings: crossSum,
    avgSpeed: speedSamples ? speedSum / speedSamples : 0,
    tputHF: dir.hF / measured, tputHB: dir.hB / measured,
    tputVF: dir.vF / measured, tputVB: dir.vB / measured,
    tputH: (dir.hF + dir.hB) / measured, tputV: (dir.vF + dir.vB) / measured,
    routed: !!routed,
    arrivals: arrWin,
    avgTravelTime: arrWin ? ttWin / arrWin : 0,   
    arrivalRate: arrWin / measured,               
    spawned: spawnedInWin,
    completion: spawnedInWin > 0 ? Math.min(1, arrWin / spawnedInWin) : 0,
  };
}

const SPEED_COLORS = ["#ef4444","#f97316","#eab308","#a3e635","#22c55e","#06b6d4"];
function sCol(v) { return SPEED_COLORS[Math.min(v, 5)]; }

function drawCross(ctx, x, y, size) {
  ctx.strokeStyle = "rgba(120,120,180,0.15)";
  ctx.lineWidth = 0.8;
  const m = size / 2;
  ctx.beginPath();
  ctx.moveTo(x + m - 3, y + m); ctx.lineTo(x + m + 3, y + m);
  ctx.moveTo(x + m, y + m - 3); ctx.lineTo(x + m, y + m + 3);
  ctx.stroke();
}

function drawState(canvas, g, state, trackedCarRef) {
  if (!canvas || !state || !g) return { carCount: 0, avgSpeed: "0" };
  const { w: canvasW, h: canvasH } = canvasSize(g);
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvasW * dpr;
  canvas.height = canvasH * dpr;
  canvas.style.width = canvasW + "px";
  canvas.style.height = canvasH + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const { hFwd, hBwd, vFwd, vBwd, lights } = state;
  const C = CELL_PX;

  ctx.fillStyle = "#0e0e18";
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.fillStyle = "#1a1a2c";
  for (let r = 0; r < NUM_H; r++) ctx.fillRect(PAD, hRoadY(g, r), g.HLEN * C, ROAD_W);
  for (let c = 0; c < NUM_V; c++) ctx.fillRect(vRoadX(g, c), PAD, ROAD_W, g.VLEN * C);

  ctx.strokeStyle = "#252540";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (let r = 0; r < NUM_H; r++) {
    const y = hRoadY(g, r) + C + LANE_GAP * 0.5;
    ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(PAD + g.HLEN * C, y); ctx.stroke();
  }
  for (let c = 0; c < NUM_V; c++) {
    const x = vRoadX(g, c) + C + LANE_GAP * 0.5;
    ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, PAD + g.VLEN * C); ctx.stroke();
  }
  ctx.setLineDash([]);

  if (g.vBarrier) {
    ctx.fillStyle = "#0e0e18";
    for (let c = 0; c < NUM_V; c++)
      for (const y of g.vBarrier[c])
        ctx.fillRect(vRoadX(g, c) - 0.5, PAD + y * C, ROAD_W + 1, C);
  }

  for (let r = 0; r < NUM_H; r++) {
    for (let c = 0; c < NUM_V; c++) {
      const ix = vRoadX(g, c), iy = hRoadY(g, r);
      if (g.tjunc && g.tjunc[r][c]) {
        ctx.fillStyle = "rgba(234,179,8,0.10)";
        ctx.fillRect(ix, iy, ROAD_W, ROAD_W);
        continue;
      }
      if (!g.present[r][c]) {
        ctx.fillStyle = "rgba(80,80,110,0.10)";
        ctx.fillRect(ix, iy, ROAD_W, ROAD_W);
        continue;
      }
      const hg = lights[r][c].hGreen;
      ctx.fillStyle = hg ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)";
      ctx.fillRect(ix, iy, ROAD_W, ROAD_W);
      drawCross(ctx, ix, iy, ROAD_W);
    }
  }

  let count = 0, totalV = 0;
  const allRouted = [];
  let trackedCar = null;

  const drawCar = (px, py, v, carObj) => { 
    count++; totalV += v; 
    ctx.fillStyle = sCol(v); 
    ctx.fillRect(px, py, C - 1, C - 1); 

    if (carObj && carObj.routed) {
      allRouted.push({ car: carObj, px, py });
      if (trackedCarRef && trackedCarRef.current === carObj.id) {
        trackedCar = { car: carObj, px, py };
      }
    }
  };

  for (let r = 0; r < NUM_H; r++) {
    const y0 = hRoadY(g, r), y1 = y0 + C + LANE_GAP;
    hFwd[r].forEach((car, i) => { if (car) drawCar(PAD + i * C, y1, car.v, car); });
    hBwd[r].forEach((car, i) => { if (car) drawCar(PAD + (g.HLEN - 1 - i) * C, y0, car.v, car); });
  }
  for (let c = 0; c < NUM_V; c++) {
    const x0 = vRoadX(g, c), x1 = x0 + C + LANE_GAP;
    vFwd[c].forEach((car, i) => { if (car) drawCar(x0, PAD + i * C, car.v, car); });
    vBwd[c].forEach((car, i) => { if (car) drawCar(x1, PAD + (g.VLEN - 1 - i) * C, car.v, car); });
  }

  if (trackedCarRef && allRouted.length > 0) {
    if (!trackedCar) {
      trackedCar = allRouted[Math.floor(Math.random() * allRouted.length)];
      trackedCarRef.current = trackedCar.car.id;
    }

    const { car, px, py } = trackedCar;

    if (car.path && car.path.length > 0) {
      ctx.strokeStyle = "rgba(236, 72, 153, 0.4)"; 
      ctx.lineWidth = 4;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();

      const firstNk = car.path[0];
      ctx.moveTo(vRoadX(g, firstNk % NUM_V) + ROAD_W / 2, hRoadY(g, Math.floor(firstNk / NUM_V)) + ROAD_W / 2);

      car.path.forEach(nk => {
        ctx.lineTo(vRoadX(g, nk % NUM_V) + ROAD_W / 2, hRoadY(g, Math.floor(nk / NUM_V)) + ROAD_W / 2);
      });

      const lastNk = car.path[car.path.length - 1];
      const cx = vRoadX(g, lastNk % NUM_V) + ROAD_W / 2;
      const cy = hRoadY(g, Math.floor(lastNk / NUM_V)) + ROAD_W / 2;
      const ext = PAD + ROAD_W;
      
      if (car.exitHeading === "E") ctx.lineTo(cx + ext, cy);
      if (car.exitHeading === "W") ctx.lineTo(cx - ext, cy);
      if (car.exitHeading === "S") ctx.lineTo(cx, cy + ext);
      if (car.exitHeading === "N") ctx.lineTo(cx, cy - ext);
      
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = "#ec4899";
    ctx.lineWidth = 2;
    ctx.strokeRect(px - 2, py - 2, C + 3, C + 3);
  } else if (trackedCarRef) {
    trackedCarRef.current = null;
  }

  for (let r = 0; r < NUM_H; r++) {
    for (let c = 0; c < NUM_V; c++) {
      if ((g.tjunc && g.tjunc[r][c]) || !g.present[r][c]) continue;
      const ix = vRoadX(g, c), iy = hRoadY(g, r);
      const cx = ix + ROAD_W / 2, cy = iy + ROAD_W / 2;
      const hg = lights[r][c].hGreen;
      ctx.fillStyle = "#0a0a12";
      ctx.beginPath(); ctx.arc(cx, cy, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hg ? "#22c55e" : "#ef4444";
      ctx.beginPath(); ctx.arc(cx, cy, 2.4, 0, Math.PI * 2); ctx.fill();
    }
  }

  return { carCount: count, avgSpeed: count > 0 ? (totalV / count).toFixed(2) : "0" };
}

const SIGNAL_MODES = [
  { id: "alternating", label: "Alternating" },
  { id: "green_wave_h", label: "Green Wave →" },
  { id: "green_wave_v", label: "Green Wave ↓" },
  { id: "all_sync", label: "All Sync" },
  { id: "adaptive", label: "Local Adaptive" },
];

const btn = {
  background: "#1e1e32", color: "#b8b8d0", border: "1px solid #30304a",
  borderRadius: "4px", padding: "5px 14px", fontSize: "12px",
  cursor: "pointer", fontFamily: "inherit",
};
const btnActive = { ...btn, background: "#6366f1", color: "#fff", border: "1px solid #818cf8" };
const toggleOn = { ...btn, background: "#0f3d2e", color: "#5eead4", border: "1px solid #14b8a6" };

export default function TrafficSim() {
  const canvasRef = useRef(null);
  const simRef = useRef(null);
  const geoRef = useRef(null);
  const rngRef = useRef(null);
  const ivRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(6);
  const [tick, setTick] = useState(0);
  const [density, setDensity] = useState(0.1);
  const [pSlow, setPSlow] = useState(DEFAULT_P_SLOW);
  const [turnP, setTurnP] = useState(DEFAULT_TURN_P);
  const [signalMode, setSignalMode] = useState("alternating");
  const [waveSpeed, setWaveSpeed] = useState(V_MAX);
  const [seed, setSeed] = useState("42");
  const [jitterOn, setJitterOn] = useState(false);
  const [missingOn, setMissingOn] = useState(false);
  const [routed, setRouted] = useState(false);
  const [stats, setStats] = useState({ carCount: 0, avgSpeed: "0" });
  const dirEmaRef = useRef({ hF: 0, hB: 0, vF: 0, vB: 0 });
  const [dirTput, setDirTput] = useState({ hF: 0, hB: 0, vF: 0, vB: 0 });
  
  const adjRef = useRef(null);
  const idRef = useRef({ n: 0 });
  const ttEmaRef = useRef(0);
  const trackedCarRef = useRef(null); 
  const [travel, setTravel] = useState({ avgTT: 0, arrivals: 0, inNet: 0 });

  const [expTicks, setExpTicks] = useState(600);
  const [expModeA, setExpModeA] = useState("all_sync");
  const [expModeB, setExpModeB] = useState("green_wave_h");
  const [expResults, setExpResults] = useState(null);
  const [expRunning, setExpRunning] = useState(false);

  const redraw = useCallback(() => setStats(drawState(canvasRef.current, geoRef.current, simRef.current, trackedCarRef)), []);

  const reset = useCallback(() => {
    geoRef.current = buildGeometry(seed, jitterOn, missingOn);
    simRef.current = initState(geoRef.current, density, signalMode, waveSpeed, seed, routed);
    simRef.current.tick = 0;
    rngRef.current = mulberry32((typeof seed === "string" ? hashString(seed) : seed) ^ 0x1234);
    adjRef.current = routed ? buildGraph(geoRef.current) : null;
    idRef.current = { n: 0 };
    dirEmaRef.current = { hF: 0, hB: 0, vF: 0, vB: 0 };
    ttEmaRef.current = 0;
    trackedCarRef.current = null;
    setDirTput({ hF: 0, hB: 0, vF: 0, vB: 0 });
    setTravel({ avgTT: 0, arrivals: 0, inNet: 0 });
    setTick(0); redraw();
  }, [density, signalMode, waveSpeed, seed, jitterOn, missingOn, routed, redraw]);

  useEffect(() => { reset(); }, [reset]);

  const step = useCallback(() => {
    if (!simRef.current) return;
    const pInj = routed ? densityToInjectRouted(density) : densityToInject(density);
    const t0 = simRef.current.tick || 0;
    simRef.current = stepSim(geoRef.current, simRef.current, pSlow, turnP, rngRef.current, pInj, {
      signalMode, 
      routed: !!routed, 
      tick: t0, 
      adj: adjRef.current, 
      idRef: idRef.current 
    });
    const s = simRef.current;
    const a = 0.1, d = s.lastDir, e = dirEmaRef.current;
    e.hF += a * (d.hF - e.hF); e.hB += a * (d.hB - e.hB);
    e.vF += a * (d.vF - e.vF); e.vB += a * (d.vB - e.vB);
    setDirTput({ hF: e.hF, hB: e.hB, vF: e.vF, vB: e.vB });
    if (routed) {
      if (s.lastArrivals > 0) {
        const tt = s.lastTravelSum / s.lastArrivals;
        ttEmaRef.current = ttEmaRef.current === 0 ? tt : ttEmaRef.current + 0.15 * (tt - ttEmaRef.current);
      }
      let inNet = 0;
      [s.hFwd, s.hBwd, s.vFwd, s.vBwd].forEach(grp => grp.forEach(rd => rd.forEach(c => { if (c) inNet++; })));
      setTravel({ avgTT: ttEmaRef.current, arrivals: s.arrivals, inNet, metered: !!s.metered });
    }
    setTick(t => t + 1);
    redraw();
  }, [pSlow, turnP, density, routed, redraw, signalMode]);

  useEffect(() => {
    if (!running) { if (ivRef.current) clearInterval(ivRef.current); return; }
    ivRef.current = setInterval(step, Math.max(16, 220 - speed * 22));
    return () => clearInterval(ivRef.current);
  }, [running, speed, step]);

  const runAB = useCallback(() => {
    setExpRunning(true);
    setRunning(false);
    setTimeout(() => {
      const opts = { density, pSlow, turnP, waveSpeed, jitterOn, missingOn, routed,
                     ticks: expTicks, warmup: Math.floor(expTicks * 0.2) };
      const a = runExperiment(seed, expModeA, opts);
      const b = runExperiment(seed, expModeB, opts);
      setExpResults({ a, b, opts });
      setExpRunning(false);
    }, 30);
  }, [seed, expModeA, expModeB, density, pSlow, turnP, waveSpeed, jitterOn, missingOn, routed, expTicks]);

  const sliders = [
    ["Speed", speed, 1, 10, (e) => setSpeed(+e.target.value), null],
    ["Density", density * 100, 3, 30, (e) => setDensity(e.target.value / 100), (density * 100).toFixed(0) + "%"],
    ["p_slow", pSlow * 100, 0, 80, (e) => setPSlow(e.target.value / 100), pSlow.toFixed(2)],
    ["p_turn", turnP * 100, 0, 80, (e) => setTurnP(e.target.value / 100), turnP.toFixed(2)],
  ];

  const labelFor = (id) => SIGNAL_MODES.find(m => m.id === id)?.label ?? id;
  const pct = expResults ? (((expResults.b.throughput - expResults.a.throughput) / Math.max(expResults.a.throughput, 1e-9)) * 100) : 0;
  const ttChange = expResults && expResults.opts.routed
    ? (((expResults.b.avgTravelTime - expResults.a.avgTravelTime) / Math.max(expResults.a.avgTravelTime, 1e-9)) * 100) : 0;

  return (
    <div style={{
      background: "#0a0a12", minHeight: "100vh", color: "#c8c8e0",
      fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace",
      padding: "14px", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px",
    }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "17px", fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "#8888a8", margin: 0 }}>
          NaSch Bidirectional Grid
        </h1>
        <p style={{ fontSize: "10px", color: "#484860", margin: "2px 0 0" }}>
          dual-lane · bidirectional · random turning · green wave · seed-driven geometry
        </p>
      </div>

      <div style={{ display: "flex", gap: "18px", fontSize: "11px", color: "#606078" }}>
        <span>tick <b style={{ color: "#a8a8c0" }}>{tick}</b></span>
        <span>cars <b style={{ color: "#a8a8c0" }}>{stats.carCount}</b></span>
        <span>avg v <b style={{ color: "#a8a8c0" }}>{stats.avgSpeed}</b></span>
        <span>crossings <b style={{ color: "#a8a8c0" }}>{simRef.current?.crossings ?? 0}</b></span>
      </div>

      <div style={{ display: "flex", gap: "14px", fontSize: "10px", color: "#54546a", flexWrap: "wrap", justifyContent: "center" }}>
        <span style={{ color: "#7a7a9a" }}>throughput/tick:</span>
        <span>→ L-R <b style={{ color: "#a3e635" }}>{dirTput.hF.toFixed(1)}</b></span>
        <span>← R-L <b style={{ color: "#a3e635" }}>{dirTput.hB.toFixed(1)}</b></span>
        <span>↓ T-D <b style={{ color: "#06b6d4" }}>{dirTput.vF.toFixed(1)}</b></span>
        <span>↑ D-T <b style={{ color: "#06b6d4" }}>{dirTput.vB.toFixed(1)}</b></span>
        <span style={{ color: "#54546a" }}>(H {(dirTput.hF + dirTput.hB).toFixed(1)} · V {(dirTput.vF + dirTput.vB).toFixed(1)})</span>
      </div>

      {routed && (
        <div style={{ display: "flex", gap: "16px", fontSize: "11px", color: "#606078", flexWrap: "wrap", justifyContent: "center" }}>
          <span style={{ color: "#c084fc" }}>routed:</span>
          <span>avg travel time <b style={{ color: "#e9d5ff" }}>{travel.avgTT.toFixed(1)}</b> ticks</span>
          <span>arrived <b style={{ color: "#e9d5ff" }}>{travel.arrivals}</b></span>
          <span>in transit <b style={{ color: "#e9d5ff" }}>{travel.inNet}</b></span>
          {travel.metered && <span style={{ color: "#fbbf24" }}>⚠ metering inflow (network full)</span>}
        </div>
      )}

      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", justifyContent: "center" }}>
        {SIGNAL_MODES.map(m => (
          <button key={m.id} onClick={() => setSignalMode(m.id)}
            style={signalMode === m.id ? btnActive : btn}>{m.label}</button>
        ))}
      </div>

      {(signalMode === "green_wave_h" || signalMode === "green_wave_v") && (
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#606078" }}>
          wave speed
          <input type="range" min={1} max={V_MAX} value={waveSpeed}
            onChange={(e) => setWaveSpeed(+e.target.value)}
            style={{ accentColor: "#22c55e", width: "80px" }} />
          <span style={{ color: "#a8a8c0" }}>{waveSpeed} cells/tick</span>
        </div>
      )}

      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
        <button onClick={() => setJitterOn(v => !v)} style={jitterOn ? toggleOn : btn}>
          {jitterOn ? "✓ " : ""}variable road length
        </button>
        <button onClick={() => setMissingOn(v => !v)} style={missingOn ? toggleOn : btn}>
          {missingOn ? "✓ " : ""}missing intersections (3-way)
        </button>
        <button onClick={() => setRouted(v => !v)} style={routed ? { ...toggleOn, background: "#3b1d5e", color: "#e9d5ff", border: "1px solid #a855f7" } : btn}>
          {routed ? "✓ " : ""}routed (O/D + shortest path)
        </button>
        <span style={{ fontSize: "10px", color: "#484860" }}>← seed-driven, change seed to reshuffle</span>
      </div>

      <div style={{
        border: "1px solid #1e1e30", borderRadius: "4px",
        overflow: "auto", maxWidth: "100%", background: "#0e0e18",
      }}>
        <canvas ref={canvasRef} />
      </div>

      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
        <button onClick={() => setRunning(r => !r)} style={btn}>{running ? "⏸ Pause" : "▶ Run"}</button>
        <button onClick={step} disabled={running} style={{ ...btn, opacity: running ? 0.4 : 1 }}>Step</button>
        <button onClick={() => { setRunning(false); reset(); }} style={btn}>Reset</button>
        <span style={{ width: 1, height: 20, background: "#2a2a40", margin: "0 4px" }} />
        <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "#606078" }}>
          seed
          <input type="text" value={seed} onChange={(e) => setSeed(e.target.value)}
            style={{ background: "#151522", color: "#a8a8c0", border: "1px solid #30304a",
              borderRadius: "3px", padding: "3px 6px", fontSize: "11px", width: "64px",
              fontFamily: "inherit", outline: "none" }} />
        </label>
        <button onClick={() => setSeed(String(Math.floor(Math.random() * 100000)))}
          style={{ ...btn, padding: "4px 8px", fontSize: "11px" }}>🎲</button>
      </div>

      <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", justifyContent: "center", fontSize: "11px" }}>
        {sliders.map(([label, val, min, max, onChange, display]) => (
          <label key={label} style={{ display: "flex", alignItems: "center", gap: "5px", color: "#606078" }}>
            {label}
            <input type="range" min={min} max={max} value={val} onChange={onChange}
              style={{ accentColor: "#6366f1", width: "60px" }} />
            {display && <span style={{ color: "#a8a8c0", width: "32px", fontSize: "10px" }}>{display}</span>}
          </label>
        ))}
      </div>

      <div style={{
        marginTop: "6px", border: "1px solid #26263c", borderRadius: "6px",
        padding: "12px 16px", background: "#10101c", maxWidth: "640px", width: "100%",
      }}>
        <div style={{ fontSize: "11px", letterSpacing: "1px", textTransform: "uppercase",
          color: "#7a7a9a", marginBottom: "8px" }}>A/B Throughput Experiment</div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", fontSize: "11px", color: "#606078" }}>
          <label style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            baseline
            <select value={expModeA} onChange={(e) => setExpModeA(e.target.value)}
              style={{ background: "#151522", color: "#a8a8c0", border: "1px solid #30304a", borderRadius: "3px", padding: "3px", fontFamily: "inherit", fontSize: "11px" }}>
              {SIGNAL_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <span style={{ color: "#484860" }}>vs</span>
          <label style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            treatment
            <select value={expModeB} onChange={(e) => setExpModeB(e.target.value)}
              style={{ background: "#151522", color: "#a8a8c0", border: "1px solid #30304a", borderRadius: "3px", padding: "3px", fontFamily: "inherit", fontSize: "11px" }}>
              {SIGNAL_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            ticks
            <input type="number" min={100} max={5000} step={100} value={expTicks}
              onChange={(e) => setExpTicks(Math.max(100, +e.target.value || 100))}
              style={{ background: "#151522", color: "#a8a8c0", border: "1px solid #30304a", borderRadius: "3px", padding: "3px", width: "64px", fontFamily: "inherit", fontSize: "11px" }} />
          </label>
          <button onClick={runAB} disabled={expRunning} style={{ ...btnActive, opacity: expRunning ? 0.5 : 1 }}>
            {expRunning ? "running…" : "Run experiment"}
          </button>
        </div>

        {expResults && (
          <div style={{ marginTop: "12px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr style={{ color: "#7a7a9a", textAlign: "left" }}>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid #2a2a40" }}>condition</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid #2a2a40" }}>total<br /><span style={{ color: "#484860", fontWeight: 400 }}>cr/tick</span></th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid #2a2a40", color: "#a3e635" }}>→ L-R</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid #2a2a40", color: "#a3e635" }}>← R-L</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid #2a2a40", color: "#06b6d4" }}>↓ T-D</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid #2a2a40", color: "#06b6d4" }}>↑ D-T</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid #2a2a40" }}>avg v</th>
                </tr>
              </thead>
              <tbody style={{ color: "#b8b8d0" }}>
                {[["baseline", expResults.a], ["treatment", expResults.b]].map(([tag, r]) => (
                  <tr key={tag}>
                    <td style={{ padding: "4px 6px" }}>{tag} · {labelFor(r.mode)}</td>
                    <td style={{ padding: "4px 6px" }}>{r.throughput.toFixed(2)}</td>
                    <td style={{ padding: "4px 6px", color: "#cde88a" }}>{r.tputHF.toFixed(2)}</td>
                    <td style={{ padding: "4px 6px", color: "#cde88a" }}>{r.tputHB.toFixed(2)}</td>
                    <td style={{ padding: "4px 6px", color: "#8fd9e8" }}>{r.tputVF.toFixed(2)}</td>
                    <td style={{ padding: "4px 6px", color: "#8fd9e8" }}>{r.tputVB.toFixed(2)}</td>
                    <td style={{ padding: "4px 6px" }}>{r.avgSpeed.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {expResults.opts.routed && (
              <div style={{ marginTop: "10px", padding: "8px 10px", background: "#1a0f2e", border: "1px solid #3b1d5e", borderRadius: "4px" }}>
                <div style={{ fontSize: "10px", color: "#c084fc", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>travel time (spawn → arrival)</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                  <thead>
                    <tr style={{ color: "#9a7ac0", textAlign: "left" }}>
                      <th style={{ padding: "3px 6px" }}>condition</th>
                      <th style={{ padding: "3px 6px" }}>avg travel time</th>
                      <th style={{ padding: "3px 6px" }}>arrivals/tick</th>
                      <th style={{ padding: "3px 6px" }}>completion</th>
                    </tr>
                  </thead>
                  <tbody style={{ color: "#e9d5ff" }}>
                    {[["baseline", expResults.a], ["treatment", expResults.b]].map(([tag, r]) => (
                      <tr key={tag}>
                        <td style={{ padding: "3px 6px" }}>{tag} · {labelFor(r.mode)}</td>
                        <td style={{ padding: "3px 6px" }}>{r.avgTravelTime.toFixed(1)} ticks</td>
                        <td style={{ padding: "3px 6px" }}>{r.arrivalRate.toFixed(2)}</td>
                        <td style={{ padding: "3px 6px" }}>{(r.completion * 100).toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: "5px", fontSize: "11px", color: ttChange <= 0 ? "#86efac" : "#fca5a5" }}>
                  travel-time change: {ttChange >= 0 ? "+" : ""}{ttChange.toFixed(1)}%
                  <span style={{ color: "#6a5a8a", fontSize: "10px", marginLeft: 8 }}>(lower is better; &lt;90% completion ⇒ congested, treat with caution)</span>
                </div>
              </div>
            )}
            <div style={{ marginTop: "8px", fontSize: "12px", color: pct >= 0 ? "#5eead4" : "#fca5a5" }}>
              total throughput change: {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
              <span style={{ color: "#7a7a9a", marginLeft: 10 }}>
                H-axis {(((expResults.b.tputH - expResults.a.tputH) / Math.max(expResults.a.tputH, 1e-9)) * 100).toFixed(1)}%
                {"  "}V-axis {(((expResults.b.tputV - expResults.a.tputV) / Math.max(expResults.a.tputV, 1e-9)) * 100).toFixed(1)}%
              </span>
              <div style={{ color: "#484860", fontSize: "10px", marginTop: 2 }}>
                seed {seed}, {expResults.opts.ticks} ticks, 20% warmup discarded, injection tied to density
                {expResults.opts.jitterOn ? ", variable length" : ""}{expResults.opts.missingOn ? ", T-junctions" : ""}
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "8px", fontSize: "9px", color: "#484860", alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
        {SPEED_COLORS.map((col, i) => (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: "2px" }}>
            <span style={{ width: 7, height: 7, background: col, borderRadius: 1, display: "inline-block" }} /> v={i}
          </span>
        ))}
        <span style={{ marginLeft: 4 }}><span style={{ color: "#22c55e" }}>●</span>/<span style={{ color: "#ef4444" }}>●</span> signals</span>
        <span style={{ marginLeft: 4 }}>╋ turning</span>
      </div>
    </div>
  );
}
