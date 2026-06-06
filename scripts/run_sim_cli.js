import { GridSimulation } from '../src/simulationEngine.js';

// Parse command line arguments
const args = process.argv.slice(2);
const params = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    const val = args[i + 1];
    params[key] = val;
  }
}

const seed = params.seed ? parseInt(params.seed) : 42;
const steps = params.steps ? parseInt(params.steps) : 800;
const density = params.density ? parseFloat(params.density) : 0.15;
const mode = params.mode || 'alternating'; // all_sync, alternating, green_wave
const deltaT = params.deltaT ? parseInt(params.deltaT) : 30;

console.log('====================================================');
console.log('       Taipei Grid Quick Simulation CLI Tool        ');
console.log('====================================================');
console.log(` 配置：Seed: ${seed} | Steps: ${steps} | Density: ${density} | Mode: ${mode} | deltaT: ${deltaT}`);
console.log('----------------------------------------------------');
console.log(' 模擬計算中... ⏳');

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

const start = Date.now();
const sim = new GridSimulation({
  seed,
  simulationSteps: steps,
  backgroundDensity: density,
  signalMode: mode,
  hRoads: defaultHRoads,
  vRoads: defaultVRoads,
  params: {
    delta_t: deltaT,
    p_change_background: 0.1,
    p_change_subject: 1.0,
    turn_probability: 0.15
  }
});

const res = sim.run();
const elapsed = Date.now() - start;

console.log(` 模擬完成！耗時：${elapsed}ms`);
console.log('----------------------------------------------------');
console.log(' 📊 定量統計數據：');
console.log(`  - 駛離車輛數 (Throughput):    ${res.metrics.arrived_count ?? 0}`);
console.log(`  - 平均行車速度 (Avg Speed):   ${res.metrics.avg_speed_background?.toFixed(3) ?? 0} cells/tick`);
console.log(`  - 平均延滯時間 (Avg Delay):   ${res.metrics.avg_delay_background?.toFixed(1) ?? 0} ticks`);
console.log(`  - 幽靈塞車次數 (Phantom Jams): ${res.metrics.phantom_jams_detected ?? 0} 次`);
console.log('----------------------------------------------------');

const reproduceConfig = {
  seed,
  steps,
  density,
  deltaT,
  pChangeBg: 0.1,
  pChangeSub: 1.0,
  turnProbability: 0.15,
  signalMode: mode,
  hRoads: defaultHRoads,
  vRoads: defaultVRoads,
  intersectionRules: {}
};

const b64 = Buffer.from(JSON.stringify(reproduceConfig)).toString('base64');

console.log(' 🚀 完美重現 GUI 的 JSON 配置 (複製下方內容貼入網頁即可)：');
console.log(JSON.stringify(reproduceConfig, null, 2));
console.log('----------------------------------------------------');
console.log(' 🔗 點擊以下連結直接在 GUI 中載入並觀查此模擬狀況：');
console.log(`  - 本地開發伺服器: http://localhost:5173/?config=${b64}`);
console.log(`  - 部署伺服器 (Render): 您的網址加上 ?config=${b64}`);
console.log('====================================================');
