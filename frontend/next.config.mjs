// Guard against deploying a production build that silently falls back to
// http://localhost:8000 (see lib/citation-api.ts) because the env var was
// never configured in the Vercel project settings. Checked against
// VERCEL_ENV (not NODE_ENV) so a local `next build`, which is also
// NODE_ENV=production, is unaffected — mirrors the check in middleware.ts.
if (process.env.VERCEL_ENV === "production") {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  if (!apiBaseUrl) {
    throw new Error(
      "NEXT_PUBLIC_API_BASE_URL is not set. Configure it in the Vercel " +
        "project's Environment Variables settings before deploying to " +
        "production.",
    )
  }
  if (!apiBaseUrl.startsWith("https://")) {
    throw new Error(
      `NEXT_PUBLIC_API_BASE_URL must start with "https://" in production, ` +
        `got "${apiBaseUrl}".`,
    )
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: ["192.168.3.22"],
}

export default nextConfig
