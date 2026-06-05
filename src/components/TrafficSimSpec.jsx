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
  const [density, setDensity] = useState(0.12);
  const [steps, setSteps] = useState(800);
  const [expType, setExpType] = useState("B2"); // 'custom', 'A', 'B1', 'B2'
  const [deltaT, setDeltaT] = useState(30);
  const [pChangeBg, setPChangeBg] = useState(0.1);
  const [pChangeSub, setPChangeSub] = useState(1.0);
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
      backgroundDensity: density,
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
        subject_spawn_tick: 70
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

  useEffect(() => {
    initializeSimulation();
    return () => {
      if (animationRef.current) clearInterval(animationRef.current);
    };
  }, [segLength, density, expType, deltaT, pChangeBg, pChangeSub, seed, signalMode, revModeH, revModeV]);

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
    const lanesPerDir = 3;
    const ROAD_W = C * lanesPerDir * 2 + LANE_GAP * 5;
    const PAD = 20;

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
    const hRoadY = (r) => PAD + g.vInt[r] * C + C / 2 - ROAD_W / 2;
    const vRoadX = (c) => PAD + g.hInt[c] * C + C / 2 - ROAD_W / 2;

    // Draw Roads (horizontal and vertical)
    ctx.fillStyle = "#161b22";
    for (let r = 0; r < g.NUM_H; r++) {
      ctx.fillRect(PAD, hRoadY(r), g.HLEN * C, ROAD_W);
    }
    for (let c = 0; c < g.NUM_V; c++) {
      ctx.fillRect(vRoadX(c), PAD, ROAD_W, g.VLEN * C);
    }

    // Draw Lane Dividers & ROC Markings
    ctx.lineWidth = 1;
    
    // Draw horizontal road markings
    for (let r = 0; r < g.NUM_H; r++) {
      const y0 = hRoadY(r);
      const fwdCount = sim.hFwd[r].length;
      const bwdCount = sim.hBwd[r].length;

      // 1. Draw Center Line / Reversible Lane Line
      const boundaryY = y0 + fwdCount * (C + LANE_GAP) - LANE_GAP / 2;
      if (sim.revModeH[r] === "none") {
        // Taiwan ROC Regulation: Single dashed yellow line (單黃虛線)
        ctx.strokeStyle = "#eab308";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(PAD, boundaryY);
        ctx.lineTo(PAD + g.HLEN * C, boundaryY);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // Taiwan ROC Regulation: Double dashed white lines (雙白虛線)
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(PAD, boundaryY - 1); ctx.lineTo(PAD + g.HLEN * C, boundaryY - 1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(PAD, boundaryY + 1); ctx.lineTo(PAD + g.HLEN * C, boundaryY + 1); ctx.stroke();
        ctx.setLineDash([]);
      }
      
      // 2. Draw lane lines (white dashed, turning solid near intersections)
      ctx.lineWidth = 0.8;
      // hFwd lane dividers
      for (let l = 1; l < fwdCount; l++) {
        const yL = y0 + l * (C + LANE_GAP) - LANE_GAP / 2;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(PAD, yL); ctx.lineTo(PAD + g.HLEN * C, yL); ctx.stroke();
        
        // Solid white line near intersection approaches (禁止跨越車道線)
        ctx.strokeStyle = "#ffffff";
        ctx.setLineDash([]);
        g.hInt.forEach(cell => {
          const start = PAD + Math.max(0, cell - 6) * C;
          const end = PAD + (cell - 1) * C;
          ctx.beginPath(); ctx.moveTo(start, yL); ctx.lineTo(end, yL); ctx.stroke();
        });
      }
      // hBwd lane dividers
      for (let l = 1; l < bwdCount; l++) {
        const yL = y0 + (fwdCount + l) * (C + LANE_GAP) - LANE_GAP / 2;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(PAD, yL); ctx.lineTo(PAD + g.HLEN * C, yL); ctx.stroke();
        
        ctx.strokeStyle = "#ffffff";
        ctx.setLineDash([]);
        g.hInt.forEach(cell => {
          const mirrorCell = mirror(cell, g.HLEN);
          const start = PAD + (mirrorCell + 1) * C;
          const end = PAD + Math.min(g.HLEN, mirrorCell + 6) * C;
          ctx.beginPath(); ctx.moveTo(start, yL); ctx.lineTo(end, yL); ctx.stroke();
        });
      }

      // 3. Draw Stop Lines (白實線)
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      g.hInt.forEach(cell => {
        if (!g.present[r][g.hInt.indexOf(cell)]) return;
        // hFwd stop line
        const xFwd = PAD + (cell - 1) * C + C;
        ctx.beginPath(); ctx.moveTo(xFwd, y0); ctx.lineTo(xFwd, y0 + fwdCount * (C + LANE_GAP) - LANE_GAP); ctx.stroke();
        // hBwd stop line
        const xBwd = PAD + mirror(cell, g.HLEN) * C;
        ctx.beginPath(); ctx.moveTo(xBwd, y0 + fwdCount * (C + LANE_GAP)); ctx.lineTo(xBwd, y0 + ROAD_W); ctx.stroke();
      });

      // 4. Draw Lane Direction Arrows
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.font = "7px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      g.hInt.forEach(cell => {
        if (!g.present[r][g.hInt.indexOf(cell)]) return;
        // hFwd Arrows (driver goes East ->)
        const xArrow = PAD + (cell - 3) * C + C / 2;
        for (let l = 0; l < fwdCount; l++) {
          let arrow = "→";
          if (l === 0) arrow = "↑"; // Left turn is North on screen (Up)
          else if (l === fwdCount - 1) arrow = "↓"; // Right turn is South on screen (Down)
          ctx.fillText(arrow, xArrow, y0 + l * (C + LANE_GAP) + C / 2);
        }
        // hBwd Arrows (driver goes West <-)
        const xArrowBwd = PAD + (mirror(cell, g.HLEN) + 3) * C + C / 2;
        for (let l = 0; l < bwdCount; l++) {
          let arrow = "←";
          if (l === 0) arrow = "↓"; // Left turn is South on screen (Down)
          else if (l === bwdCount - 1) arrow = "↑"; // Right turn is North on screen (Up)
          ctx.fillText(arrow, xArrowBwd, y0 + (fwdCount + l) * (C + LANE_GAP) + C / 2);
        }
      });
    }

    // Draw vertical road markings
    for (let c = 0; c < g.NUM_V; c++) {
      const x0 = vRoadX(c);
      const fwdCount = sim.vFwd[c].length;
      const bwdCount = sim.vBwd[c].length;

      // 1. Center Line / Reversible Lane Line
      const boundaryX = x0 + fwdCount * (C + LANE_GAP) - LANE_GAP / 2;
      if (sim.revModeV[c] === "none") {
        ctx.strokeStyle = "#eab308";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(boundaryX, PAD); ctx.lineTo(boundaryX, PAD + g.VLEN * C); ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(boundaryX - 1, PAD); ctx.lineTo(boundaryX - 1, PAD + g.VLEN * C); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(boundaryX + 1, PAD); ctx.lineTo(boundaryX + 1, PAD + g.VLEN * C); ctx.stroke();
        ctx.setLineDash([]);
      }

      // 2. Draw lane lines
      ctx.lineWidth = 0.8;
      // vFwd lane dividers
      for (let l = 1; l < fwdCount; l++) {
        const xL = x0 + l * (C + LANE_GAP) - LANE_GAP / 2;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(xL, PAD); ctx.lineTo(xL, PAD + g.VLEN * C); ctx.stroke();
        
        ctx.strokeStyle = "#ffffff";
        ctx.setLineDash([]);
        g.vInt.forEach(cell => {
          const start = PAD + Math.max(0, cell - 6) * C;
          const end = PAD + (cell - 1) * C;
          ctx.beginPath(); ctx.moveTo(xL, start); ctx.lineTo(xL, end); ctx.stroke();
        });
      }
      // vBwd lane dividers
      for (let l = 1; l < bwdCount; l++) {
        const xL = x0 + (fwdCount + l) * (C + LANE_GAP) - LANE_GAP / 2;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(xL, PAD); ctx.lineTo(xL, PAD + g.VLEN * C); ctx.stroke();
        
        ctx.strokeStyle = "#ffffff";
        ctx.setLineDash([]);
        g.vInt.forEach(cell => {
          const mirrorCell = mirror(cell, g.VLEN);
          const start = PAD + (mirrorCell + 1) * C;
          const end = PAD + Math.min(g.VLEN, mirrorCell + 6) * C;
          ctx.beginPath(); ctx.moveTo(xL, start); ctx.lineTo(xL, end); ctx.stroke();
        });
      }

      // 3. Draw Stop Lines
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      g.vInt.forEach(cell => {
        if (!g.present[g.vInt.indexOf(cell)][c]) return;
        // vFwd stop line
        const yFwd = PAD + (cell - 1) * C + C;
        ctx.beginPath(); ctx.moveTo(x0, yFwd); ctx.lineTo(x0 + fwdCount * (C + LANE_GAP) - LANE_GAP, yFwd); ctx.stroke();
        // vBwd stop line
        const yBwd = PAD + mirror(cell, g.VLEN) * C;
        ctx.beginPath(); ctx.moveTo(x0 + fwdCount * (C + LANE_GAP), yBwd); ctx.lineTo(x0 + ROAD_W, yBwd); ctx.stroke();
      });

      // 4. Draw Lane Direction Arrows
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.font = "7px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      g.vInt.forEach(cell => {
        if (!g.present[g.vInt.indexOf(cell)][c]) return;
        // vFwd Arrows (driver goes South |v)
        const yArrow = PAD + (cell - 3) * C + C / 2;
        for (let l = 0; l < fwdCount; l++) {
          let arrow = "↓";
          if (l === 0) arrow = "→"; // Left turn is East on screen (Right)
          else if (l === fwdCount - 1) arrow = "←"; // Right turn is West on screen (Left)
          ctx.fillText(arrow, x0 + l * (C + LANE_GAP) + C / 2, yArrow);
        }
        // vBwd Arrows (driver goes North ^|)
        const yArrowBwd = PAD + (mirror(cell, g.VLEN) + 3) * C + C / 2;
        for (let l = 0; l < bwdCount; l++) {
          let arrow = "↑";
          if (l === 0) arrow = "←"; // Left turn is West on screen (Left)
          else if (l === bwdCount - 1) arrow = "→"; // Right turn is East on screen (Right)
          ctx.fillText(arrow, x0 + (fwdCount + l) * (C + LANE_GAP) + C / 2, yArrowBwd);
        }
      });
    }

    // Draw Traffic Lights
    for (let r = 0; r < g.NUM_H; r++) {
      for (let c = 0; c < g.NUM_V; c++) {
        if (!g.present[r][c]) continue;
        const cx = vRoadX(c) + ROAD_W / 2;
        const cy = hRoadY(r) + ROAD_W / 2;
        const hg = sim.isHGreen(r, c);

        ctx.fillStyle = hg ? theme.success : theme.danger;
        ctx.beginPath();
        ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw Vehicles
    activeVehicles.forEach(car => {
      const roadType = car.roadType;
      const idx = car.roadIdx;
      const lane = car.lane;
      const pos = car.pos;

      let px = 0;
      let py = 0;

      const fwdCountH = sim.hFwd[idx] ? sim.hFwd[idx].length : 3;
      const fwdCountV = sim.vFwd[idx] ? sim.vFwd[idx].length : 3;

      // Coordinate matching
      if (roadType === 'hFwd') {
        px = PAD + pos * C;
        py = hRoadY(idx) + lane * (C + LANE_GAP);
      } else if (roadType === 'hBwd') {
        px = PAD + mirror(pos, g.HLEN) * C;
        py = hRoadY(idx) + (fwdCountH + lane) * (C + LANE_GAP);
      } else if (roadType === 'vFwd') {
        px = vRoadX(idx) + lane * (C + LANE_GAP);
        py = PAD + pos * C;
      } else if (roadType === 'vBwd') {
        px = vRoadX(idx) + (fwdCountV + lane) * (C + LANE_GAP);
        py = PAD + mirror(pos, g.VLEN) * C;
      }

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
    const ROAD_W = C * 6 + LANE_GAP * 5;
    const hRoadY = (r) => PAD + g.vInt[r] * C - C;
    const vRoadX = (c) => PAD + g.hInt[c] * C - C;

    let closestCar = null;
    let minDist = 15; // Max click distance 15px

    activeVehicles.forEach(car => {
      let px = 0, py = 0;
      if (car.roadType === 'hFwd') {
        px = PAD + car.pos * C;
        py = hRoadY(car.roadIdx) + car.lane * (C + LANE_GAP);
      } else if (car.roadType === 'hBwd') {
        px = PAD + mirror(car.pos, g.HLEN) * C;
        py = hRoadY(car.roadIdx) + (3 + car.lane) * (C + LANE_GAP);
      } else if (car.roadType === 'vFwd') {
        px = vRoadX(car.roadIdx) + car.lane * (C + LANE_GAP);
        py = PAD + car.pos * C;
      } else if (car.roadType === 'vBwd') {
        px = vRoadX(car.roadIdx) + (3 + car.lane) * (C + LANE_GAP);
        py = PAD + mirror(car.pos, g.VLEN) * C;
      }

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
      const res = runExperimentASweep(seed, deltaT, density);
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
        backgroundDensity: 0.18,
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
        backgroundDensity: 0.18,
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
        backgroundDensity: 0.18,
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
                <label style={{ display: "block", fontSize: "12px", color: theme.textMuted, marginBottom: "4px" }}>車流密度: {(density * 100).toFixed(0)}%</label>
                <input
                  type="range"
                  min={0.05}
                  max={0.3}
                  step={0.01}
                  value={density}
                  onChange={(e) => setDensity(Number(e.target.value))}
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
                  <option value="none">常態配置 (3+3 單黃虛線)</option>
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
