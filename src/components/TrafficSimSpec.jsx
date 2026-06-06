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
  // Safely check and retrieve build metadata injected during compilation
  const buildInfo = typeof __BUILD_METADATA__ !== "undefined" ? __BUILD_METADATA__ : {
    version: "v1.7.2",
    commitHash: "Dev",
    commitDate: "N/A",
    buildTime: "Local Build"
  };

  const [activeTab, setActiveTab] = useState("visualizer");

  // Simulation State
  const [seed, setSeed] = useState(42);
  const [segLength, setSegLength] = useState(20);
  const [densityHFwd, setDensityHFwd] = useState(0.12);
  const [densityHBwd, setDensityHBwd] = useState(0.12);
  const [density, setDensity] = useState(0.15);
  const [steps, setSteps] = useState(800);
  const [expType, setExpType] = useState("B2"); // 'custom', 'A', 'B1', 'B2'
  const [deltaT, setDeltaT] = useState(30);
  const [pChangeBg, setPChangeBg] = useState(0.1);
  const [pChangeSub, setPChangeSub] = useState(1.0);
  const [turnProbability, setTurnProbability] = useState(0.15);
  const [isPlaying, setIsPlaying] = useState(false);
  const [simSpeed, setSimSpeed] = useState(100); // ms per tick

  const [signalMode, setSignalMode] = useState("alternating");
  const [hRoads, setHRoads] = useState([
    { tier: "minor",     inflowFwd: 0.08, inflowBwd: 0.08, revMode: "none" },
    { tier: "primary",   inflowFwd: 0.12, inflowBwd: 0.12, revMode: "none" },
    { tier: "secondary", inflowFwd: 0.12, inflowBwd: 0.12, revMode: "none" },
    { tier: "primary",   inflowFwd: 0.12, inflowBwd: 0.12, revMode: "none" },
    { tier: "minor",     inflowFwd: 0.08, inflowBwd: 0.08, revMode: "none" },
  ]);
  const [vRoads, setVRoads] = useState([
    { tier: "minor",     inflowFwd: 0.08, inflowBwd: 0.08, revMode: "none" },
    { tier: "primary",   inflowFwd: 0.12, inflowBwd: 0.12, revMode: "none" },
    { tier: "minor",     inflowFwd: 0.08, inflowBwd: 0.08, revMode: "none" },
    { tier: "secondary", inflowFwd: 0.12, inflowBwd: 0.12, revMode: "none" },
    { tier: "primary",   inflowFwd: 0.12, inflowBwd: 0.12, revMode: "none" },
    { tier: "minor",     inflowFwd: 0.08, inflowBwd: 0.08, revMode: "none" },
  ]);

  // Dynamic Sim Instances
  const [sim, setSim] = useState(null);
  const [tick, setTick] = useState(0);
  const [activeVehicles, setActiveVehicles] = useState([]);
  const [arrivedCount, setArrivedCount] = useState(0);
  const [metrics, setMetrics] = useState({});
  const [expResults, setExpResults] = useState(null);
  const [trackedVehicleId, setTrackedVehicleId] = useState(null);

  // Batch Simulation State
  const [batchSeeds, setBatchSeeds] = useState("42, 100, 2026, 999");
  const [batchSignalModes, setBatchSignalModes] = useState(["all_sync", "alternating", "green_wave"]);
  const [batchDensities, setBatchDensities] = useState([0.12, 0.16, 0.20]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResults, setBatchResults] = useState([]);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });

  const runBatchSimulation = async () => {
    if (batchRunning) return;
    setBatchRunning(true);
    setBatchResults([]);
    
    const seeds = batchSeeds.split(",").map(s => parseInt(s.trim())).filter(s => !isNaN(s));
    const combinations = [];
    
    for (const seedVal of seeds) {
      for (const modeVal of batchSignalModes) {
        for (const densityVal of batchDensities) {
          combinations.push({ seed: seedVal, signalMode: modeVal, density: densityVal });
        }
      }
    }
    
    if (combinations.length === 0) {
      alert("請至少選擇或設定一組種子、號誌模式與背景密度！");
      setBatchRunning(false);
      return;
    }
    
    setBatchProgress({ current: 0, total: combinations.length });
    
    const results = [];
    for (let i = 0; i < combinations.length; i++) {
      const combo = combinations[i];
      setBatchProgress({ current: i + 1, total: combinations.length });
      
      // Yield control to the browser to render progress update
      await new Promise(resolve => setTimeout(resolve, 30));
      
      try {
        const sim = new GridSimulation({
          seed: combo.seed,
          hRoads: hRoads,
          vRoads: vRoads,
          intersectionRules: intersectionRules,
          simulationSteps: steps,
          experimentType: expType,
          exportTrajectories: false,
          segLength: segLength,
          signalMode: combo.signalMode,
          backgroundDensity: combo.density,
          params: {
            delta_t: deltaT,
            p_change_background: pChangeBg,
            p_change_subject: pChangeSub,
            turn_probability: turnProbability
          }
        });
        
        const simRes = sim.run();
        const runMetrics = simRes.metrics;
        const isAnomalous = runMetrics.phantom_jams_detected > 3 || runMetrics.avg_delay_background > 150;
        
        results.push({
          id: i + 1,
          seed: combo.seed,
          signalMode: combo.signalMode,
          density: combo.density,
          throughput: runMetrics.arrived_count ?? 0,
          avgSpeed: runMetrics.avg_speed_background ?? 0,
          avgDelay: runMetrics.avg_delay_background ?? 0,
          phantomJams: runMetrics.phantom_jams_detected ?? 0,
          isAnomalous,
          hRoads: JSON.parse(JSON.stringify(hRoads)),
          vRoads: JSON.parse(JSON.stringify(vRoads)),
          intersectionRules: JSON.parse(JSON.stringify(intersectionRules)),
          steps: steps
        });
        
        setBatchResults([...results]);
      } catch (err) {
        console.error("Batch simulation run error:", err);
      }
    }
    
    setBatchRunning(false);
  };

  const loadRunIntoVisualizer = (run) => {
    setSeed(run.seed);
    setDensity(run.density);
    setSignalMode(run.signalMode);
    if (run.steps) setSteps(run.steps);
    if (run.hRoads) setHRoads(run.hRoads);
    if (run.vRoads) setVRoads(run.vRoads);
    if (run.intersectionRules) setIntersectionRules(run.intersectionRules);
    
    setActiveTab("visualizer");
    setIsPlaying(false);
    if (animationRef.current) clearInterval(animationRef.current);
    
    setTimeout(() => {
      initializeSimulation();
      setIsPlaying(true);
      animationRef.current = setInterval(stepSimulation, simSpeed);
    }, 200);
  };

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

  const [intersectionRules, setIntersectionRules] = useState({});
  const [selectedIntersection, setSelectedIntersection] = useState(null);
  const [selectedRoadConfig, setSelectedRoadConfig] = useState(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [importExportText, setImportExportText] = useState("");
  const skipReinitRef = useRef(false);

  // Initialize Simulation on config change
  const initializeSimulation = () => {
    setIsPlaying(false);
    if (animationRef.current) clearInterval(animationRef.current);
    
    // Create new simulation instance
    const s = new GridSimulation({
      seed: seed,
      hRoads: hRoads,
      vRoads: vRoads,
      intersectionRules: intersectionRules,
      simulationSteps: steps,
      experimentType: expType,
      exportTrajectories: true,
      segLength: segLength,
      signalMode: signalMode,
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

  const getVehicleCoords = (roadType, idx, lane, pos, currentSim, car = null) => {
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

    if (roadType.startsWith("alley")) {
      const isMeeting = car ? !!car.isMeeting : false;
      const isFwd = idx === 0;

      if (roadType === "alleyA" || roadType === "alleyC" || roadType === "alleyE") {
        let y0 = 0;
        let xStart = 0;
        let xEnd = 0;

        if (roadType === "alleyA") {
          y0 = (hRoadY(0) + hRoadY(1)) / 2;
          xStart = vRoadX(2);
          xEnd = vRoadX(3) + getRoadWidthV(3);
        } else if (roadType === "alleyC") {
          y0 = (hRoadY(3) + hRoadY(4)) / 2;
          xStart = vRoadX(4);
          xEnd = vRoadX(5) + getRoadWidthV(5);
        } else {
          y0 = (hRoadY(2) + hRoadY(3)) / 2;
          xStart = vRoadX(0);
          xEnd = vRoadX(1) + getRoadWidthV(1);
        }

        const roadLen = xEnd - xStart;
        const alleyObj = currentSim.alleys ? currentSim.alleys.find(a => a.id === roadType) : null;
        const cells = alleyObj ? alleyObj.len : 15;

        if (isFwd) {
          px = xStart + pos * (roadLen - C) / Math.max(1, cells - 1);
          py = isMeeting ? (y0 + C + LANE_GAP) : (y0 + (C + LANE_GAP) / 2 - C / 2);
        } else {
          px = xEnd - pos * (roadLen - C) / Math.max(1, cells - 1) - C;
          py = isMeeting ? y0 : (y0 + (C + LANE_GAP) / 2 - C / 2);
        }
      } else {
        // Vertical alleys: Alley B, D, F
        let x0 = 0;
        let yStart = 0;
        let yEnd = 0;

        if (roadType === "alleyB") {
          x0 = (vRoadX(0) + vRoadX(1)) / 2;
          yStart = hRoadY(1);
          yEnd = hRoadY(2) + getRoadWidthH(2);
        } else if (roadType === "alleyD") {
          x0 = (vRoadX(3) + vRoadX(4)) / 2;
          yStart = hRoadY(2);
          yEnd = hRoadY(3) + getRoadWidthH(3);
        } else {
          x0 = (vRoadX(4) + vRoadX(5)) / 2;
          yStart = hRoadY(0);
          yEnd = hRoadY(1) + getRoadWidthH(1);
        }

        const roadLen = yEnd - yStart;
        const alleyObj = currentSim.alleys ? currentSim.alleys.find(a => a.id === roadType) : null;
        const cells = alleyObj ? alleyObj.len : 15;

        if (isFwd) {
          py = yStart + pos * (roadLen - C) / Math.max(1, cells - 1);
          px = isMeeting ? x0 : (x0 + (C + LANE_GAP) / 2 - C / 2);
        } else {
          py = yEnd - pos * (roadLen - C) / Math.max(1, cells - 1) - C;
          px = isMeeting ? (x0 + C + LANE_GAP) : (x0 + (C + LANE_GAP) / 2 - C / 2);
        }
      }

      return { px, py };
    }

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

  const getLaneArrowType = (roadType, idx, lane, nextInterIdx) => {
    const isH = roadType === 'hFwd' || roadType === 'hBwd';
    const interR = isH ? idx : nextInterIdx;
    const interC = isH ? nextInterIdx : idx;
    const key = `${interR}-${interC}`;
    const customRules = intersectionRules[key]?.[roadType];
    if (customRules && customRules[lane]) {
      return customRules[lane];
    }
    const totalLanes = sim ? sim.getRoad(roadType, idx).length : 3;
    if (totalLanes === 1) return 'all';
    if (totalLanes === 2) {
      return lane === 0 ? 'left' : 'right';
    }
    if (lane === 0) return 'left';
    if (lane === totalLanes - 1) return 'right';
    return 'straight';
  };

  // Handle URL config loading on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const configParam = params.get("config");
    if (configParam) {
      try {
        let decoded = "";
        try {
          decoded = atob(configParam);
        } catch (e) {
          decoded = decodeURIComponent(configParam);
        }
        const parsed = JSON.parse(decoded);
        
        if (parsed.seed !== undefined) setSeed(Number(parsed.seed));
        if (parsed.steps !== undefined) setSteps(Number(parsed.steps));
        if (parsed.density !== undefined) setDensity(Number(parsed.density));
        if (parsed.densityHFwd !== undefined) setDensityHFwd(Number(parsed.densityHFwd));
        if (parsed.densityHBwd !== undefined) setDensityHBwd(Number(parsed.densityHBwd));
        if (parsed.deltaT !== undefined) setDeltaT(Number(parsed.deltaT));
        if (parsed.pChangeBg !== undefined) setPChangeBg(Number(parsed.pChangeBg));
        if (parsed.pChangeSub !== undefined) setPChangeSub(Number(parsed.pChangeSub));
        if (parsed.turnProbability !== undefined) setTurnProbability(Number(parsed.turnProbability));
        if (parsed.signalMode !== undefined) setSignalMode(parsed.signalMode);
        if (parsed.hRoads !== undefined) setHRoads(parsed.hRoads);
        if (parsed.vRoads !== undefined) setVRoads(parsed.vRoads);
        if (parsed.intersectionRules !== undefined) setIntersectionRules(parsed.intersectionRules);
        
        setTimeout(() => {
          initializeSimulation();
        }, 150);
        
        console.log("Successfully loaded simulation configuration from URL parameters:", parsed);
      } catch (err) {
        console.error("Failed to parse URL config:", err);
      }
    }
  }, []);

  useEffect(() => {
    if (skipReinitRef.current) {
      skipReinitRef.current = false;
      return;
    }
    initializeSimulation();
    return () => {
      if (animationRef.current) clearInterval(animationRef.current);
    };
  }, [segLength, expType, deltaT, pChangeBg, pChangeSub, seed, signalMode, turnProbability, hRoads, vRoads]);

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

    const isPrimaryH = (r) => r === 1 || r === 3;
    const isPrimaryV = (c) => c === 1 || c === 4;
    const isSecondaryH = (r) => r === 2;
    const isSecondaryV = (c) => c === 3;

    // Draw Roads (horizontal and vertical) in a single seamless asphalt color
    ctx.fillStyle = "#181f2d";
    for (let r = 0; r < g.NUM_H; r++) {
      ctx.fillRect(PAD, hRoadY(r), g.HLEN * C, getRoadWidthH(r));
    }
    for (let c = 0; c < g.NUM_V; c++) {
      ctx.fillRect(vRoadX(c), PAD, getRoadWidthV(c), g.VLEN * C);
    }

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
      
      const getAlleySkipsH = (r) => {
        return [];
      };

      const drawSegment = (x1, x2) => {
        const skips = getAlleySkipsH(r);
        let currX = x1;
        for (let skip of skips) {
          if (skip.x >= currX && skip.x < x2) {
            if (currX < skip.x) {
              ctx.beginPath();
              ctx.moveTo(currX, y);
              ctx.lineTo(skip.x, y);
              ctx.stroke();
            }
            currX = skip.x + skip.w;
          }
        }
        if (currX < x2) {
          ctx.beginPath();
          ctx.moveTo(currX, y);
          ctx.lineTo(x2, y);
          ctx.stroke();
        }
      };

      let currentX = PAD;
      for (let c = 0; c < g.NUM_V; c++) {
        const xStart = vRoadX(c);
        const isPresent = g.present[r][c];
        if (isPresent) {
          if (currentX < xStart) {
            drawSegment(currentX, xStart);
          }
          currentX = xStart + getRoadWidthV(c);
        }
      }
      if (currentX < PAD + g.HLEN * C) {
        drawSegment(currentX, PAD + g.HLEN * C);
      }
      ctx.setLineDash([]);
    };

    // Helper to draw vertical lines in segments
    const drawVerticalLineInSegments = (c, x, strokeStyle, lineWidth, lineDash = []) => {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash(lineDash);
      
      const getAlleySkipsV = (c) => {
        return [];
      };

      const drawSegment = (y1, y2) => {
        const skips = getAlleySkipsV(c);
        let currY = y1;
        for (let skip of skips) {
          if (skip.y >= currY && skip.y < y2) {
            if (currY < skip.y) {
              ctx.beginPath();
              ctx.moveTo(x, currY);
              ctx.lineTo(x, skip.y);
              ctx.stroke();
            }
            currY = skip.y + skip.h;
          }
        }
        if (currY < y2) {
          ctx.beginPath();
          ctx.moveTo(x, currY);
          ctx.lineTo(x, y2);
          ctx.stroke();
        }
      };

      let currentY = PAD;
      for (let r = 0; r < g.NUM_H; r++) {
        const yStart = hRoadY(r);
        const isPresent = g.present[r][c];
        if (isPresent) {
          if (currentY < yStart) {
            drawSegment(currentY, yStart);
          }
          currentY = yStart + getRoadWidthH(r);
        }
      }
      if (currentY < PAD + g.VLEN * C) {
        drawSegment(currentY, PAD + g.VLEN * C);
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
        drawHorizontalLineInSegments(r, boundaryY - 1, "#eab308", 1, [4, 4]);
        drawHorizontalLineInSegments(r, boundaryY + 1, "#eab308", 1, [4, 4]);
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
          const endX = Math.min(PAD + g.HLEN * C, stopX + 8 * C);
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
          const startX = Math.max(PAD, stopX - 8 * C);
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
          const type = getLaneArrowType('hBwd', r, l, c);
          drawVectorArrow(xArrowBwd, y0 + l * (C + LANE_GAP) + C / 2, Math.PI, type);
        }

        // hFwd Arrows (driver goes East ->, rot = 0, bottom half)
        const xArrow = vRoadX(c) - 3 * C + C / 2;
        for (let l = 0; l < fwdCount; l++) {
          const type = getLaneArrowType('hFwd', r, l, c);
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
        drawVerticalLineInSegments(c, boundaryX - 1, "#eab308", 1, [4, 4]);
        drawVerticalLineInSegments(c, boundaryX + 1, "#eab308", 1, [4, 4]);
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
          const startY = Math.max(PAD, stopY - 8 * C);
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
          const endY = Math.min(PAD + g.VLEN * C, stopY + 8 * C);
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
          const type = getLaneArrowType('vFwd', c, l, r);
          drawVectorArrow(x0 + l * (C + LANE_GAP) + C / 2, yArrow, Math.PI / 2, type);
        }

        // vBwd Arrows (driver goes North ^|, rot = Math.PI * 1.5, right half)
        const yArrowBwd = hRoadY(r) + getRoadWidthH(r) + 2 * C + C / 2;
        for (let l = 0; l < bwdCount; l++) {
          const type = getLaneArrowType('vBwd', c, l, r);
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

    // Draw Inspected Vehicle Trajectory (History Path)
    const inspectedCar = getTrackedVehicleDetails();
    if (trackedVehicleId !== null && inspectedCar && inspectedCar.posProfile) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(192, 132, 252, 0.75)"; // Translucent Purple
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 3]);
      inspectedCar.posProfile.forEach((pt, idx) => {
        const [t, pos, lane, roadType, roadIdx] = pt;
        const { px, py } = getVehicleCoords(roadType, roadIdx, lane, pos, sim, null);
        const cx = px + C / 2;
        const cy = py + C / 2;
        if (idx === 0) {
          ctx.moveTo(cx, cy);
        } else {
          ctx.lineTo(cx, cy);
        }
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw Vehicles
    activeVehicles.forEach(car => {
      const roadType = car.roadType;
      const idx = car.roadIdx;
      const lane = car.lane;
      const pos = car.pos;

      const { px, py } = getVehicleCoords(roadType, idx, lane, pos, sim, car);

      // Highlight tracked car
      if (trackedVehicleId === car.id) {
        ctx.strokeStyle = theme.purple;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px - 1.5, py - 1.5, C + 3, C + 3);
      }

      // Color Coding
      let grad = ctx.createLinearGradient(px, py, px + C, py + C);
      if (car.type === 'emergency') {
        grad.addColorStop(0, "#ffedd5");
        grad.addColorStop(1, "#ea580c");
        
        // Flashing blue siren
        if (tick % 2 === 0) {
          ctx.fillStyle = "#3b82f6";
          ctx.beginPath();
          ctx.arc(px + C/2, py - 2, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (car.isVampire) {
        // Bright Crimson Red for Vampire/Tailgating vehicles
        grad.addColorStop(0, "#ef4444");
        grad.addColorStop(1, "#991b1b");
      } else if (car.type === 'subject') {
        if (expType === 'B1') {
          // Bright Neon Amber/Gold for Weaving Demon (切車魔人)
          grad.addColorStop(0, "#fbbf24");
          grad.addColorStop(1, "#b45309");
        } else {
          // Pink/Magenta for other subject modes
          grad.addColorStop(0, "#e879f9");
          grad.addColorStop(1, "#a21caf");
        }
      } else {
        // Standard background cars (Cyan)
        grad.addColorStop(0, "#22d3ee");
        grad.addColorStop(1, "#0369a1");
      }

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(px, py, C - 0.5, C - 0.5, 1);
      ctx.fill();
    });

    // 5. Draw Road Entrance Configuration Dots (Amber)
    ctx.fillStyle = "#c5a059";
    for (let r = 0; r < g.NUM_H; r++) {
      // Horizontal Forward entrance (West end, bottom half)
      const yFwd = hRoadY(r) + getRoadWidthH(r) - 5;
      ctx.beginPath(); ctx.arc(PAD - 8, yFwd, 3, 0, Math.PI * 2); ctx.fill();

      // Horizontal Backward entrance (East end, top half)
      const yBwd = hRoadY(r) + 5;
      ctx.beginPath(); ctx.arc(PAD + g.HLEN * C + 8, yBwd, 3, 0, Math.PI * 2); ctx.fill();
    }
    for (let c = 0; c < g.NUM_V; c++) {
      // Vertical Forward entrance (North end, left half)
      const xFwd = vRoadX(c) + 5;
      ctx.beginPath(); ctx.arc(xFwd, PAD - 8, 3, 0, Math.PI * 2); ctx.fill();

      // Vertical Backward entrance (South end, right half)
      const xBwd = vRoadX(c) + getRoadWidthV(c) - 5;
      ctx.beginPath(); ctx.arc(xBwd, PAD + g.VLEN * C + 8, 3, 0, Math.PI * 2); ctx.fill();
    }

    // 6. Draw Intersection Customization Center Dots (Teal)
    ctx.fillStyle = "rgba(102, 252, 241, 0.6)";
    for (let r = 0; r < g.NUM_H; r++) {
      for (let c = 0; c < g.NUM_V; c++) {
        const cx = vRoadX(c) + getRoadWidthV(c) / 2;
        const cy = hRoadY(r) + getRoadWidthH(r) / 2;
        ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
      }
    }

  }, [tick, activeVehicles, sim, trackedVehicleId, intersectionRules]);

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
      const { px, py } = getVehicleCoords(car.roadType, car.roadIdx, car.lane, car.pos, sim, car);

      const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
      if (dist < minDist) {
        minDist = dist;
        closestCar = car;
      }
    });

    if (closestCar) {
      setTrackedVehicleId(closestCar.id);
      setSelectedIntersection(null);
      setSelectedRoadConfig(null);
    } else {
      setTrackedVehicleId(null);
      
      // 1. Check if clicked near a Road Entrance Dot (Amber, radius 3px)
      let closestRoad = null;
      let minRoadDist = 12; // Click radius
      for (let r = 0; r < g.NUM_H; r++) {
        // Horizontal Forward entrance (West end)
        const yFwd = hRoadY(r) + getRoadWidthH(r) - 5;
        let dist = Math.sqrt((x - (PAD - 8)) ** 2 + (y - yFwd) ** 2);
        if (dist < minRoadDist) {
          minRoadDist = dist;
          closestRoad = { roadType: 'hFwd', idx: r, px: PAD - 8, py: yFwd };
        }
        // Horizontal Backward entrance (East end)
        const yBwd = hRoadY(r) + 5;
        dist = Math.sqrt((x - (PAD + g.HLEN * C + 8)) ** 2 + (y - yBwd) ** 2);
        if (dist < minRoadDist) {
          minRoadDist = dist;
          closestRoad = { roadType: 'hBwd', idx: r, px: PAD + g.HLEN * C + 8, py: yBwd };
        }
      }
      for (let c = 0; c < g.NUM_V; c++) {
        // Vertical Forward entrance (North end)
        const xFwd = vRoadX(c) + 5;
        let dist = Math.sqrt((x - xFwd) ** 2 + (y - (PAD - 8)) ** 2);
        if (dist < minRoadDist) {
          minRoadDist = dist;
          closestRoad = { roadType: 'vFwd', idx: c, px: xFwd, py: PAD - 8 };
        }
        // Vertical Backward entrance (South end)
        const xBwd = vRoadX(c) + getRoadWidthV(c) - 5;
        dist = Math.sqrt((x - xBwd) ** 2 + (y - (PAD + g.VLEN * C + 8)) ** 2);
        if (dist < minRoadDist) {
          minRoadDist = dist;
          closestRoad = { roadType: 'vBwd', idx: c, px: xBwd, py: PAD + g.VLEN * C + 8 };
        }
      }

      if (closestRoad) {
        setSelectedRoadConfig(closestRoad);
        setSelectedIntersection(null);
        return;
      }

      // 2. Check if clicked near an Intersection center (Teal, radius 3px)
      let closestInter = null;
      let minInterDist = 15; // Click radius
      for (let r = 0; r < g.NUM_H; r++) {
        for (let c = 0; c < g.NUM_V; c++) {
          const cx = vRoadX(c) + getRoadWidthV(c) / 2;
          const cy = hRoadY(r) + getRoadWidthH(r) / 2;
          const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
          if (dist < minInterDist) {
            minInterDist = dist;
            closestInter = { r, c, px: cx, py: cy };
          }
        }
      }

      if (closestInter) {
        setSelectedIntersection(closestInter);
        setSelectedRoadConfig(null);
      } else {
        setSelectedIntersection(null);
        setSelectedRoadConfig(null);
      }
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
        hRoads: hRoads,
        vRoads: vRoads,
        seed: seed,
        experimentType: 'custom',
        params: { p_change_background: 0.1 }
      });
      const resCtrl = simCtrl.run();

      // 2. Weaving Scenario (Subject weaving, P_change = 1.0)
      const simWeave = new GridSimulation({
        simulationSteps: 800,
        hRoads: hRoads,
        vRoads: vRoads,
        seed: seed,
        experimentType: 'B1',
        params: { p_change_background: 0.1, p_change_subject: 1.0, subject_spawn_tick: 70 }
      });
      const resWeave = simWeave.run();

      // 3. Tailgating Scenario (Subject tailgating emergency vehicle)
      const simTailgate = new GridSimulation({
        simulationSteps: 800,
        hRoads: hRoads,
        vRoads: vRoads,
        seed: seed,
        experimentType: 'B2',
        params: { p_change_background: 0.1, p_change_subject: 1.0, emergency_spawn_tick: 50, subject_spawn_tick: 70 }
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
      padding: "12px",
      minHeight: "100vh",
      boxSizing: "border-box",
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
            }} title={`Built on: ${buildInfo.buildTime}`}>
              {buildInfo.version} ({buildInfo.commitHash})
            </span>
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
            { id: "batchSim", label: "自動化批量模擬" },
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
        <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: "16px" }}>
          {/* Controls Config */}
          <div style={{
            background: "rgba(31, 40, 51, 0.45)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "12px",
            padding: "16px",
            position: "sticky",
            top: "16px",
            maxHeight: "calc(100vh - 32px)",
            overflowY: "auto",
            overflowX: "hidden",
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


              {/* ─── 道路個別設定 Matrix ─── */}
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: "8px", paddingTop: "14px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: theme.primary, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "8px" }}>
                  道路個別設定 (Per-Road Config)
                </div>

                {/* Column headers */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "36px minmax(0,1.2fr) minmax(0,1.2fr) 60px 60px 42px",
                  gap: "4px",
                  alignItems: "center",
                  marginBottom: "4px",
                  padding: "0 4px",
                }}>
                  <span style={{ fontSize: "9px", color: theme.textMuted, textTransform: "uppercase" }}>道路</span>
                  <span style={{ fontSize: "9px", color: "#67e8f9", textTransform: "uppercase" }}>正向 →↓</span>
                  <span style={{ fontSize: "9px", color: "#f9a8d4", textTransform: "uppercase" }}>反向 ←↑</span>
                  <span style={{ fontSize: "9px", color: theme.textMuted, textTransform: "uppercase" }}>等級</span>
                  <span style={{ fontSize: "9px", color: theme.textMuted, textTransform: "uppercase" }}>調撥</span>
                  <span style={{ fontSize: "9px", color: theme.textMuted, textTransform: "uppercase", textAlign: "right" }}>操作</span>
                </div>

                {/* Separator */}
                <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: "6px" }} />

                {/* Horizontal Roads */}
                <div style={{ fontSize: "10px", fontWeight: "bold", color: theme.textLight, padding: "2px 4px", marginBottom: "4px" }}>水平道路 (Horizontal Roads)</div>
                {hRoads.map((road, idx) => {
                  const inflowFwd = road.inflowFwd;
                  const inflowBwd = road.inflowBwd;
                  const revMode   = road.revMode;
                  const isPrimary = road.tier === "primary";
                  const isSecondary = road.tier === "secondary";
                  const canReverse = isPrimary || isSecondary;
                  const tierColor  = isPrimary ? theme.primary : isSecondary ? "#a78bfa" : theme.textMuted;
                  const baseLabel  = isPrimary ? "3+3" : isSecondary ? "2+2" : "1+1";
                  const fwdPeak    = isPrimary ? "4+2" : isSecondary ? "3+1" : null;
                  const bwdPeak    = isPrimary ? "2+4" : isSecondary ? "1+3" : null;
                  const ic = (v) => v > 0.5 ? "#f87171" : v > 0.3 ? "#fbbf24" : theme.primary;

                  return (
                    <div key={`h-${idx}`} style={{
                      display: "grid",
                      gridTemplateColumns: "36px minmax(0,1.2fr) minmax(0,1.2fr) 60px 60px 42px",
                      gap: "4px",
                      alignItems: "center",
                      padding: "3px 4px",
                      borderRadius: "4px",
                      background: canReverse ? "rgba(102,252,241,0.03)" : "transparent",
                      marginBottom: "2px",
                    }}>
                      <span style={{ fontSize: "10px", fontWeight: 600, color: tierColor }}>H{idx}</span>

                      {/* Fwd slider */}
                      <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                        <input
                          type="range" min={0} max={1.0} step={0.02}
                          value={inflowFwd}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            const copy = [...hRoads];
                            copy[idx] = { ...copy[idx], inflowFwd: v };
                            setHRoads(copy);
                          }}
                          style={{ flex: 1, accentColor: ic(inflowFwd), height: "2px" }}
                        />
                        <span style={{ fontSize: "8px", color: ic(inflowFwd), fontWeight: 700, minWidth: "16px", textAlign: "right" }}>
                          {(inflowFwd * 100).toFixed(0)}
                        </span>
                      </div>

                      {/* Bwd slider */}
                      <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                        <input
                          type="range" min={0} max={1.0} step={0.02}
                          value={inflowBwd}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            const copy = [...hRoads];
                            copy[idx] = { ...copy[idx], inflowBwd: v };
                            setHRoads(copy);
                          }}
                          style={{ flex: 1, accentColor: ic(inflowBwd), height: "2px" }}
                        />
                        <span style={{ fontSize: "8px", color: ic(inflowBwd), fontWeight: 700, minWidth: "16px", textAlign: "right" }}>
                          {(inflowBwd * 100).toFixed(0)}
                        </span>
                      </div>

                      {/* Tier Selector */}
                      <select
                        value={road.tier}
                        onChange={(e) => {
                          const val = e.target.value;
                          const copy = [...hRoads];
                          copy[idx] = { ...copy[idx], tier: val, revMode: val === "minor" ? "none" : copy[idx].revMode };
                          setHRoads(copy);
                        }}
                        style={{
                          background: "#0d1117", border: "1px solid #30363d", color: "#fff",
                          padding: "1px 2px", borderRadius: "3px", fontSize: "8px", cursor: "pointer",
                        }}
                      >
                        <option value="minor">一般</option>
                        <option value="secondary">次要</option>
                        <option value="primary">主要</option>
                      </select>

                      {/* Rev-mode dropdown */}
                      {canReverse ? (
                        <select
                          value={revMode}
                          onChange={(e) => {
                            const copy = [...hRoads];
                            copy[idx] = { ...copy[idx], revMode: e.target.value };
                            setHRoads(copy);
                          }}
                          style={{
                            width: "100%", background: "#0d1117",
                            border: "1px solid #30363d", color: tierColor,
                            padding: "1px 2px", borderRadius: "3px",
                            cursor: "pointer", fontSize: "8px", fontWeight: 600,
                          }}
                        >
                          <option value="none">{baseLabel}</option>
                          <option value="peak_fwd">→ {fwdPeak}</option>
                          <option value="peak_bwd">← {bwdPeak}</option>
                        </select>
                      ) : (
                        <span style={{ fontSize: "8px", color: theme.textMuted, textAlign: "center" }}>—</span>
                      )}

                      {/* Actions */}
                      <div style={{ display: "flex", gap: "2px", justifyContent: "flex-end" }}>
                        <button
                          title="複製插入下方"
                          onClick={() => {
                            const copy = [...hRoads];
                            copy.splice(idx + 1, 0, { ...road });
                            setHRoads(copy);
                          }}
                          style={{
                            background: "rgba(102,252,241,0.1)", color: theme.primary, border: "none",
                            borderRadius: "3px", width: "16px", height: "16px", fontSize: "10px",
                            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center"
                          }}
                        >
                          +
                        </button>
                        <button
                          title="刪除道路"
                          disabled={hRoads.length <= 1}
                          onClick={() => {
                            const copy = [...hRoads];
                            copy.splice(idx, 1);
                            setHRoads(copy);
                          }}
                          style={{
                            background: hRoads.length <= 1 ? "rgba(255,255,255,0.05)" : "rgba(252,68,69,0.1)",
                            color: hRoads.length <= 1 ? theme.textMuted : theme.danger, border: "none",
                            borderRadius: "3px", width: "16px", height: "16px", fontSize: "10px",
                            cursor: hRoads.length <= 1 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center"
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}

                <button
                  onClick={() => {
                    const copy = [...hRoads];
                    copy.push({ tier: "minor", inflowFwd: 0.08, inflowBwd: 0.08, revMode: "none" });
                    setHRoads(copy);
                  }}
                  style={{
                    background: "rgba(102,252,241,0.08)", border: "1px dashed rgba(102,252,241,0.25)",
                    color: theme.primary, padding: "4px 8px", borderRadius: "6px", fontSize: "9px",
                    fontWeight: "bold", cursor: "pointer", marginTop: "4px", width: "100%", transition: "all 0.2s",
                    marginBottom: "12px"
                  }}
                >
                  ＋ 新增 H 路 (Add Horizontal Road)
                </button>

                <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: "6px" }} />

                {/* Vertical Roads */}
                <div style={{ fontSize: "10px", fontWeight: "bold", color: theme.textLight, padding: "2px 4px", marginBottom: "4px" }}>垂直道路 (Vertical Roads)</div>
                {vRoads.map((road, idx) => {
                  const inflowFwd = road.inflowFwd;
                  const inflowBwd = road.inflowBwd;
                  const revMode   = road.revMode;
                  const isPrimary = road.tier === "primary";
                  const isSecondary = road.tier === "secondary";
                  const canReverse = isPrimary || isSecondary;
                  const tierColor  = isPrimary ? theme.primary : isSecondary ? "#a78bfa" : theme.textMuted;
                  const baseLabel  = isPrimary ? "3+3" : isSecondary ? "2+2" : "1+1";
                  const fwdPeak    = isPrimary ? "4+2" : isSecondary ? "3+1" : null;
                  const bwdPeak    = isPrimary ? "2+4" : isSecondary ? "1+3" : null;
                  const ic = (v) => v > 0.5 ? "#f87171" : v > 0.3 ? "#fbbf24" : theme.primary;

                  return (
                    <div key={`v-${idx}`} style={{
                      display: "grid",
                      gridTemplateColumns: "36px minmax(0,1.2fr) minmax(0,1.2fr) 60px 60px 42px",
                      gap: "4px",
                      alignItems: "center",
                      padding: "3px 4px",
                      borderRadius: "4px",
                      background: canReverse ? "rgba(102,252,241,0.03)" : "transparent",
                      marginBottom: "2px",
                    }}>
                      <span style={{ fontSize: "10px", fontWeight: 600, color: tierColor }}>V{idx}</span>

                      {/* Fwd slider */}
                      <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                        <input
                          type="range" min={0} max={1.0} step={0.02}
                          value={inflowFwd}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            const copy = [...vRoads];
                            copy[idx] = { ...copy[idx], inflowFwd: v };
                            setVRoads(copy);
                          }}
                          style={{ flex: 1, accentColor: ic(inflowFwd), height: "2px" }}
                        />
                        <span style={{ fontSize: "8px", color: ic(inflowFwd), fontWeight: 700, minWidth: "16px", textAlign: "right" }}>
                          {(inflowFwd * 100).toFixed(0)}
                        </span>
                      </div>

                      {/* Bwd slider */}
                      <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                        <input
                          type="range" min={0} max={1.0} step={0.02}
                          value={inflowBwd}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            const copy = [...vRoads];
                            copy[idx] = { ...copy[idx], inflowBwd: v };
                            setVRoads(copy);
                          }}
                          style={{ flex: 1, accentColor: ic(inflowBwd), height: "2px" }}
                        />
                        <span style={{ fontSize: "8px", color: ic(inflowBwd), fontWeight: 700, minWidth: "16px", textAlign: "right" }}>
                          {(inflowBwd * 100).toFixed(0)}
                        </span>
                      </div>

                      {/* Tier Selector */}
                      <select
                        value={road.tier}
                        onChange={(e) => {
                          const val = e.target.value;
                          const copy = [...vRoads];
                          copy[idx] = { ...copy[idx], tier: val, revMode: val === "minor" ? "none" : copy[idx].revMode };
                          setVRoads(copy);
                        }}
                        style={{
                          background: "#0d1117", border: "1px solid #30363d", color: "#fff",
                          padding: "1px 2px", borderRadius: "3px", fontSize: "8px", cursor: "pointer",
                        }}
                      >
                        <option value="minor">一般</option>
                        <option value="secondary">次要</option>
                        <option value="primary">主要</option>
                      </select>

                      {/* Rev-mode dropdown */}
                      {canReverse ? (
                        <select
                          value={revMode}
                          onChange={(e) => {
                            const copy = [...vRoads];
                            copy[idx] = { ...copy[idx], revMode: e.target.value };
                            setVRoads(copy);
                          }}
                          style={{
                            width: "100%", background: "#0d1117",
                            border: "1px solid #30363d", color: tierColor,
                            padding: "1px 2px", borderRadius: "3px",
                            cursor: "pointer", fontSize: "8px", fontWeight: 600,
                          }}
                        >
                          <option value="none">{baseLabel}</option>
                          <option value="peak_fwd">↓ {fwdPeak}</option>
                          <option value="peak_bwd">↑ {bwdPeak}</option>
                        </select>
                      ) : (
                        <span style={{ fontSize: "8px", color: theme.textMuted, textAlign: "center" }}>—</span>
                      )}

                      {/* Actions */}
                      <div style={{ display: "flex", gap: "2px", justifyContent: "flex-end" }}>
                        <button
                          title="複製插入下方"
                          onClick={() => {
                            const copy = [...vRoads];
                            copy.splice(idx + 1, 0, { ...road });
                            setVRoads(copy);
                          }}
                          style={{
                            background: "rgba(102,252,241,0.1)", color: theme.primary, border: "none",
                            borderRadius: "3px", width: "16px", height: "16px", fontSize: "10px",
                            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center"
                          }}
                        >
                          +
                        </button>
                        <button
                          title="刪除道路"
                          disabled={vRoads.length <= 1}
                          onClick={() => {
                            const copy = [...vRoads];
                            copy.splice(idx, 1);
                            setVRoads(copy);
                          }}
                          style={{
                            background: vRoads.length <= 1 ? "rgba(255,255,255,0.05)" : "rgba(252,68,69,0.1)",
                            color: vRoads.length <= 1 ? theme.textMuted : theme.danger, border: "none",
                            borderRadius: "3px", width: "16px", height: "16px", fontSize: "10px",
                            cursor: vRoads.length <= 1 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center"
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}

                <button
                  onClick={() => {
                    const copy = [...vRoads];
                    copy.push({ tier: "minor", inflowFwd: 0.08, inflowBwd: 0.08, revMode: "none" });
                    setVRoads(copy);
                  }}
                  style={{
                    background: "rgba(102,252,241,0.08)", border: "1px dashed rgba(102,252,241,0.25)",
                    color: theme.primary, padding: "4px 8px", borderRadius: "6px", fontSize: "9px",
                    fontWeight: "bold", cursor: "pointer", marginTop: "4px", width: "100%", transition: "all 0.2s",
                    marginBottom: "4px"
                  }}
                >
                  ＋ 新增 V 路 (Add Vertical Road)
                </button>
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
              overflowX: "auto",
              position: "relative"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "14px", fontWeight: "bold", color: theme.textLight }}>模擬運行狀態 (Tick: {tick} / {steps})</span>
                  <button
                    onClick={() => {
                      const config = {
                        seed, steps, density, densityHFwd, densityHBwd, deltaT, pChangeBg, pChangeSub,
                        turnProbability, signalMode, hRoads, vRoads, intersectionRules
                      };
                      setImportExportText(JSON.stringify(config, null, 2));
                      setShowConfigModal(true);
                    }}
                    style={{
                      background: "rgba(102, 252, 241, 0.12)",
                      color: theme.primary,
                      border: "1px solid rgba(102, 252, 241, 0.3)",
                      borderRadius: "6px",
                      fontSize: "11px",
                      padding: "2px 8px",
                      cursor: "pointer"
                    }}
                  >
                    ⚙️ 匯入/匯出配置
                  </button>
                </div>
                <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", fontSize: "12px" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "linear-gradient(to bottom, #22d3ee, #0369a1)" }}></span>
                    <strong style={{ color: "#22d3ee" }}>青藍色</strong> 背景車
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "linear-gradient(to bottom, #ffedd5, #ea580c)" }}></span>
                    <strong style={{ color: "#ea580c" }}>橘色/閃爍藍燈</strong> 救護車
                  </span>
                  {expType === 'B1' && (
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "linear-gradient(to bottom, #fbbf24, #b45309)" }}></span>
                      <strong style={{ color: "#fbbf24" }}>橘黃色</strong> 切車魔人
                    </span>
                  )}
                  {expType === 'B2' && (
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "linear-gradient(to bottom, #ef4444, #991b1b)" }}></span>
                      <strong style={{ color: "#ef4444" }}>紅色</strong> 吸血鬼(尾隨車)
                    </span>
                  )}
                  {expType !== 'B1' && expType !== 'B2' && (
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "linear-gradient(to bottom, #e879f9, #a21caf)" }}></span>
                      <strong style={{ color: "#e879f9" }}>紫色</strong> 主體車
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
                提示：點擊車輛進行軌跡追蹤；點擊路口中心 ⚙️ 調節轉向；點擊道路端點 ⚙️ 調節車道與車流
              </p>

              {/* Floating Cards and Overlays */}
              {selectedIntersection && (
                <div style={{
                  position: "absolute",
                  left: `${selectedIntersection.px + 15}px`,
                  top: `${selectedIntersection.py + 15}px`,
                  background: "rgba(31, 40, 51, 0.95)",
                  border: "2px solid " + theme.primary,
                  borderRadius: "12px",
                  padding: "16px",
                  width: "280px",
                  zIndex: 1000,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                  backdropFilter: "blur(8px)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <strong style={{ color: theme.textLight, fontSize: "13px" }}>
                      路口 (H{selectedIntersection.r}, V{selectedIntersection.c}) 轉向車道自訂
                    </strong>
                    <button 
                      onClick={() => setSelectedIntersection(null)}
                      style={{ background: "transparent", color: theme.textMuted, border: "none", cursor: "pointer", fontSize: "16px" }}
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxHeight: "250px", overflowY: "auto", paddingRight: "4px" }}>
                    {[
                      { label: "⬅️ 西側入口 (向東)", roadType: "hFwd", idx: selectedIntersection.r },
                      { label: "➡️ 東側入口 (向西)", roadType: "hBwd", idx: selectedIntersection.r },
                      { label: "⬇️ 北側入口 (向南)", roadType: "vFwd", idx: selectedIntersection.c },
                      { label: "⬆️ 南側入口 (向北)", roadType: "vBwd", idx: selectedIntersection.c },
                    ].map((leg) => {
                      const lanes = sim ? sim.getRoad(leg.roadType, leg.idx) : null;
                      if (!lanes) return null;
                      const totalLanes = lanes.length;
                      const key = `${selectedIntersection.r}-${selectedIntersection.c}`;
                      const currentRules = intersectionRules[key]?.[leg.roadType] || [];
                      return (
                        <div key={leg.roadType} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "8px" }}>
                          <span style={{ fontSize: "11px", color: theme.secondary, fontWeight: "bold" }}>{leg.label}</span>
                          <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                            {Array.from({ length: totalLanes }).map((_, l) => {
                              let val = currentRules[l];
                              if (!val) {
                                if (totalLanes === 1) val = "all";
                                else if (totalLanes === 2) val = (l === 0 ? "left" : "right");
                                else val = (l === 0 ? "left" : (l === totalLanes - 1 ? "right" : "straight"));
                              }
                              return (
                                <div key={l} style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
                                  <span style={{ fontSize: "9px", color: theme.textMuted, textAlign: "center" }}>車道 {l}</span>
                                  <select
                                    value={val}
                                    onChange={(e) => {
                                      const newRules = { ...intersectionRules };
                                      if (!newRules[key]) newRules[key] = {};
                                      if (!newRules[key][leg.roadType]) {
                                        newRules[key][leg.roadType] = Array.from({ length: totalLanes }).map((_, i) => {
                                          if (totalLanes === 1) return "all";
                                          if (totalLanes === 2) return (i === 0 ? "left" : "right");
                                          return (i === 0 ? "left" : (i === totalLanes - 1 ? "right" : "straight"));
                                        });
                                      }
                                      newRules[key][leg.roadType][l] = e.target.value;
                                      setIntersectionRules(newRules);
                                      if (simRef.current) {
                                        simRef.current.intersectionRules = newRules;
                                      }
                                    }}
                                    style={{
                                      background: "#0b0c10", color: theme.primary, border: "1px solid rgba(255,255,255,0.15)",
                                      borderRadius: "4px", fontSize: "10px", padding: "2px 4px", cursor: "pointer", outline: "none"
                                    }}
                                  >
                                    <option value="left">左轉 ⬅️</option>
                                    <option value="straight">直行 ⬆️</option>
                                    <option value="right">右轉 ➡️</option>
                                    <option value="all">全開放 🔄</option>
                                  </select>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedRoadConfig && (
                <div style={{
                  position: "absolute",
                  left: `${selectedRoadConfig.px + 15}px`,
                  top: `${selectedRoadConfig.py - 50}px`,
                  background: "rgba(31, 40, 51, 0.95)",
                  border: "2px solid " + theme.secondary,
                  borderRadius: "12px",
                  padding: "16px",
                  width: "250px",
                  zIndex: 1001,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                  backdropFilter: "blur(8px)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <strong style={{ color: theme.textLight, fontSize: "13px" }}>
                      道路設定 ({selectedRoadConfig.roadType.toUpperCase()} {selectedRoadConfig.idx})
                    </strong>
                    <button 
                      onClick={() => setSelectedRoadConfig(null)}
                      style={{ background: "transparent", color: theme.textMuted, border: "none", cursor: "pointer", fontSize: "16px" }}
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {/* Road Tier Selector */}
                    <div>
                      <label style={{ display: "block", fontSize: "11px", color: theme.textMuted, marginBottom: "4px" }}>道路層級 (車道數)</label>
                      <select
                        value={
                          (selectedRoadConfig.roadType.startsWith('h') ? hRoads[selectedRoadConfig.idx] : vRoads[selectedRoadConfig.idx]).tier
                        }
                        onChange={(e) => {
                          const isH = selectedRoadConfig.roadType.startsWith('h');
                          const copy = isH ? [...hRoads] : [...vRoads];
                          copy[selectedRoadConfig.idx].tier = e.target.value;
                          skipReinitRef.current = true;
                          if (isH) setHRoads(copy);
                          else setVRoads(copy);
                          if (simRef.current) {
                            simRef.current.updateRoadTier(selectedRoadConfig.roadType, selectedRoadConfig.idx, e.target.value);
                          }
                        }}
                        style={{
                          width: "100%", background: "#0b0c10", color: "#fff", border: "1px solid rgba(255,255,255,0.15)",
                          borderRadius: "6px", fontSize: "12px", padding: "6px"
                        }}
                      >
                        <option value="minor">一般道路 (1 車道)</option>
                        <option value="secondary">次要幹道 (2 車道)</option>
                        <option value="primary">主要幹道 (3 車道)</option>
                      </select>
                    </div>
                    {/* Inflow Rate Slider */}
                    <div>
                      <label style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: theme.textMuted, marginBottom: "4px" }}>
                        <span>輸入車流率</span>
                        <span style={{ color: theme.primary, fontWeight: "bold" }}>
                          {(selectedRoadConfig.roadType.startsWith('h') ? hRoads[selectedRoadConfig.idx] : vRoads[selectedRoadConfig.idx])[selectedRoadConfig.roadType.endsWith('Fwd') ? 'inflowFwd' : 'inflowBwd'].toFixed(2)}
                        </span>
                      </label>
                      <input
                        type="range"
                        min="0.0"
                        max="1.0"
                        step="0.02"
                        value={
                          (selectedRoadConfig.roadType.startsWith('h') ? hRoads[selectedRoadConfig.idx] : vRoads[selectedRoadConfig.idx])[selectedRoadConfig.roadType.endsWith('Fwd') ? 'inflowFwd' : 'inflowBwd']
                        }
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          const isH = selectedRoadConfig.roadType.startsWith('h');
                          const copy = isH ? [...hRoads] : [...vRoads];
                          if (selectedRoadConfig.roadType.endsWith('Fwd')) {
                            copy[selectedRoadConfig.idx].inflowFwd = val;
                          } else {
                            copy[selectedRoadConfig.idx].inflowBwd = val;
                          }
                          skipReinitRef.current = true;
                          if (isH) setHRoads(copy);
                          else setVRoads(copy);
                          if (simRef.current) {
                            simRef.current.updateInflowRate(selectedRoadConfig.roadType, selectedRoadConfig.idx, val);
                          }
                        }}
                        style={{ width: "100%", accentColor: theme.primary }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {showConfigModal && (
                <div style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  background: "#1f2833",
                  border: "2px solid " + theme.primary,
                  borderRadius: "16px",
                  padding: "24px",
                  width: "400px",
                  zIndex: 2000,
                  boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
                  backdropFilter: "blur(10px)"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                    <strong style={{ color: theme.textLight, fontSize: "16px" }}>匯入 / 匯出 JSON 模擬配置</strong>
                    <button 
                      onClick={() => setShowConfigModal(false)}
                      style={{ background: "transparent", color: theme.textMuted, border: "none", cursor: "pointer", fontSize: "18px" }}
                    >
                      ✕
                    </button>
                  </div>
                  <p style={{ fontSize: "11px", color: theme.textMuted, margin: "0 0 12px 0" }}>
                    您可以複製此 JSON 配置以利於定量分析中完美重現；或是將 AI/自動化腳本生成的 anomalous 配置 JSON 貼在下方，點擊「匯入並載入」完美復現。
                  </p>
                  <textarea
                    value={importExportText}
                    onChange={(e) => setImportExportText(e.target.value)}
                    style={{
                      width: "100%", height: "180px", background: "#0b0c10", color: theme.primary,
                      fontFamily: "monospace", fontSize: "10px", padding: "8px", borderRadius: "8px",
                      border: "1px solid rgba(255,255,255,0.15)", resize: "none", outline: "none"
                    }}
                  />
                  <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                    <button
                      onClick={() => {
                        const config = {
                          seed, steps, density, densityHFwd, densityHBwd, deltaT, pChangeBg, pChangeSub,
                          turnProbability, signalMode, hRoads, vRoads, intersectionRules
                        };
                        setImportExportText(JSON.stringify(config, null, 2));
                      }}
                      style={{ flex: 1, padding: "8px", background: "#30363d", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "12px" }}
                    >
                      生成當前配置 JSON
                    </button>
                    <button
                      onClick={() => {
                        try {
                          const parsed = JSON.parse(importExportText);
                          if (parsed.seed !== undefined) setSeed(parsed.seed);
                          if (parsed.steps !== undefined) setSteps(parsed.steps);
                          if (parsed.density !== undefined) setDensity(parsed.density);
                          if (parsed.densityHFwd !== undefined) setDensityHFwd(parsed.densityHFwd);
                          if (parsed.densityHBwd !== undefined) setDensityHBwd(parsed.densityHBwd);
                          if (parsed.deltaT !== undefined) setDeltaT(parsed.deltaT);
                          if (parsed.pChangeBg !== undefined) setPChangeBg(parsed.pChangeBg);
                          if (parsed.pChangeSub !== undefined) setPChangeSub(parsed.pChangeSub);
                          if (parsed.turnProbability !== undefined) setTurnProbability(parsed.turnProbability);
                          if (parsed.signalMode !== undefined) setSignalMode(parsed.signalMode);
                          if (parsed.hRoads !== undefined) setHRoads(parsed.hRoads);
                          if (parsed.vRoads !== undefined) setVRoads(parsed.vRoads);
                          if (parsed.intersectionRules !== undefined) setIntersectionRules(parsed.intersectionRules);
                          
                          setShowConfigModal(false);
                          setTimeout(() => initializeSimulation(), 50);
                        } catch (e) {
                          alert("JSON 格式有誤，請確認後重試！");
                        }
                      }}
                      style={{ flex: 1, padding: "8px", background: theme.primary, color: "#000", fontWeight: "bold", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "12px" }}
                    >
                      匯入並載入 🚀
                    </button>
                  </div>
                </div>
              )}
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
                    <span style={{ width: "80px", textAlign: "right", color: "#fbbf24" }}>切車魔人組</span>
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
                      <span style={{ width: "80px", textAlign: "right", color: "#fbbf24", fontWeight: "bold" }}>
                        {bComparison.weaving.metrics[row.k]}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{
                  marginTop: "16px",
                  padding: "10px",
                  background: "rgba(251, 191, 36, 0.08)",
                  border: "1px solid rgba(251, 191, 36, 0.2)",
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

      {/* Tab Content - Batch Sim Dashboard */}
      {activeTab === "batchSim" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "20px" }}>
            {/* Settings Left Column */}
            <div style={{
              background: "rgba(31, 40, 51, 0.45)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "16px",
              padding: "20px",
              display: "flex",
              flexDirection: "column",
              gap: "20px"
            }}>
              <div>
                <h3 style={{ margin: "0 0 12px 0", color: theme.textLight, fontSize: "16px" }}>批量掃描配置</h3>
                <p style={{ margin: "0 0 16px 0", fontSize: "12px", color: theme.textMuted }}>設定欲掃描的各種參數組合，一鍵在本機瀏覽器完成高通量模擬統計。</p>
              </div>

              {/* Seeds input */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "12px", color: theme.text, fontWeight: "bold" }}>隨機數種子 (逗號分隔)</span>
                <input
                  type="text"
                  value={batchSeeds}
                  onChange={(e) => setBatchSeeds(e.target.value)}
                  style={{
                    background: "#0b0c10", color: theme.primary, border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: "6px", padding: "8px", fontSize: "12px", outline: "none"
                  }}
                  placeholder="例如: 42, 100, 2026, 999"
                />
              </div>

              {/* Signal Modes multi-select */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "12px", color: theme.text, fontWeight: "bold" }}>測試號誌模式</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", background: "#161b22", padding: "10px", borderRadius: "8px" }}>
                  {[
                    { id: "all_sync", label: "全同步 (All Sync)" },
                    { id: "alternating", label: "交替模式 (Alternating)" },
                    { id: "green_wave", label: "綠波協調 (Green Wave)" }
                  ].map(modeOpt => {
                    const checked = batchSignalModes.includes(modeOpt.id);
                    return (
                      <label key={modeOpt.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", cursor: "pointer", color: theme.text }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            if (checked) {
                              setBatchSignalModes(batchSignalModes.filter(m => m !== modeOpt.id));
                            } else {
                              setBatchSignalModes([...batchSignalModes, modeOpt.id]);
                            }
                          }}
                          style={{ cursor: "pointer" }}
                        />
                        {modeOpt.label}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Densities multi-select */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "12px", color: theme.text, fontWeight: "bold" }}>測試背景車流密度</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", background: "#161b22", padding: "10px", borderRadius: "8px" }}>
                  {[
                    { val: 0.12, label: "低車流 (0.12)" },
                    { val: 0.16, label: "中車流 (0.16)" },
                    { val: 0.20, label: "高車流 (0.20)" }
                  ].map(densOpt => {
                    const checked = batchDensities.includes(densOpt.val);
                    return (
                      <label key={densOpt.val} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", cursor: "pointer", color: theme.text }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            if (checked) {
                              setBatchDensities(batchDensities.filter(d => d !== densOpt.val));
                            } else {
                              setBatchDensities([...batchDensities, densOpt.val]);
                            }
                          }}
                          style={{ cursor: "pointer" }}
                        />
                        {densOpt.label}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Start Button & Progress */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
                <button
                  onClick={runBatchSimulation}
                  disabled={batchRunning}
                  style={{
                    background: batchRunning ? theme.textMuted : theme.primary,
                    color: "#000",
                    border: "none",
                    borderRadius: "8px",
                    padding: "12px",
                    fontWeight: "bold",
                    cursor: batchRunning ? "not-allowed" : "pointer",
                    fontSize: "14px",
                    transition: "all 0.2s"
                  }}
                >
                  {batchRunning ? "⏳ 批量模擬計算中..." : "🚀 開始自動化批量跑模擬"}
                </button>

                {batchRunning && (
                  <div style={{ marginTop: "10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: theme.textMuted, marginBottom: "4px" }}>
                      <span>模擬進度</span>
                      <span>{batchProgress.current} / {batchProgress.total} 組</span>
                    </div>
                    <div style={{ width: "100%", height: "8px", background: "#0b0c10", borderRadius: "4px", overflow: "hidden" }}>
                      <div style={{
                        width: `${(batchProgress.current / batchProgress.total) * 100}%`,
                        height: "100%",
                        background: `linear-gradient(to right, ${theme.primary}, ${theme.purple})`,
                        transition: "width 0.1s ease-out"
                      }}></div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Results Table Right Column */}
            <div style={{
              background: "rgba(31, 40, 51, 0.45)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "16px",
              padding: "20px",
              display: "flex",
              flexDirection: "column",
              gap: "20px"
            }}>
              <div>
                <h3 style={{ margin: "0 0 6px 0", color: theme.textLight, fontSize: "16px" }}>批量掃描模擬結果</h3>
                {batchResults.length > 0 ? (
                  <p style={{ margin: 0, fontSize: "12px", color: theme.textMuted }}>
                    已完成 <strong style={{ color: theme.primary }}>{batchResults.length}</strong> 組實驗。
                    偵測到 <strong style={{ color: theme.danger }}>{batchResults.filter(r => r.isAnomalous).length}</strong> 組異常壅塞波 (幽靈塞車次數 &gt; 3 或 平均延滯 &gt; 150)。
                  </p>
                ) : (
                  <p style={{ margin: 0, fontSize: "12px", color: theme.textMuted }}>尚未開始模擬。點擊左側按鈕開始進行高通量掃描統計。</p>
                )}
              </div>

              {/* Scrollable Table Container */}
              <div style={{ flex: 1, overflowY: "auto", maxHeight: "600px", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", background: "#0b0c10" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
                  <thead>
                    <tr style={{ background: "#1f2833", color: theme.textLight, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                      <th style={{ padding: "10px" }}>編號</th>
                      <th style={{ padding: "10px" }}>種子</th>
                      <th style={{ padding: "10px" }}>號誌模式</th>
                      <th style={{ padding: "10px" }}>車流密度</th>
                      <th style={{ padding: "10px" }}>駛離吞吐量</th>
                      <th style={{ padding: "10px" }}>平均速度</th>
                      <th style={{ padding: "10px" }}>平均延滯</th>
                      <th style={{ padding: "10px" }}>幽靈塞車</th>
                      <th style={{ padding: "10px" }}>狀態</th>
                      <th style={{ padding: "10px", textAlign: "center" }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchResults.length > 0 ? (
                      batchResults.map(run => (
                        <tr key={run.id} style={{
                          borderBottom: "1px solid rgba(255,255,255,0.05)",
                          background: run.isAnomalous ? "rgba(252, 68, 69, 0.08)" : "transparent",
                          color: run.isAnomalous ? theme.danger : theme.text,
                          transition: "background 0.2s"
                        }}>
                          <td style={{ padding: "10px", fontWeight: "bold" }}>#{run.id}</td>
                          <td style={{ padding: "10px" }}>{run.seed}</td>
                          <td style={{ padding: "10px" }}>
                            {run.signalMode === "all_sync" ? "全同步" : run.signalMode === "alternating" ? "交替" : "綠波協調"}
                          </td>
                          <td style={{ padding: "10px" }}>{run.density.toFixed(2)}</td>
                          <td style={{ padding: "10px" }}>{run.throughput} 輛</td>
                          <td style={{ padding: "10px" }}>{run.avgSpeed.toFixed(3)}</td>
                          <td style={{ padding: "10px" }}>{run.avgDelay.toFixed(1)}</td>
                          <td style={{ padding: "10px" }}>{run.phantomJams} 次</td>
                          <td style={{ padding: "10px", fontWeight: "bold" }}>
                            {run.isAnomalous ? "⚠️ 交通壅塞/波動" : "✅ 正常順暢"}
                          </td>
                          <td style={{ padding: "6px 10px", textAlign: "center" }}>
                            <button
                              onClick={() => loadRunIntoVisualizer(run)}
                              style={{
                                background: run.isAnomalous ? theme.danger : theme.primary,
                                color: "#000",
                                border: "none",
                                borderRadius: "4px",
                                padding: "4px 8px",
                                fontSize: "11px",
                                fontWeight: "bold",
                                cursor: "pointer"
                              }}
                            >
                              🔍 載入可視化
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={10} style={{ padding: "30px", textAlign: "center", color: theme.textMuted }}>
                          暫無結果。請在左側設定後，點擊「開始自動化批量跑模擬」。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
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
