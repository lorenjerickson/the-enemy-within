"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the page every few seconds (e.g. a lobby filling up), checking in first when given checkIn. */
export default function AutoRefresh({ seconds = 3, checkIn }: { seconds?: number; checkIn?: () => Promise<void> }) {
  const router = useRouter();
  useEffect(() => {
    const tick = async () => {
      if (checkIn) await checkIn().catch(() => {});
      router.refresh();
    };
    const timer = setInterval(tick, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds, checkIn]);
  return null;
}
