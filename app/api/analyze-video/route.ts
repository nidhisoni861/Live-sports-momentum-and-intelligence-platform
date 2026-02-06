import { NextResponse } from "next/server";
import {
  VideoIntelligenceServiceClient,
  protos,
} from "@google-cloud/video-intelligence";
import { readFileSync } from "fs";
import { join } from "path";
import {
  saveVideoAnalysis,
  getVideoAnalysisById,
} from "@/lib/mongo";

export const runtime = "nodejs";

type NormalizedBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function toSeconds(timeOffset: any): number {
  const s = Number(timeOffset?.seconds ?? 0);
  const n = Number(timeOffset?.nanos ?? 0);
  return s + n / 1e9;
}

function safeBox(box: any): NormalizedBox | null {
  if (!box) return null;
  return {
    left: Number(box.left ?? 0),
    top: Number(box.top ?? 0),
    right: Number(box.right ?? 0),
    bottom: Number(box.bottom ?? 0),
  };
}

/* =========================================================
   POST → Analyze video + store result in MongoDB
   ========================================================= */
export async function POST(request: Request) {
  try {
    // 1) Read video
    const formData = await request.formData();
    const file = formData.get("video") as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No video file provided" },
        { status: 400 }
      );
    }

    // 2) Load Google service account
    const serviceAccountPath = join(
      process.cwd(),
      "app",
      "secrets",
      "video-sa.json"
    );

    const serviceAccount = JSON.parse(
      readFileSync(serviceAccountPath, "utf8")
    );

    const videoClient = new VideoIntelligenceServiceClient({
      projectId: serviceAccount.project_id,
      credentials: {
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key,
      },
    });

    // 3) Call Google Video Intelligence API
    const inputContent = Buffer.from(await file.arrayBuffer());

    const [operation] = await videoClient.annotateVideo({
      inputContent,
      features: [
        protos.google.cloud.videointelligence.v1.Feature.LABEL_DETECTION,
        protos.google.cloud.videointelligence.v1.Feature.OBJECT_TRACKING,
        protos.google.cloud.videointelligence.v1.Feature.TEXT_DETECTION,
      ],
    });

    const [operationResult] = await operation.promise();
    const annotation = operationResult.annotationResults?.[0];

    if (!annotation) {
      return NextResponse.json(
        { success: false, error: "No annotation results returned" },
        { status: 500 }
      );
    }

    // 4) Extract labels
    const labels = (annotation.segmentLabelAnnotations ?? []).map(
      (l: any) => ({
        name: l.entity?.description ?? "",
        confidence: Number(l.segments?.[0]?.confidence ?? 0),
        categories: (l.categoryEntities ?? [])
          .map((c: any) => c.description)
          .filter(Boolean),
      })
    );

    // 5) Extract objects
    const objects = (annotation.objectAnnotations ?? []).map((obj: any) => {
      const frames = (obj.frames ?? [])
        .map((f: any) => {
          const box = safeBox(f.normalizedBoundingBox);
          if (!box) return null;
          return {
            t: toSeconds(f.timeOffset),
            box,
          };
        })
        .filter(Boolean);

      return {
        type: obj.entity?.description ?? "",
        confidence: Number(obj.confidence ?? 0),
        segment: {
          start: toSeconds(obj.segment?.startTimeOffset),
          end: toSeconds(obj.segment?.endTimeOffset),
        },
        frames,
      };
    });

    // 6) Extract text
    const text = (annotation.textAnnotations ?? []).map((t: any) => ({
      value: t.text ?? "",
      segments: (t.segments ?? []).map((s: any) => ({
        start: toSeconds(s.startTime),
        end: toSeconds(s.endTime),
        confidence: Number(s.confidence ?? 0),
      })),
    }));

    // 7) Save to MongoDB (data access layer)
    await saveVideoAnalysis({
      videoId: file.name,
      labels,
      objects,
      text,
      analyzedAt: new Date(),
    });

    // 8) Return response to frontend
    return NextResponse.json({
      success: true,
      videoId: file.name,
      analyzedAt: new Date().toISOString(),
      summary: { labels, objects, text },
    });
  } catch (error) {
    console.error("❌ Video processing failed:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to process video",
      },
      { status: 500 }
    );
  }
}

/* =========================================================
   GET → Fetch stored analysis from MongoDB
   ========================================================= */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get("videoId");

    if (!videoId) {
      return NextResponse.json(
        { success: false, error: "videoId query param is required" },
        { status: 400 }
      );
    }

    const data = await getVideoAnalysisById(videoId);

    if (!data) {
      return NextResponse.json(
        { success: false, error: "No analysis found for this video" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("❌ Fetch failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch video analysis" },
      { status: 500 }
    );
  }
}
