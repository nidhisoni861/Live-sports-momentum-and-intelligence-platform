"use client";

import { useState } from "react";

function VideoTest() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [totalProgress, setTotalProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [analysisComplete, setAnalysisComplete] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
      setVideoUrl("");
      setResult("");
      setAnalysisComplete(false);
    }
  };

  const analyzeVideo = async () => {
    if (!file) return;

    // Reset states
    setIsLoading(true);
    setUploadProgress(0);
    setIsProcessing(false);
    setTotalProgress(0);
    setVideoUrl("");
    setResult("");
    setAnalysisComplete(false);

    try {
      const formData = new FormData();
      formData.append("video", file);

      // Create upload progress tracking
      const xhr = new XMLHttpRequest();
      
      // Track upload progress
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(progress);
          // Update total progress (upload is 30% of total)
          const total = Math.round(progress * 0.3);
          setTotalProgress(total);
          console.log(`Upload progress: ${progress}%, Total: ${total}%`);
        }
      });

      // When upload starts, ensure we show progress
      xhr.upload.addEventListener('loadstart', () => {
        setUploadProgress(0);
        setTotalProgress(0);
      });

      // When upload is complete, start processing simulation
      xhr.addEventListener('load', () => {
        setIsProcessing(true);
        setUploadProgress(100);
        // Start simulating API processing progress (70% of total)
        let processingProgress = 30; // Start from 30% (upload complete)
        const processingInterval = setInterval(() => {
          processingProgress += 2; // Increment by 2% every 200ms
          if (processingProgress <= 100) {
            setTotalProgress(processingProgress);
            console.log(`Processing progress: ${processingProgress}%`);
          } else {
            clearInterval(processingInterval);
          }
        }, 200);
      });

      // Create promise to handle the request
      const responsePromise = new Promise((resolve, reject) => {
        xhr.open('POST', '/api/analyze-video');
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            reject(new Error(`HTTP error! status: ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(formData);
      });

      const data = await responsePromise as any;

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

      // Set results and make video playable
      setResult(
        `🏷️ Labels:\n${labels}\n\n🎯 Objects:\n${objects}\n\n📝 Text:\n${text}`
      );
      setVideoUrl(URL.createObjectURL(file));
      setAnalysisComplete(true);
      setTotalProgress(100); // Ensure progress reaches 100% when complete
    } catch (err) {
      console.error(err);
      setResult("Error analyzing video. Check console.");
    } finally {
      setIsLoading(false);
      setIsProcessing(false);
      setUploadProgress(0);
      setTotalProgress(0); // Reset total progress
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
        disabled={isLoading}
        className="block w-full mb-4 text-sm"
      />

      <button
        onClick={analyzeVideo}
        disabled={!file || isLoading}
        className={`px-4 py-2 rounded-md text-white ${
          isLoading ? "bg-green-400" : "bg-green-600 hover:bg-green-700"
        }`}
      >
        {isLoading ? "Processing..." : "Analyze Video"}
      </button>

      {/* Upload Progress Bar */}
      {isLoading && (
        <div className="mt-4">
          <div className="text-sm text-gray-600 mb-2">
            {totalProgress < 30 
              ? "Uploading video..." 
              : totalProgress < 100 
              ? "Processing video with AI..." 
              : "Analysis complete!"
            }
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${totalProgress}%` }}
            />
          </div>
          <div className="text-xs text-gray-500 mt-1">{totalProgress}%</div>
        </div>
      )}

      {/* Processing Loader */}
      {isProcessing && (
        <div className="mt-4 flex items-center space-x-2">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          <span className="text-sm text-gray-600">Processing video...</span>
        </div>
      )}

      {/* Video Player - Only show after analysis is complete */}
      {analysisComplete && videoUrl && (
        <div className="mt-6">
          <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-white">
            Video
          </h3>
          <video
            src={videoUrl}
            controls
            autoPlay
            className="w-full rounded-md"
          />
        </div>
      )}

      {/* Results - Only show after analysis is complete */}
      {analysisComplete && result && (
        <div className="mt-6">
          <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-white">
            Analysis Results
          </h3>
          <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-md">
            <div className="space-y-4 text-sm">
              {result.split('\n\n').map((section, index) => (
                <div key={index}>
                  <div className="font-semibold text-gray-900 dark:text-white mb-2">
                    {section.split(':')[0]}
                  </div>
                  <div className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                    {section.split(':')[1]?.trim() || 'No data'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default VideoTest;
