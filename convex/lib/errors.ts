import { ConvexError } from "convex/values";

// Typed application errors. ConvexError data reaches the client intact,
// so the UI can show `message` and branch on `code`; internal errors
// (bugs) are redacted by Convex in production.
export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "CONFLICT";

export function appError(code: AppErrorCode, message: string) {
  return new ConvexError({ code, message });
}
