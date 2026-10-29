"use client";

/** Отметка шага воронки (lib/funnel.ts): страница открылась — шаг пройден. Ничего не показывает. */
import { useEffect } from "react";
import type { TrackedStep } from "@/lib/funnel";

export function track(step: TrackedStep, leadId?: string) {
  void fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step, leadId }),
    keepalive: true,
  }).catch(() => {});
}

export function Track({ step, leadId }: { step: TrackedStep; leadId?: string }) {
  useEffect(() => {
    track(step, leadId);
  }, [step, leadId]);
  return null;
}
