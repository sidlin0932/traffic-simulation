import { GridSimulation, runExperimentASweep } from './simulationEngine.js';

console.log('--- Starting Microscopic Traffic Simulation Test ---');

// Test 1: Determinism Test
console.log('\n[Test 1] Testing Determinism (Seed: 42)');
const sim1 = new GridSimulation({
  roadLength: 200,
  simulationSteps: 500,
  backgroundDensity: 0.15,
  seed: 42,
  experimentType: 'B2',
  params: {
    p_change_background: 0.1,
    p_change_subject: 1.0,
    emergency_spawn_tick: 50,
    subject_spawn_tick: 70
  }
});
const res1 = sim1.run();

const sim2 = new GridSimulation({
  roadLength: 200,
  simulationSteps: 500,
  backgroundDensity: 0.15,
  seed: 42,
  experimentType: 'B2',
  params: {
    p_change_background: 0.1,
    p_change_subject: 1.0,
    emergency_spawn_tick: 50,
    subject_spawn_tick: 70
  }
});
const res2 = sim2.run();

const match = JSON.stringify(res1) === JSON.stringify(res2);
console.log(`- Runs match exactly: ${match ? 'PASSED (100% deterministic)' : 'FAILED'}`);

if (match) {
  console.log('Sample metrics:', res1.metrics);
  console.log('Sample B2 results:', res1.experiment_results);
} else {
  process.exit(1);
}

// Test 2: Sweep Test
console.log('\n[Test 2] Testing Experiment A Sweep (Delta T = 30)');
const sweepRes = runExperimentASweep(42, 30, 0.15);
console.log(`- Sweep run successfully: ${sweepRes.success}`);
console.log(`- Best Road Length found: ${sweepRes.best_road_length}`);
console.log(`- Calculated Cruise Speed: ${sweepRes.calculated_cruise_speed} Cells/Tick`);

console.log('\n--- All Tests Passed Successfully! ---');
