# Changelog

All notable changes to the **Taipei Grid Microscopic Traffic Simulation System** will be documented in this file.

---

## [1.6.0] - 2026-06-05
### Added
- **Right-Hand Traffic (RHT) Navigation**: Complete coordinate correction for RHT (Taiwan standard) in both horizontal and vertical directions (Southbound on the left half of the vertical street, Northbound on the right half).
- **Four-Way Signal Lights**: Implemented four distinct signal lights, one positioned exactly on each of the four intersection entrance stop lines.
- **Stop-line Interp / Offset Control**: Created a new coordinate mapping `getVehicleCoords` that compresses vehicle gaps when approaching an intersection, ensuring vehicle models align perfectly with the stop line without overflowing or overlapping during red lights.

## [1.5.0] - 2026-06-05
### Fixed
- Fixed stop line rendering offsets, ensuring they align exactly with road margins.
- Cleaned up rendering overlapping issues inside intersections.
- Added high-quality vector arrows inside lanes indicating direction of travel.

## [1.4.0] - 2026-06-05
### Added
- **ROC Standard Road Markings**: Double Solid Yellow lines (separating opposite traffic), Double White dashed lines (reversible lanes), Solid White lines (lane limits and stop lines).
- **Crossing Conflict Detection**: Checks and flags vehicles crossing paths at intersections.
- **Four Coordinated Signal Modes**: `all_sync` (all sync), `alternating` (alternate), `green_wave_h` (horizontal green wave), and `green_wave_v` (vertical green wave).
- **Simulation Server**: Created `server.js` exposing `POST /api/v1/simulation/run` for headless simulation execution and batch analysis.

## [1.3.0] - 2026-06-05
### Added
- **Taipei Core Preset**: Upgraded to a realistic 9x11 road grid preset mimicking the core Taipei grid structure (including physical spacing, road class speed limits, and terminations for Ren'ai Rd and Xinyi Rd).

## [1.2.0] - 2026-06-05
### Fixed
- **Directed Graph Routing**: Updated the BFS graph generation to dynamically reflect the direction of reversible lanes and alternating one-way pairs.

## [1.1.0] - 2026-06-05
### Added
- **A\* Pathfinding Algorithm**: Added static and dynamic congestion-aware A* pathfinding.
- **Road Class Speeds**: Classified segments with appropriate velocity limits.

## [1.0.0] - 2026-06-05
### Added
- **Cellular Automaton Engine**: Seed-driven deterministic simulator based on Nagel-Schreckenberg cellular automata.
- **Reversible Lanes**: Support for peak hour lane direction reversals.
- **Compliance Control**: Driver compliance rate settings.
- **Deployment CI/CD**: Automatic GitHub Pages deployment workflow.
