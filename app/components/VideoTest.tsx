"use client";

import { useState, useRef, useEffect } from 'react';

function VideoTest() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [shouldPlay, setShouldPlay] = useState(false);
  const [showDetections, setShowDetections] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setResult(null);
      setShouldPlay(false);
    }
  };

  // Draw detection boxes on canvas
  const drawDetections = () => {
    if (!videoRef.current || !canvasRef.current || !result || !showDetections) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw object bounding boxes
    if (result.objects) {
      result.objects.forEach((object: any) => {
        if (object.frames && object.frames.length > 0) {
          // Get the first frame for demonstration
          const frame = object.frames[0];
          if (frame.normalizedBoundingBox) {
            const box = frame.normalizedBoundingBox;
            const x = box.left || 0;
            const y = box.top || 0;
            const width = (box.right || 1) - x;
            const height = (box.bottom || 1) - y;

            // Draw rectangle
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 3;
            ctx.strokeRect(
              x * canvas.width,
              y * canvas.height,
              width * canvas.width,
              height * canvas.height
            );

            // Draw label
            ctx.fillStyle = '#00ff00';
            ctx.fillRect(
              x * canvas.width,
              y * canvas.height - 25,
              150,
              25
            );
            ctx.fillStyle = '#000000';
            ctx.font = '14px Arial';
            ctx.fillText(
              `${object.description} (${Math.round(object.confidence * 100)}%)`,
              x * canvas.width + 5,
              y * canvas.height - 8
            );
          }
        }
      });
    }

    // Draw logo bounding boxes
    if (result.logos) {
      result.logos.forEach((logo: any) => {
        if (logo.tracks && logo.tracks.length > 0) {
          logo.tracks.forEach((track: any) => {
            if (track.timestampedObjects && track.timestampedObjects.length > 0) {
              const obj = track.timestampedObjects[0];
              if (obj.normalizedBoundingBox) {
                const box = obj.normalizedBoundingBox;
                const x = box.left || 0;
                const y = box.top || 0;
                const width = (box.right || 1) - x;
                const height = (box.bottom || 1) - y;

                // Draw rectangle for logo
                ctx.strokeStyle = '#ffaa00';
                ctx.lineWidth = 3;
                ctx.strokeRect(
                  x * canvas.width,
                  y * canvas.height,
                  width * canvas.width,
                  height * canvas.height
                );

                // Draw label
                ctx.fillStyle = '#ffaa00';
                ctx.fillRect(
                  x * canvas.width,
                  y * canvas.height - 25,
                  150,
                  25
                );
                ctx.fillStyle = '#000000';
                ctx.font = '14px Arial';
                ctx.fillText(
                  `🏢 ${logo.description} (${Math.round(logo.confidence * 100)}%)`,
                  x * canvas.width + 5,
                  y * canvas.height - 8
                );
              }
            }
          });
        }
      });
    }
  };

  // Update canvas when video plays
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      drawDetections();
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [result, showDetections]);

  // Initial draw when result is available
  useEffect(() => {
    if (result) {
      drawDetections();
    }
  }, [result, showDetections]);

  const analyzeVideo = async () => {
    if (!file) return;
    
    setIsLoading(true);
    setShouldPlay(true);
    setResult(null);
    
    try {
      const formData = new FormData();
      formData.append('video', file);
      
      const response = await fetch('/api/analyze-video', {
        method: 'POST',
        body: formData,
      });
      
      const data = await response.json();
      
      if (data.error) {
        setResult({ error: data.error });
      } else {
        setResult(data);
      }
    } catch (error) {
      console.error('Error analyzing video:', error);
      setResult({ error: 'Error analyzing video. Check console for details.' });
    } finally {
      setIsLoading(false);
    }
  };

  const formatResults = (data: any) => {
    if (data.error) {
      return (
        <div className="alert alert-danger" role="alert">
          <i className="bi bi-exclamation-triangle-fill me-2"></i>
          {data.error}
        </div>
      );
    }

    const labels = data.labels?.map((label: any, index: number) => (
      <span key={`label-${index}`} className="badge bg-primary me-2 mb-2">
        {label.description} ({Math.round(label.confidence * 100)}%)
      </span>
    ));

    const objects = data.objects?.map((object: any, index: number) => (
      <span key={`object-${index}`} className="badge bg-success me-2 mb-2">
        {object.description} ({Math.round(object.confidence * 100)}%)
      </span>
    ));

    const text = data.text?.map((textItem: any, index: number) => (
      <div key={`text-${index}`} className="alert alert-light border-secondary">
        <small className="text-muted">Text {index + 1}:</small>
        <div className="fw-semibold">"{textItem.text}"</div>
        <small className="text-muted">Confidence: {Math.round(textItem.segments[0]?.confidence * 100 || 0)}%</small>
      </div>
    ));

    const logos = data.logos?.map((logo: any, index: number) => (
      <span key={`logo-${index}`} className="badge bg-warning text-dark me-2 mb-2">
        <i className="bi bi-building me-1"></i>
        {logo.description} ({Math.round(logo.confidence * 100)}%)
      </span>
    ));

    return (
      <div className="row">
        <div className="col-md-6 mb-3">
          <div className="card h-100 border-0 shadow-sm">
            <div className="card-header bg-primary text-white">
              <h6 className="mb-0">
                <i className="bi bi-tags-fill me-2"></i>Labels Detected
              </h6>
            </div>
            <div className="card-body">
              {labels?.length > 0 ? labels : <p className="text-muted">No labels detected</p>}
            </div>
          </div>
        </div>
        
        <div className="col-md-6 mb-3">
          <div className="card h-100 border-0 shadow-sm">
            <div className="card-header bg-success text-white">
              <h6 className="mb-0">
                <i className="bi bi-bullseye me-2"></i>Objects Tracked
              </h6>
            </div>
            <div className="card-body">
              {objects?.length > 0 ? objects : <p className="text-muted">No objects detected</p>}
            </div>
          </div>
        </div>
        
        <div className="col-md-6 mb-3">
          <div className="card h-100 border-0 shadow-sm">
            <div className="card-header bg-info text-white">
              <h6 className="mb-0">
                <i className="bi bi-fonts me-2"></i>Text Detected
              </h6>
            </div>
            <div className="card-body">
              {text?.length > 0 ? text : <p className="text-muted">No text detected</p>}
            </div>
          </div>
        </div>
        
        <div className="col-md-6 mb-3">
          <div className="card h-100 border-0 shadow-sm">
            <div className="card-header bg-warning text-dark">
              <h6 className="mb-0">
                <i className="bi bi-building me-2"></i>Logos Identified
              </h6>
            </div>
            <div className="card-body">
              {logos?.length > 0 ? logos : <p className="text-muted">No logos detected</p>}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="container-fluid py-4">
      <div className="row justify-content-center">
        <div className="col-12">
          <div className="text-center mb-5">
            <h1 className="display-4 fw-bold text-primary mb-3">
              Live Sports Momentum and Intelligence Platform
            </h1>
            <p className="lead text-muted">
              Advanced Video Analysis with Google Cloud AI
            </p>
          </div>
        </div>
      </div>

      <div className="row justify-content-center">
        <div className="col-lg-10">
          <div className="card border-0 shadow-lg mb-4">
            <div className="card-body p-4">
              <div className="row">
                <div className="col-md-8 mb-3">
                  <label htmlFor="videoUpload" className="form-label fw-semibold">
                    <i className="bi bi-camera-video me-2"></i>Upload Video File
                  </label>
                  <input
                    id="videoUpload"
                    type="file"
                    accept="video/*"
                    onChange={handleFileChange}
                    className="form-control form-control-lg"
                  />
                  {file && (
                    <small className="text-success d-block mt-2">
                      <i className="bi bi-check-circle-fill me-1"></i>
                      {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                    </small>
                  )}
                </div>
                <div className="col-md-4 mb-3 d-flex align-items-end">
                  <button
                    onClick={analyzeVideo}
                    disabled={!file || isLoading}
                    className={`btn btn-lg w-100 ${!file || isLoading ? 'btn-secondary' : 'btn-success'}`}
                  >
                    {isLoading ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-play-circle me-2"></i>Analyze Video
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {file && (
            <div className="card border-0 shadow-lg mb-4">
              <div className="card-header bg-gradient bg-primary text-white d-flex justify-content-between align-items-center">
                <h5 className="mb-0">
                  <i className="bi bi-play-fill me-2"></i>Video Preview
                </h5>
                <div className="form-check form-switch">
                  <input 
                    className="form-check-input" 
                    type="checkbox" 
                    id="detectionToggle"
                    checked={showDetections}
                    onChange={(e) => setShowDetections(e.target.checked)}
                  />
                  <label className="form-check-label text-white" htmlFor="detectionToggle">
                    Show Detections
                  </label>
                </div>
              </div>
              <div className="card-body p-0">
                <div className="ratio ratio-16x9 position-relative">
                  <video
                    ref={videoRef}
                    src={URL.createObjectURL(file)}
                    controls
                    autoPlay={shouldPlay}
                    className="w-full h-full"
                    style={{ 
                      boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
                      borderRadius: '0 0 0.375rem 0.375rem'
                    }}
                  />
                  <canvas
                    ref={canvasRef}
                    className="position-absolute top-0 start-0 w-100 h-100"
                    style={{ 
                      pointerEvents: 'none',
                      borderRadius: '0 0 0.375rem 0.375rem'
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {result && (
            <div className="card border-0 shadow-lg">
              <div className="card-header bg-gradient bg-secondary text-white">
                <h5 className="mb-0">
                  <i className="bi bi-graph-up me-2"></i>Analysis Results
                </h5>
              </div>
              <div className="card-body">
                {formatResults(result)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default VideoTest;
