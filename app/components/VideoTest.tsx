"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ===================== Types =====================
type BoundingBox = { left: number; top: number; right: number; bottom: number };
type ObjectFrame = { t: number; box: BoundingBox };

type TrackedObject = {
  type: string;
  entityId: string;
  confidence: number;
  segment: { start: number; end: number };
  frames: ObjectFrame[];
};

type TimelineEvent = {
  type: "label" | "object" | "text";
  name: string;
  confidence: number;
  start: number;
  end: number;
};

type SidebarTab = "objects" | "labels" | "text";

// ===================== Colors =====================
const TYPE_COLORS: Record<string, string> = {
  person: "#3b82f6",
  player: "#3b82f6",
  goalkeeper: "#eab308",
  referee: "#ef4444",
  ball: "#22c55e",
  football: "#22c55e",
  "sports ball": "#22c55e",
};

function getColor(type: string): string {
  const key = type.toLowerCase();
  for (const [k, v] of Object.entries(TYPE_COLORS)) {
    if (key.includes(k)) return v;
  }
  let hash = 0;
  for (let i = 0; i < key.length; i++)
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 70%, 55%)`;
}

// ===================== Interpolation =====================
function interpolateBox(
  frames: ObjectFrame[],
  currentTime: number
): BoundingBox | null {
  if (frames.length === 0) return null;
  if (currentTime <= frames[0].t) return frames[0].box;
  if (currentTime >= frames[frames.length - 1].t)
    return frames[frames.length - 1].box;

  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    if (currentTime >= a.t && currentTime <= b.t) {
      const r = (currentTime - a.t) / (b.t - a.t);
      return {
        left: a.box.left + (b.box.left - a.box.left) * r,
        top: a.box.top + (b.box.top - a.box.top) * r,
        right: a.box.right + (b.box.right - a.box.right) * r,
        bottom: a.box.bottom + (b.box.bottom - a.box.bottom) * r,
      };
    }
  }
  return null;
}

// ===================== SVG Icons (inline) =====================
function IconUpload() {
  return (
    <svg
      width="48"
      height="48"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
      />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

// ===================== Component =====================
export default function VideoTest() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rafRef = useRef<number>(0);

  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [trackedObjects, setTrackedObjects] = useState<TrackedObject[]>([]);
  const [activeEvents, setActiveEvents] = useState<TimelineEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [totalProgress, setTotalProgress] = useState(0);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [showBoxes, setShowBoxes] = useState(true);
  const [liveStats, setLiveStats] = useState<Record<string, number>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<SidebarTab>("objects");
  const [errorMsg, setErrorMsg] = useState("");

  // ---- Helpers ----
  const fileSizeMB = file ? (file.size / (1024 * 1024)).toFixed(1) : "0";

  const progressStep: "idle" | "uploading" | "processing" | "done" =
    !isLoading && !analysisComplete
      ? "idle"
      : totalProgress < 30
      ? "uploading"
      : totalProgress < 100
      ? "processing"
      : "done";

  // ---- File handling ----
  const acceptFile = (f: File) => {
    if (!f.type.startsWith("video/")) {
      setErrorMsg("Please select a valid video file.");
      return;
    }
    setErrorMsg("");
    setFile(f);
    setTimeline([]);
    setActiveEvents([]);
    setTrackedObjects([]);
    setAnalysisComplete(false);
    setLiveStats({});
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) acceptFile(e.target.files[0]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.[0]) acceptFile(e.dataTransfer.files[0]);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  // ---- Analyze ----
  const analyzeVideo = async () => {
    if (!file) return;
    setIsLoading(true);
    setTotalProgress(0);
    setAnalysisComplete(false);
    setErrorMsg("");

    const formData = new FormData();
    formData.append("video", file);

    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        setTotalProgress(Math.round((e.loaded / e.total) * 30));
    };

    xhr.open("POST", "/api/analyze-video");
    xhr.send(formData);

    let response: any;
    try {
      response = await new Promise<any>((resolve, reject) => {
        xhr.onload = () => {
          setTotalProgress(60);
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error("Invalid response from server"));
          }
        };
        xhr.onerror = () => reject(new Error("Network error"));
      });
    } catch (err: any) {
      setErrorMsg(err.message ?? "Something went wrong");
      setIsLoading(false);
      return;
    }

    if (!response.success) {
      setErrorMsg(response.error ?? "Analysis failed");
      setIsLoading(false);
      return;
    }

    const summary = response.summary || {};
    const events: TimelineEvent[] = [];

    summary.labels?.forEach((l: any) => {
      l.segments?.forEach((s: any) => {
        events.push({
          type: "label",
          name: l.description,
          confidence: l.confidence,
          start: s.start,
          end: s.end,
        });
      });
    });

    summary.objects?.forEach((o: any) => {
      events.push({
        type: "object",
        name: o.type,
        confidence: o.confidence,
        start: o.segment.start,
        end: o.segment.end,
      });
    });

    summary.text?.forEach((t: any) => {
      t.segments?.forEach((s: any) => {
        events.push({
          type: "text",
          name: t.text,
          confidence: s.confidence,
          start: s.start,
          end: s.end,
        });
      });
    });

    setTrackedObjects(summary.objects ?? []);
    setTimeline(events);
    setVideoUrl(URL.createObjectURL(file));
    setTotalProgress(100);
    setIsLoading(false);
    setAnalysisComplete(true);
  };

  // ---- Canvas drawing ----
  const drawDetections = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !showBoxes) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = video.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const currentTime = video.currentTime;
    const stats: Record<string, number> = {};

    for (const obj of trackedObjects) {
      if (currentTime < obj.segment.start || currentTime > obj.segment.end)
        continue;

      const box = interpolateBox(obj.frames, currentTime);
      if (!box) continue;

      const color = getColor(obj.type);
      const x = box.left * canvas.width;
      const y = box.top * canvas.height;
      const w = (box.right - box.left) * canvas.width;
      const h = (box.bottom - box.top) * canvas.height;

      // Bounding box
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      // Corner accents
      const cLen = Math.min(w, h) * 0.22;
      ctx.lineWidth = 3;
      // TL
      ctx.beginPath();
      ctx.moveTo(x, y + cLen);
      ctx.lineTo(x, y);
      ctx.lineTo(x + cLen, y);
      ctx.stroke();
      // TR
      ctx.beginPath();
      ctx.moveTo(x + w - cLen, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + cLen);
      ctx.stroke();
      // BL
      ctx.beginPath();
      ctx.moveTo(x, y + h - cLen);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x + cLen, y + h);
      ctx.stroke();
      // BR
      ctx.beginPath();
      ctx.moveTo(x + w - cLen, y + h);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + w, y + h - cLen);
      ctx.stroke();

      // Foot ellipse
      const cx = x + w / 2;
      const by = y + h;
      const mr = Math.max(w * 0.25, 6);
      ctx.beginPath();
      ctx.ellipse(cx, by, mr, mr * 0.4, 0, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label chip
      const fs = Math.max(10, Math.min(13, canvas.width / 65));
      ctx.font = `600 ${fs}px system-ui, sans-serif`;
      const labelText = `${obj.type} ${(obj.confidence * 100).toFixed(0)}%`;
      const tw = ctx.measureText(labelText).width;
      const pad = 4;
      const chipH = fs + pad * 2;
      const chipY = y - chipH - 2;

      // Rounded chip bg
      const radius = 4;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(x + radius, chipY);
      ctx.lineTo(x + tw + pad * 2 - radius, chipY);
      ctx.quadraticCurveTo(x + tw + pad * 2, chipY, x + tw + pad * 2, chipY + radius);
      ctx.lineTo(x + tw + pad * 2, chipY + chipH - radius);
      ctx.quadraticCurveTo(x + tw + pad * 2, chipY + chipH, x + tw + pad * 2 - radius, chipY + chipH);
      ctx.lineTo(x + radius, chipY + chipH);
      ctx.quadraticCurveTo(x, chipY + chipH, x, chipY + chipH - radius);
      ctx.lineTo(x, chipY + radius);
      ctx.quadraticCurveTo(x, chipY, x + radius, chipY);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.fillStyle = "#fff";
      ctx.fillText(labelText, x + pad, chipY + fs + pad - 1);

      stats[obj.type] = (stats[obj.type] || 0) + 1;
    }

    // Stats HUD (top-right)
    if (Object.keys(stats).length > 0) {
      const fs = Math.max(11, Math.min(14, canvas.width / 55));
      ctx.font = `600 ${fs}px system-ui, sans-serif`;

      const entries = Object.entries(stats);
      const boxW = 180;
      const lineH = fs + 10;
      const boxH = lineH * entries.length + 20;
      const boxX = canvas.width - boxW - 10;
      const boxY = 10;

      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 8);
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 8);
      ctx.stroke();

      entries.forEach(([type, count], i) => {
        const yPos = boxY + 14 + i * lineH;
        const c = getColor(type);

        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(boxX + 16, yPos + fs / 2 - 1, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillText(type, boxX + 28, yPos + fs - 1);

        ctx.fillStyle = "#fff";
        ctx.font = `700 ${fs}px system-ui, sans-serif`;
        ctx.fillText(String(count), boxX + boxW - 30, yPos + fs - 1);
        ctx.font = `600 ${fs}px system-ui, sans-serif`;
      });
    }

    setLiveStats(stats);
  }, [trackedObjects, showBoxes]);

  // ---- Animation loop ----
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !analysisComplete) return;
    const loop = () => {
      drawDetections();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [analysisComplete, drawDetections]);

  // ---- Timeline sync ----
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTimeUpdate = () => {
      const t = video.currentTime;
      setActiveEvents(timeline.filter((e) => t >= e.start && t <= e.end));
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, [timeline]);

  // ---- Resize observer ----
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const observer = new ResizeObserver(() => drawDetections());
    observer.observe(video);
    return () => observer.disconnect();
  }, [drawDetections]);

  // ---- Filtered events by tab ----
  const tabToType: Record<SidebarTab, TimelineEvent["type"]> = {
    objects: "object",
    labels: "label",
    text: "text",
  };
  const filteredEvents = activeEvents.filter((e) => e.type === tabToType[activeTab]);

  const tabCounts = {
    objects: activeEvents.filter((e) => e.type === "object").length,
    labels: activeEvents.filter((e) => e.type === "label").length,
    text: activeEvents.filter((e) => e.type === "text").length,
  };

  // ===================== Render =====================
  return (
    <div className="space-y-6">
      {/* ---- Header ---- */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Live Sports AI
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Real-time video intelligence powered by Google Cloud
          </p>
        </div>
        {analysisComplete && (
          <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-live" />
            LIVE DETECTION
          </div>
        )}
      </header>

      {/* ---- Upload area (shown when no analysis yet) ---- */}
      {!analysisComplete && !isLoading && (
        <div
          className={`
            relative rounded-xl border-2 border-dashed transition-all duration-200
            ${isDragging
              ? "border-blue-500 bg-blue-500/5"
              : file
              ? "border-zinc-700 bg-zinc-900"
              : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-600"
            }
          `}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {!file ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              <div className={`mb-4 transition-colors ${isDragging ? "text-blue-400" : ""}`}>
                <IconUpload />
              </div>
              <p className="text-base font-medium text-zinc-300 mb-1">
                Drop your match footage here
              </p>
              <p className="text-sm text-zinc-600 mb-5">
                MP4, MOV, AVI, or WebM
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-5 py-2 text-sm font-medium rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 hover:text-white transition"
              >
                Browse Files
              </button>
              <label>
                <span className="sr-only">Select video file</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>
          ) : (
            /* File selected */
            <div className="flex items-center justify-between px-6 py-5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="text-blue-400">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-white truncate max-w-xs">
                    {file.name}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {fileSizeMB} MB
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setErrorMsg("");
                  }}
                  className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white border border-zinc-700 rounded-lg hover:bg-zinc-800 transition"
                >
                  Change
                </button>
                <button
                  type="button"
                  onClick={analyzeVideo}
                  className="px-5 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition shadow-lg shadow-blue-500/20"
                >
                  Analyze Video
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- Error ---- */}
      {errorMsg && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {errorMsg}
        </div>
      )}

      {/* ---- Loading / Progress ---- */}
      {isLoading && (
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-6 animate-fade-in-up">
          {/* Step indicators */}
          <div className="flex items-center gap-3 mb-5">
            {(["uploading", "processing", "done"] as const).map((step, i) => {
              const isActive = progressStep === step;
              const isDone =
                (step === "uploading" && (progressStep === "processing" || progressStep === "done")) ||
                (step === "processing" && progressStep === "done") ||
                (step === "done" && progressStep === "done");
              return (
                <div key={step} className="flex items-center gap-3">
                  {i > 0 && (
                    <div
                      className={`w-8 h-px ${
                        isDone ? "bg-emerald-500" : "bg-zinc-700"
                      }`}
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                        isDone
                          ? "bg-emerald-500 text-white"
                          : isActive
                          ? "bg-blue-500 text-white animate-pulse"
                          : "bg-zinc-800 text-zinc-500 border border-zinc-700"
                      }`}
                    >
                      {isDone ? <IconCheck /> : i + 1}
                    </div>
                    <span
                      className={`text-xs font-medium capitalize ${
                        isDone
                          ? "text-emerald-400"
                          : isActive
                          ? "text-white"
                          : "text-zinc-600"
                      }`}
                    >
                      {step === "done" ? "Complete" : step}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Progress bar */}
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${totalProgress}%`,
                background:
                  totalProgress >= 100
                    ? "#22c55e"
                    : "linear-gradient(90deg, #3b82f6, #8b5cf6)",
              }}
            />
          </div>
          <p className="text-xs text-zinc-500 mt-2 text-right">
            {totalProgress}%
          </p>
        </div>
      )}

      {/* ---- Analysis Result: Video + Sidebar ---- */}
      {analysisComplete && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 animate-fade-in-up">
          {/* Video panel */}
          <div className="lg:col-span-8 xl:col-span-9 space-y-4">
            {/* Video container */}
            <div
              ref={containerRef}
              className="relative w-full rounded-xl overflow-hidden video-glow bg-black"
            >
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                className="w-full block"
              />
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full pointer-events-none"
              />
            </div>

            {/* Controls bar */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              {/* Detection badges */}
              <div className="flex flex-wrap gap-2">
                {Object.entries(liveStats).map(([type, count]) => (
                  <span
                    key={type}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border"
                    style={{
                      color: getColor(type),
                      borderColor: getColor(type) + "33",
                      background: getColor(type) + "10",
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: getColor(type) }}
                    />
                    {type}: {count}
                  </span>
                ))}
                {Object.keys(liveStats).length === 0 && (
                  <span className="text-xs text-zinc-600">
                    Play video to see detections
                  </span>
                )}
              </div>

              {/* Toggle + new file */}
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showBoxes}
                    onChange={(e) => setShowBoxes(e.target.checked)}
                    className="accent-blue-500 w-3.5 h-3.5"
                  />
                  Overlay
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setAnalysisComplete(false);
                    setVideoUrl("");
                    setTimeline([]);
                    setTrackedObjects([]);
                    setLiveStats({});
                  }}
                  className="text-xs text-zinc-500 hover:text-white transition"
                >
                  New video
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar panel */}
          <div className="lg:col-span-4 xl:col-span-3">
            <div className="rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden h-full flex flex-col">
              {/* Tabs */}
              <div className="flex border-b border-zinc-800">
                {(["objects", "labels", "text"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider transition-colors relative ${
                      activeTab === tab
                        ? "text-white"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {tab}
                    {tabCounts[tab] > 0 && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-zinc-800 text-zinc-400">
                        {tabCounts[tab]}
                      </span>
                    )}
                    {activeTab === tab && (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />
                    )}
                  </button>
                ))}
              </div>

              {/* Events list */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2 max-h-[500px]">
                {filteredEvents.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-10 text-zinc-600">
                    <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="mb-2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <p className="text-xs">No {activeTab} detected right now</p>
                    <p className="text-[10px] text-zinc-700 mt-0.5">Play the video to see live data</p>
                  </div>
                )}

                {filteredEvents.map((e, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-800 hover:border-zinc-700 transition"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-white">
                        {e.name}
                      </span>
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                        style={{
                          color: getColor(e.name),
                          backgroundColor: getColor(e.name) + "15",
                        }}
                      >
                        {(e.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    {/* Confidence bar */}
                    <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${e.confidence * 100}%`,
                          backgroundColor: getColor(e.name),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Summary footer */}
              {timeline.length > 0 && (
                <div className="border-t border-zinc-800 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold mb-2">
                    Total Detections
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: "Objects", type: "object" as const, color: "#3b82f6" },
                      { label: "Labels", type: "label" as const, color: "#8b5cf6" },
                      { label: "Text", type: "text" as const, color: "#eab308" },
                    ].map((s) => (
                      <div
                        key={s.type}
                        className="rounded-lg bg-zinc-800/50 py-2"
                      >
                        <p className="text-lg font-bold" style={{ color: s.color }}>
                          {timeline.filter((e) => e.type === s.type).length}
                        </p>
                        <p className="text-[10px] text-zinc-500">{s.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}