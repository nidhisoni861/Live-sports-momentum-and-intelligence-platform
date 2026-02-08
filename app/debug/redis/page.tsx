"use client";

import { useEffect, useState } from "react";

type LiveResponse = {
  success: boolean;
  source?: string;
  t?: number;
  live?: {
    videoId: string;
    t: number;
    playerCount: number;
    scoreboard: string;
    score: string;
    lastUpdated: string;
    labels?: { value: string; score: number }[];
  } | null;
  error?: string;
};

export default function RedisDebugPage() {
  const [videoId, setVideoId] = useState("football.mp4");
  const [t, setT] = useState<number>(0);
  const [json, setJson] = useState<LiveResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(vId = videoId, time = t) {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/analyze-video?videoId=${encodeURIComponent(vId)}&t=${time}`,
        {
          cache: "no-store",
        },
      );
      const data = (await res.json()) as LiveResponse;
      setJson(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const live = json?.live;

  return (
    <div style={{ padding: 18, fontFamily: "system-ui" }}>
      <h2 style={{ marginBottom: 10 }}>Redis Live Debug</h2>

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <label>
          VideoId{" "}
          <input
            value={videoId}
            onChange={(e) => setVideoId(e.target.value)}
            style={{ width: 260, padding: 6 }}
          />
        </label>

        <label>
          t(s){" "}
          <input
            type="number"
            value={t}
            onChange={(e) => setT(Number(e.target.value))}
            style={{ width: 90, padding: 6 }}
          />
        </label>

        <button onClick={() => load()} style={{ padding: "6px 10px" }}>
          {loading ? "Loading..." : "Fetch"}
        </button>

        <button
          onClick={() => {
            const nt = Math.max(0, t - 1);
            setT(nt);
            load(videoId, nt);
          }}
          style={{ padding: "6px 10px" }}
        >
          -1s
        </button>

        <button
          onClick={() => {
            const nt = t + 1;
            setT(nt);
            load(videoId, nt);
          }}
          style={{ padding: "6px 10px" }}
        >
          +1s
        </button>

        <button
          onClick={() => {
            setT(0);
            load(videoId, 0);
          }}
          style={{ padding: "6px 10px" }}
        >
          Reset
        </button>
      </div>

      <hr style={{ margin: "14px 0" }} />

      <div style={{ display: "grid", gap: 8 }}>
        <div>
          <b>Status:</b> {json?.success ? "OK" : "FAIL"}{" "}
          {json?.source ? `(${json.source})` : ""}
        </div>
        {json?.error && (
          <div style={{ color: "crimson" }}>
            <b>Error:</b> {json.error}
          </div>
        )}

        <div
          style={{
            display: "grid",
            gap: 6,
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 8,
          }}
        >
          <div>
            <b>Players:</b> {live?.playerCount ?? "—"}
          </div>
          <div>
            <b>Scoreboard text:</b> {live?.scoreboard || "—"}
          </div>
          <div>
            <b>Parsed score:</b> {live?.score || "—"}
          </div>
          <div>
            <b>Updated:</b> {live?.lastUpdated || "—"}
          </div>
        </div>

        <details>
          <summary style={{ cursor: "pointer" }}>
            <b>Raw JSON</b>
          </summary>
          <pre
            style={{
              background: "#111",
              color: "#0f0",
              padding: 12,
              borderRadius: 8,
              overflowX: "auto",
            }}
          >
            {JSON.stringify(json, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  );
}
