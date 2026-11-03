import type { Metadata } from "next";
import { AdminView } from "@/components/views/AdminView";

// Client-rendered from Convex; see (app)/layout.tsx.
export const instant = false;

export const metadata: Metadata = { title: "Admin · LendLoop" };

export default function AdminPage() {
  return <AdminView />;
}
