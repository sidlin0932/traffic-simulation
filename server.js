import express from 'express';
import cors from 'cors';
import { GridSimulation, runExperimentASweep } from './src/simulationEngine.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

// Simple logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// API Endpoint: Run microscopic traffic simulation
app.post('/api/v1/simulation/run', (req, res) => {
  try {
    const {
      random_seed = 42,
      simulation_steps = 1000,
      road_length = 300,
      background_density = 0.15,
      experiment_type = 'custom',
      export_trajectories = false,
      h_roads = null,
      v_roads = null,
      hRoads = null,
      vRoads = null,
      params = {}
    } = req.body;

    if (experiment_type === 'A') {
      // Run Experiment A sweep
      const delta_t = params.delta_t || 30;
      const result = runExperimentASweep(random_seed, delta_t, background_density);
      return res.json(result);
    } else {
      const finalHRoads = h_roads || hRoads;
      const finalVRoads = v_roads || vRoads;
      const finalIntersectionRules = req.body.intersection_rules || req.body.intersectionRules || {};

      const sim = new GridSimulation({
        roadLength: road_length,
        simulationSteps: simulation_steps,
        backgroundDensity: background_density,
        seed: random_seed,
        experimentType: experiment_type,
        exportTrajectories: export_trajectories,
        signalMode: req.body.signal_mode || 'alternating',
        hRoads: finalHRoads,
        vRoads: finalVRoads,
        intersectionRules: finalIntersectionRules,
        params
      });

      const result = sim.run();
      result.reproduce_config = {
        seed: random_seed,
        steps: simulation_steps,
        density: background_density,
        deltaT: params.delta_t || 30,
        pChangeBg: params.p_change_background || 0.1,
        pChangeSub: params.p_change_subject || 1.0,
        turnProbability: params.turn_probability || 0.15,
        signalMode: req.body.signal_mode || 'alternating',
        hRoads: finalHRoads,
        vRoads: finalVRoads,
        intersectionRules: finalIntersectionRules
      };

      return res.json(result);
    }
  } catch (error) {
    console.error('Error executing simulation:', error);
    return res.status(500).json({
      success: false,
      message: 'Simulation execution failed',
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', version: '1.0.0' });
});

// Fallback route for index.html (Frontend SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Traffic Simulation API Server is running on port ${PORT}`);
});
