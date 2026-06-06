import { useState, useEffect, useRef } from "react";
import { GridSimulation, runExperimentASweep } from "../simulationEngine";

const mirror = (pos, len) => len - 1 - pos;

// HSL theme helper for premium look
const theme = {
  bg: "#0b0c10",
  surface: "#1f2833",
  primary: "#66fcf1",
  primaryHover: "#45a29e",
  secondary: "#c5a059",
  text: "#c5c6c7",
  textLight: "#ffffff",
  textMuted: "#8f9499",
  danger: "#fc4445",
  warning: "#f97316",
  success: "#22c55e",
  purple: "#c084fc",
};

export default function TrafficSimSpec() {
  const [activeTab, setActiveTab] = useState("visualizer");

  // Simulation State
  const [seed, setSeed] = useState(42);
  const [segLength, setSegLength] = useState(20);
  const [densityHFwd, setDensityHFwd] = useState(0.12);
  const [densityHBwd, setDensityHBwd] = useState(0.12);
  const [steps, setSteps] = useState(800);
  const [expType, setExpType] = useState("B2"); // 'custom', 'A', 'B1', 'B2'
  const [deltaT, setDeltaT] = useState(30);
  const [pChangeBg, setPChangeBg] = useState(0.1);
  const [pChangeSub, setPChangeSub] = useState(1.0);
  const [turnProbability, setTurnProbability] = useState(0.15);
  const [isPlaying, setIsPlaying] = useState(false);
  const [simSpeed, setSimSpeed] = useState(100); // ms per tick

  const [signalMode, setSignalMode] = useState("alternating");
  const [revModeH, setRevModeH] = useState(["none", "none", "none", "none", "none"]);
  const [revModeV, setRevModeV] = useState(["none", "none", "none", "none", "none", "none"]);

  // Dynamic Sim Instances
  const [sim, setSim] = useState(null);
  const [tick, setTick] = useState(0);
  const [activeVehicles, setActiveVehicles] = useState([]);
  const [arrivedCount, setArrivedCount] = useState(0);
  const [metrics, setMetrics] = useState({});
  const [expResults, setExpResults] = useState(null);
  const [trackedVehicleId, setTrackedVehicleId] = useState(null);

  // Exp A Sweep State
  const [sweepData, setSweepData] = useState([]);
  const [bestL, setBestL] = useState(null);
  const [calcCruiseSpeed, setCalcCruiseSpeed] = useState(null);
  const [isSweeping, setIsSweeping] = useState(false);

  // Exp B Comparison State
  const [bComparison, setBComparison] = useState(null);
  const [isComparing, setIsComparing] = useState(false);

  const canvasRef = useRef(null);
  const simRef = useRef(null);
  const animationRef = useRef(null);

  // Interpolation cache for smooth lane changes
  // carId -> { prevLane, progress }
  const laneInterpolation = useRef(new Map());

  // Initialize Simulation on config change
  const initializeSimulation = () => {
    setIsPlaying(false);
    if (animationRef.current) clearInterval(animationRef.current);
    
    // Create new simulation instance
    const s = new GridSimulation({
      seed: seed,
      backgroundDensityHFwd: densityHFwd,
      backgroundDensityHBwd: densityHBwd,
      simulationSteps: steps,
      experimentType: expType,
      exportTrajectories: true,
      segLength: segLength,
      signalMode: signalMode,
      revModeH: revModeH,
      revModeV: revModeV,
      params: {
        delta_t: deltaT,
        p_change_background: pChangeBg,
        p_change_subject: pChangeSub,
        emergency_spawn_tick: 50,
        subject_spawn_tick: 70,
        turn_probability: turnProbability
      }
    });

    simRef.current = s;
    setSim(s);
    setTick(0);
    setActiveVehicles([...s.vehicles]);
    setArrivedCount(0);
    setMetrics({});
    setExpResults(null);
    setTrackedVehicleId(null);
    laneInterpolation.current.clear();
  };

  const getVehicleCoords = (roadType, idx, lane, pos, currentSim) => {
    if (!currentSim) return { px: 0, py: 0 };
    const g = currentSim.g;
    const C = 6;
    const LANE_GAP = 1;
    const PAD = 20;

    const getRoadWidthH = (r) => {
      const fwd = currentSim.hFwd[r] ? currentSim.hFwd[r].length : 3;
      const bwd = currentSim.hBwd[r] ? currentSim.hBwd[r].length : 3;
      return C * (fwd + bwd) + LANE_GAP * (fwd + bwd - 1);
    };
    const getRoadWidthV = (c) => {
      const fwd = currentSim.vFwd[c] ? currentSim.vFwd[c].length : 3;
      const bwd = currentSim.vBwd[c] ? currentSim.vBwd[c].length : 3;
      return C * (fwd + bwd) + LANE_GAP * (fwd + bwd - 1);
    };

    const hRoadY = (r) => PAD + g.vInt[r] * C + C / 2 - getRoadWidthH(r) / 2;
    const vRoadX = (c) => PAD + g.hInt[c] * C + C / 2 - getRoadWidthV(c) / 2;

    let px = 0;
    let py = 0;

    const bwdCountH = currentSim.hBwd[idx] ? currentSim.hBwd[idx].length : 3;
    const bwdCountV = currentSim.vBwd[idx] ? currentSim.vBwd[idx].length : 3;
    const fwdCountV = currentSim.vFwd[idx] ? currentSim.vFwd[idx].length : 3;

    if (roadType === 'hFwd' || roadType === 'hBwd') {
      const y0 = hRoadY(idx);
      if (roadType === 'hFwd') {
        py = y0 + (bwdCountH + lane) * (C + LANE_GAP);
        
        let found = false;
        let prevX = PAD;
        let prevCell = -1;
        for (let c = 0; c < g.NUM_V; c++) {
          const stopCell = g.hInt[c];
          if (pos < stopCell) {
            const startX = prevX;
            const endX = vRoadX(c);
            const cellsInSeg = stopCell - prevCell - 1;
            const localPos = pos - prevCell - 1;
            px = startX + localPos * (endX - startX - C) / Math.max(1, cellsInSeg - 1);
            found = true;
            break;
          } else if (pos === stopCell) {
            px = vRoadX(c) + getRoadWidthV(c) / 2 - C / 2;
            found = true;
            break;
          }
          prevX = vRoadX(c) + getRoadWidthV(c);
          prevCell = stopCell;
        }
        if (!found) {
          px = prevX + (pos - prevCell - 1) * C;
        }
      } else {
        py = y0 + lane * (C + LANE_GAP);
        const physPos = mirror(pos, g.HLEN);
        
        let found = false;
        let prevX = PAD + g.HLEN * C;
        let prevCell = g.HLEN;
        for (let c = g.NUM_V - 1; c >= 0; c--) {
          const stopCell = g.hInt[c];
          if (physPos > stopCell) {
            const startX = prevX;
            const endX = vRoadX(c) + getRoadWidthV(c);
            const cellsInSeg = prevCell - stopCell - 1;
            const localPos = prevCell - physPos - 1;
            px = startX - localPos * (startX - endX - C) / Math.max(1, cellsInSeg - 1) - C;
            found = true;
            break;
          } else if (physPos === stopCell) {
            px = vRoadX(c) + getRoadWidthV(c) / 2 - C / 2;
            found = true;
            break;
          }
          prevX = vRoadX(c);
          prevCell = stopCell;
        }
        if (!found) {
          px = prevX - (prevCell - physPos - 1) * C - C;
        }
      }
    } else {
      const x0 = vRoadX(idx);
      if (roadType === 'vFwd') {
        px = x0 + lane * (C + LANE_GAP);
        
        let found = false;
        let prevY = PAD;
        let prevCell = -1;
        for (let r = 0; r < g.NUM_H; r++) {
          const stopCell = g.vInt[r];
          if (pos < stopCell) {
            const startY = prevY;
            const endY = hRoadY(r);
            const cellsInSeg = stopCell - prevCell - 1;
            const localPos = pos - prevCell - 1;
            py = startY + localPos * (endY - startY - C) / Math.max(1, cellsInSeg - 1);
            found = true;
            break;
          } else if (pos === stopCell) {
            py = hRoadY(r) + getRoadWidthH(r) / 2 - C / 2;
            found = true;
            break;
          }
          prevY = hRoadY(r) + getRoadWidthH(r);
          prevCell = stopCell;
        }
        if (!found) {
          py = prevY + (pos - prevCell - 1) * C;
        }
      } else {
        px = x0 + (fwdCountV + lane) * (C + LANE_GAP);
        const physPos = mirror(pos, g.VLEN);
        
        let found = false;
        let prevY = PAD + g.VLEN * C;
        let prevCell = g.VLEN;
        for (let r = g.NUM_H - 1; r >= 0; r--) {
          const stopCell = g.vInt[r];
          if (physPos > stopCell) {
            const startY = prevY;
            const endY = hRoadY(r) + getRoadWidthH(r);
            const cellsInSeg = prevCell - stopCell - 1;
            const localPos = prevCell - physPos - 1;
            py = startY - localPos * (startY - endY - C) / Math.max(1, cellsInSeg - 1) - C;
            found = true;
            break;
          } else if (physPos === stopCell) {
            py = hRoadY(r) + getRoadWidthH(r) / 2 - C / 2;
            found = true;
            break;
          }
          prevY = hRoadY(r);
          prevCell = stopCell;
        }
        if (!found) {
          py = prevY - (prevCell - physPos - 1) * C - C;
        }
      }
    }

    return { px, py };
  };

  useEffect(() => {
    initializeSimulation();
    return () => {
      if (animationRef.current) clearInterval(animationRef.current);
    };
  }, [segLength, densityHFwd, densityHBwd, expType, deltaT, pChangeBg, pChangeSub, seed, signalMode, revModeH, revModeV, turnProbability]);

  // Tick step of simulation
  const stepSimulation = () => {
    if (!simRef.current) return;
    const s = simRef.current;

    if (s.tick >= s.steps) {
      setIsPlaying(false);
      if (animationRef.current) clearInterval(animationRef.current);
      const res = s.getResults();
      setMetrics(res.metrics);
      if (res.experiment_results) setExpResults(res.experiment_results);
      return;
    }

    // Capture pre-step lane state for interpolation
    const prevLanes = new Map();
    s.vehicles.forEach(c => {
      prevLanes.set(c.id, c.lane);
    });

    s.step();

    // Setup lane change interpolation
    s.vehicles.forEach(c => {
      const prevL = prevLanes.get(c.id);
      if (prevL !== undefined && prevL !== c.lane) {
        laneInterpolation.current.set(c.id, {
          fromLane: prevL,
          progress: 0
        });
      }
    });

    setTick(s.tick);
    setActiveVehicles([...s.vehicles]);
    setArrivedCount(s.arrivedVehicles.length);
    
    const res = s.getResults();
    setMetrics(res.metrics);
    if (res.experiment_results) setExpResults(res.experiment_results);
  };

  // Play / Pause toggler
  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      if (animationRef.current) clearInterval(animationRef.current);
    } else {
      setIsPlaying(true);
      animationRef.current = setInterval(stepSimulation, simSpeed);
    }
  };

  // Canvas drawing loop for 6-Lane 5x6 Grid
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sim) return;

    const ctx = canvas.getContext("2d");
    const g = sim.g;
    
    // Grid coordinate parameters
    const C = 6; // CELL_PX
    const LANE_GAP = 1;
    const PAD = 20;

    const getRoadWidthH = (r) => {
      const fwd = sim.hFwd[r] ? sim.hFwd[r].length : 3;
      const bwd = sim.hBwd[r] ? sim.hBwd[r].length : 3;
      return C * (fwd + bwd) + LANE_GAP * (fwd + bwd - 1);
    };
    const getRoadWidthV = (c) => {
      const fwd = sim.vFwd[c] ? sim.vFwd[c].length : 3;
      const bwd = sim.vBwd[c] ? sim.vBwd[c].length : 3;
      return C * (fwd + bwd) + LANE_GAP * (fwd + bwd - 1);
    };

    // Set canvas dimensions based on geometry
    const canvasW = PAD * 2 + g.HLEN * C;
    const canvasH = PAD * 2 + g.VLEN * C;
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasW * dpr;
    canvas.height = canvasH * dpr;
    canvas.style.width = canvasW + "px";
    canvas.style.height = canvasH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear Canvas
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Redefined coordinate helpers to align roads perfectly with intersection centers
    const hRoadY = (r) => PAD + g.vInt[r] * C + C / 2 - getRoadWidthH(r) / 2;
    const vRoadX = (c) => PAD + g.hInt[c] * C + C / 2 - getRoadWidthV(c) / 2;

    // Draw Roads (horizontal and vertical)
    for (let r = 0; r < g.NUM_H; r++) {
      const isArterial = r === 2;
      ctx.fillStyle = isArterial ? "#212630" : "#141923";
      ctx.fillRect(PAD, hRoadY(r), g.HLEN * C, getRoadWidthH(r));
    }
    for (let c = 0; c < g.NUM_V; c++) {
      const isArterial = c === 3;
      ctx.fillStyle = isArterial ? "#212630" : "#141923";
      ctx.fillRect(vRoadX(c), PAD, getRoadWidthV(c), g.VLEN * C);
    }

    // Draw road labels for Arterial Roads
    ctx.fillStyle = "rgba(102, 252, 241, 0.45)"; // primary theme color with transparency
    ctx.font = "bold 9px 'Outfit', sans-serif";
    ctx.fillText("主要幹道 H2 (Arterial H2)", PAD + 10, hRoadY(2) - 4);

    ctx.save();
    ctx.translate(vRoadX(3) - 4, PAD + 50);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("主要幹道 V3 (Arterial V3)", 0, 0);
    ctx.restore();

    // Draw Lane Dividers & ROC Markings
    ctx.lineWidth = 1;

    // Vector arrow drawing helper inside the cell
    const drawVectorArrow = (cx, cy, rot, type) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
      ctx.lineWidth = 0.7;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // Draw Straight Arrow Line
      if (type === 'straight' || type === 'straight_left' || type === 'straight_right') {
        ctx.beginPath();
        ctx.moveTo(-2.2, 0);
        ctx.lineTo(2.2, 0);
        // Head
        ctx.moveTo(1.2, -1.0);
        ctx.lineTo(2.2, 0);
        ctx.lineTo(1.2, 1.0);
        ctx.stroke();
      }

      // Draw Left Turn component (curves up relative to vehicle direction)
      if (type === 'left' || type === 'straight_left') {
        ctx.beginPath();
        ctx.moveTo(-0.8, 0);
        ctx.quadraticCurveTo(0.8, 0, 0.8, -1.6);
        // Head
        ctx.moveTo(0.1, -0.9);
        ctx.lineTo(0.8, -2.0);
        ctx.lineTo(1.5, -0.9);
        ctx.stroke();
      }

      // Draw Right Turn component (curves down relative to vehicle direction)
      if (type === 'right' || type === 'straight_right') {
        ctx.beginPath();
        ctx.moveTo(-0.8, 0);
        ctx.quadraticCurveTo(0.8, 0, 0.8, 1.6);
        // Head
        ctx.moveTo(0.1, 0.9);
        ctx.lineTo(0.8, 2.0);
        ctx.lineTo(1.5, 0.9);
        ctx.stroke();
      }

      ctx.restore();
    };

    // Helper to draw horizontal lines in segments (skipping intersections where road exists)
    const drawHorizontalLineInSegments = (r, y, strokeStyle, lineWidth, lineDash = []) => {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash(lineDash);
      
      let currentX = PAD;
      for (let c = 0; c < g.NUM_V; c++) {
        const xStart = vRoadX(c);
        const isPresent = g.present[r][c];
        if (isPresent) {
          if (currentX < xStart) {
            ctx.beginPath();
            ctx.moveTo(currentX, y);
            ctx.lineTo(xStart, y);
            ctx.stroke();
          }
          currentX = xStart + getRoadWidthV(c);
        }
      }
      if (currentX < PAD + g.HLEN * C) {
        ctx.beginPath();
        ctx.moveTo(currentX, y);
        ctx.lineTo(PAD + g.HLEN * C, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };

    // Helper to draw vertical lines in segments
    const drawVerticalLineInSegments = (c, x, strokeStyle, lineWidth, lineDash = []) => {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash(lineDash);
      
      let currentY = PAD;
      for (let r = 0; r < g.NUM_H; r++) {
        const yStart = hRoadY(r);
        const isPresent = g.present[r][c];
        if (isPresent) {
          if (currentY < yStart) {
            ctx.beginPath();
            ctx.moveTo(x, currentY);
            ctx.lineTo(x, yStart);
            ctx.stroke();
          }
          currentY = yStart + getRoadWidthH(r);
        }
      }
      if (currentY < PAD + g.VLEN * C) {
        ctx.beginPath();
        ctx.moveTo(x, currentY);
        ctx.lineTo(x, PAD + g.VLEN * C);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };

    // Draw horizontal road markings
    for (let r = 0; r < g.NUM_H; r++) {
      const y0 = hRoadY(r);
      const fwdCount = sim.hFwd[r].length;
      const bwdCount = sim.hBwd[r].length;

      // 1. Center Line / Reversible Lane Line (drawn in segments)
      const boundaryY = y0 + bwdCount * (C + LANE_GAP) - LANE_GAP / 2;
      if (sim.revModeH[r] === "none") {
        drawHorizontalLineInSegments(r, boundaryY - 1, "#eab308", 1, []);
        drawHorizontalLineInSegments(r, boundaryY + 1, "#eab308", 1, []);
      } else {
        drawHorizontalLineInSegments(r, boundaryY - 1, "#ffffff", 1, [4, 4]);
        drawHorizontalLineInSegments(r, boundaryY + 1, "#ffffff", 1, [4, 4]);
      }

      // 2. Draw lane lines (white dashed, turning solid near intersections)
      // hBwd lane dividers (top half, Westbound)
      for (let l = 1; l < bwdCount; l++) {
        const yL = y0 + l * (C + LANE_GAP) - LANE_GAP / 2;
        drawHorizontalLineInSegments(r, yL, "rgba(255, 255, 255, 0.15)", 0.8, [2, 4]);

        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 0.8;
        ctx.setLineDash([]);
        for (let c = 0; c < g.NUM_V; c++) {
          if (!g.present[r][c]) continue;
          const stopX = vRoadX(c) + getRoadWidthV(c);
          const endX = Math.min(PAD + g.HLEN * C, stopX + 6 * C);
          ctx.beginPath(); ctx.moveTo(stopX, yL); ctx.lineTo(endX, yL); ctx.stroke();
        }
      }
      // hFwd lane dividers (bottom half, Eastbound)
      for (let l = 1; l < fwdCount; l++) {
        const yL = y0 + (bwdCount + l) * (C + LANE_GAP) - LANE_GAP / 2;
        drawHorizontalLineInSegments(r, yL, "rgba(255, 255, 255, 0.15)", 0.8, [2, 4]);

        // Draw solid white line near intersection approaches (禁止跨越車道線)
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 0.8;
        ctx.setLineDash([]);
        for (let c = 0; c < g.NUM_V; c++) {
          if (!g.present[r][c]) continue;
          const stopX = vRoadX(c);
          const startX = Math.max(PAD, stopX - 6 * C);
          ctx.beginPath(); ctx.moveTo(startX, yL); ctx.lineTo(stopX, yL); ctx.stroke();
        }
      }

      // 3. Draw Stop Lines (白實線)
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      for (let c = 0; c < g.NUM_V; c++) {
        if (!g.present[r][c]) continue;
        // hBwd stop line (top half, Westbound, stops at right edge)
        const xBwd = vRoadX(c) + getRoadWidthV(c);
        ctx.beginPath(); ctx.moveTo(xBwd, y0); ctx.lineTo(xBwd, y0 + bwdCount * (C + LANE_GAP) - LANE_GAP); ctx.stroke();
        // hFwd stop line (bottom half, Eastbound, stops at left edge)
        const xFwd = vRoadX(c);
        ctx.beginPath(); ctx.moveTo(xFwd, y0 + bwdCount * (C + LANE_GAP)); ctx.lineTo(xFwd, y0 + getRoadWidthH(r)); ctx.stroke();
      }

      // 4. Draw Lane Direction Arrows
      for (let c = 0; c < g.NUM_V; c++) {
        if (!g.present[r][c]) continue;
        
        // hBwd Arrows (driver goes West <-, rot = Math.PI, top half)
        const xArrowBwd = vRoadX(c) + getRoadWidthV(c) + 2 * C + C / 2;
        for (let l = 0; l < bwdCount; l++) {
          let type = "straight";
          if (l === bwdCount - 1) type = "straight_left";
          else if (l === 0) type = "straight_right";
          drawVectorArrow(xArrowBwd, y0 + l * (C + LANE_GAP) + C / 2, Math.PI, type);
        }

        // hFwd Arrows (driver goes East ->, rot = 0, bottom half)
        const xArrow = vRoadX(c) - 3 * C + C / 2;
        for (let l = 0; l < fwdCount; l++) {
          let type = "straight";
          if (l === 0) type = "straight_left";
          else if (l === fwdCount - 1) type = "straight_right";
          drawVectorArrow(xArrow, y0 + (bwdCount + l) * (C + LANE_GAP) + C / 2, 0, type);
        }
      }
    }

    // Draw vertical road markings
    for (let c = 0; c < g.NUM_V; c++) {
      const x0 = vRoadX(c);
      const fwdCount = sim.vFwd[c].length;
      const bwdCount = sim.vBwd[c].length;

      // 1. Center Line / Reversible Lane Line
      const boundaryX = x0 + fwdCount * (C + LANE_GAP) - LANE_GAP / 2;
      if (sim.revModeV[c] === "none") {
        drawVerticalLineInSegments(c, boundaryX - 1, "#eab308", 1, []);
        drawVerticalLineInSegments(c, boundaryX + 1, "#eab308", 1, []);
      } else {
        drawVerticalLineInSegments(c, boundaryX - 1, "#ffffff", 1, [4, 4]);
        drawVerticalLineInSegments(c, boundaryX + 1, "#ffffff", 1, [4, 4]);
      }

      // 2. Draw lane lines
      // vFwd lane dividers (left half, Southbound)
      for (let l = 1; l < fwdCount; l++) {
        const xL = x0 + l * (C + LANE_GAP) - LANE_GAP / 2;
        drawVerticalLineInSegments(c, xL, "rgba(255, 255, 255, 0.15)", 0.8, [2, 4]);
        
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 0.8;
        ctx.setLineDash([]);
        for (let r = 0; r < g.NUM_H; r++) {
          if (!g.present[r][c]) continue;
          const stopY = hRoadY(r);
          const startY = Math.max(PAD, stopY - 6 * C);
          ctx.beginPath(); ctx.moveTo(xL, startY); ctx.lineTo(xL, stopY); ctx.stroke();
        }
      }
      // vBwd lane dividers (right half, Northbound)
      for (let l = 1; l < bwdCount; l++) {
        const xL = x0 + (fwdCount + l) * (C + LANE_GAP) - LANE_GAP / 2;
        drawVerticalLineInSegments(c, xL, "rgba(255, 255, 255, 0.15)", 0.8, [2, 4]);
        
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 0.8;
        ctx.setLineDash([]);
        for (let r = 0; r < g.NUM_H; r++) {
          if (!g.present[r][c]) continue;
          const stopY = hRoadY(r) + getRoadWidthH(r);
          const endY = Math.min(PAD + g.VLEN * C, stopY + 6 * C);
          ctx.beginPath(); ctx.moveTo(xL, stopY); ctx.lineTo(xL, endY); ctx.stroke();
        }
      }

      // 3. Draw Stop Lines
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      for (let r = 0; r < g.NUM_H; r++) {
        if (!g.present[r][c]) continue;
        // vFwd stop line (left half, Southbound, stops at top edge)
        const yFwd = hRoadY(r);
        ctx.beginPath(); ctx.moveTo(x0, yFwd); ctx.lineTo(x0 + fwdCount * (C + LANE_GAP) - LANE_GAP, yFwd); ctx.stroke();
        // vBwd stop line (right half, Northbound, stops at bottom edge)
        const yBwd = hRoadY(r) + getRoadWidthH(r);
        ctx.beginPath(); ctx.moveTo(x0 + fwdCount * (C + LANE_GAP), yBwd); ctx.lineTo(x0 + getRoadWidthV(c), yBwd); ctx.stroke();
      }

      // 4. Draw Lane Direction Arrows
      for (let r = 0; r < g.NUM_H; r++) {
        if (!g.present[r][c]) continue;
        
        // vFwd Arrows (driver goes South |v, rot = Math.PI / 2, left half)
        const yArrow = hRoadY(r) - 3 * C + C / 2;
        for (let l = 0; l < fwdCount; l++) {
          let type = "straight";
          if (l === fwdCount - 1) type = "straight_left";
          else if (l === 0) type = "straight_right";
          drawVectorArrow(x0 + l * (C + LANE_GAP) + C / 2, yArrow, Math.PI / 2, type);
        }

        // vBwd Arrows (driver goes North ^|, rot = Math.PI * 1.5, right half)
        const yArrowBwd = hRoadY(r) + getRoadWidthH(r) + 2 * C + C / 2;
        for (let l = 0; l < bwdCount; l++) {
          let type = "straight";
          if (l === 0) type = "straight_left";
          else if (l === bwdCount - 1) type = "straight_right";
          drawVectorArrow(x0 + (fwdCount + l) * (C + LANE_GAP) + C / 2, yArrowBwd, Math.PI * 1.5, type);
        }
      }
    }

    // Draw Traffic Lights (Four lights per intersection, placed on stop lines)
    for (let r = 0; r < g.NUM_H; r++) {
      for (let c = 0; c < g.NUM_V; c++) {
        if (!g.present[r][c]) continue;
        const hg = sim.isHGreen(r, c);
        const fwdCountH = sim.hFwd[r].length;
        const bwdCountH = sim.hBwd[r].length;
        const fwdCountV = sim.vFwd[c].length;
        const bwdCountV = sim.vBwd[c].length;

        // 1. hFwd Light (going East, bottom half, stops at left edge)
        const hFwdX = vRoadX(c);
        const hFwdY = hRoadY(r) + bwdCountH * (C + LANE_GAP) + fwdCountH * (C + LANE_GAP) / 2 - LANE_GAP / 2;
        ctx.fillStyle = hg ? theme.success : theme.danger;
        ctx.beginPath(); ctx.arc(hFwdX, hFwdY, 2.5, 0, Math.PI * 2); ctx.fill();

        // 2. hBwd Light (going West, top half, stops at right edge)
        const hBwdX = vRoadX(c) + getRoadWidthV(c);
        const hBwdY = hRoadY(r) + bwdCountH * (C + LANE_GAP) / 2 - LANE_GAP / 2;
        ctx.fillStyle = hg ? theme.success : theme.danger;
        ctx.beginPath(); ctx.arc(hBwdX, hBwdY, 2.5, 0, Math.PI * 2); ctx.fill();

        // 3. vFwd Light (going South, left half, stops at top edge)
        const vFwdX = vRoadX(c) + fwdCountV * (C + LANE_GAP) / 2 - LANE_GAP / 2;
        const vFwdY = hRoadY(r);
        ctx.fillStyle = !hg ? theme.success : theme.danger;
        ctx.beginPath(); ctx.arc(vFwdX, vFwdY, 2.5, 0, Math.PI * 2); ctx.fill();

        // 4. vBwd Light (going North, right half, stops at bottom edge)
        const vBwdX = vRoadX(c) + fwdCountV * (C + LANE_GAP) + bwdCountV * (C + LANE_GAP) / 2 - LANE_GAP / 2;
        const vBwdY = hRoadY(r) + getRoadWidthH(r);
        ctx.fillStyle = !hg ? theme.success : theme.danger;
        ctx.beginPath(); ctx.arc(vBwdX, vBwdY, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Draw Vehicles
    activeVehicles.forEach(car => {
      const roadType = car.roadType;
      const idx = car.roadIdx;
      const lane = car.lane;
      const pos = car.pos;

      const { px, py } = getVehicleCoords(roadType, idx, lane, pos, sim);

      // Highlight tracked car
      if (trackedVehicleId === car.id) {
        ctx.strokeStyle = theme.purple;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px - 1.5, py - 1.5, C + 3, C + 3);
      }

      // Color Coding
      let grad = ctx.createLinearGradient(px, py, px + C, py + C);
      if (car.type === 'subject') {
        grad.addColorStop(0, "#e879f9");
        grad.addColorStop(1, "#a21caf");
      } else if (car.type === 'emergency') {
        grad.addColorStop(0, "#ffedd5");
        grad.addColorStop(1, "#ea580c");
        
        // Flashing blue siren
        if (tick % 2 === 0) {
          ctx.fillStyle = "#3b82f6";
          ctx.beginPath();
          ctx.arc(px + C/2, py - 2, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        grad.addColorStop(0, "#22d3ee");
        grad.addColorStop(1, "#0369a1");
      }

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(px, py, C - 0.5, C - 0.5, 1);
      ctx.fill();
    });

  }, [tick, activeVehicles, sim, trackedVehicleId]);

  // Click on Canvas to Inspect Car in Grid
  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !sim) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const C = 6;
    const LANE_GAP = 1;
    const PAD = 20;
    const g = sim.g;
    
    const getRoadWidthH = (r) => {
      const fwd = sim.hFwd[r] ? sim.hFwd[r].length : 3;
      const bwd = sim.hBwd[r] ? sim.hBwd[r].length : 3;
      return C * (fwd + bwd) + LANE_GAP * (fwd + bwd - 1);
    };
    const getRoadWidthV = (c) => {
      const fwd = sim.vFwd[c] ? sim.vFwd[c].length : 3;
      const bwd = sim.vBwd[c] ? sim.vBwd[c].length : 3;
      return C * (fwd + bwd) + LANE_GAP * (fwd + bwd - 1);
    };
    
    const hRoadY = (r) => PAD + g.vInt[r] * C + C / 2 - getRoadWidthH(r) / 2;
    const vRoadX = (c) => PAD + g.hInt[c] * C + C / 2 - getRoadWidthV(c) / 2;

    let closestCar = null;
    let minDist = 15; // Max click distance 15px

    activeVehicles.forEach(car => {
      const { px, py } = getVehicleCoords(car.roadType, car.roadIdx, car.lane, car.pos, sim);

      const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
      if (dist < minDist) {
        minDist = dist;
        closestCar = car;
      }
    });

    if (closestCar) {
      setTrackedVehicleId(closestCar.id);
    } else {
      setTrackedVehicleId(null);
    }
  };

  // Run Experiment A (Spatial Sweep)
  const executeSweep = async () => {
    setIsSweeping(true);
    // Let UI render loading state
    setTimeout(() => {
      const res = runExperimentASweep(seed, deltaT, (densityHFwd + densityHBwd) / 2);
      setSweepData(res.sweep);
      setBestL(res.best_road_length);
      setCalcCruiseSpeed(res.calculated_cruise_speed);
      setIsSweeping(false);
    }, 100);
  };

  // Run Experiment B Comparison in 6-Lane Grid
  const executeBComparison = () => {
    setIsComparing(true);

    setTimeout(() => {
      // 1. Control Run (Background only, P_change = 0.1)
      const simCtrl = new GridSimulation({
        simulationSteps: 800,
        backgroundDensityHFwd: densityHFwd,
        backgroundDensityHBwd: densityHBwd,
        seed: seed,
        experimentType: 'custom',
        params: {
          p_change_background: 0.1,
        }
      });
      const resCtrl = simCtrl.run();

      // 2. Weaving Scenario (Subject weaving, P_change = 1.0)
      const simWeave = new GridSimulation({
        simulationSteps: 800,
        backgroundDensityHFwd: densityHFwd,
        backgroundDensityHBwd: densityHBwd,
        seed: seed,
        experimentType: 'B1',
        params: {
          p_change_background: 0.1,
          p_change_subject: 1.0,
          subject_spawn_tick: 70
        }
      });
      const resWeave = simWeave.run();

      // 3. Tailgating Scenario (Subject tailgating emergency vehicle)
      const simTailgate = new GridSimulation({
        simulationSteps: 800,
        backgroundDensityHFwd: densityHFwd,
        backgroundDensityHBwd: densityHBwd,
        seed: seed,
        experimentType: 'B2',
        params: {
          p_change_background: 0.1,
          p_change_subject: 1.0,
          emergency_spawn_tick: 50,
          subject_spawn_tick: 70
        }
      });
      const resTailgate = simTailgate.run();

      setBComparison({
        control: resCtrl,
        weaving: resWeave,
        tailgate: resTailgate
      });
      setIsComparing(false);
    }, 100);
  };

  // Get details of inspected car
  const getTrackedVehicleDetails = () => {
    if (!simRef.current || trackedVehicleId === null) return null;
    const allCars = [...simRef.current.arrivedVehicles, ...simRef.current.vehicles];
    return allCars.find(c => c.id === trackedVehicleId);
  };

  const inspectedCar = getTrackedVehicleDetails();

  return (
    <div style={{
      fontFamily: "'Outfit', 'Inter', sans-serif",
      color: theme.text,
      background: theme.bg,
      padding: "24px",
      minHeight: "100vh"
    }}>
      {/* Header Panel */}
      <div style={{
        background: "rgba(31, 40, 51, 0.45)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: "16px",
        padding: "20px 24px",
        marginBottom: "20px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }}>
        <div>
          <h1 style={{
            fontSize: "24px",
            color: theme.textLight,
            margin: "0 0 6px 0",
            fontWeight: 700,
            letterSpacing: "-0.5px"
          }}>
            微觀交通模擬實驗 API 與規格看板 <span style={{
              fontSize: "12px",
              background: "rgba(102, 252, 241, 0.15)",
              color: theme.primary,
              padding: "4px 8px",
              borderRadius: "6px",
              fontWeight: 500,
              marginLeft: "10px"
            }}>v1.0.0</span>
          </h1>
          <p style={{ margin: 0, fontSize: "14px", color: theme.textMuted }}>
            基於雙車道元胞自動機 (CA) 研究空間尺度綠波協調及極端利己駕駛行為 (切車/尾隨)
          </p>
        </div>

        {/* Tab Selection */}
        <div style={{
          background: "#161b22",
          padding: "4px",
          borderRadius: "8px",
          display: "flex",
          gap: "4px"
        }}>
          {[
            { id: "visualizer", label: "實時可視化" },
            { id: "experimentA", label: "實驗 A: 空間逆推" },
            { id: "experimentB", label: "實驗 B: 行為對抗" },
            { id: "spec", label: "API 規格文件" }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: activeTab === tab.id ? theme.primary : "transparent",
                color: activeTab === tab.id ? theme.bg : theme.text,
                border: "none",
                borderRadius: "6px",
                padding: "8px 16px",
                cursor: "pointer",
                fontWeight: "bold",
                transition: "all 0.2s",
                fontSize: "13px"
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content - Visualizer */}
      {activeTab === "visualizer" && (
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "20px" }}>
          {/* Controls Config */}
          <div style={{
            background: "rgba(31, 40, 51, 0.45)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "16px",
            padding: "20px",
            height: "fit-content"
          }}>
            <h3 style={{ margin: "0 0 16px 0", color: theme.textLight, fontSize: "16px" }}>參數配置</h3>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", color: theme.textMuted, marginBottom: "4px" }}>亂數種子 (Random Seed)</label>
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(Number(e.target.value))}
                  style={{
                    width: "100%",
                    background: "#161b22",
                    border: "1px solid #30363d",
                    color: "#fff",
                    padding: "8px",
                    borderRadius: "6px",
                    boxSizing: "border-box"
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", color: theme.textMuted, marginBottom: "4px" }}>街廓長度 (Seg Length): {segLength} cells</label>
                <input
                  type="range"
                  min={12}
                  max={28}
                  step={2}
                  value={segLength}
                  onChange={(e) => setSegLength(Number(e.target.value))}
                  style={{ width: "100%", accentColor: theme.primary }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", color: theme.textMuted, marginBottom: "4px" }}>東向車流密度 (Eastbound): {(densityHFwd * 100).toFixed(0)}%</label>
                <input
                  type="range"
                  min={0.05}
                  max={0.3}
                  step={0.01}
                  value={densityHFwd}
                  onChange={(e) => setDensityHFwd(Number(e.target.value))}
                  style={{ width: "100%", accentColor: theme.primary }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", color: theme.textMuted, marginBottom: "4px" }}>西向車流密度 (Westbound): {(densityHBwd * 100).toFixed(0)}%</label>
                <input
                  type="range"
                  min={0.05}
                  max={0.3}
                  step={0.01}
                  value={densityHBwd}
                  onChange={(e) => setDensityHBwd(Number(e.target.value))}
                  style={{ width: "100%", accentColor: theme.primary }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", color: theme.textMuted, marginBottom: "4px" }}>路口轉彎機率: {(turnProbability * 100).toFixed(0)}%</label>
                <input
                  type="range"
                  min={0.05}
                  max={0.4}
                  step={0.05}
                  value={turnProbability}
                  onChange={(e) => setTurnProbability(Number(e.target.value))}
                  style={{ width: "100%", accentColor: theme.primary }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", color: theme.textMuted, marginBottom: "4px" }}>實驗情境</label>
                <select
                  value={expType}
                  onChange={(e) => setExpType(e.target.value)}
                  style={{
                    width: "100%",
                    background: "#161b22",
                    border: "1px solid #30363d",
                    color: "#fff",
                    padding: "8px",
                    borderRadius: "6px",
                    cursor: "pointer"
                  }}
                >
                  <option value="custom">自訂自由流模式</option>
                  <option value="A">實驗 A: 號誌綠波協調</option>
                  <option value="B1">實驗 B 情境 1: 切車魔人 (Weaving)</option>
                  <option value="B2">實驗 B 情境 2: 吸血鬼駕駛 (Tailgate)</option>
                </select>
              </div>

              {expType === "A" && (
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: theme.textMuted, marginBottom: "4px" }}>號誌綠燈差 (Δt): {deltaT} Ticks</label>
                  <input
                    type="range"
                    min={10}
                    max={60}
                    step={5}
                    value={deltaT}
                    onChange={(e) => setDeltaT(Number(e.target.value))}
                    style={{ width: "100%", accentColor: theme.primary }}
                  />
                </div>
              )}

              <div>
                <label style={{ display: "block", fontSize: "12px", color: theme.textMuted, marginBottom: "4px" }}>背景車切道率 (P_change)</label>
                <input
                  type="range"
                  min={0.0}
                  max={0.5}
                  step={0.05}
                  value={pChangeBg}
                  onChange={(e) => setPChangeBg(Number(e.target.value))}
                  style={{ width: "100%", accentColor: theme.primary }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", color: theme.textMuted, marginBottom: "4px" }}>模擬速度: {simSpeed}ms/Tick</label>
                <input
                  type="range"
                  min={30}
                  max={300}
                  step={10}
                  value={simSpeed}
                  onChange={(e) => {
                    setSimSpeed(Number(e.target.value));
                    if (isPlaying) {
                      clearInterval(animationRef.current);
                      animationRef.current = setInterval(stepSimulation, Number(e.target.value));
                    }
                  }}
                  style={{ width: "100%", accentColor: theme.primary }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", color: theme.textMuted, marginBottom: "4px" }}>號誌控制模式 (Signal Mode)</label>
                <select
                  value={signalMode}
                  onChange={(e) => setSignalMode(e.target.value)}
                  style={{
                    width: "100%",
                    background: "#161b22",
                    border: "1px solid #30363d",
                    color: "#fff",
                    padding: "8px",
                    borderRadius: "6px",
                    cursor: "pointer"
                  }}
                >
                  <option value="all_sync">全部同時 (All Sync)</option>
                  <option value="alternating">交互切換 (Alternating)</option>
                  <option value="green_wave">靜態綠波協調 (Green Wave)</option>
                  <option value="adaptive">智慧動態感測 (Local Adaptive)</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", color: theme.textMuted, marginBottom: "4px" }}>調撥車道設定 (主要幹道 H2)</label>
                <select
                  value={revModeH[2]}
                  onChange={(e) => {
                    const newRev = [...revModeH];
                    newRev[2] = e.target.value;
                    setRevModeH(newRev);
                  }}
                  style={{
                    width: "100%",
                    background: "#161b22",
                    border: "1px solid #30363d",
                    color: "#fff",
                    padding: "8px",
                    borderRadius: "6px",
                    cursor: "pointer"
                  }}
                >
                  <option value="none">常態配置 (3+3 雙黃實線)</option>
                  <option value="peak_fwd">東向尖峰 (4+2 雙白虛線)</option>
                  <option value="peak_bwd">西向尖峰 (2+4 雙白虛線)</option>
                </select>
              </div>
            </div>

            <hr style={{ borderColor: "rgba(255,255,255,0.06)", margin: "20px 0" }} />

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={togglePlay}
                style={{
                  flex: 1,
                  background: isPlaying ? theme.warning : theme.success,
                  color: "#000",
                  fontWeight: "bold",
                  border: "none",
                  padding: "10px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "13px"
                }}
              >
                {isPlaying ? "暫停" : "播放"}
              </button>
              <button
                onClick={initializeSimulation}
                style={{
                  flex: 1,
                  background: "#30363d",
                  color: "#fff",
                  fontWeight: "bold",
                  border: "none",
                  padding: "10px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "13px"
                }}
              >
                重置
              </button>
            </div>
          </div>

          {/* Canvas & Real-time Stats */}
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Visualizer Area */}
            <div style={{
              background: "rgba(31, 40, 51, 0.45)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "16px",
              padding: "20px",
              overflowX: "auto"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", alignItems: "center" }}>
                <span style={{ fontSize: "14px", fontWeight: "bold", color: theme.textLight }}>模擬運行狀態 (Tick: {tick} / {steps})</span>
                <div style={{ display: "flex", gap: "14px", fontSize: "12px" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "linear-gradient(to bottom, #22d3ee, #0369a1)" }}></span> 背景車
                  </span>
                  {(expType === 'B1' || expType === 'B2') && (
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "linear-gradient(to bottom, #e879f9, #a21caf)" }}></span> 主體車
                    </span>
                  )}
                  {expType === 'B2' && (
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "linear-gradient(to bottom, #ffedd5, #ea580c)" }}></span> 救護車
                    </span>
                  )}
                </div>
              </div>

              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                style={{
                  borderRadius: "8px",
                  cursor: "crosshair",
                  display: "block",
                  margin: "0 auto"
                }}
              />
              <p style={{ margin: "8px 0 0 0", fontSize: "11px", color: theme.textMuted, textAlign: "center" }}>
                提示：點擊車輛可進行「微觀軌跡追蹤」
              </p>
            </div>

            {/* Metrics Panel */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              {/* General Metrics */}
              <div style={{
                background: "rgba(31, 40, 51, 0.45)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "16px",
                padding: "20px"
              }}>
                <h3 style={{ margin: "0 0 14px 0", color: theme.textLight, fontSize: "15px" }}>車流統計數據</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  {[
                    { label: "活躍車輛數", val: activeVehicles.length },
                    { label: "駛離車輛數", val: arrivedCount },
                    { label: "背景車平均速度", val: metrics.avg_speed_background ? `${metrics.avg_speed_background} cells/tick` : "計算中..." },
                    { label: "背景車平均旅行時間", val: metrics.avg_travel_time_background ? `${metrics.avg_travel_time_background} ticks` : "計算中..." },
                    { label: "背景車平均延滯", val: metrics.avg_delay_background ? `${metrics.avg_delay_background} ticks` : "計算中..." },
                    { label: "幽靈塞車偵測次數", val: metrics.phantom_jams_detected ?? 0 }
                  ].map((stat, idx) => (
                    <div key={idx} style={{ background: "#161b22", padding: "10px", borderRadius: "8px" }}>
                      <span style={{ fontSize: "11px", color: theme.textMuted, display: "block" }}>{stat.label}</span>
                      <span style={{ fontSize: "15px", color: theme.primary, fontWeight: "bold" }}>{stat.val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Inspected/Tracked Vehicle details */}
              <div style={{
                background: "rgba(31, 40, 51, 0.45)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "16px",
                padding: "20px"
              }}>
                <h3 style={{ margin: "0 0 14px 0", color: theme.textLight, fontSize: "15px" }}>個體車輛軌跡追蹤 (Inspector)</h3>
                {inspectedCar ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{
                        fontSize: "12px",
                        background: inspectedCar.type === 'subject' ? theme.purple : inspectedCar.type === 'emergency' ? theme.warning : theme.primary,
                        color: "#000",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        fontWeight: "bold"
                      }}>
                        {inspectedCar.type.toUpperCase()} 車輛 #{inspectedCar.id}
                      </span>
                      <span style={{ fontSize: "11px", color: theme.textMuted }}>運行 Ticks: {tick - inspectedCar.spawnTick}</span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "12px" }}>
                      <div style={{ background: "#161b22", padding: "8px", borderRadius: "6px" }}>
                        <span style={{ color: theme.textMuted, display: "block", fontSize: "10px" }}>當前位置/車道</span>
                        <span style={{ color: "#fff", fontWeight: "bold" }}>Cell {inspectedCar.pos} / Lane {inspectedCar.lane}</span>
                      </div>
                      <div style={{ background: "#161b22", padding: "8px", borderRadius: "6px" }}>
                        <span style={{ color: theme.textMuted, display: "block", fontSize: "10px" }}>當前車速 / 速限</span>
                        <span style={{ color: "#fff", fontWeight: "bold" }}>{inspectedCar.v} / {inspectedCar.vMax}</span>
                      </div>
                      <div style={{ background: "#161b22", padding: "8px", borderRadius: "6px" }}>
                        <span style={{ color: theme.textMuted, display: "block", fontSize: "10px" }}>累計切車道次數</span>
                        <span style={{ color: "#fff", fontWeight: "bold" }}>{inspectedCar.totalLaneChanges} 次</span>
                      </div>
                      <div style={{ background: "#161b22", padding: "8px", borderRadius: "6px" }}>
                        <span style={{ color: theme.textMuted, display: "block", fontSize: "10px" }}>紅燈煞停次數</span>
                        <span style={{ color: "#fff", fontWeight: "bold" }}>{inspectedCar.totalRedLightStops} 次</span>
                      </div>
                    </div>

                    {/* Simple inline speed sparkline */}
                    <div>
                      <span style={{ fontSize: "10px", color: theme.textMuted, display: "block", marginBottom: "4px" }}>車速變化曲線 (Speed Profile)</span>
                      <div style={{ display: "flex", gap: "2px", alignItems: "flex-end", height: "30px", background: "#161b22", padding: "4px", borderRadius: "6px" }}>
                        {inspectedCar.speedProfile.slice(-30).map((v, i) => (
                          <div
                            key={i}
                            style={{
                              flex: 1,
                              height: `${(v / inspectedCar.vMax) * 100}%`,
                              background: inspectedCar.type === 'subject' ? theme.purple : theme.primary,
                              minWidth: "4px",
                              borderRadius: "1px"
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ height: "100px", display: "flex", justifyContent: "center", alignItems: "center", color: theme.textMuted, border: "1px dashed #30363d", borderRadius: "8px" }}>
                    點擊車體鎖定單車進行統計追蹤
                  </div>
                )}

                {/* Specific Experiment B2 Results overlay */}
                {expType === "B2" && expResults && (
                  <div style={{ marginTop: "12px", padding: "10px", background: "rgba(192, 132, 252, 0.08)", border: "1px solid rgba(192, 132, 252, 0.2)", borderRadius: "8px" }}>
                    <span style={{ fontSize: "11px", color: theme.purple, fontWeight: "bold", display: "block", marginBottom: "6px" }}>吸血鬼駕駛行為統計</span>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "11px" }}>
                      <div>個人節省時間: <strong style={{ color: "#fff" }}>{expResults.personal_time_saved} ticks</strong></div>
                      <div>社會成本總延滯: <strong style={{ color: "#fff" }}>{expResults.social_cost_total_delay} ticks</strong></div>
                      <div>利己排他比 (Ratio): <strong style={{ color: theme.danger }}>{expResults.selfishness_ratio}</strong></div>
                      <div>救護車尾隨率: <strong style={{ color: "#fff" }}>{(expResults.tailgate_ratio * 100).toFixed(0)}%</strong></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab Content - Experiment A Sweep */}
      {activeTab === "experimentA" && (
        <div style={{
          background: "rgba(31, 40, 51, 0.45)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "16px",
          padding: "24px"
        }}>
          <h2 style={{ color: theme.textLight, margin: "0 0 10px 0", fontSize: "20px" }}>實驗 A：空間尺度逆推巡航速度 (Spatial Sweep Calibration)</h2>
          <p style={{ color: theme.textMuted, margin: "0 0 24px 0", fontSize: "14px" }}>
            在固定號誌協調時差 Δt 下，遞增改變道路長度 L。當車流平均延滯最低時，該點 L_best 與時差的比例即為車隊綠波最順暢的「巡航速率」。
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "250px 1fr", gap: "30px" }}>
            {/* Form */}
            <div style={{ background: "#161b22", padding: "20px", borderRadius: "12px", height: "fit-content" }}>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "12px", color: theme.textMuted, marginBottom: "4px" }}>號誌綠燈差 (Δt)</label>
                <input
                  type="number"
                  value={deltaT}
                  onChange={(e) => setDeltaT(Number(e.target.value))}
                  style={{
                    width: "100%",
                    background: "#0b0c10",
                    border: "1px solid #30363d",
                    color: "#fff",
                    padding: "8px",
                    borderRadius: "6px"
                  }}
                />
              </div>

              <div style={{ marginBottom: "20px" }}>
                <label style={{ display: "block", fontSize: "12px", color: theme.textMuted, marginBottom: "4px" }}>車流密度</label>
                <input
                  type="number"
                  value={density}
                  onChange={(e) => setDensity(Number(e.target.value))}
                  style={{
                    width: "100%",
                    background: "#0b0c10",
                    border: "1px solid #30363d",
                    color: "#fff",
                    padding: "8px",
                    borderRadius: "6px"
                  }}
                />
              </div>

              <button
                onClick={executeSweep}
                disabled={isSweeping}
                style={{
                  width: "100%",
                  background: theme.primary,
                  color: "#000",
                  fontWeight: "bold",
                  border: "none",
                  padding: "12px",
                  borderRadius: "6px",
                  cursor: isSweeping ? "not-allowed" : "pointer",
                  fontSize: "14px"
                }}
              >
                {isSweeping ? "執行掃描中..." : "開始差分掃描"}
              </button>

              {bestL && (
                <div style={{ marginTop: "20px", padding: "14px", background: "rgba(102, 252, 241, 0.08)", border: "1px solid rgba(102, 252, 241, 0.2)", borderRadius: "8px" }}>
                  <span style={{ fontSize: "12px", color: theme.primary, fontWeight: "bold", display: "block", marginBottom: "6px" }}>逆推分析結果</span>
                  <div style={{ fontSize: "13px", display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div>最佳協調長度 L: <strong style={{ color: "#fff" }}>{bestL} cells</strong></div>
                    <div>逆推巡航車速 v_cruise: <strong style={{ color: theme.secondary }}>{calcCruiseSpeed} cells/tick</strong></div>
                  </div>
                </div>
              )}
            </div>

            {/* Chart */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div style={{
                height: "250px",
                background: "#161b22",
                borderRadius: "12px",
                padding: "20px",
                display: "flex",
                alignItems: "flex-end",
                position: "relative"
              }}>
                <span style={{ position: "absolute", top: "15px", left: "20px", fontSize: "12px", color: theme.textMuted }}>車流平均延滯 (Ticks) vs. 道路長度 (L)</span>
                
                {sweepData.length > 0 ? (
                  <div style={{ display: "flex", width: "100%", height: "180px", alignItems: "flex-end", justifyContent: "space-between" }}>
                    {sweepData.map((d, i) => {
                      const maxDelay = Math.max(...sweepData.map(x => x.avg_delay));
                      const pct = (d.avg_delay / (maxDelay || 1)) * 100;
                      const isBest = d.road_length === bestL;

                      return (
                        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                          <span style={{ fontSize: "9px", color: isBest ? theme.primary : theme.textMuted, marginBottom: "4px" }}>{d.avg_delay.toFixed(1)}</span>
                          <div
                            style={{
                              width: "18px",
                              height: `${pct}%`,
                              background: isBest ? theme.primary : "#30363d",
                              borderRadius: "4px 4px 0 0",
                              transition: "all 0.3s"
                            }}
                          />
                          <span style={{ fontSize: "9px", color: "#8f9499", marginTop: "6px" }}>{d.road_length}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", justifyContent: "center", alignItems: "center", color: theme.textMuted }}>
                    點擊按鈕運行長度差分掃描，生成 V 字延滯物理曲線圖
                  </div>
                )}
              </div>

              {/* Data Table */}
              {sweepData.length > 0 && (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #30363d", textAlign: "left", color: theme.textLight }}>
                      <th style={{ padding: "10px" }}>道路長度 (L)</th>
                      <th style={{ padding: "10px" }}>固定號誌差 (Δt)</th>
                      <th style={{ padding: "10px" }}>平均延滯 (Delay)</th>
                      <th style={{ padding: "10px" }}>平均速度</th>
                      <th style={{ padding: "10px" }}>狀態評估</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sweepData.map((d, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", background: d.road_length === bestL ? "rgba(102, 252, 241, 0.04)" : "transparent" }}>
                        <td style={{ padding: "10px", fontWeight: d.road_length === bestL ? "bold" : "normal" }}>{d.road_length} cells</td>
                        <td style={{ padding: "10px" }}>{deltaT} ticks</td>
                        <td style={{ padding: "10px", color: d.road_length === bestL ? theme.primary : "#fff" }}>{d.avg_delay.toFixed(1)} ticks</td>
                        <td style={{ padding: "10px" }}>{d.avg_speed.toFixed(2)} cells/tick</td>
                        <td style={{ padding: "10px" }}>
                          {d.road_length === bestL ? (
                            <span style={{ color: theme.success, fontWeight: "bold" }}>● 綠波最佳共振點</span>
                          ) : d.road_length < bestL ? (
                            <span style={{ color: theme.textMuted }}>車速受限 (提前到達紅燈)</span>
                          ) : (
                            <span style={{ color: theme.textMuted }}>號誌過載 (延遲到達紅燈)</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab Content - Experiment B */}
      {activeTab === "experimentB" && (
        <div style={{
          background: "rgba(31, 40, 51, 0.45)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "16px",
          padding: "24px"
        }}>
          <h2 style={{ color: theme.textLight, margin: "0 0 10px 0", fontSize: "20px" }}>實驗 B：極端個體駕駛行為分析 (Anti-Herd Behavior Analysis)</h2>
          <p style={{ color: theme.textMuted, margin: "0 0 24px 0", fontSize: "14px" }}>
            對比常規遵守間距的背景車流，分析「切車魔人 (情境 1)」強行切車引發幽靈塞車的物理效應，以及「吸血鬼駕駛 (情境 2)」尾隨救護車的個人時間收益與對環境造成的額外社會成本。
          </p>

          <div style={{ marginBottom: "20px" }}>
            <button
              onClick={executeBComparison}
              disabled={isComparing}
              style={{
                background: theme.primary,
                color: "#000",
                fontWeight: "bold",
                border: "none",
                padding: "12px 24px",
                borderRadius: "6px",
                cursor: isComparing ? "not-allowed" : "pointer",
                fontSize: "14px"
              }}
            >
              {isComparing ? "執行對比模擬中..." : "開始運行情境對比實驗"}
            </button>
          </div>

          {bComparison ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
              {/* Scenario 1: Weaving Demon */}
              <div style={{ background: "#161b22", padding: "20px", borderRadius: "12px" }}>
                <h3 style={{ color: theme.primary, margin: "0 0 12px 0", fontSize: "16px" }}>情境 1: 切車魔人與幽靈塞車偵測</h3>
                <p style={{ fontSize: "12px", color: theme.textMuted, marginBottom: "16px" }}>
                  對比完全無序隨機慢化的背景車流，觀察 100% 機率強行切車的主體車是否破壞了後車安全距離，觸發局部煞車回彈衝擊波。
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #30363d", paddingBottom: "8px", fontSize: "13px" }}>
                    <span>對比指標</span>
                    <span style={{ width: "80px", textAlign: "right" }}>對照組 (常規)</span>
                    <span style={{ width: "80px", textAlign: "right", color: theme.danger }}>切車魔人組</span>
                  </div>
                  {[
                    { label: "偵測到幽靈塞車次數", k: "phantom_jams_detected" },
                    { label: "背景車平均速度 (cells/t)", k: "avg_speed_background" },
                    { label: "背景車平均延滯 (ticks)", k: "avg_delay_background" },
                  ].map((row, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", padding: "4px 0" }}>
                      <span>{row.label}</span>
                      <span style={{ width: "80px", textAlign: "right", fontWeight: "bold" }}>
                        {bComparison.control.metrics[row.k]}
                      </span>
                      <span style={{ width: "80px", textAlign: "right", color: theme.danger, fontWeight: "bold" }}>
                        {bComparison.weaving.metrics[row.k]}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{
                  marginTop: "16px",
                  padding: "10px",
                  background: "rgba(252, 68, 69, 0.08)",
                  border: "1px solid rgba(252, 68, 69, 0.2)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: theme.text
                }}>
                  <strong>學術發現</strong>：單一主體車強行插隊（P_change=1.0）使背景車流煞車衝擊波傳播頻次上升，降低了道路的臨界通行包絡線，是引發非物理瓶頸局部停滯（幽靈塞車）的主因。
                </div>
              </div>

              {/* Scenario 2: Vampire Driver */}
              <div style={{ background: "#161b22", padding: "20px", borderRadius: "12px" }}>
                <h3 style={{ color: theme.purple, margin: "0 0 12px 0", fontSize: "16px" }}>情境 2: 吸血鬼尾隨與社會成本分析</h3>
                <p style={{ fontSize: "12px", color: theme.textMuted, marginBottom: "16px" }}>
                  主體車利用特種車避讓機制，100% 緊跟在救護車後方，搭乘救護車破壞的紅燈和避讓間距，獲取高額時間收益，但引發後續道路的嚴重擾動。
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {[
                    { label: "主體車旅行時間 (Ticks)", val: bComparison.tailgate.experiment_results.subject_travel_time, suffix: " ticks", color: theme.purple },
                    { label: "背景車對照旅行時間", val: bComparison.tailgate.experiment_results.bg_control_avg_travel_time, suffix: " ticks" },
                    { label: "個人時間淨收益 (Time Saved)", val: bComparison.tailgate.experiment_results.personal_time_saved, suffix: " ticks", color: theme.success },
                    { label: "外部背景車累積延滯 (Social Cost)", val: bComparison.tailgate.experiment_results.social_cost_total_delay, suffix: " ticks", color: theme.danger },
                    { label: "利己社會成本比 (Selfishness Ratio)", val: bComparison.tailgate.experiment_results.selfishness_ratio, color: theme.secondary },
                    { label: "救護車緊密尾隨率", val: `${(bComparison.tailgate.experiment_results.tailgate_ratio * 100).toFixed(0)}%` }
                  ].map((row, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <span>{row.label}</span>
                      <span style={{ fontWeight: "bold", color: row.color || "#fff" }}>
                        {row.val}{row.suffix}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{
                  marginTop: "16px",
                  padding: "10px",
                  background: "rgba(192, 132, 252, 0.08)",
                  border: "1px solid rgba(192, 132, 252, 0.2)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: theme.text
                }}>
                  <strong>學術發現</strong>：吸血鬼駕駛的「利己社會成本比」小於 0.2。這量化表明：**主體車每給自己節省 1 秒旅行時間，會迫使社會其他背景車集體付出超過 5 秒的等待代價**，具有嚴重的外部破壞性。
                </div>
              </div>
            </div>
          ) : (
            <div style={{ height: "200px", display: "flex", justifyContent: "center", alignItems: "center", color: theme.textMuted, border: "1px dashed #30363d", borderRadius: "12px", background: "#161b22" }}>
              點擊上方按鈕，以前台與後台的對照組資料進行情境對比分析
            </div>
          )}
        </div>
      )}

      {/* Tab Content - API Spec Docs */}
      {activeTab === "spec" && (
        <div style={{
          background: "rgba(31, 40, 51, 0.45)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "16px",
          padding: "24px"
        }}>
          <h2 style={{ color: theme.textLight, margin: "0 0 10px 0", fontSize: "20px" }}>微觀交通模擬實驗 API 說明文檔</h2>
          <p style={{ color: theme.textMuted, margin: "0 0 20px 0", fontSize: "14px" }}>
            後台 Express API 接口，供 AI Agent 穩定再現與自訂參數訓練。
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div>
              <h3 style={{ color: theme.primary, margin: "0 0 8px 0", fontSize: "15px" }}>1. 運行實驗 Endpoint</h3>
              <div style={{ background: "#161b22", padding: "12px", borderRadius: "8px", fontFamily: "monospace", fontSize: "13px" }}>
                <span style={{ color: theme.success, fontWeight: "bold", marginRight: "10px" }}>POST</span>
                http://localhost:3000/api/v1/simulation/run
              </div>
            </div>

            <div>
              <h3 style={{ color: theme.primary, margin: "0 0 8px 0", fontSize: "15px" }}>2. 請求主體 JSON 格式</h3>
              <pre style={{ background: "#161b22", padding: "16px", borderRadius: "8px", fontFamily: "monospace", fontSize: "12px", overflowX: "auto", margin: 0 }}>
{`{
  "random_seed": 42,
  "simulation_steps": 1000,
  "road_length": 300,
  "background_density": 0.15,
  "experiment_type": "B2", // A, B1, B2, custom
  "export_trajectories": false,
  "params": {
    "delta_t": 30,
    "p_change_background": 0.1,
    "p_change_subject": 1.0,
    "v_max_background": 5,
    "v_max_subject": 6
  }
}`}
              </pre>
            </div>

            <div>
              <h3 style={{ color: theme.primary, margin: "0 0 8px 0", fontSize: "15px" }}>3. 回應 JSON 格式</h3>
              <pre style={{ background: "#161b22", padding: "16px", borderRadius: "8px", fontFamily: "monospace", fontSize: "12px", overflowX: "auto", margin: 0 }}>
{`{
  "success": true,
  "seed_used": 42,
  "experiment_type": "B2",
  "metrics": {
    "total_vehicles_spawned": 142,
    "avg_speed_background": 3.42,
    "avg_travel_time_background": 88.2,
    "phantom_jams_detected": 1
  },
  "experiment_results": {
    "subject_travel_time": 61.8,
    "personal_time_saved": 16.7,
    "social_cost_total_delay": 84.6,
    "selfishness_ratio": 0.197
  }
}`}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
