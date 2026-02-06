import { NextResponse } from "next/server";
import {
  VideoIntelligenceServiceClient,
  protos,
} from "@google-cloud/video-intelligence";
import { readFileSync } from "fs";
import { join } from "path";

import { saveAnalyzedVideo, getDb, COLLECTIONS } from "@/app/db/models";

export const runtime = "nodejs";

type NormalizedBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const MAX_SIZE_MB = 50;

/* ===== HELPERS ===== */

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

function validateFile(file: File) {
  if (!file.type.startsWith("video/")) {
    throw new Error("Only video files allowed");
  }

  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`Max file size is ${MAX_SIZE_MB}MB`);
  }
}

/* =========================================================
   POST
   ========================================================= */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("video") as File | null;

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

    /* ===== Normalize results ===== */

    const labels = (annotation.segmentLabelAnnotations ?? []).map((l: any) => ({
      name: l.entity?.description ?? "",
      confidence: Number(l.segments?.[0]?.confidence ?? 0),
    }));

    // NOTE: safeBox() exists but we are not storing frames in Mongo now.
    // If you want frames later, we can add a separate collection for frames.
    const objects = (annotation.objectAnnotations ?? []).map((obj: any) => ({
      name: obj.entity?.description ?? "",
      confidence: Number(obj.confidence ?? 0),
      start: toSeconds(obj.segment?.startTimeOffset),
      end: toSeconds(obj.segment?.endTimeOffset),
    }));

    const text = (annotation.textAnnotations ?? []).map((t: any) => ({
      text: t.text ?? "",
      confidence: Number(t.segments?.[0]?.confidence ?? 0),
      timestamp: toSeconds(t.segments?.[0]?.startTime),
    }));

    /* ===== SAVE TO MONGO (professional multi-collection) ===== */

    await saveAnalyzedVideo({
      videoId: file.name,
      labels,
      objects,
      text,
    });

    return NextResponse.json({
      success: true,
      videoId: file.name,
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
   GET
   ========================================================= */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get("videoId");

    if (!videoId) {
      return NextResponse.json(
        { success: false, error: "videoId required" },
        { status: 400 },
      );
    }

    const db = await getDb();

    const analysisArr = await db
      .collection(COLLECTIONS.ANALYSIS)
      .find({ videoId })
      .sort({ analyzedAt: -1 })
      .limit(1)
      .toArray();

    if (!analysisArr.length) {
      return NextResponse.json(
        { success: false, error: "No analysis found" },
        { status: 404 },
      );
    }

    const analysis = analysisArr[0];
    const analysisId = analysis._id.toString();

    const [objects, text, labels] = await Promise.all([
      db.collection(COLLECTIONS.OBJECTS).find({ analysisId }).toArray(),
      db.collection(COLLECTIONS.OCR).find({ analysisId }).toArray(),
      db.collection(COLLECTIONS.LABELS).find({ analysisId }).toArray(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        analysis,
        objects,
        text,
        labels,
      },
    });
  } catch (error) {
    console.error("❌ Fetch failed:", error);

    return NextResponse.json(
      { success: false, error: "Failed to fetch" },
      { status: 500 },
    );
  }
}
