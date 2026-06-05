import { useState } from "react";
import TrafficSimSpec from "./components/TrafficSimSpec.jsx";
import TrafficSimImproved from "../traffic_simulation_improved.jsx";
import TrafficSimOriginal from "../traffic_simulation_destination.jsx";

function App() {
  const [version, setVersion] = useState("spec");

  return (
    <div style={{ background: "#0a0a12", minHeight: "100vh" }}>
      <div style={{
        background: "#121222",
        padding: "10px 16px",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: "12px",
        borderBottom: "1px solid #22223a",
        fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace",
        fontSize: "12px"
      }}>
        <span style={{ color: "#7a7a9a" }}>切換對照版本：</span>
        <button 
          onClick={() => setVersion("original")}
          style={{
            background: version === "original" ? "#ef4444" : "#1e1e32",
            color: version === "original" ? "#fff" : "#b8b8d0",
            border: version === "original" ? "1px solid #f87171" : "1px solid #30304a",
            borderRadius: "4px",
            padding: "5px 14px",
            cursor: "pointer",
            fontSize: "11px",
            fontWeight: "bold",
            transition: "all 0.2s"
          }}
        >
          原始對照組 (Original Baseline V0)
        </button>
        <button 
          onClick={() => setVersion("improved")}
          style={{
            background: version === "improved" ? "#eab308" : "#1e1e32",
            color: version === "improved" ? "#fff" : "#b8b8d0",
            border: version === "improved" ? "1px solid #fef08a" : "1px solid #30304a",
            borderRadius: "4px",
            padding: "5px 14px",
            cursor: "pointer",
            fontSize: "11px",
            fontWeight: "bold",
            transition: "all 0.2s"
          }}
        >
          論文實驗組 (Improved Thesis V1)
        </button>
        <button 
          onClick={() => setVersion("spec")}
          style={{
            background: version === "spec" ? "#6366f1" : "#1e1e32",
            color: version === "spec" ? "#fff" : "#b8b8d0",
            border: version === "spec" ? "1px solid #818cf8" : "1px solid #30304a",
            borderRadius: "4px",
            padding: "5px 14px",
            cursor: "pointer",
            fontSize: "11px",
            fontWeight: "bold",
            transition: "all 0.2s"
          }}
        >
          雙車道 API & Spec Dashboard (V2 New)
        </button>
      </div>
      {version === "spec" && <TrafficSimSpec />}
      {version === "improved" && <TrafficSimImproved />}
      {version === "original" && <TrafficSimOriginal />}
    </div>
  );
}

export default App;
