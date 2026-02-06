import { NextResponse } from "next/server";
import {
  VideoIntelligenceServiceClient,
  protos,
} from "@google-cloud/video-intelligence";
import { readFileSync } from "fs";
import { join } from "path";

import { saveVideoAnalysis } from "@/app/db/mongo";
import {
  buildLiveStateAtTime,
  getLiveStateAtTime,
} from "@/app/db/redis-models/live";

export const runtime = "nodejs";

const MAX_SIZE_MB = 50;

/* ================= HELPERS ================= */

function toSeconds(timeOffset: any): number {
  const s = Number(timeOffset?.seconds ?? 0);
  const n = Number(timeOffset?.nanos ?? 0);
  return s + n / 1e9;
}

function validateFile(file: any) {
  if (!file?.type?.startsWith("video/")) {
    throw new Error("Only video files allowed");
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`Max file size is ${MAX_SIZE_MB}MB`);
  }
}

/* =========================================================
   POST → Upload video → Google analysis → Mongo → Redis init
   ========================================================= */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("video") as any;

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No video file provided" },
        { status: 400 },
      );
    }

    validateFile(file);

    const serviceAccountPath = join(
      process.cwd(),
      "app",
      "secrets",
      "video-sa.json",
    );

    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));

    const videoClient = new VideoIntelligenceServiceClient({
      projectId: serviceAccount.project_id,
      credentials: {
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key,
      },
    });

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
      throw new Error("No annotation results returned");
    }

    /* ===== Normalize results for Mongo ===== */

    // Segment labels (simple)
    const labels = (annotation.segmentLabelAnnotations ?? []).map((l: any) => ({
      name: l.entity?.description ?? "",
      confidence: Number(l.segments?.[0]?.confidence ?? 0),
    }));

    // Object tracking (segment start/end are useful for timeline)
    const objects = (annotation.objectAnnotations ?? []).map((obj: any) => ({
      name: obj.entity?.description ?? "",
      confidence: Number(obj.confidence ?? 0),
      start: toSeconds(obj.segment?.startTimeOffset),
      end: toSeconds(obj.segment?.endTimeOffset),
    }));

    /**
     * ✅ OCR FIX FOR TIMELINE:
     * Flatten *all* segments so each OCR event has real time range.
     * This enables live.ts to select 0-1 at early t and 0-2 later.
     */
    const text = (annotation.textAnnotations ?? []).flatMap((t: any) =>
      (t.segments ?? []).map((s: any) => ({
        text: t.text ?? "",
        confidence: Number(s.confidence ?? 0),
        start: toSeconds(s.startTime),
        end: toSeconds(s.endTime),
        timestamp: toSeconds(s.startTime), // keep for backward compatibility
      })),
    );

    /* ===== SAVE TO MONGO ===== */
    await saveVideoAnalysis({
      videoId: file.name,
      labels,
      objects,
      text,
      analyzedAt: new Date(),
    });

    /* ===== Build initial Redis snapshot at t=0 (safe) ===== */
    try {
      await buildLiveStateAtTime(file.name, 0);
    } catch (redisErr) {
      console.warn("⚠ Redis init failed:", redisErr);
    }

    return NextResponse.json({
      success: true,
      videoId: file.name,
      message: "Analysis completed",
      summary: {
        labelCount: labels.length,
        objectCount: objects.length,
        textCount: text.length,
      },
    });
  } catch (error: any) {
    console.error("❌ Video processing failed:", error);

    return NextResponse.json(
      { success: false, error: error?.message || "Failed" },
      { status: 500 },
    );
  }
}

/* =========================================================
   GET → Real Timeline Mode
   /api/analyze-video?videoId=...&t=37
   ========================================================= */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const videoId = searchParams.get("videoId");
    const tParam = searchParams.get("t");
    const t = Math.floor(Number(tParam ?? 0));

    if (!videoId) {
      return NextResponse.json(
        { success: false, error: "videoId required" },
        { status: 400 },
      );
    }

    const timeSec = Number.isFinite(t) && t >= 0 ? t : 0;

    /* ===== 1) Try Redis first ===== */
    const cached = await getLiveStateAtTime(videoId, timeSec);
    if (cached) {
      return NextResponse.json({
        success: true,
        source: "redis",
        t: timeSec,
        live: cached,
      });
    }

    /* ===== 2) Build snapshot for this time ===== */
    await buildLiveStateAtTime(videoId, timeSec);

    const fresh = await getLiveStateAtTime(videoId, timeSec);

    return NextResponse.json({
      success: true,
      source: "mongo→redis",
      t: timeSec,
      live: fresh,
    });
  } catch (error) {
    console.error("❌ Fetch failed:", error);

    return NextResponse.json(
      { success: false, error: "Failed to fetch" },
      { status: 500 },
    );
  }
}
