import { GridSimulation } from '../src/simulationEngine.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Scenarios to evaluate
const SEEDS = [42, 100, 2026, 999];
const SIGNAL_MODES = ['all_sync', 'alternating', 'green_wave'];
const DENSITIES = [0.12, 0.16, 0.20];

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

console.log('====================================================');
console.log('  Taipei Grid Headless Automated Batch Runner CLI  ');
console.log('====================================================');

const results = [];
let runs = 0;

for (const seed of SEEDS) {
  for (const signalMode of SIGNAL_MODES) {
    for (const density of DENSITIES) {
      runs++;
      console.log(`[Run #${runs}] Seed: ${seed} | Mode: ${signalMode} | Inflow Density: ${density}`);

      // We can also configure a custom intersection rule to test turning
      // e.g. Intersection H1, V1: Lane 0 is left-turn only, Lane 1 is straight, Lane 2 is right-turn only
      const intersectionRules = {
        "1-1": {
          hFwd: ["left", "straight", "right"],
          hBwd: ["left", "straight", "right"],
          vFwd: ["left", "straight", "right"],
          vBwd: ["left", "straight", "right"]
        }
      };

      const sim = new GridSimulation({
        seed: seed,
        simulationSteps: 800,
        backgroundDensity: density,
        signalMode: signalMode,
        hRoads: defaultHRoads,
        vRoads: defaultVRoads,
        intersectionRules: intersectionRules,
        params: {
          delta_t: 30,
          p_change_background: 0.1,
          p_change_subject: 1.0,
          turn_probability: 0.15
        }
      });

      const start = Date.now();
      const res = sim.run();
      const elapsed = Date.now() - start;

      const metrics = res.metrics;
      const isAnomalous = metrics.phantom_jams_detected > 3 || metrics.avg_delay_background > 150;

      const reproduceConfig = {
        seed: seed,
        steps: 800,
        density: density,
        deltaT: 30,
        pChangeBg: 0.1,
        pChangeSub: 1.0,
        turnProbability: 0.15,
        signalMode: signalMode,
        hRoads: defaultHRoads,
        vRoads: defaultVRoads,
        intersectionRules: intersectionRules
      };

      results.push({
        run_id: runs,
        seed,
        signalMode,
        density,
        elapsed_ms: elapsed,
        metrics,
        is_anomalous: isAnomalous,
        reproduce_config: reproduceConfig
      });

      if (isAnomalous) {
        const b64 = Buffer.from(JSON.stringify(reproduceConfig)).toString('base64');
        console.warn(`  ⚠️  Anomalous Traffic Wave Detected! Phantom jams: ${metrics.phantom_jams_detected}, Avg Delay: ${metrics.avg_delay_background.toFixed(1)} ticks.`);
        console.warn(`     🔗 完美重現 GUI 連結 (Ctrl+Click 開啟):`);
        console.warn(`        - Local Dev: http://localhost:5173/?config=${b64}`);
        console.warn(`        - Local Server: http://localhost:3000/?config=${b64}`);
      }
    }
  }
}

// Write report
const reportDir = path.join(__dirname, '../dist');
if (!fs.existsSync(reportDir)) {
  fs.mkdirSync(reportDir, { recursive: true });
}
const reportPath = path.join(reportDir, 'batch_analysis_report.json');
fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));

console.log('====================================================');
console.log(` Batch completed. Ran ${runs} simulations.`);
console.log(` Report written to: ${reportPath}`);
console.log('====================================================');
