# Taipei Grid Microscopic Traffic Simulation System — Technical Documentation

This directory contains the detailed documentation, specifications, and history of the seed-driven, deterministic microscopic traffic simulation project.

---

## 1. System Overview

The system is a microscopic traffic simulator based on the **Nagel–Schreckenberg (NaSch) Cellular Automata (CA) model**. It is designed to run A/B testing on various signal coordination schemes and reversible lane strategies, observing their effects on throughput, average travel time, congestion waves, and social costs.

The simulator supports two main modes:
1. **Interactive Visualizer (Frontend)**: A React-based web interface showing live vehicle movements, queue build-ups, traffic signal transitions, and real-time statistics dashboard.
2. **API Server (Backend)**: An Express-based backend for executing batch simulation sweeps and programmatically retrieving results in JSON format.

---

## 2. Core Physics & Simulation Model

### 2.1 Cellular Automata (Nagel-Schreckenberg)
Each lane of a road is represented as a sequence of discrete cells. At each time tick, every vehicle updates its velocity $v$ and position according to the following rules:
1. **Acceleration**: $v \leftarrow \min(v + 1, v_{\max})$
2. **Deceleration**: $v \leftarrow \min(v, d)$ where $d$ is the distance to the leading vehicle (or the stop line if the light is red).
3. **Randomization (Dawdling)**: With probability $p_{\text{slow}}$, $v \leftarrow \max(v - 1, 0)$.
4. **Movement**: The vehicle advances by $v$ cells.

### 2.2 Grid Network Hierarchy
- **Standard Grid**: 5 horizontal × 6 vertical roads.
- **Taipei Core Grid Preset**: A realistic 9x11 grid mapping the street geometry of downtown Taipei (including Ren'ai Rd and Xinyi Rd terminations).
- **Speed Limits**: Configured by road classification (e.g., Arterial roads: $v_{\max} = 5$; Collector roads: $v_{\max} = 3$).
- **Lanes**: 6-lane configuration (3 lanes in forward direction, 3 in backward direction).
  - Can be dynamically sized to 4/2 or 2/4 during peak hours when **Reversible Lanes** are active.

---

## 3. Key Features

### 3.1 Right-Hand Traffic (RHT) Navigation
Standard Taiwan-compliant driving rules are enforced:
- **Horizontal Roads**: West-to-East (Eastbound) flow is on the bottom half; East-to-West (Westbound) flow is on the top half.
- **Vertical Roads**: North-to-South (Southbound) flow is on the left half; South-to-North (Northbound) flow is on the right half.

### 3.2 Coordinated Traffic Signal Modes
- **Synchronized (`all_sync`)**: All intersections switch green/red at the same time.
- **Alternating (`alternating`)**: Adjacent intersections have alternating phases to break up continuous flow.
- **Horizontal Green Wave (`green_wave_h`)**: Signal offsets are calculated based on travel times to allow smooth progression on East-West roads.
- **Vertical Green Wave (`green_wave_v`)**: Signal offsets are calculated to allow smooth progression on North-South roads.
- **Four-Way Signal Placement**: A distinct signal light is rendered exactly at the entrance stop line of each intersection leg.

### 3.3 Road Markings (ROC Standards)
- **Reversible Lane Limits**: Rendered as double white dashed lines.
- **Direction Separator**: Rendered as double solid yellow lines.
- **Lane and Stop Lines**: Rendered as solid white lines.
- **Turn Guides**: High-quality vector arrows inside each lane indicating allowed direction transitions.

### 3.5 Keep Intersection Clear (路口淨空)
- **Intersection Clearance Enforcement**: Non-emergency vehicles check whether they can completely clear the intersection before crossing. If the exit lane immediately after the intersection is congested (causing the vehicle's calculated next position to stop exactly inside the intersection cell), the vehicle will proactively decelerate and stop at the entrance stop line (cell `p - 1`) to keep the intersection box clear and avoid multi-directional gridlocks.

### 3.6 Microscopic Trajectory Tracking & Color System
- **Vehicle Color Coding**:
  - **Background Cars**: Cyan/Blue gradient (`#22d3ee` to `#0369a1`).
  - **Weaving Demon (切車魔人 - Scenario 1)**: Distinctive Neon Amber/Gold gradient (`#fbbf24` to `#b45309`) with matching warning colors in the metrics table.
  - **Vampire/Tailgater (Scenario 2)**: Crimson Red gradient (`#ef4444` to `#991b1b`).
  - **Emergency Vehicle (Ambulance)**: Light Orange gradient (`#ffedd5` to `#ea580c`) with a flashing blue siren.
- **Historical Trajectory Tracing**: Clicking any vehicle in the visualizer renders its detailed history path as a translucent purple dashed line on the canvas.

---

## 4. Directory Directory Map

- `/src/components/TrafficSimSpec.jsx`: The primary React component managing UI layout, drawing the HTML5 Canvas, and running the interactive animation.
- `/src/simulationEngine.js`: The standalone simulation engine implementing Mulberry32 PRNG, geometry builder, and NaSch step calculations.
- `/server.js`: Express server implementation defining API endpoints.
- `/docs/traffic_simulation_api_spec.md`: Detailed specification of endpoints, parameters, and payloads.
- `/docs/CHANGELOG.md`: Full version release history.
- `/docs/archive/realREADME.md`: Original prototype readme design document.
