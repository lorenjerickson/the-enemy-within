import type { Metadata } from "next";
import TimingProbe from "./TimingProbe";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = { title: "The Enemy Within" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body className="min-h-screen">{children}{process.env.TIMING === "1" && <TimingProbe />}</body>
    </html>
  );
}
