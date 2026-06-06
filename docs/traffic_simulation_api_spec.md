# Microscopic Traffic Simulation API Specification / 微觀交通模擬實驗 API 規格與方法論說明書

This document defines the standard API specifications, parameters, schemas, and usage examples for the **6-Lane 5x6 Grid Microscopic Traffic Cellular Automata Simulator**. It is designed to be easily parsed and understood by AI Agents and researchers for reproducing experiments.

本文件定義了【6車道 5x6 網格微觀交通流元胞自動機模擬器】的標準 API 規格、參數、Schema 與呼叫範例，旨在提供 AI Agent 與研究人員穩定對接與再現實驗。

---

## 1. API Endpoint Overview / 接口概覽

- **URL**: `http://localhost:3000/api/v1/simulation/run`
- **Method**: `POST`
- **Headers**: 
  - `Content-Type: application/json`

---

## 2. Request Body Specification / 請求參數規格

### 2.1 Request JSON Schema & Example / 請求 JSON 範例
```json
{
  "random_seed": 42,
  "simulation_steps": 1000,
  "background_density": 0.15,
  "background_density_eastbound": 0.18,
  "background_density_westbound": 0.12,
  "experiment_type": "B2",
  "export_trajectories": false,
  "signal_mode": "alternating",
  "reversible_modes_h": ["none", "none", "none", "none", "none"],
  "reversible_modes_v": ["none", "none", "none", "none", "none", "none"],
  "params": {
    "delta_t": 30,
    "seg_len": 20,
    "p_change_background": 0.1,
    "p_change_subject": 1.0,
    "v_max_background": 5,
    "v_max_subject": 6,
    "v_max_emergency": 7,
    "p_slow_background": 0.2,
    "p_slow_subject": 0.0,
    "emergency_spawn_tick": 50,
    "subject_spawn_tick": 70
  }
}
```

### 2.2 Parameter Definitions / 參數詳細說明

| Field Name / 欄位名稱 | Type / 類型 | Default / 預設值 | Allowed Values / 允許值 | Description (English / 中文) |
| :--- | :--- | :--- | :--- | :--- |
| `random_seed` | Integer | `42` | Any integer | Seed for seedable Mulberry32 PRNG to guarantee reproducibility.<br>亂數種子，用以確保模擬隨機慢化與注入機率可完全重現。 |
| `simulation_steps` | Integer | `1000` | `1 ~ 10000` | Total number of simulation ticks (steps).<br>模擬運行的總時間步（Ticks）。 |
| `background_density` | Float | `0.15` | `0.0 ~ 0.5` | General background vehicle density on the road grid (fallback if directional density is not specified).<br>通用背景車流密度（若未特別指定單向密度時的預設值）。 |
| `background_density_eastbound` | Float | `None` | `0.0 ~ 0.5` | Injected vehicle density for Eastbound (hFwd) traffic.<br>東向背景車流注入密度。 |
| `background_density_westbound` | Float | `None` | `0.0 ~ 0.5` | Injected vehicle density for Westbound (hBwd) traffic.<br>西向背景車流注入密度。 |
| `experiment_type` | String | `"custom"` | `"A"`, `"B1"`, `"B2"`, `"custom"` | **"A"**: Block length sweep.<br>**"B1"**: Phantom jam detection.<br>**"B2"**: Subject vehicle selfishness ratio analysis.<br>**"custom"**: Run simulation with custom params.<br>實驗類型：`"A"` (長度掃描), `"B1"` (幽靈塞車), `"B2"` (利己比率分析), `"custom"` (自訂參數)。 |
| `export_trajectories` | Boolean | `false` | `true`, `false` | If true, returns detailed trajectories profile for all vehicles.<br>是否匯出全車輛的每一步時空軌跡數據。 |
| `signal_mode` | String | `"alternating"` | `"all_sync"`, `"alternating"`, `"green_wave"`, `"adaptive"` | **"all_sync"**: Sync lights.<br>**"alternating"**: Alternating offset.<br>**"green_wave"**: Coordinated green wave.<br>**"adaptive"**: Self-adaptive sensing.<br>號誌控制模式。 |
| `reversible_modes_h` | Array | `["none", ...]` | Array of 5 strings from: `["none", "peak_fwd", "peak_bwd"]` | Reversible lane configurations for the 5 horizontal segments.<br>水平 5 個路段的調撥車道配置。 |
| `reversible_modes_v` | Array | `["none", ...]` | Array of 6 strings from: `["none", "peak_fwd", "peak_bwd"]` | Reversible lane configurations for the 6 vertical segments.<br>垂直 6 個路段的調撥車道配置。 |
| `params.delta_t` | Integer | `30` | `10 ~ 100` | Cycle offset for green wave traffic signals.<br>號誌綠燈差步數（適用於綠波協調）。 |
| `params.seg_len` | Integer | `20` | `12 ~ 28` | Segment block length in cell units.<br>路段街廓長度（單位：元胞格數 Cells）。 |
| `params.p_change_background` | Float | `0.1` | `0.0 ~ 1.0` | Probability of lane-changing for background cars.<br>背景車變換車道機率。 |
| `params.p_change_subject` | Float | `1.0` | `0.0 ~ 1.0` | Probability of lane-changing for the subject car.<br>主體車變換車道機率。 |
| `params.v_max_background` | Integer | `5` | `1 ~ 10` | Max velocity of background cars (cells/tick).<br>背景車最高限速。 |
| `params.v_max_subject` | Integer | `6` | `1 ~ 10` | Max velocity of the subject car.<br>主體車最高限速。 |
| `params.v_max_emergency` | Integer | `7` | `1 ~ 10` | Max velocity of emergency vehicles.<br>特種/緊急車輛最高限速。 |
| `params.p_slow_background` | Float | `0.2` | `0.0 ~ 1.0` | Dawdling probability for background vehicles.<br>背景車隨機慢化機率。 |
| `params.p_slow_subject` | Float | `0.0` | `0.0 ~ 1.0` | Dawdling probability for the subject vehicle.<br>主體車隨機慢化機率。 |
| `params.emergency_spawn_tick` | Integer | `50` | Any positive int | Tick at which the emergency vehicle is injected.<br>特種緊急車注入時間步。 |
| `params.subject_spawn_tick` | Integer | `70` | Any positive int | Tick at which the subject vehicle is injected.<br>主體車注入時間步。 |

---

## 3. Response Body Specification / 回應參數規格

### 3.1 Response JSON Example / 回應 JSON 範例
```json
{
  "success": true,
  "seed_used": 42,
  "experiment_type": "B2",
  "road_length": 126,
  "simulation_steps": 1000,
  "metrics": {
    "total_vehicles_spawned": 2643,
    "total_vehicles_arrived": 2180,
    "avg_speed_background": 0.34,
    "avg_travel_time_background": 97.6,
    "avg_travel_time_subject": 25.0,
    "avg_delay_background": 68.4,
    "avg_delay_subject": 0.7,
    "phantom_jams_detected": 0
  },
  "experiment_results": {
    "subject_exists": true,
    "emergency_exists": true,
    "subject_travel_time": 25.0,
    "bg_control_avg_travel_time": 89.8,
    "personal_time_saved": 64.8,
    "social_cost_total_delay": 13.5,
    "selfishness_ratio": 4.803,
    "tailgate_ticks": 0,
    "tailgate_ratio": 0.0
  },
  "trajectories": []
}
```

### 3.2 Response Field Descriptions / 回應指標說明

- **`success`** (Boolean): Whether the simulation executed successfully. / 模擬是否執行成功。
- **`seed_used`** (Integer): The seed used to initialize the PRNG. / 實際使用的隨機編號種子。
- **`road_length`** (Integer): The computed total grid length in cells ($HLEN$). / 計算出的總路網長度（Cells）。
- **`metrics.phantom_jams_detected`** (Integer): Count of detected backward-propagating shockwaves (phantom jams). / 偵測到的無號誌煞車波（幽靈塞車）傳播總次數。
- **`experiment_results.personal_time_saved`** (Float): Travel time ticks saved by the subject car compared to background flow. / 主體車相較於背景車所節省的旅行時間步（Ticks）。
- **`experiment_results.social_cost_total_delay`** (Float): Total extra delay caused by the subject vehicle's lane changes to the background flow. / 背景車流因主體車切入與干擾避讓集體增加的額外延滯總和。
- **`experiment_results.selfishness_ratio`** (Float): The ratio of personal time saved to the social cost incurred. Lower values represent higher social costs for tiny personal benefits. / 利己社會成本比。數值越低，代表個人微小收益造成的社會外部破壞越大。

---

## 4. How to Invoke / 呼叫方法與程式碼範例

### 4.1 Using cURL / 使用 cURL 呼叫
```bash
curl -X POST http://localhost:3000/api/v1/simulation/run \
  -H "Content-Type: application/json" \
  -d '{
    "random_seed": 42,
    "simulation_steps": 500,
    "background_density": 0.15,
    "experiment_type": "B2",
    "signal_mode": "green_wave",
    "params": {
      "seg_len": 20
    }
  }'
```

### 4.2 Python Script Example / Python 呼叫範例
```python
import requests

url = "http://localhost:3000/api/v1/simulation/run"
payload = {
    "random_seed": 42,
    "simulation_steps": 1000,
    "background_density": 0.15,
    "experiment_type": "B2",
    "export_trajectories": False,
    "signal_mode": "alternating",
    "params": {
        "seg_len": 20,
        "p_change_background": 0.1,
        "p_change_subject": 1.0
    }
}

response = requests.post(url, json=payload)
data = response.json()

if data.get("success"):
    metrics = data["metrics"]
    results = data.get("experiment_results", {})
    print(f"--- Simulation Run Succeeded ---")
    print(f"Total Spawned Vehicles: {metrics['total_vehicles_spawned']}")
    print(f"Total Arrived Vehicles: {metrics['total_vehicles_arrived']}")
    if results:
        print(f"Personal Time Saved: {results['personal_time_saved']} Ticks")
        print(f"Social Cost Total Delay: {results['social_cost_total_delay']} Ticks")
        print(f"Selfishness Ratio: {results['selfishness_ratio']}")
else:
    print("Simulation Failed:", data.get("message"))
```
