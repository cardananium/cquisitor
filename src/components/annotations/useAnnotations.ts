"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  annotationStore,
  type AnnotationStatus,
  type AnnotationStore,
  type AnnotationTab,
  type TabAnnotations,
} from "@/utils/annotations/store";
import { spotlightStore, type SpotlightStore } from "@/utils/annotations/scrim";

const serverSnapshot = (): TabAnnotations | null => null;
const spotlightServerSnapshot = () => true;

/** The tab's annotations, re-rendering on every change to them. */
export function useTabAnnotations(
  tab: AnnotationTab,
  store: AnnotationStore = annotationStore,
): TabAnnotations | null {
  return useSyncExternalStore(store.subscribe, () => store.get(tab), serverSnapshot);
}

/** Whether the scrim darkens the page around the focused target (the navigator's toggle). */
export function useSpotlightEnabled(store: SpotlightStore = spotlightStore): boolean {
  return useSyncExternalStore(store.subscribe, store.enabled, spotlightServerSnapshot);
}

/** Report how far each target resolved on this tab. */
export function useReportStatuses(
  tab: AnnotationTab,
  statuses: readonly AnnotationStatus[] | null,
  store: AnnotationStore = annotationStore,
): void {
  useEffect(() => {
    if (statuses) store.setStatuses(tab, statuses);
  }, [tab, statuses, store]);
}

/** Dismiss the tab's annotations once the user replaces the input the link wrote. */
export function useAnnotationInputGuard(
  tab: AnnotationTab,
  inputKey: string,
  store: AnnotationStore = annotationStore,
): void {
  const active = useTabAnnotations(tab, store) !== null;
  useEffect(() => {
    if (active) store.noteInput(tab, inputKey);
  }, [tab, inputKey, active, store]);
}
