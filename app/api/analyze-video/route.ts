/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import {
  VideoIntelligenceServiceClient,
  protos,
} from "@google-cloud/video-intelligence";
import { readFileSync } from "fs";
import { join } from "path";

import { saveVideoAnalysis, getVideoAnalysisById } from "@/app/db/mongo";
import { normalizeToModels } from "@/app/db/models/normalizer";
import {
  buildLiveStateAtTime,
  getLiveStateAtTime,
} from "@/app/db/redis-models/live";

export const runtime = "nodejs";

const MAX_SIZE_MB = 50;

function toSeconds(d: any): number {
  const s = Number(d?.seconds ?? 0);
  const n = Number(d?.nanos ?? 0);
  return s + n / 1e9;
}

function validateFile(file: any) {
  if (!file?.type?.startsWith("video/"))
    throw new Error("Only video files allowed");

  if (file.size > MAX_SIZE_MB * 1024 * 1024)
    throw new Error(`Max file size is ${MAX_SIZE_MB}MB`);
}

function extractScore(text: string): string | null {
  const s = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (/\b\d{1,2}:\d{2}\b/.test(s)) return null;

  const m = s.match(/(\d{1,2})\s*[- ]\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

/* ================= POST ================= */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("video") as any;

    if (!file)
      return NextResponse.json(
        { success: false, error: "No video file provided" },
        { status: 400 },
      );

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
    if (!annotation) throw new Error("No annotation results returned");

    /* ===== LABELS ===== */
    const labels = (annotation.segmentLabelAnnotations ?? []).map((l: any) => ({
      name: l.entity?.description ?? "",
      confidence: Number(l.segments?.[0]?.confidence ?? 0),
    }));

    /* ===== OBJECTS – WITH FRAMES ===== */
    const objects = (annotation.objectAnnotations ?? []).map((obj: any) => ({
      name: obj.entity?.description ?? "",
      entityId: obj.entity?.entityId ?? null,

      confidence: Number(obj.confidence ?? 0),

      segment: {
        start: toSeconds(obj.segment?.startTimeOffset),
        end: toSeconds(obj.segment?.endTimeOffset),
      },

      frames: Array.isArray(obj.frames)
        ? obj.frames.map((f: any) => ({
            t: toSeconds(f.timeOffset),
            box: {
              left: Number(f.normalizedBoundingBox?.left ?? 0),
              top: Number(f.normalizedBoundingBox?.top ?? 0),
              right: Number(f.normalizedBoundingBox?.right ?? 0),
              bottom: Number(f.normalizedBoundingBox?.bottom ?? 0),
            },
          }))
        : [],
    }));

    /* ===== TEXT ===== */
    const text: any[] = [];

    for (const ta of annotation.textAnnotations ?? []) {
      const segs = Array.isArray(ta?.segments) ? ta.segments : [];

      for (const seg of segs) {
        const startSec = toSeconds(seg?.segment?.startTimeOffset);
        const endSec = toSeconds(seg?.segment?.endTimeOffset);

        text.push({
          text: ta?.text ?? "",
          confidence: Number(seg?.confidence ?? 0),
          start: startSec,
          end: endSec,
          timestamp: startSec,
        });
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

    /* ===== SAVE TO MONGO ===== */
    const mongoWrite = await saveVideoAnalysis({
      videoId: file.name,
      labels,
      objects,
      text,
      scoreEvents,
      analyzedAt,
    });

    const analysis = await getVideoAnalysisById(file.name);

    try {
      await normalizeToModels({
        videoId: file.name,
        labels,
        objects,
        text,
        scoreEvents,
        analyzedAt,
      });
    } catch (err) {
      console.warn("Normalization failed", err);
    }

    try {
      await buildLiveStateAtTime(file.name, 0);
    } catch (err) {
      console.warn("Redis init failed", err);
    }

    return NextResponse.json({
      success: true,
      videoId: file.name,
      mongo: mongoWrite,
      analysis,
    });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed" },
      { status: 500 },
    );
  }
}

/* ================= GET ================= */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get("videoId");
    const tParam = searchParams.get("t");

    if (!videoId)
      return NextResponse.json(
        { success: false, error: "videoId required" },
        { status: 400 },
      );

    const analysis = await getVideoAnalysisById(videoId);

    const live =
      tParam !== null
        ? await getLiveStateAtTime(videoId, Number(tParam))
        : null;

    return NextResponse.json({
      success: true,
      videoId,
      analysis,
      live,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Failed" },
      { status: 500 },
    );
  }
}
