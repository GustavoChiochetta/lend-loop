import type { Metadata } from "next";
import { IncomingView } from "@/components/views/IncomingView";

// Client-rendered from Convex; see (app)/layout.tsx.
export const instant = false;

export const metadata: Metadata = { title: "Incoming requests · LendLoop" };

export default function IncomingPage() {
  return <IncomingView />;
}
