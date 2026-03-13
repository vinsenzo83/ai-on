"use client";
import { useEffect, useState, useCallback } from "react";
import {
  listAiUsersFull,
  getAiUserDetail,
  updateAiUserRoleFull,
  deleteAiUser,
  getModelPriority,
  type AiUserFull,
  type AiAuditLog,
  type ModelPriority,
} from "@/lib/api";

// ── Role / Policy Definitions ─────────────────────────────────────────────────
// These reflect the backend's hardcoded role system.
// No /api/admin/roles endpoint exists yet — definitions are static.
// When a dedicated roles API is added, replace ROLE_POLICY with a fetch.

type RoleKey = "user" | "admin" | "moderator";
type DevMode = "READ_ONLY" | "SAFE_WRITE" | "FULL";

interface RolePolicy {
  role: RoleKey;
  label: string;
  color: string;
  badgeCls: string;
  description: string;
  devMode: DevMode;
  devModeCls: string;
  capabilities: string[];
  dangerousCaps: string[];
  futureReady: boolean;
}

const ROLE_POLICY: Record<RoleKey, RolePolicy> = {
  user: {
    role: "user",
    label: "User",
    color: "slate",
    badgeCls: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
    description: "Standard user. Can invoke pipelines, view own jobs and costs.",
    devMode: "READ_ONLY",
    devModeCls: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    capabilities: [
      "Run pipelines",
      "View own jobs",
      "View own costs",
      "Use API key",
    ],
    dangerousCaps: [],
    futureReady: false,
  },
  moderator: {
    role: "moderator",
    label: "Moderator",
    color: "yellow",
    badgeCls: "bg-yellow-100 text-yellow-800 ring-1 ring-yellow-300",
    description: "Elevated user. Can view all jobs, manage pipelines, read audit logs.",
    devMode: "SAFE_WRITE",
    devModeCls: "bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200",
    capabilities: [
      "All user capabilities",
      "View all jobs (read)",
      "View audit logs",
      "Manage pipelines",
      "View cost analytics",
    ],
    dangerousCaps: [],
    futureReady: true,
  },
  admin: {
    role: "admin",
    label: "Admin",
    color: "red",
    badgeCls: "bg-red-100 text-red-800 ring-1 ring-red-300",
    description: "Full administrative control. Can manage users, models, system config.",
    devMode: "FULL",
    devModeCls: "bg-red-50 text-red-700 ring-1 ring-red-200",
    capabilities: [
      "All moderator capabilities",
      "Manage users & roles",
      "Change model whitelist",
      "Configure API providers",
      "Access audit logs (all users)",
      "Clear job queues",
      "Run health checks",
      "Broadcast system messages",
      "Deploy updates",
    ],
    dangerousCaps: [
      "Delete users",
      "Reset passwords",
      "Force job cancellation",
      "Flush memory/observability engines",
      "Seed test data",
    ],
    futureReady: true,
  },
};

const DEV_MODE_ORDER: DevMode[] = ["READ_ONLY", "SAFE_WRITE", "FULL"];

// ── Helper Components ─────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const p = ROLE_POLICY[role as RoleKey];
  if (!p) return <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600">{role}</span>;
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${p.badgeCls}`}>{p.label}</span>;
}

function DevModeBadge({ mode }: { mode: DevMode }) {
  const cls = {
    READ_ONLY:  "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    SAFE_WRITE: "bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200",
    FULL:       "bg-red-50 text-red-700 ring-1 ring-red-200",
  }[mode];
  const icon = { READ_ONLY: "👁", SAFE_WRITE: "✏️", FULL: "⚡" }[mode];
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold ${cls}`}>
      {icon} {mode.replace("_", " ")}
    </span>
  );
}

function CapabilityList({ caps, danger = false }: { caps: string[]; danger?: boolean }) {
  if (caps.length === 0) return null;
  return (
    <ul className="space-y-1">
      {caps.map((c) => (
        <li key={c} className={`flex items-start gap-2 text-xs ${danger ? "text-red-600" : "text-slate-600"}`}>
          <span className={`mt-0.5 flex-shrink-0 ${danger ? "text-red-400" : "text-green-400"}`}>
            {danger ? "⚠" : "✓"}
          </span>
          {c}
        </li>
      ))}
    </ul>
  );
}

function PolicyCard({ policy }: { policy: RolePolicy }) {
  const modeIdx = DEV_MODE_ORDER.indexOf(policy.devMode);
  return (
    <div className={`bg-white rounded-xl border-2 ${
      policy.role === "admin" ? "border-red-200" :
      policy.role === "moderator" ? "border-yellow-200" : "border-slate-200"
    } overflow-hidden`}>
      {/* Header */}
      <div className={`px-5 py-4 flex items-center justify-between ${
        policy.role === "admin" ? "bg-red-50" :
        policy.role === "moderator" ? "bg-yellow-50" : "bg-slate-50"
      }`}>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <RoleBadge role={policy.role} />
            {policy.futureReady && (
              <span className="text-xs text-slate-400 italic">future-ready</span>
            )}
          </div>
          <p className="text-xs text-slate-500 max-w-xs">{policy.description}</p>
        </div>
        <DevModeBadge mode={policy.devMode} />
      </div>

      {/* Dev Mode Progress */}
      <div className="px-5 py-3 border-b border-slate-100">
        <p className="text-xs text-slate-500 mb-2">Developer Tool Mode Cap</p>
        <div className="flex gap-1">
          {DEV_MODE_ORDER.map((m, i) => (
            <div
              key={m}
              className={`flex-1 h-2 rounded ${
                i <= modeIdx
                  ? m === "FULL" ? "bg-red-400" : m === "SAFE_WRITE" ? "bg-yellow-400" : "bg-blue-400"
                  : "bg-slate-100"
              }`}
            />
          ))}
        </div>
        <div className="flex justify-between text-xs text-slate-400 mt-1">
          <span>READ_ONLY</span>
          <span>SAFE_WRITE</span>
          <span>FULL</span>
        </div>
      </div>

      {/* Capabilities */}
      <div className="px-5 py-4 space-y-3">
        <CapabilityList caps={policy.capabilities} />
        {policy.dangerousCaps.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-1">
              ⚠ Dangerous Capabilities
            </p>
            <CapabilityList caps={policy.dangerousCaps} danger />
          </div>
        )}
      </div>
    </div>
  );
}

// ── User Detail Drawer ────────────────────────────────────────────────────────

interface UserDrawerProps {
  user: AiUserFull;
  auditLogs: AiAuditLog[];
  onClose: () => void;
  onRoleChange: (userId: string, role: RoleKey) => void;
  onDelete: (userId: string) => void;
  currentUserEmail: string;
}

function UserDrawer({ user, auditLogs, onClose, onRoleChange, onDelete, currentUserEmail }: UserDrawerProps) {
  const [pendingRole, setPendingRole] = useState<RoleKey>(user.role as RoleKey || "user");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  const policy = ROLE_POLICY[pendingRole] ?? ROLE_POLICY.user;
  const isSelf = user.email === currentUserEmail;

  async function saveRole() {
    setSaving(true);
    try {
      await onRoleChange(user.id, pendingRole);
    } finally {
      setSaving(false);
    }
  }

  function fmtDate(s: string | null) {
    if (!s) return "—";
    return new Date(s).toLocaleString("ko-KR");
  }

  function parseDetails(raw: string | null): string {
    if (!raw) return "—";
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside className="w-[520px] bg-white shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="font-bold text-slate-800">{user.username || user.email}</h2>
            <p className="text-xs text-slate-500">{user.email}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl">✕</button>
        </div>

        <div className="p-6 space-y-6">
          {/* User Info */}
          <section>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">User Info</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">Current Role</p>
                <RoleBadge role={user.role} />
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">Dev Mode Cap</p>
                <DevModeBadge mode={ROLE_POLICY[user.role as RoleKey]?.devMode ?? "READ_ONLY"} />
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">Last Login</p>
                <p className="text-xs font-medium text-slate-700">{fmtDate(user.last_login)}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">Member Since</p>
                <p className="text-xs font-medium text-slate-700">{fmtDate(user.created_at)}</p>
              </div>
              {user.api_key && (
                <div className="bg-slate-50 rounded-lg p-3 col-span-2">
                  <p className="text-xs text-slate-400 mb-1">API Key</p>
                  <p className="font-mono text-xs text-slate-500">
                    {user.api_key.slice(0, 8)}••••••••{user.api_key.slice(-4)}
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Role Change */}
          <section>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Role Management
              {isSelf && <span className="ml-2 text-orange-500">(Cannot modify own role)</span>}
            </h3>
            <div className="space-y-3">
              <div className="flex gap-2">
                {(["user", "moderator", "admin"] as RoleKey[]).map((r) => (
                  <button
                    key={r}
                    disabled={isSelf}
                    onClick={() => !isSelf && setPendingRole(r)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition ${
                      pendingRole === r
                        ? r === "admin" ? "border-red-400 bg-red-50 text-red-700" :
                          r === "moderator" ? "border-yellow-400 bg-yellow-50 text-yellow-700" :
                          "border-blue-400 bg-blue-50 text-blue-700"
                        : "border-slate-200 text-slate-500 hover:border-slate-300"
                    } ${isSelf ? "opacity-40 cursor-not-allowed" : ""}`}
                  >
                    {ROLE_POLICY[r].label}
                  </button>
                ))}
              </div>

              {pendingRole !== user.role && !isSelf && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                  <p className="font-semibold mb-1">⚠ Role change preview</p>
                  <p>
                    <span className="font-medium">{user.username}</span> will go from{" "}
                    <strong>{user.role}</strong> → <strong>{pendingRole}</strong>.
                    Dev mode cap: <strong>{ROLE_POLICY[pendingRole].devMode}</strong>
                  </p>
                </div>
              )}

              {!isSelf && (
                <button
                  onClick={saveRole}
                  disabled={saving || pendingRole === user.role}
                  className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-medium
                             hover:bg-blue-700 disabled:opacity-40 transition"
                >
                  {saving ? "Saving…" : pendingRole === user.role ? "No Changes" : `Apply Role: ${ROLE_POLICY[pendingRole].label}`}
                </button>
              )}
            </div>
          </section>

          {/* Effective Policy Preview */}
          <section>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Effective Policy ({ROLE_POLICY[pendingRole]?.label})
            </h3>
            <div className="bg-slate-50 rounded-xl p-4 space-y-3">
              <CapabilityList caps={policy.capabilities} />
              {policy.dangerousCaps.length > 0 && (
                <>
                  <div className="border-t border-slate-200 pt-3">
                    <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2">
                      Dangerous Capabilities
                    </p>
                    <CapabilityList caps={policy.dangerousCaps} danger />
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Recent Audit Activity */}
          {auditLogs.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Recent Activity ({auditLogs.length} events)
              </h3>
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {auditLogs.slice(0, 15).map((log) => (
                  <div key={log.id} className="bg-slate-50 rounded-lg px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-blue-700 truncate max-w-[180px]">{log.action}</span>
                      <span className="text-slate-400 flex-shrink-0">
                        {new Date(log.created_at).toLocaleString("ko-KR")}
                      </span>
                    </div>
                    {log.resource && (
                      <p className="text-slate-500 mt-0.5">{log.resource}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Danger Zone */}
          {!isSelf && (
            <section>
              <h3 className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-3">Danger Zone</h3>
              {!showDeleteConfirm ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full py-2 rounded-lg border-2 border-red-200 text-red-600 text-sm font-medium
                             hover:bg-red-50 transition"
                >
                  Delete User Account
                </button>
              ) : (
                <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 space-y-3">
                  <p className="text-sm text-red-700 font-medium">
                    ⚠ Permanently delete <strong>{user.email}</strong>?
                  </p>
                  <p className="text-xs text-red-500">This action cannot be undone.</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      className="flex-1 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { onDelete(user.id); onClose(); }}
                      className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700"
                    >
                      Confirm Delete
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AiRolesPage() {
  const [users, setUsers]           = useState<AiUserFull[]>([]);
  const [priorities, setPriorities] = useState<ModelPriority[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [selectedUser, setSelected] = useState<{ user: AiUserFull; logs: AiAuditLog[] } | null>(null);
  const [actionMsg, setActionMsg]   = useState<string | null>(null);
  const [tab, setTab]               = useState<"users" | "policies" | "devmodes">("users");

  // In a real deployment, currentUserEmail would come from useAuth().
  // We read it from localStorage as a fallback for now.
  const currentUserEmail =
    typeof window !== "undefined"
      ? (localStorage.getItem("admin_email") ?? "")
      : "";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ur, mp] = await Promise.all([
        listAiUsersFull(),
        getModelPriority().catch(() => ({ success: false, priorities: [] })),
      ]);
      setUsers(ur.users);
      setPriorities(mp.priorities ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openUser(user: AiUserFull) {
    try {
      const detail = await getAiUserDetail(user.id);
      setSelected({ user: detail.user, logs: detail.auditLogs ?? [] });
    } catch {
      setSelected({ user, logs: [] });
    }
  }

  async function handleRoleChange(userId: string, role: RoleKey) {
    try {
      await updateAiUserRoleFull(userId, role);
      setActionMsg(`✓ Role updated to ${ROLE_POLICY[role].label}`);
      setTimeout(() => setActionMsg(null), 3000);
      await load();
      // Refresh drawer
      const updated = users.find((u) => u.id === userId);
      if (updated) await openUser({ ...updated, role });
    } catch (e) {
      setActionMsg(`✗ ${e instanceof Error ? e.message : "Failed"}`);
      setTimeout(() => setActionMsg(null), 4000);
    }
  }

  async function handleDelete(userId: string) {
    try {
      await deleteAiUser(userId);
      setActionMsg("✓ User deleted");
      setTimeout(() => setActionMsg(null), 3000);
      await load();
    } catch (e) {
      setActionMsg(`✗ ${e instanceof Error ? e.message : "Delete failed"}`);
      setTimeout(() => setActionMsg(null), 4000);
    }
  }

  const filtered = users.filter((u) => {
    const matchRole   = roleFilter === "all" || u.role === roleFilter;
    const matchSearch = !search ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.username ?? "").toLowerCase().includes(search.toLowerCase());
    return matchRole && matchSearch;
  });

  // Role distribution
  const roleCounts = users.reduce<Record<string, number>>((acc, u) => {
    acc[u.role] = (acc[u.role] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">🔐 Role & Permission Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {users.length} users · {Object.keys(roleCounts).length} roles active
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium
                     hover:bg-blue-700 disabled:opacity-50 transition"
        >
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {/* Action message */}
      {actionMsg && (
        <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
          actionMsg.startsWith("✓") ? "bg-green-50 text-green-700 border border-green-200" :
          "bg-red-50 text-red-700 border border-red-200"
        }`}>
          {actionMsg}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* Role Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        {(["user", "moderator", "admin"] as RoleKey[]).map((r) => {
          const p = ROLE_POLICY[r];
          return (
            <div
              key={r}
              className={`rounded-xl border-2 p-4 cursor-pointer transition ${
                roleFilter === r
                  ? r === "admin" ? "border-red-400 bg-red-50" :
                    r === "moderator" ? "border-yellow-400 bg-yellow-50" :
                    "border-blue-400 bg-blue-50"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
              onClick={() => setRoleFilter(roleFilter === r ? "all" : r)}
            >
              <div className="flex items-center justify-between mb-2">
                <RoleBadge role={r} />
                <span className="text-2xl font-bold text-slate-800">{roleCounts[r] ?? 0}</span>
              </div>
              <DevModeBadge mode={p.devMode} />
              <p className="text-xs text-slate-500 mt-2">{p.capabilities.length} caps
                {p.dangerousCaps.length > 0 && (
                  <span className="ml-1 text-red-500">· {p.dangerousCaps.length} dangerous</span>
                )}
              </p>
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        {(["users", "policies", "devmodes"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 text-sm font-medium border-b-2 transition ${
              tab === t
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "users" ? "👥 Users" : t === "policies" ? "📋 Role Policies" : "🔧 Dev Mode Caps"}
          </button>
        ))}
      </div>

      {/* Users Tab */}
      {tab === "users" && (
        <div className="space-y-4">
          {/* Search + Filter */}
          <div className="flex items-center gap-3 flex-wrap">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by email or username…"
              className="flex-1 min-w-[200px] border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
            >
              <option value="all">All Roles</option>
              <option value="user">User</option>
              <option value="moderator">Moderator</option>
              <option value="admin">Admin</option>
            </select>
            <span className="text-sm text-slate-500">{filtered.length} shown</span>
          </div>

          {loading && users.length === 0 && (
            <div className="text-center py-16 text-slate-400">Loading users…</div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="text-center py-12 text-slate-400">No users match filters.</div>
          )}

          {filtered.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">User</th>
                    <th className="px-4 py-3 text-left">Role</th>
                    <th className="px-4 py-3 text-left">Dev Mode Cap</th>
                    <th className="px-4 py-3 text-left">Last Login</th>
                    <th className="px-4 py-3 text-left">API Key</th>
                    <th className="px-4 py-3 text-left">Joined</th>
                    <th className="px-4 py-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((u) => {
                    const devMode = ROLE_POLICY[u.role as RoleKey]?.devMode ?? "READ_ONLY";
                    return (
                      <tr
                        key={u.id}
                        className="hover:bg-slate-50 cursor-pointer"
                        onClick={() => openUser(u)}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{u.username || "—"}</p>
                          <p className="text-xs text-slate-500">{u.email}</p>
                        </td>
                        <td className="px-4 py-3">
                          <RoleBadge role={u.role} />
                        </td>
                        <td className="px-4 py-3">
                          <DevModeBadge mode={devMode} />
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {u.last_login ? new Date(u.last_login).toLocaleString("ko-KR") : "Never"}
                        </td>
                        <td className="px-4 py-3">
                          {u.api_key ? (
                            <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded">
                              Active
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {new Date(u.created_at).toLocaleDateString("ko-KR")}
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => openUser(u)}
                            className="text-xs px-3 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
                          >
                            Manage →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Policies Tab */}
      {tab === "policies" && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-700">
            <p className="font-semibold mb-1">ℹ Backend Note</p>
            <p>
              Role policy definitions are hardcoded in the Node.js backend (<code className="font-mono">src/routes/admin.js</code>).
              Valid roles: <code className="font-mono">user | moderator | admin</code>.
              No dedicated <code className="font-mono">/api/admin/roles</code> endpoint exists yet —
              this view renders the static policy definition. Future-ready controls are marked accordingly.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(Object.values(ROLE_POLICY) as RolePolicy[]).map((p) => (
              <PolicyCard key={p.role} policy={p} />
            ))}
          </div>
        </div>
      )}

      {/* Dev Modes Tab */}
      {tab === "devmodes" && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-700">
            <p className="font-semibold mb-1">ℹ Developer Tool Mode Caps</p>
            <p>
              Mode caps define the maximum operation level a role can exercise in developer tool integrations.
              READ_ONLY → query only. SAFE_WRITE → controlled mutations. FULL → unrestricted.
              These caps are enforced by the orchestrator core (frozen — do not modify).
            </p>
          </div>

          {/* Mode Overview Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Mode</th>
                  <th className="px-4 py-3 text-left">Allowed Roles</th>
                  <th className="px-4 py-3 text-left">Operations</th>
                  <th className="px-4 py-3 text-left">Risk Level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="hover:bg-slate-50">
                  <td className="px-4 py-4"><DevModeBadge mode="READ_ONLY" /></td>
                  <td className="px-4 py-4"><RoleBadge role="user" /></td>
                  <td className="px-4 py-4 text-slate-600 text-xs">
                    Read data, query indexes, fetch results, inspect state
                  </td>
                  <td className="px-4 py-4">
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">Safe</span>
                  </td>
                </tr>
                <tr className="hover:bg-slate-50">
                  <td className="px-4 py-4"><DevModeBadge mode="SAFE_WRITE" /></td>
                  <td className="px-4 py-4 space-x-1">
                    <RoleBadge role="user" />
                    <RoleBadge role="moderator" />
                  </td>
                  <td className="px-4 py-4 text-slate-600 text-xs">
                    Controlled mutations, pipeline management, non-destructive writes
                  </td>
                  <td className="px-4 py-4">
                    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full">Guarded</span>
                  </td>
                </tr>
                <tr className="hover:bg-slate-50">
                  <td className="px-4 py-4"><DevModeBadge mode="FULL" /></td>
                  <td className="px-4 py-4 space-x-1">
                    <RoleBadge role="admin" />
                  </td>
                  <td className="px-4 py-4 text-slate-600 text-xs">
                    Unrestricted access: user management, model config, system ops, deploys
                  </td>
                  <td className="px-4 py-4">
                    <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">⚠ Dangerous</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Model Priority Routing */}
          {priorities.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-600 mb-3">Model Priority Routing</h3>
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left">Task / Pipeline</th>
                      <th className="px-4 py-3 text-left">Primary Model</th>
                      <th className="px-4 py-3 text-left">Fallback Chain</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {priorities.map((p, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{p.task}</td>
                        <td className="px-4 py-3">
                          <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-mono">
                            {p.primary}
                          </span>
                        </td>
                        <td className="px-4 py-3 flex flex-wrap gap-1">
                          {(p.fallback ?? []).map((f, fi) => (
                            <span key={fi} className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-xs font-mono">
                              {fi + 1}. {f}
                            </span>
                          ))}
                          {(!p.fallback || p.fallback.length === 0) && (
                            <span className="text-slate-400 text-xs">No fallback</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* User Drawer */}
      {selectedUser && (
        <UserDrawer
          user={selectedUser.user}
          auditLogs={selectedUser.logs}
          onClose={() => setSelected(null)}
          onRoleChange={handleRoleChange}
          onDelete={handleDelete}
          currentUserEmail={currentUserEmail}
        />
      )}
    </div>
  );
}
