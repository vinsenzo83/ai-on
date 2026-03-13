import type { NextConfig } from "next";

// Python FastAPI backend (KBeauty e-commerce: Sprints 1–18)
const API_URL = process.env.API_URL || "http://api:8000";

// Node.js AI Orchestrator backend (Phase 13–16)
const AI_API_URL = process.env.AI_API_URL || "http://ai-orchestrator:3001";

const nextConfig: NextConfig = {
  // Required for Docker multi-stage standalone build (Dockerfile.dashboard)
  output: "standalone",

  async rewrites() {
    return [
      // ── Node.js AI Orchestrator routes (/api/jobs/*, /api/memory/*, etc.) ──
      // Must come BEFORE the generic /admin/* rule to avoid conflicts.
      {
        source: "/api/jobs/:path*",
        destination: `${AI_API_URL}/api/jobs/:path*`,
      },
      {
        source: "/api/memory/:path*",
        destination: `${AI_API_URL}/api/memory/:path*`,
      },
      {
        source: "/api/admin/:path*",
        destination: `${AI_API_URL}/api/admin/:path*`,
      },

      // ── Python FastAPI backend routes (/admin/*) ──
      // Browser-side requests: /admin/* → Python backend /admin/*
      {
        source: "/admin/:path*",
        destination: `${API_URL}/admin/:path*`,
      },
    ];
  },
};

export default nextConfig;
