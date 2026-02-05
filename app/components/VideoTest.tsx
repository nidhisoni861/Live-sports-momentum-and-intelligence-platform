"use client";

import { useState } from "react";

function VideoTest() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
    }
  };

  const analyzeVideo = async () => {
    if (!file) return;

    setIsLoading(true);
    setResult("Analyzing video...");

    try {
      const formData = new FormData();
      formData.append("video", file);

      const response = await fetch("/api/analyze-video", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!data.success) {
        setResult(`Error: ${data.error || "Unknown error"}`);
        return;
      }

      const summary = data.summary || {};

      // 🏷️ Labels
      const labels =
        summary.labels?.length > 0
          ? summary.labels
              .map(
                (label: any) =>
                  `• ${label.description} (${Math.round(
                    label.confidence * 100
                  )}%)`
              )
              .join("\n")
          : "No labels detected";

      // 🎯 Objects
      const objects =
        summary.objects?.length > 0
          ? summary.objects
              .map(
                (obj: any) =>
                  `• ${obj.type} (${Math.round(
                    obj.confidence * 100
                  )}%) [${obj.segment.start}s – ${obj.segment.end}s]`
              )
              .join("\n")
          : "No objects detected";

      // 📝 Text (OCR)
      const text =
        summary.text?.length > 0
          ? summary.text
              .map(
                (t: any) =>
                  `• "${t.text}" (${Math.round(
                    (t.segments?.[0]?.confidence || 0) * 100
                  )}%)`
              )
              .join("\n")
          : "No text detected";

      setResult(
        `🏷️ Labels:\n${labels}\n\n🎯 Objects:\n${objects}\n\n📝 Text:\n${text}`
      );
    } catch (err) {
      console.error(err);
      setResult("Error analyzing video. Check console.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-2xl p-6 bg-white rounded-lg shadow-md dark:bg-gray-800">
      <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">
        Google Video Intelligence API Test
      </h1>

      <input
        type="file"
        accept="video/*"
        onChange={handleFileChange}
        className="block w-full mb-4 text-sm"
      />

      <button
        onClick={analyzeVideo}
        disabled={!file || isLoading}
        className={`px-4 py-2 rounded-md text-white ${
          isLoading ? "bg-green-400" : "bg-green-600 hover:bg-green-700"
        }`}
      >
        {isLoading ? "Analyzing..." : "Analyze Video"}
      </button>

      {file && (
        <div className="mt-4">
          <video
            src={URL.createObjectURL(file)}
            controls
            className="w-full rounded-md"
          />
        </div>
      )}

      {result && (
        <pre className="mt-6 p-4 bg-gray-100 dark:bg-gray-700 rounded-md whitespace-pre-wrap text-sm">
          {result}
        </pre>
      )}
    </div>
  );
}

export default VideoTest;
