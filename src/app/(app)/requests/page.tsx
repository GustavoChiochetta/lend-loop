import type { Metadata } from "next";
import { RequestsView } from "@/components/views/RequestsView";

// Client-rendered from Convex; see (app)/layout.tsx.
export const instant = false;

export const metadata: Metadata = { title: "My requests · LendLoop" };

export default function RequestsPage() {
  return <RequestsView />;
}
