/* Shared helpers for the website and admin panel */
(function () {
  const C = window.HMS_CONFIG;
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  const pad = n => String(n).padStart(2, "0");
  const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parse = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const nightsBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const fmtDate = s => s ? parse(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
  const money = v => C.CURRENCY + " " + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => iso(new Date());

  function toast(msg, kind = "ok") {
    let box = document.getElementById("toasts");
    if (!box) { box = document.createElement("div"); box.id = "toasts"; box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
    const t = document.createElement("div");
    t.className = "toast toast-" + kind; t.textContent = msg; box.appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, kind === "err" ? 6000 : 3500);
  }

  // Turn database errors into messages a guest or admin can act on
  function friendlyError(err) {
    if (!err) return "Something went wrong. Please try again.";
    const m = (err.message || "") + " " + (err.hint || "") + " " + (err.details || "");
    if (err.code === "23P01" || /ROOM_UNAVAILABLE|bookings_no_overlap/.test(m))
      return "Sorry! This room is already booked for the selected dates. Please choose another available date or room.";
    if (err.code === "23503") return "This record is still in use by other records, so it can't be removed. Remove or reassign those first.";
    if (err.code === "23505") return "A record with this ID already exists. Use a different ID.";
    if (err.code === "23514" || /bookings_dates_valid/.test(m)) return "Check-out must be after check-in.";
    if (err.code === "42501" || /row-level security/.test(m)) return "You don't have permission to do that. Sign in as an administrator.";
    if (/Failed to fetch|NetworkError/.test(m)) return "Can't reach the server. Check your connection and try again.";
    return (err.message || "Something went wrong.").replace(/^.*?ERROR:\s*/, "");
  }

  function confirmDialog(title, body, okLabel = "Confirm", danger = false) {
    return new Promise(resolve => {
      const d = document.createElement("dialog");
      d.className = "dialog";
      d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3><p>${esc(body)}</p>
        <div class="dialog-actions"><button value="no" class="btn btn-ghost">Cancel</button>
        <button value="yes" class="btn ${danger ? "btn-danger" : "btn-primary"}">${esc(okLabel)}</button></div></form>`;
      document.body.appendChild(d);
      d.addEventListener("close", () => { resolve(d.returnValue === "yes"); d.remove(); });
      d.showModal();
    });
  }

  const STATUS_LABEL = { PENDING: "Pending", PENDING_PAYMENT: "Awaiting payment", CONFIRMED: "Confirmed", PAID: "Paid",
    CHECKED_IN: "Checked in", CHECKED_OUT: "Checked out", CANCELLED: "Cancelled" };
  const statusBadge = s => { const k = String(s || "").toUpperCase(); return `<span class="badge st-${k.toLowerCase()}">${esc(STATUS_LABEL[k] || s || "—")}</span>`; };

  window.HMS = { sb, C, iso, parse, addDays, nightsBetween, fmtDate, money, esc, today, toast, friendlyError, confirmDialog, statusBadge, STATUS_LABEL };
})();
