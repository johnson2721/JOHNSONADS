import type { NextConfig } from "next";

// An unconfigured platform preview may be embedded. A configured HTTPS installation is not.
const protectedDeployment = process.env.APP_URL?.startsWith("https://") || process.env.ENFORCE_FRAME_DENY === "1";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      ...(protectedDeployment ? [{ key: "X-Frame-Options", value: "DENY" }] : []),
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value: `base-uri 'self'; object-src 'none'; form-action 'self'${protectedDeployment ? "; frame-ancestors 'none'" : ""}` },
    ] }, { source: "/admin/:path*", headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "private, no-store" },
    ] }];
  },
};
export default nextConfig;
