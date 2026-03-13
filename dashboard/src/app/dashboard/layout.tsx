"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import clsx from "clsx";

// ── KBeauty E-Commerce (Python FastAPI backend, Sprints 1–18) ─────────────────
const KBEAUTY_NAV = [
  { href: "/dashboard",              label: "Overview"       },
  { href: "/dashboard/orders",       label: "Orders"         },
  { href: "/dashboard/metrics",      label: "Metrics"        },
  { href: "/dashboard/tickets",      label: "Tickets"        },
  { href: "/dashboard/health",       label: "Health"         },
  { href: "/dashboard/publish",      label: "🚀 Publish"     },  // Sprint 12
  { href: "/dashboard/repricing",    label: "💰 Repricing"   },  // Sprint 13
  { href: "/dashboard/fulfillment",  label: "🚚 Fulfillment" },  // Sprint 14
  { href: "/dashboard/discovery",    label: "🔭 Discovery"   },  // Sprint 15 + 17
  { href: "/dashboard/ops",          label: "⚙️ Ops"         },  // Sprint 16
  { href: "/dashboard/trends",       label: "📈 Trends v2"   },  // Sprint 18
];

// ── AI Orchestrator (Node.js backend, Phase 13–16) ────────────────────────────
const AI_NAV = [
  { href: "/dashboard/ai-overview",  label: "🤖 Overview"    },  // Phase 16
  { href: "/dashboard/ai-health",    label: "🏥 Provider Health" }, // Phase 16
  { href: "/dashboard/ai-costs",     label: "💸 Cost Analysis" }, // Phase 16
  { href: "/dashboard/ai-jobs",      label: "⚙️ Job Queue"   },  // Phase 14
  { href: "/dashboard/ai-inference", label: "🧠 Inference"   },  // Phase 13–15
  { href: "/dashboard/ai-platform",  label: "🏗️ Platform"    },  // Phase 14
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { email, role, logout, loading } = useAuth();
  const pathname = usePathname();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-60 bg-slate-800 text-slate-200 flex flex-col overflow-y-auto">
        <div className="px-5 py-5 border-b border-slate-700">
          <p className="text-sm font-bold text-white">KBeauty Admin</p>
          <p className="text-xs text-slate-400 mt-0.5 truncate">{email}</p>
          <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-blue-600 text-white">
            {role}
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-5">
          {/* KBeauty E-Commerce section */}
          <div>
            <p className="px-3 mb-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              E-Commerce
            </p>
            <div className="space-y-0.5">
              {KBEAUTY_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "block rounded-lg px-3 py-2 text-sm font-medium transition",
                    pathname === item.href
                      ? "bg-blue-600 text-white"
                      : "text-slate-300 hover:bg-slate-700"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          {/* AI Orchestrator section */}
          <div>
            <p className="px-3 mb-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              AI Orchestrator
            </p>
            <div className="space-y-0.5">
              {AI_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "block rounded-lg px-3 py-2 text-sm font-medium transition",
                    pathname === item.href
                      ? "bg-purple-600 text-white"
                      : "text-slate-300 hover:bg-slate-700"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </nav>

        <div className="px-5 py-4 border-t border-slate-700">
          <button
            onClick={logout}
            className="text-sm text-slate-400 hover:text-white transition"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-gray-50">
        {children}
      </main>
    </div>
  );
}
