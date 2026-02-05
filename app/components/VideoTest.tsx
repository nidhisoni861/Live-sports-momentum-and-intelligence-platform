"use client";

import { useState } from 'react';

function VideoTest() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const analyzeVideo = async () => {
    if (!file) return;
    
    setIsLoading(true);
    setResult('Analyzing video...');
    
    try {
      const formData = new FormData();
      formData.append('video', file);
      
      const response = await fetch('/api/analyze-video', {
        method: 'POST',
        body: formData,
      });
      
      const data = await response.json();
      
      if (data.error) {
        setResult(`Error: ${data.error}`);
      } else {
        // Format labels
        const labels = data.labels?.map((label: any) => 
          `${label.description} (${Math.round(label.confidence * 100)}%)`
        ).join(', ') || 'No labels detected';
        
        // Format objects
        const objects = data.objects?.map((object: any) => 
          `${object.description} (${Math.round(object.confidence * 100)}%)`
        ).join(', ') || 'No objects detected';
        
        // Format text
        const text = data.text?.map((textItem: any) => 
          `"${textItem.text}" (${Math.round(textItem.segments[0]?.confidence * 100 || 0)}%)`
        ).join(', ') || 'No text detected';
        
        setResult(`🏷️ **Labels:** ${labels}\n\n🎯 **Objects:** ${objects}\n\n📝 **Text:** ${text}`);
      }
    } catch (error) {
      console.error('Error analyzing video:', error);
      setResult('Error analyzing video. Check console for details.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-2xl p-6 bg-white rounded-lg shadow-md dark:bg-gray-800">
      <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">
        Google Video Intelligence API Test
      </h1>
      
      <div className="mb-4">
        <input
          type="file"
          accept="video/*"
          onChange={handleFileChange}
          className="block w-full text-sm text-gray-900 bg-gray-50 rounded-lg border border-gray-300 cursor-pointer focus:outline-none dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400"
        />
      </div>
      
      <button
        onClick={analyzeVideo}
        disabled={!file || isLoading}
        className={`px-4 py-2 rounded-md text-white font-medium ${
          !file || isLoading
            ? 'bg-green-400 cursor-not-allowed'
            : 'bg-green-600 hover:bg-green-700'
        }`}
      >
        {isLoading ? 'Analyzing...' : 'Analyze Video'}
      </button>
      
      {file && (
        <div className="mt-4">
          <h3 className="font-medium text-gray-900 dark:text-white">Preview:</h3>
          <div className="mt-2 w-full max-w-xs">
            <video
              src={URL.createObjectURL(file)}
              controls
              className="rounded-md w-full"
            />
          </div>
        </div>
      )}
      
      {result && (
        <div className="mt-6 p-4 bg-gray-100 dark:bg-gray-700 rounded-md">
          <h3 className="font-medium text-gray-900 dark:text-white mb-2">Results:</h3>
          <p className="whitespace-pre-wrap text-gray-700 dark:text-gray-200">{result}</p>
        </div>
      )}
    </div>
  );
}

export default VideoTest;
