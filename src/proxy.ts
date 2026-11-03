import { clerkMiddleware } from "@clerk/nextjs/server";

// Makes the Clerk session available to server code. Route protection is
// resource-based (Clerk v7 guidance): signed-in pages call auth.protect() in
// their layout, and the real authorization is enforced in every Convex function.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
