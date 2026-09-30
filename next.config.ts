import type { NextConfig } from "next";

// FC_EXPORT=1 builds the app as plain files, for the desktop app and for a
// hosted page. The app uses nothing that needs a server, so nothing is lost.
// It builds into a folder of its own, so it can run while `next dev` or
// `next start` is using .next.
//
//   FC_OUT        the folder to build into. "out" for the desktop app.
//   FC_BASE_PATH  the path the pages are served under, for a hosted page that
//                 is not at the top of its site: "/flight-companion" on GitHub
//                 Pages. Empty for the desktop app.
const exported = process.env.FC_EXPORT === "1";
const basePath = (process.env.FC_BASE_PATH ?? "").replace(/\/+$/, "");

const nextConfig: NextConfig = exported
  ? {
      output: "export",
      distDir: process.env.FC_OUT || "out",
      images: { unoptimized: true },
      ...(basePath ? { basePath } : null),
      // for the few addresses the app writes itself
      env: { NEXT_PUBLIC_BASE_PATH: basePath },
    }
  : {};

export default nextConfig;
