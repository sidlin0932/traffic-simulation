# 微觀交通模擬實驗 API 規格與物理方法論說明書 (6車道 5x6 網格版)

本文件定義了【6車道 5x6 網格微觀交通流元胞自動機模擬器】的標準 API 規格與數據收集方法論，旨在提供 AI Agent 與交通研究人員穩定再現實驗 A（空間街廓長度掃描）與實驗 B（個人極端駕駛行為與社會成本對抗）的數據接口。

---

## 一、 核心物理指標與數學公式定義

模擬器在 5x6 網格（雙向共 6 車道，即單向各 3 車道）後台運行時，會透過以下公式實時計算並記錄車流特徵數據，以佐證實驗結果。

### 1. 差分自由車速計算 (Experiment A Method of Differences)
為消除車輛在紅綠燈路口的起步加速 $T_{accel}$、煞車減速 $T_{decel}$ 與紅燈等待 $T_{wait}$ 等邊界效應，採用差分法計算純路段自由流速 $v_{free}$：
$$\Delta T = T_2 - T_1 = \frac{L_2 - L_1}{v_{free}} \implies v_{free} = \frac{\Delta L}{\Delta T}$$
- **$L_1, L_2$**：兩種不同的街廓長度（單元格數，Cells）。
- **$T_1, T_2$**：在相同種子數與零干擾下，車輛通過兩路段的實際總旅行時間。

### 2. 綠波最佳時差逆推 (Experiment A Coordinated Speed)
在號誌協調控制中，固定號誌時差（綠燈差）$\Delta t$，尋找平均延滯（Delay）最低的最佳街廓長度 $L_{best}$：
$$v_{cruise} = \frac{L_{best}}{\Delta t}$$

### 3. 利己社會成本比 (Experiment B2 Selfishness Ratio)
量化主體車（Subject Car，如吸血鬼駕駛）在 3 車道中採取極端駕駛行為時，個人時間收益與對背景車流造成的外部干擾之間的非對稱博弈關係：
$$\text{Selfishness Ratio} = \frac{\Delta T_{\text{subject\_saved}}}{\text{Social Cost}} = \frac{T_{\text{bg\_control}} - T_{\text{subject\_actual}}}{\sum_{i=1}^{N} (T_{\text{bg\_experimental\_i}} - T_{\text{bg\_control\_i}})}$$
- **$T_{\text{bg\_control}}$**：同種子對照組中，背景車的平均旅行時間。
- **$T_{\text{subject\_actual}}$**：實驗組中，主體車（尾隨救護車）的實際旅行時間。
- **$T_{\text{bg\_experimental\_i}}$**：實驗組中，第 $i$ 輛背景車因主體車頻繁切車插隊與強行阻礙救護車避讓所導致的實際旅行時間。

### 4. 幽靈塞車判定邏輯 (Experiment B1 Phantom Jam Detection)
在 6 車道路段下，當某個檢測區間（Sector，長度 10 Cells）的某條同向車道滿足以下條件，判定發生一次幽靈塞車：
1. **速度驟降**：該車道區間平均車速 $V_{sector}(s, t) \le 1.0$。
2. **無外部障礙**：該區間無紅燈且無特種車避讓阻擋。
3. **衝擊波回傳**：該低速狀態在空間上向後傳播，即 $V_{sector}(s-1, t+1) \le 1.0$。

---

## 二、 API 接口規格說明

### 1. 運行模擬實驗 (POST /api/v1/simulation/run)

#### 請求標頭 (Request Headers)
`Content-Type: application/json`

#### 請求參數 (Request Body)
```json
{
  "random_seed": 42,
  "simulation_steps": 1000,
  "background_density": 0.15,
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
    "emergency_spawn_tick": 50,
    "subject_spawn_tick": 70
  }
}
```

##### 參數詳細說明：
| 欄位名稱 | 類型 | 預設值 | 說明 |
| :--- | :--- | :--- | :--- |
| `random_seed` | Integer | 42 | 亂數種子，用以確保模擬隨機慢化與注入機率可完全重現。 |
| `simulation_steps`| Integer | 1000 | 模擬運行的總時間步（Ticks）。 |
| `background_density`| Float | 0.15 | 背景車流初始與注入密度（0.0 ~ 0.5）。 |
| `experiment_type` | String | "custom" | 實驗類型：`"A"` (長度掃描), `"B1"` (切車魔人對比), `"B2"` (吸血鬼尾隨), `"custom"` (自訂參數)。 |
| `export_trajectories`| Boolean | false | 是否匯出全車輛的每一步時空軌跡數據。 |
| `signal_mode` | String | "alternating" | 號誌控制模式：`"all_sync"` (全部同時), `"alternating"` (交互切換), `"green_wave"` (靜態綠波), `"adaptive"` (智慧感測)。 |
| `reversible_modes_h` | Array | `["none", ...]` | 水平各路段的調撥車道配置。選值：`"none"`, `"peak_fwd"`, `"peak_bwd"`。 |
| `reversible_modes_v` | Array | `["none", ...]` | 垂直各路段的調撥車道配置。選值：`"none"`, `"peak_fwd"`, `"peak_bwd"`。 |
| `params.delta_t` | Integer | 30 | 號誌時差（綠燈間隔步數），適用於實驗 A。 |
| `params.seg_len` | Integer | 20 | 街廓長度（元胞格數 Cells，12 ~ 28）。 |
| `params.p_change_background`| Float | 0.1 | 背景車變換車道機率（0.0 ~ 1.0）。 |
| `params.p_change_subject`| Float | 1.0 | 主體車變換車道機率。 |

---

#### 回應參數 (Response Body - JSON)
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

##### 回應指標說明：
*   **`metrics.phantom_jams_detected`**：模擬中偵測到的無號誌煞車波（幽靈塞車）傳播總次數。
*   **`experiment_results.personal_time_saved`**：主體車相較於背景車所節省的旅行秒數（單位：Ticks）。
*   **`experiment_results.social_cost_total_delay`**：所有背景車因為主體車的插入與破壞避讓，集體增加的延滯時間總和。
*   **`experiment_results.selfishness_ratio`**：利己社會成本比。數值越低，代表個人微小收益造成的社會外部破壞越大。

---

## 三、 Python 再現實驗範例

AI Agent 可使用以下 Python 腳本調用 API，獲取 6 車道網格數據並自動繪製**「時空軌跡圖」**：

```python
import requests
import matplotlib.pyplot as plt

url = "http://localhost:3000/api/v1/simulation/run"
payload = {
    "random_seed": 42,
    "simulation_steps": 1000,
    "background_density": 0.18,
    "experiment_type": "B2",
    "export_trajectories": True,
    "params": {
        "p_change_background": 0.1,
        "p_change_subject": 1.0
    }
}

response = requests.post(url, json=payload)
data = response.json()

if data.get("success"):
    results = data["experiment_results"]
    print(f"--- 6車道網格實驗結果 ---")
    print(f"個人時間收益: {results['personal_time_saved']} Ticks")
    print(f"外部社會成本: {results['social_cost_total_delay']} Ticks")
    print(f"利己社會成本比 (Selfishness Ratio): {results['selfishness_ratio']}")
```
