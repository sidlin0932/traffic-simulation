# Traffic Simulation — Design Doc

A seeded, deterministic traffic micro-simulation on a bidirectional road grid,
built as a single React artifact (`traffic_simulation.jsx`). It supports A/B
experiments comparing signal-timing strategies on throughput and travel time.

## Model

- **Grid:** 5 horizontal × 6 vertical roads. Each physical road is two one-way
  lanes (forward/backward), so the network is fully bidirectional.
- **Movement:** Nagel–Schreckenberg (NaSch) cellular automaton. Each tick a car
  accelerates, brakes to avoid the car ahead, randomly dawdles with probability
  `p_slow`, then advances. Max speed 5 cells/tick.
- **Signals:** Four modes — `all_sync`, `alternating`, `green_wave_h`,
  `green_wave_v`. Green-wave offsets use each intersection's cumulative distance
  from the road start, so coordination still works under irregular geometry.
- **Determinism:** Fixed seed + parameters reproduce a run exactly. This is what
  makes the A/B experiments trustworthy.

## Seed-driven realism (optional toggles)

- **Variable road length:** segment lengths jittered ±10 cells per seed.
- **T-junctions:** ~18% of nodes have one arm of the vertical road physically
  severed (a barrier), forcing cars to turn. These have no signal.

## Two traffic modes

- **Random mode (default):** anonymous cars, random turns at green
  intersections, despawn at road ends.
- **Routed mode:** each car has identity, spawn-tick, origin, and a destination
  boundary exit. It follows a BFS shortest path via guided turns. Travel time
  (arrival − spawn) is recorded. Includes dynamic rerouting when blocked and
  inflow metering to prevent congestion collapse.

## Metrics

- **Throughput:** intersection crossings per tick, split four ways
  (L→R, R→L, top→down, down→top); the four sum to the total. Counted only at
  signalled (4-way) intersections.
- **Travel time (routed mode):** mean ticks from spawn to arrival, plus arrival
  rate and completion %. Responds strongly to signal coordination (alternating
  signals roughly double travel time vs. synchronized).
- **Density slider → load:** tied to injection rate so density is a real control
  variable; throughput rises then saturates while speed falls (fundamental
  diagram).

## Code structure (top → bottom in the file)

| Section | Responsibility |
|---|---|
| Constants & utils | Grid/NaSch params, seeded PRNG (`mulberry32`), `mirror` |
| Geometry (`buildGeometry`) | Builds the whole grid from a seed: segment lengths, intersection positions, `present` / `tjunc` / `vBarrier` tables |
| Routing layer | `buildGraph`, `bfsPath`, `bfsPathAvoid`, entry/exit/heading helpers (routed mode only) |
| Simulation core | `naschStep` (movement), `inject` / `injectRouted` (spawning), `clearIntersections` (anti-gridlock), `processTurns` (random) / `processRoutes` (guided + reroute), all driven by `stepSim` (one tick) |
| Experiment runner | `runExperiment` — headless N-tick run, warmup discarded, returns all metrics. `densityToInject*` map the slider to load |
| Rendering | `drawState` — roads, severed gaps, signal dots (drawn over cars), speed-colored vehicles |
| Component (`TrafficSim`) | React state/refs, run loop, controls, live stats, A/B panel |

**Key design property:** geometry → simulation → rendering → experiment are
independent layers communicating through plain data. The simulation never
touches the canvas, and the experiment runner reuses the exact same `stepSim` as
the live view (just without drawing). This is why the dynamics can be verified
headlessly in Node without React.

## Stability mechanisms (routed mode)

- **Reachability filter:** cars are never assigned an exit whose boundary segment
  is severed by a T-junction (the original deadlock source).
- **Dynamic rerouting:** a car blocked at a turn reroutes around the blocked edge
  after a short wait; after a longer wait it bails to a different reachable exit.
- **Inflow metering:** when the network exceeds capacity (~220 cars), new-car
  injection is throttled so the network drains instead of collapsing — analogous
  to highway ramp metering. A UI indicator shows when metering is active.

## Known limits

- Abstract CA model — ticks and cells are not seconds and meters; not calibrated
  to real traffic.
- The metering cap (220) and routed injection ceiling are tuned constants, not
  derived optima.
- Throughput counts only signalled intersections, so T-junctions don't
  contribute to it.
- Routed travel times include reroute detours, so heavy congestion inflates them
  legitimately rather than artificially.
