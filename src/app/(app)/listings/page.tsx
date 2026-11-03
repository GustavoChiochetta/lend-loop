import type { Metadata } from "next";
import { ListingsView } from "@/components/views/ListingsView";

// Client-rendered from Convex; see (app)/layout.tsx.
export const instant = false;

export const metadata: Metadata = { title: "My listings · LendLoop" };

export default function ListingsPage() {
  return <ListingsView />;
}
