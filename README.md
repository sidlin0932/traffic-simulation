# Taipei Grid Microscopic Traffic Simulation System

A seed-driven, deterministic microscopic traffic micro-simulation system based on the Nagel–Schreckenberg (NaSch) Cellular Automata model. It supports A/B experiments comparing coordinated traffic signal timing strategies and dynamic reversible lane configurations.

Now upgraded with standard Right-Hand Traffic (RHT) navigation, ROC-standard road markings, and a realistic Taipei core grid preset (9x11 grid).

---

## 📂 Project Documentation

All detailed specifications, design notes, and version history have been moved and organized under the `docs/` folder:

*   **[Technical Design Document](file:///f:/Antigravity/批判寫作/docs/README.md)**: Details the system architecture, Nagel-Schreckenberg CA physics engine, and dynamic routing (BFS & A*).
*   **[API Specification](file:///f:/Antigravity/批判寫作/docs/traffic_simulation_api_spec.md)**: Specifications for the Express API server endpoints (`POST /api/v1/simulation/run`), including parameters, payloads, and Python verification script.
*   **[Changelog](file:///f:/Antigravity/批判寫作/docs/CHANGELOG.md)**: Project release history documenting versions up to **v1.6.0** (RHT coordinates & stop-line coordinate interpolation).
*   **[Original Prototype Readme (Archived)](file:///f:/Antigravity/批判寫作/docs/archive/realREADME.md)**: The initial design document of the traffic simulation.

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- npm

### Installation
1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```

### Running the Visualizer (Frontend)
Run the Vite development server:
```bash
npm run dev
```
Open `http://localhost:5173/` in your browser.

### Running the API Server (Backend)
Start the Express API server on Port 3000:
```bash
node server.js
```
The server will be available at `http://localhost:3000/api/v1/simulation/run`.
