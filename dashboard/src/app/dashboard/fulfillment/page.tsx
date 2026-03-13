"use client";
import { useEffect, useState, useCallback } from "react";
import {
  listSupplierOrders,
  triggerFulfillment,
  type SupplierOrderItem,
} from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string | null | undefined) {
  return s ? s.slice(0, 16).replace("T", " ") : "—";
}

function fmtCost(cost: number | null, currency: string | null) {
  if (cost == null) return "—";
  const sym = currency === "KRW" ? "₩" : currency === "JPY" ? "¥" : "$";
  return `${sym}${cost.toLocaleString()}`;
}

// ── Status pill ───────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  placed:    "bg-blue-100 text-blue-700",
  shipped:   "bg-green-100 text-green-700",
  delivered: "bg-emerald-100 text-emerald-700",
  failed:    "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
  pending:   "bg-yellow-100 text-yellow-700",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
        STATUS_COLORS[status?.toLowerCase()] ?? "bg-gray-100 text-gray-600"
      }`}
    >
      {status}
    </span>
  );
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

function OrderDrawer({
  order,
  onClose,
  onTrigger,
}: {
  order: SupplierOrderItem;
  onClose: () => void;
  onTrigger: (id: string, dry: boolean) => Promise<void>;
}) {
  const [triggering, setTriggering] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleTrigger(dry: boolean) {
    setTriggering(true);
    setMsg(null);
    try {
      await onTrigger(order.channel_order_id, dry);
      setMsg(dry ? "✅ Dry-run queued — no supplier call made." : "✅ Fulfillment task queued.");
    } catch (e: unknown) {
      setMsg(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTriggering(false);
    }
  }

  const rows: [string, string | number | null][] = [
    ["Supplier Order ID",  order.supplier_order_id],
    ["Supplier",           order.supplier],
    ["Supplier Status",    order.supplier_status],
    ["Tracking Number",    order.tracking_number],
    ["Tracking Carrier",   order.tracking_carrier],
    ["Cost",               fmtCost(order.cost, order.currency)],
    ["Retry Count",        order.retry_count],
    ["Created",            fmtDate(order.created_at)],
    ["Updated",            fmtDate(order.updated_at)],
  ];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Supplier Order
            </h2>
            <p className="text-xs font-mono text-gray-400 mt-0.5">{order.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill status={order.status} />
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Fields */}
        <div className="bg-gray-50 rounded-lg p-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {rows.map(([label, value]) => (
              <>
                <dt key={`dt-${label}`} className="text-gray-500">{label}</dt>
                <dd key={`dd-${label}`} className="text-gray-800 font-medium truncate">
                  {value ?? "—"}
                </dd>
              </>
            ))}
          </dl>
        </div>

        {/* Failure reason */}
        {order.failure_reason && (
          <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-sm text-red-700">
            <strong>Failure:</strong> {order.failure_reason}
          </div>
        )}

        {/* Actions — only for failed/pending */}
        {(order.status === "failed" || order.status === "pending") && (
          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <button
              onClick={() => handleTrigger(true)}
              disabled={triggering}
              className="flex-1 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100 disabled:opacity-50"
            >
              {triggering ? "…" : "🔍 Dry-Run Trigger"}
            </button>
            <button
              onClick={() => handleTrigger(false)}
              disabled={triggering}
              className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
            >
              {triggering ? "…" : "🚀 Trigger Live"}
            </button>
          </div>
        )}

        {msg && (
          <p className={`text-xs rounded-lg px-3 py-2 ${
            msg.startsWith("✅")
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}>
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const STATUS_FILTERS = ["all", "placed", "shipped", "failed", "pending", "delivered", "cancelled"];
const SUPPLIER_FILTERS = ["all", "COUPANG", "GMARKET", "NAVER"];

export default function FulfillmentPage() {
  const [orders, setOrders]         = useState<SupplierOrderItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [statusFilter, setStatus]   = useState("all");
  const [supplierFilter, setSupplier] = useState("all");
  const [limit, setLimit]           = useState(50);
  const [selected, setSelected]     = useState<SupplierOrderItem | null>(null);
  const [lastRefreshed, setRefreshed] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listSupplierOrders({
        status:   statusFilter === "all"   ? undefined : statusFilter,
        supplier: supplierFilter === "all" ? undefined : supplierFilter,
        limit,
      });
      setOrders(data.items);
      setRefreshed(new Date().toLocaleTimeString());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, supplierFilter, limit]);

  useEffect(() => { load(); }, [load]);

  async function handleTrigger(channelOrderId: string, dry: boolean) {
    await triggerFulfillment(channelOrderId, dry);
    await load();
  }

  // Stats
  const total    = orders.length;
  const placed   = orders.filter(o => o.status === "placed").length;
  const shipped  = orders.filter(o => o.status === "shipped").length;
  const failed   = orders.filter(o => o.status === "failed").length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">🚚 Fulfillment</h1>
          <p className="text-sm text-gray-500 mt-1">
            Sprint 14 — Supplier orders &amp; auto-fulfillment tracking
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50 font-medium"
        >
          {loading ? "Loading…" : "↺ Refresh"}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total",   value: total,   color: "text-gray-800" },
          { label: "Placed",  value: placed,  color: "text-blue-600" },
          { label: "Shipped", value: shipped, color: "text-green-600" },
          { label: "Failed",  value: failed,  color: failed > 0 ? "text-red-600" : "text-gray-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Status:</span>
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-2 py-1 rounded-full text-xs font-medium border transition ${
                statusFilter === s
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Supplier */}
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-xs text-gray-500 mr-1">Supplier:</span>
          <select
            value={supplierFilter}
            onChange={e => setSupplier(e.target.value)}
            className="border rounded px-2 py-1 text-xs"
          >
            {SUPPLIER_FILTERS.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Limit */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">Limit:</span>
          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="border rounded px-2 py-1 text-xs"
          >
            {[20, 50, 100, 200].map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        {lastRefreshed && (
          <span className="text-xs text-gray-300">Updated {lastRefreshed}</span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">Loading supplier orders…</div>
        ) : orders.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <p className="text-gray-400 text-sm">No supplier orders found.</p>
            <p className="text-gray-300 text-xs">Try changing the filters or refresh.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {[
                    "ID", "Channel Order", "Supplier",
                    "Supplier Ref", "Tracking", "Cost",
                    "Retries", "Status", "Updated", "",
                  ].map(h => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-gray-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {orders.map(o => (
                  <tr
                    key={o.id}
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => setSelected(o)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      {o.id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      {o.channel_order_id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-700">{o.supplier}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {o.supplier_order_id ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {o.tracking_number
                        ? <span title={o.tracking_carrier ?? ""}>{o.tracking_number}</span>
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {fmtCost(o.cost, o.currency)}
                    </td>
                    <td className="px-4 py-3 text-xs text-center">
                      {o.retry_count > 0 ? (
                        <span className="text-orange-600 font-semibold">{o.retry_count}</span>
                      ) : (
                        <span className="text-gray-300">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={o.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {fmtDate(o.updated_at)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={e => { e.stopPropagation(); setSelected(o); }}
                        className="text-xs px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info footer */}
      <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-500 space-y-1">
        <p>
          <strong>🔍 Dry-Run Trigger</strong> — Enqueues the fulfillment task with{" "}
          <code>dry_run=true</code>; the supplier API is <em>not</em> called.
        </p>
        <p>
          <strong>🚀 Trigger Live</strong> — Enqueues a real fulfillment task for
          the given channel order. Use with care.
        </p>
        <p className="text-gray-400">
          Fulfillment runs automatically via Celery every 30 min. Manual trigger
          is available for failed or stuck orders.
        </p>
      </div>

      {/* Drawer */}
      {selected && (
        <OrderDrawer
          order={selected}
          onClose={() => setSelected(null)}
          onTrigger={handleTrigger}
        />
      )}
    </div>
  );
}
