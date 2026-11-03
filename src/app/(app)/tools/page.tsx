import type { Metadata } from "next";
import { ToolsView } from "@/components/views/ToolsView";

// Client-rendered from Convex; see (app)/layout.tsx.
export const instant = false;

export const metadata: Metadata = { title: "Tools · LendLoop" };

export default function ToolsPage() {
  return <ToolsView />;
}
