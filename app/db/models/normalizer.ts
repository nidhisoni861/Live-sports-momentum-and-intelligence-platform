/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from "../mongo";
import type { VideoAnalysisDoc } from "../mongo";
import type { TimeRange, ParsedScore } from "./types";

/**
 * Explodes the single "videoAnalysis" document into normalized collections:
 * - analyses
 * - labelEvents
 * - objectSegments
 * - ocrEvents
 * - videos
 */
export async function normalizeToModels(doc: VideoAnalysisDoc) {
  const db = await getDb();

  const videoId = doc.videoId;
  const now = new Date();

  /* =========================
     1) analyses (root record)
     ========================= */
  const analysisRes = await db.collection("analyses").insertOne({
    videoId,
    analyzedAt: doc.analyzedAt ?? now,
    createdAt: now,
    summary: {
      labels: Array.isArray(doc.labels) ? doc.labels.length : 0,
      objects: Array.isArray(doc.objects) ? doc.objects.length : 0,
      text: Array.isArray(doc.text) ? doc.text.length : 0,
      scoreEvents: Array.isArray(doc.scoreEvents) ? doc.scoreEvents.length : 0,
    },
  });

  const analysisId = analysisRes.insertedId.toString();

  /* =========================
     2) labelEvents
     LabelEvent:
     { videoId, analysisId?, name, confidence, timeRange? }
     ========================= */
  const labelEvents = (doc.labels ?? []).map((l: any) => ({
    videoId,
    analysisId,
    name: String(l?.name ?? ""),
    confidence: Number(l?.confidence ?? 0),
    timeRange: { start: 0, end: 0 } as TimeRange,
  }));

  if (labelEvents.length) {
    await db.collection("labelEvents").insertMany(labelEvents);
  }

  /* =========================
     3) objectSegments
     ObjectSegment:
     { videoId, analysisId?, name, confidence, time: TimeRange, trackId? }
     ========================= */
  const objectSegments = (doc.objects ?? []).map((o: any) => ({
    videoId,
    analysisId,
    name: String(o?.name ?? ""),
    confidence: Number(o?.confidence ?? 0),
    time: {
      start: Number(o?.start ?? 0),
      end: Number(o?.end ?? o?.start ?? 0),
    } as TimeRange,
    trackId: o?.trackId != null ? String(o.trackId) : undefined,
  }));

  if (objectSegments.length) {
    await db.collection("objectSegments").insertMany(objectSegments);
  }

  /* =========================
     4) ocrEvents
     OcrEvent:
     { videoId, analysisId?, text, confidence, parsed?, timestamp }
     ========================= */
  const ocrEvents = (doc.text ?? []).map((t: any) => {
    const rawText = String(t?.text ?? "");
    const confidence = Number(t?.confidence ?? 0);
    const timestamp = Number(t?.timestamp ?? t?.start ?? 0);

    let parsed: ParsedScore | undefined;
    const m = rawText.match(/(\d{1,2})\s*[- ]\s*(\d{1,2})/);
    if (m) {
      parsed = {
        home: Number(m[1]),
        away: Number(m[2]),
        raw: rawText,
      };
    }

    return {
      videoId,
      analysisId,
      text: rawText,
      confidence,
      parsed,
      timestamp,
    };
  });

  if (ocrEvents.length) {
    await db.collection("ocrEvents").insertMany(ocrEvents);
  }

  /* =========================
     5) videos (metadata)
     ========================= */
  await db.collection("videos").updateOne(
    { videoId },
    {
      $set: {
        videoId,
        lastAnalyzed: now,
        lastAnalysisId: analysisId,
      },
      $inc: { analysisRuns: 1 },
    },
    { upsert: true },
  );

  return {
    analysisId,
    counts: {
      labelEvents: labelEvents.length,
      objectSegments: objectSegments.length,
      ocrEvents: ocrEvents.length,
    },
  };
}
