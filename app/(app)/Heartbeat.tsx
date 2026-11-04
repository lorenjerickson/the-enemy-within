"use client";

import { useEffect } from "react";

/** Checks in every few seconds without re-rendering the page (e.g. so a player stays "here" while filling in a form). */
export default function Heartbeat({ checkIn, seconds = 5 }: { checkIn: () => Promise<void>; seconds?: number }) {
  useEffect(() => {
    checkIn().catch(() => {});
    const timer = setInterval(() => checkIn().catch(() => {}), seconds * 1000);
    return () => clearInterval(timer);
  }, [checkIn, seconds]);
  return null;
}
