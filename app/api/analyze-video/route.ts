// app/api/analyze-video/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import {
  VideoIntelligenceServiceClient,
  protos,
} from "@google-cloud/video-intelligence";
import { readFileSync } from "fs";
import { join } from "path";

import { saveVideoAnalysis, getVideoAnalysisById } from "@/app/db/mongo";
import {
  buildLiveStateAtTime,
  getLiveStateAtTime,
} from "@/app/db/redis-models/live";
import { normalizeToModels } from "@/app/db/models/normalizer";

export const runtime = "nodejs";

const MAX_SIZE_MB = 50;

/* ================= HELPERS ================= */

function toSeconds(d: any): number {
  const s = Number(d?.seconds ?? 0);
  const n = Number(d?.nanos ?? 0);
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

function extractScore(text: string): string | null {
  const s = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  // ignore timestamps like 12:34
  if (/\b\d{1,2}:\d{2}\b/.test(s)) return null;

  // match score patterns like "0-2" or "0 - 2"
  const m = s.match(/(\d{1,2})\s*[- ]\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function getSegStart(seg: any) {
  return (
    seg?.segment?.startTimeOffset ??
    seg?.startTimeOffset ??
    seg?.startTime ??
    null
  );
}

function getSegEnd(seg: any) {
  return (
    seg?.segment?.endTimeOffset ?? seg?.endTimeOffset ?? seg?.endTime ?? null
  );
}

/* =========================================================
   POST → Upload video → Google analysis → Mongo → Normalize
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

    // Portable credential path (relative to repo)
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
    if (!annotation) throw new Error("No annotation results returned");

    /* ===== Normalize (simple) ===== */

    const labels = (annotation.segmentLabelAnnotations ?? []).map((l: any) => ({
      name: l.entity?.description ?? "",
      confidence: Number(l.segments?.[0]?.confidence ?? 0),
    }));

    const objects = (annotation.objectAnnotations ?? []).map((obj: any) => ({
      name: obj.entity?.description ?? "",
      confidence: Number(obj.confidence ?? 0),
      start: toSeconds(obj.segment?.startTimeOffset),
      end: toSeconds(obj.segment?.endTimeOffset),
      frames: (obj.frames ?? []).map((frame: any) => ({
        t: toSeconds(frame.timeOffset),
        box: {
          left: Number(frame.normalizedBoundingBox?.left ?? 0),
          top: Number(frame.normalizedBoundingBox?.top ?? 0),
          right: Number(frame.normalizedBoundingBox?.right ?? 0),
          bottom: Number(frame.normalizedBoundingBox?.bottom ?? 0),
        },
      })),
    }));

    const text: any[] = [];

    for (const ta of annotation.textAnnotations ?? []) {
      const segs = Array.isArray(ta?.segments) ? ta.segments : [];

      if (segs.length) {
        for (const seg of segs) {
          const startSec = toSeconds(getSegStart(seg));
          const endSec = toSeconds(getSegEnd(seg));

          text.push({
            text: ta?.text ?? "",
            confidence: Number(seg?.confidence ?? 0),
            start: startSec,
            end: endSec,
            timestamp: startSec,
          });
        }
      }
    }

    const scoreEvents = text
      .map((ev) => {
        const score = extractScore(ev.text);
        return score
          ? {
              score,
              text: ev.text,
              confidence: ev.confidence,
              start: ev.start,
              end: ev.end,
            }
          : null;
      })
      .filter(Boolean) as any[];

    const analyzedAt = new Date();

    /* ========== Mongo upsert ========== */
    const mongoWrite = await saveVideoAnalysis({
      videoId: file.name,
      labels,
      objects,
      text,
      scoreEvents,
      analyzedAt,
    });

    // Always return a stable doc to frontend (prevents UI failures)
    const analysis = await getVideoAnalysisById(file.name);

    /* ========== Populate other models (best-effort) ========== */
    try {
      await normalizeToModels({
        videoId: file.name,
        labels,
        objects,
        text,
        scoreEvents,
        analyzedAt,
      });
    } catch (normErr) {
      console.warn("⚠ Normalization failed:", normErr);
    }

    /* Redis optional init (best-effort) */
    try {
      await buildLiveStateAtTime(file.name, 0);
    } catch (redisErr) {
      console.warn("⚠ Redis init failed:", redisErr);
    }

    return NextResponse.json({
      success: true,
      videoId: file.name,
      mongo: {
        upsertedId: mongoWrite.upsertedId ?? null,
        matchedCount: mongoWrite.matchedCount ?? 0,
        modifiedCount: mongoWrite.modifiedCount ?? 0,
      },
      analysis, // full stored doc (frontend can render immediately)
      summary: {
        labelCount: labels.length,
        objectCount: objects.length,
        textCount: text.length,
        scoreEventCount: scoreEvents.length,
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
   GET → Fetch stored analysis (Mongo) + live state (Redis)
   Usage:
   /api/analyze-video?videoId=football.mp4
   /api/analyze-video?videoId=football.mp4&t=34
   ========================================================= */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get("videoId");
    const tParam = searchParams.get("t");
    const t = tParam !== null ? Number(tParam) : null;

    if (!videoId) {
      return NextResponse.json(
        { success: false, error: "videoId query param required" },
        { status: 400 },
      );
    }

    const analysis = await getVideoAnalysisById(videoId);

    const live =
      t !== null && Number.isFinite(t)
        ? await getLiveStateAtTime(videoId, t)
        : null;

    if (!analysis && !live) {
      return NextResponse.json(
        { success: false, error: "No data found for videoId" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      videoId,
      analysis,
      live,
      summary: analysis ? {
        labelCount: analysis.labels?.length || 0,
        objectCount: analysis.objects?.length || 0,
        textCount: analysis.text?.length || 0,
        scoreEventCount: analysis.scoreEvents?.length || 0,
      } : null,
    });
  } catch (error: any) {
    console.error("❌ GET /api/analyze-video failed:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed" },
      { status: 500 },
    );
  }
}
