"use client";

import { useEffect, useRef, useState } from "react";

type TimelineEvent = {
  type: "label" | "object" | "text";
  name: string;
  confidence: number;
  start: number;
  end: number;
};

function VideoTest() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [activeEvents, setActiveEvents] = useState<TimelineEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [totalProgress, setTotalProgress] = useState(0);
  const [analysisComplete, setAnalysisComplete] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
      setTimeline([]);
      setActiveEvents([]);
      setAnalysisComplete(false);
    }
  };

  const analyzeVideo = async () => {
    if (!file) return;

    setIsLoading(true);
    setTotalProgress(0);
    setAnalysisComplete(false);

    const formData = new FormData();
    formData.append("video", file);

    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setTotalProgress(Math.round((e.loaded / e.total) * 30));
      }
    };

    xhr.onload = () => {
      setTotalProgress(30);
    };

    xhr.open("POST", "/api/analyze-video");
    xhr.send(formData);

    const response = await new Promise<any>((resolve, reject) => {
      xhr.onload = () => resolve(JSON.parse(xhr.responseText));
      xhr.onerror = () => reject();
    });

    if (!response.success) {
      setIsLoading(false);
      return;
    }

    const summary = response.summary || {};
    const events: TimelineEvent[] = [];

    // 🏷️ Labels
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

    // 🎯 Objects
    summary.objects?.forEach((o: any) => {
      events.push({
        type: "object",
        name: o.type,
        confidence: o.confidence,
        start: o.segment.start,
        end: o.segment.end,
      });
    });

    // 📝 Text
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

    setTimeline(events);
    setVideoUrl(URL.createObjectURL(file));
    setTotalProgress(100);
    setIsLoading(false);
    setAnalysisComplete(true);
  };

  // 🔥 LIVE VIDEO SYNC
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      const t = video.currentTime;
      const active = timeline.filter(
        (e) => t >= e.start && t <= e.end
      );
      setActiveEvents(active);
    };

    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, [timeline]);

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white dark:bg-gray-900 rounded-lg shadow">
      <h1 className="text-2xl font-bold mb-4">🎥 Live Video AI Analyzer</h1>

      <input type="file" accept="video/*" onChange={handleFileChange} />

      <button
        onClick={analyzeVideo}
        disabled={!file || isLoading}
        className="mt-4 px-4 py-2 bg-green-600 text-white rounded"
      >
        {isLoading ? "Analyzing..." : "Analyze Video"}
      </button>

      {isLoading && (
        <div className="mt-4">
          <div className="h-2 bg-gray-200 rounded">
            <div
              className="h-2 bg-blue-600 rounded"
              style={{ width: `${totalProgress}%` }}
            />
          </div>
          <p className="text-xs mt-1">{totalProgress}%</p>
        </div>
      )}

      {analysisComplete && (
        <div className="mt-6 grid grid-cols-3 gap-6">
          {/* VIDEO */}
          <div className="col-span-2">
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              className="w-full rounded"
            />
          </div>

          {/* LIVE EVENTS */}
          <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded">
            <h3 className="font-semibold mb-2">📡 Live Insights</h3>

            {activeEvents.length === 0 && (
              <p className="text-sm text-gray-500">No events right now</p>
            )}

            {activeEvents.map((e, i) => (
              <div
                key={i}
                className="mb-2 p-2 bg-white dark:bg-gray-700 rounded"
              >
                <div className="text-xs uppercase text-gray-500">
                  {e.type}
                </div>
                <div className="font-medium">{e.name}</div>
                <div className="text-xs">
                  {(e.confidence * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default VideoTest;
