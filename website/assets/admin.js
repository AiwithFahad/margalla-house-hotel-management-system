/* Admin dashboard — every action reads/writes Supabase, protected by RLS (is_admin) */
(function () {
  const { sb, iso, addDays, nightsBetween, fmtDate, money, esc, today, toast, friendlyError, confirmDialog, statusBadge, STATUS_LABEL } = window.HMS;
  const view = document.getElementById("view"), titleEl = document.getElementById("title"), actionsEl = document.getElementById("actions");
  const STATUSES = ["PENDING", "PENDING_PAYMENT", "CONFIRMED", "PAID", "CHECKED_IN", "CHECKED_OUT", "CANCELLED"];
  const ACTIVE = s => String(s || "").toUpperCase() !== "CANCELLED";
  let charts = [];
  // Chart.js is only downloaded the first time a chart is shown
  let chartLib = null;
  const loadChart = () => chartLib || (chartLib = window.Chart ? Promise.resolve() : new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
    s.onload = res; s.onerror = () => { chartLib = null; rej(new Error("chart")); }; document.head.appendChild(s); }));
  async function drawChart(canvasId, config) {
    try { await loadChart(); } catch (e) { const c = document.getElementById(canvasId); if (c) c.outerHTML = '<p class="muted small">Chart unavailable offline.</p>'; return; }
    const el = document.getElementById(canvasId); if (!el || !document.body.contains(el)) return;
    charts.push(new Chart(el, config));
  }

  // ---------- access guard: no session or not admin -> login ----------
  async function guard() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return location.replace("login/");
    const { data: ok, error } = await sb.rpc("is_admin");
    if (error || !ok) { await sb.auth.signOut(); return location.replace("login/"); }
    document.getElementById("who").textContent = session.user.email;
    document.getElementById("gate").remove(); document.getElementById("shell").hidden = false;
    sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") location.replace("login/"); });
    route();
  }
  document.getElementById("logout").onclick = async () => { await sb.auth.signOut(); location.replace("login/"); };
  document.getElementById("menu").onclick = () => document.getElementById("side").classList.toggle("open");

  // ---------- data helpers ----------
  async function q(promise) { const { data, error } = await promise; if (error) throw error; return data; }
  async function loadAll() {
    const [bookings, guests, rooms, buildings, floors, types] = await Promise.all([
      q(sb.from("bookings").select("*").order("BookedOn", { ascending: false })),
      q(sb.from("guests").select("*").order("created_at", { ascending: false })),
      q(sb.from("rooms").select("*").order("RoomID")),
      q(sb.from("buildings").select("*").order("buildingID")),
      q(sb.from("floors").select("*").order("floorID")),
      q(sb.from("room_types").select("*").order("roomTypeID"))]);
    return { bookings, guests, rooms, buildings, floors, types };
  }
  const guestOf = (d, id) => d.guests.find(g => g.GuestID === id) || {};
  const roomName = (d, id) => (d.rooms.find(r => r.RoomID === id) || {}).room_name || id || "—";
  const bName = (d, id) => (d.buildings.find(b => b.buildingID === id) || {}).buildingName || id || "—";
  const loading = () => { view.innerHTML = `<div class="spinner" role="status" aria-label="Loading"></div>`; };
  const fail = e => { view.innerHTML = `<div class="empty"><h2>Couldn’t load this section</h2><p>${esc(friendlyError(e))}</p><button class="btn btn-primary" onclick="location.reload()">Reload</button></div>`; };
  const isRevenue = b => String(b.PaymentStatus || "").toUpperCase() === "PAID" || ["PAID", "CHECKED_IN", "CHECKED_OUT"].includes(String(b.BookingStatus || "").toUpperCase());
  const occupiedToday = (d, roomId) => d.bookings.some(b => b.RoomID === roomId && ACTIVE(b.BookingStatus) && b.CheckInDate <= today() && b.CheckOutDate > today());

  // ---------- generic modal form ----------
  function formModal({ title, fields, values = {}, submitLabel = "Save changes", onSubmit, extra = "" }) {
    const d = document.createElement("dialog"); d.className = "modal";
    const input = f => {
      const v = values[f.k] ?? f.default ?? "";
      const id = "f_" + f.k.replace(/\W/g, "_"), req = f.required ? "required" : "", ro = f.readonly ? "readonly" : "";
      if (f.type === "checkbox") return `<div class="field ${f.wide ? "wide" : ""}"><label class="check"><input type="checkbox" id="${id}" ${v ? "checked" : ""}> ${esc(f.label)}</label></div>`;
      let el;
      if (f.type === "select") el = `<select id="${id}" ${req} ${f.readonly ? "disabled" : ""}>${f.empty ? `<option value="">${esc(f.empty)}</option>` : ""}${f.options.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? "selected" : ""}>${esc(lab)}</option>`; }).join("")}</select>`;
      else if (f.type === "textarea") el = `<textarea id="${id}" rows="${f.rows || 3}" ${req} ${ro}>${esc(v)}</textarea>`;
      else el = `<input id="${id}" type="${f.type || "text"}" value="${esc(v)}" ${req} ${ro} ${f.min != null ? `min="${f.min}"` : ""} ${f.step ? `step="${f.step}"` : ""} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ""}>`;
      return `<div class="field ${f.wide ? "wide" : ""}"><label for="${id}">${esc(f.label)}${f.required ? "" : ' <span class="muted small">(optional)</span>'}</label>${el}${f.help ? `<div class="muted small">${esc(f.help)}</div>` : ""}</div>`;
    };
    d.innerHTML = `<form novalidate><div class="modal-head"><h3>${esc(title)}</h3></div>
      <div class="modal-body"><div class="mmsg"></div><div class="form-grid">${fields.map(input).join("")}</div>${extra}</div>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary">${esc(submitLabel)}</button></div></form>`;
    document.body.appendChild(d);
    const read = () => { const out = {}; fields.forEach(f => { const el = d.querySelector("#f_" + f.k.replace(/\W/g, "_"));
      if (f.type === "checkbox") out[f.k] = el.checked; else if (f.type === "number") out[f.k] = el.value === "" ? null : Number(el.value); else out[f.k] = el.value.trim() === "" ? null : el.value.trim(); }); return out; };
    d.querySelector("[data-close]").onclick = () => d.close();
    d.addEventListener("close", () => d.remove());
    d.querySelector("form").onsubmit = async e => {
      e.preventDefault(); const vals = read(), msg = d.querySelector(".mmsg");
      const missing = fields.filter(f => f.required && (vals[f.k] === null || vals[f.k] === "")).map(f => f.label);
      if (missing.length) { msg.innerHTML = `<p class="form-msg err">Fill in: ${esc(missing.join(", "))}.</p>`; return; }
      const btn = d.querySelector(".modal-foot .btn-primary"); btn.disabled = true; const old = btn.textContent; btn.textContent = "Saving…";
      try { await onSubmit(vals, d); d.close(); }
      catch (err) { msg.innerHTML = `<p class="form-msg err">${esc(friendlyError(err))}</p>`; msg.scrollIntoView({ block: "nearest" }); btn.disabled = false; btn.textContent = old; }
    };
    d.showModal(); return d;
  }
  function infoModal(title, html) {
    const d = document.createElement("dialog"); d.className = "modal";
    d.innerHTML = `<form method="dialog"><div class="modal-head"><h3>${esc(title)}</h3></div><div class="modal-body">${html}</div><div class="modal-foot"><button class="btn btn-primary">Close</button></div></form>`;
    document.body.appendChild(d); d.addEventListener("close", () => d.remove()); d.showModal(); return d;
  }
  async function del(table, col, id, label) {
    if (!(await confirmDialog(`Delete ${label}?`, "This can’t be undone.", "Delete", true))) return false;
    const { error } = await sb.from(table).delete().eq(col, id);
    if (error) { toast(friendlyError(error), "err"); return false; }
    toast(`${label} deleted.`); return true;
  }
  const table = (heads, rows, empty = "Nothing here yet.") => rows.length
    ? `<div class="table-wrap"><table class="t"><thead><tr>${heads.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : `<div class="empty panel">${esc(empty)}</div>`;

  // ---------- OVERVIEW ----------
  async function overview() {
    loading(); let d; try { d = await loadAll(); } catch (e) { return fail(e); }
    const B = d.bookings, cnt = s => B.filter(b => String(b.BookingStatus || "").toUpperCase() === s).length;
    const activeRooms = d.rooms.filter(r => r.is_active), occ = activeRooms.filter(r => occupiedToday(d, r.RoomID)).length;
    const revenue = B.filter(isRevenue).reduce((s, b) => s + Number(b.TotalRoomAmount || 0), 0);
    const cards = [["Total rooms", d.rooms.length], ["Buildings", d.buildings.length], ["Available today", activeRooms.length - occ], ["Occupied today", occ],
      ["Total bookings", B.length], ["Pending", cnt("PENDING") + cnt("PENDING_PAYMENT")], ["Confirmed", cnt("CONFIRMED") + cnt("PAID")], ["Cancelled", cnt("CANCELLED")]];
    view.innerHTML = `<div class="cards">${cards.map(([k, v]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}
      <div class="card accent"><div class="k">Revenue (paid)</div><div class="v">${money(revenue)}</div></div></div>
      <div class="grid2"><div class="panel"><h2>Bookings &amp; revenue — last 6 months</h2><canvas id="ch1" height="140"></canvas></div>
      <div class="panel"><h2>Occupancy today</h2><div class="occ">${d.rooms.map(r => { const o = occupiedToday(d, r.RoomID);
        return `<div class="occ-row"><span><span class="dot ${o ? "on" : "off"}"></span>${esc(r.room_name || r.RoomID)}</span><span class="muted small">${!r.is_active ? "Inactive" : o ? "Occupied" : "Free"}</span><span></span></div>`; }).join("")}</div></div></div>
      <div class="panel"><h2>Recent reservations</h2>${table(["Ref", "Guest", "Room", "Dates", "Status", "Total", "Source"],
        B.slice(0, 8).map(b => `<tr><td><strong>${esc(b.BookingID)}</strong></td><td>${esc(guestOf(d, b.GuestID).FullName || b.GuestID || "—")}</td><td>${esc(roomName(d, b.RoomID))}</td>
        <td>${fmtDate(b.CheckInDate)} – ${fmtDate(b.CheckOutDate)}</td><td>${statusBadge(b.BookingStatus)}</td><td>${money(b.TotalRoomAmount)}</td><td class="small muted">${esc(b.source || "n8n")}</td></tr>`), "No reservations yet.")}</div>`;
    const months = [...Array(6)].map((_, i) => { const x = new Date(); x.setDate(1); x.setMonth(x.getMonth() - 5 + i); return iso(x).slice(0, 7); });
    const inM = (b, m) => String(b.BookedOn || b.CheckInDate || "").slice(0, 7) === m;
    drawChart("ch1", { data: { labels: months.map(m => new Date(m + "-01").toLocaleDateString(undefined, { month: "short", year: "2-digit" })), datasets: [
      { type: "bar", label: "Bookings", data: months.map(m => B.filter(b => inM(b, m)).length), backgroundColor: "#173A35", yAxisID: "y" },
      { type: "line", label: "Revenue (PKR)", data: months.map(m => B.filter(b => inM(b, m) && isRevenue(b)).reduce((s, b) => s + Number(b.TotalRoomAmount || 0), 0)), borderColor: "#A9844B", backgroundColor: "#A9844B", yAxisID: "y1" }] },
      options: { responsive: true, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false } } } } });
  }

  // ---------- BOOKINGS ----------
  let bFilter = { q: "", status: "", building: "", from: "", to: "" };
  async function bookings() {
    loading(); let d; try { d = await loadAll(); } catch (e) { return fail(e); }
    actionsEl.innerHTML = `<button class="btn btn-primary" id="newB">New booking</button>`;
    document.getElementById("newB").onclick = () => newBooking(d);
    const draw = () => {
      const f = bFilter, qq = f.q.toLowerCase();
      const list = d.bookings.filter(b => { const g = guestOf(d, b.GuestID);
        return (!qq || [b.BookingID, g.FullName, g.Email, g.Phone, b.RoomID].some(x => String(x || "").toLowerCase().includes(qq)))
          && (!f.status || String(b.BookingStatus || "").toUpperCase() === f.status) && (!f.building || b.BuildingID === f.building || (d.rooms.find(r => r.RoomID === b.RoomID) || {}).buildingID === f.building)
          && (!f.from || b.CheckOutDate > f.from) && (!f.to || b.CheckInDate <= f.to); });
      document.getElementById("blist").innerHTML = table(["Ref", "Guest", "Room", "Check-in", "Check-out", "Guests", "Total", "Status", "Payment", ""],
        list.map(b => { const g = guestOf(d, b.GuestID), s = String(b.BookingStatus || "").toUpperCase();
          const next = { PENDING: ["CONFIRMED", "Confirm"], PENDING_PAYMENT: ["CONFIRMED", "Confirm"], CONFIRMED: ["CHECKED_IN", "Check in"], PAID: ["CHECKED_IN", "Check in"], CHECKED_IN: ["CHECKED_OUT", "Check out"] }[s];
          return `<tr><td><strong>${esc(b.BookingID)}</strong></td><td>${esc(g.FullName || "—")}<div class="muted small">${esc(g.Email || "")}</div></td><td>${esc(roomName(d, b.RoomID))}</td>
          <td>${fmtDate(b.CheckInDate)}</td><td>${fmtDate(b.CheckOutDate)}</td><td>${b.NumGuests ?? "—"}</td><td>${money(b.TotalRoomAmount)}</td><td>${statusBadge(b.BookingStatus)}</td><td class="small">${esc(b.PaymentStatus || "—")}</td>
          <td class="actions">${next ? `<button class="btn btn-ghost btn-sm" data-st="${esc(b.BookingID)}" data-to="${next[0]}">${next[1]}</button>` : ""}
          <button class="btn btn-ghost btn-sm" data-view="${esc(b.BookingID)}">View</button><button class="btn btn-ghost btn-sm" data-edit="${esc(b.BookingID)}">Edit</button>
          ${s !== "CANCELLED" ? `<button class="btn btn-ghost btn-sm" data-cancel="${esc(b.BookingID)}">Cancel</button>` : `<button class="btn btn-ghost btn-sm" data-del="${esc(b.BookingID)}">Delete</button>`}</td></tr>`; }),
        "No bookings match these filters.");
      document.getElementById("bcount").textContent = `${list.length} of ${d.bookings.length}`;
    };
    view.innerHTML = `<div class="toolbar">
      <div class="field" style="flex:1;min-width:220px"><label for="bq">Search</label><input id="bq" placeholder="Reference, guest name, email, phone" value="${esc(bFilter.q)}"></div>
      <div class="field"><label for="bs">Status</label><select id="bs"><option value="">All</option>${STATUSES.map(s => `<option value="${s}" ${bFilter.status === s ? "selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}</select></div>
      <div class="field"><label for="bb">Building</label><select id="bb"><option value="">All</option>${d.buildings.map(b => `<option value="${esc(b.buildingID)}" ${bFilter.building === b.buildingID ? "selected" : ""}>${esc(b.buildingName)}</option>`).join("")}</select></div>
      <div class="field"><label for="bf">Staying from</label><input type="date" id="bf" value="${bFilter.from}"></div>
      <div class="field"><label for="bt">to</label><input type="date" id="bt" value="${bFilter.to}"></div>
      <span class="muted small" id="bcount"></span></div><div id="blist"></div>`;
    [["bq", "q"], ["bs", "status"], ["bb", "building"], ["bf", "from"], ["bt", "to"]].forEach(([id, k]) => document.getElementById(id).oninput = e => { bFilter[k] = e.target.value; draw(); });
    draw();
    document.getElementById("blist").onclick = async e => {
      const t = e.target.closest("button"); if (!t) return;
      const find = id => d.bookings.find(b => b.BookingID === id);
      if (t.dataset.st) { const b = find(t.dataset.st), to = t.dataset.to;
        const patch = { BookingStatus: to }; if (to === "CHECKED_OUT" && !b.PaymentStatus) patch.PaymentStatus = "PAID";
        const { error } = await sb.from("bookings").update(patch).eq("BookingID", b.BookingID);
        if (error) return toast(friendlyError(error), "err");
        if (to === "CHECKED_IN" || to === "CHECKED_OUT") await sb.from("guests").update(to === "CHECKED_IN" ? { GuestStatus: "Checked in", CheckedInAt: new Date().toISOString() } : { GuestStatus: "Checked out", CheckedOutAt: new Date().toISOString() }).eq("GuestID", b.GuestID);
        toast(`${b.BookingID}: ${STATUS_LABEL[to]}.`); return bookings(); }
      if (t.dataset.view) { const b = find(t.dataset.view), g = guestOf(d, b.GuestID);
        return infoModal("Booking " + b.BookingID, `<div class="summary"><dl>
          <dt>Status</dt><dd>${statusBadge(b.BookingStatus)}</dd><dt>Payment</dt><dd>${esc(b.PaymentStatus || "—")} ${b.PaymentMode ? "· " + esc(b.PaymentMode) : ""}</dd>
          <dt>Room</dt><dd>${esc(roomName(d, b.RoomID))}</dd><dt>Building</dt><dd>${esc(bName(d, (d.rooms.find(r => r.RoomID === b.RoomID) || {}).buildingID))}</dd>
          <dt>Stay</dt><dd>${fmtDate(b.CheckInDate)} – ${fmtDate(b.CheckOutDate)} (${b.CheckInDate && b.CheckOutDate ? nightsBetween(b.CheckInDate, b.CheckOutDate) : "?"} nights)</dd>
          <dt>Guests</dt><dd>${b.NumGuests ?? "—"}</dd><dt>Total</dt><dd>${money(b.TotalRoomAmount)}</dd>
          <dt>Guest</dt><dd>${esc(g.FullName || "—")}</dd><dt>Email</dt><dd>${esc(g.Email || "—")}</dd><dt>Phone</dt><dd>${esc(g.Phone || "—")}</dd>
          <dt>CNIC</dt><dd>${esc(g.CNIC || "—")}</dd><dt>Booked</dt><dd>${b.BookedOn ? new Date(b.BookedOn).toLocaleString() : "—"}</dd><dt>Source</dt><dd>${esc(b.source || "n8n")}</dd>
          <dt>Notes</dt><dd>${esc(b.Notes || "—")}</dd></dl></div>`); }
      if (t.dataset.edit) return editBooking(d, find(t.dataset.edit));
      if (t.dataset.cancel) { const b = find(t.dataset.cancel);
        if (!(await confirmDialog(`Cancel booking ${b.BookingID}?`, "The dates will be released for other guests immediately.", "Cancel booking", true))) return;
        const { error } = await sb.from("bookings").update({ BookingStatus: "CANCELLED" }).eq("BookingID", b.BookingID);
        if (error) return toast(friendlyError(error), "err"); toast(`Booking ${b.BookingID} cancelled. Dates released.`); return bookings(); }
      if (t.dataset.del) { if (await del("bookings", "BookingID", t.dataset.del, "Booking " + t.dataset.del)) { await sb.from("room_bookings").delete().eq("BookingID", t.dataset.del); bookings(); } }
    };
  }
  const roomOpts = d => d.rooms.filter(r => r.is_active).map(r => [r.RoomID, `${r.room_name || r.RoomID} — ${r.TypeName}, ${money(r.RatePerNight)}/night`]);
  function newBooking(d) {
    formModal({ title: "New booking", submitLabel: "Create booking", fields: [
      { k: "room", label: "Room", type: "select", options: roomOpts(d), required: true, wide: true },
      { k: "ci", label: "Check-in", type: "date", required: true, min: today(), default: today() }, { k: "co", label: "Check-out", type: "date", required: true, default: addDays(today(), 1) },
      { k: "guests", label: "Guests", type: "number", required: true, default: 1, min: 1 }, { k: "offer", label: "Offer code" },
      { k: "name", label: "Guest full name", required: true }, { k: "email", label: "Email", type: "email", required: true },
      { k: "phone", label: "Phone", required: true }, { k: "nat", label: "Nationality" }, { k: "cnic", label: "CNIC / passport" },
      { k: "notes", label: "Notes", type: "textarea", wide: true }],
      onSubmit: async v => {
        const { data, error } = await sb.rpc("create_booking", { p_room: v.room, p_check_in: v.ci, p_check_out: v.co, p_full_name: v.name, p_email: v.email, p_phone: v.phone,
          p_num_guests: v.guests, p_nationality: v.nat, p_cnic: v.cnic, p_notes: v.notes, p_offer_code: v.offer, p_source: "admin" });
        if (error) throw error; toast(`Booking ${data[0].booking_id} created and confirmed (${money(data[0].total)}).`); bookings(); } });
  }
  function editBooking(d, b) {
    formModal({ title: "Edit booking " + b.BookingID, values: b, fields: [
      { k: "RoomID", label: "Room", type: "select", options: d.rooms.map(r => [r.RoomID, r.room_name || r.RoomID]), required: true, wide: true },
      { k: "CheckInDate", label: "Check-in", type: "date", required: true }, { k: "CheckOutDate", label: "Check-out", type: "date", required: true },
      { k: "NumGuests", label: "Guests", type: "number", min: 1 }, { k: "TotalRoomAmount", label: "Total (PKR)", type: "number", step: "0.01", min: 0 },
      { k: "BookingStatus", label: "Booking status", type: "select", options: STATUSES.map(s => [s, STATUS_LABEL[s]]), required: true },
      { k: "PaymentStatus", label: "Payment status", type: "select", options: ["PENDING", "PAID", "REFUNDED"], empty: "—" },
      { k: "PaymentMode", label: "Payment method" }, { k: "Notes", label: "Notes", type: "textarea", wide: true }],
      onSubmit: async v => {
        if (v.CheckOutDate <= v.CheckInDate) throw { message: "Check-out must be after check-in." };
        const room = d.rooms.find(r => r.RoomID === v.RoomID);
        if (v.NumGuests && room && v.NumGuests > room.Capacity) throw { message: `This room accommodates up to ${room.Capacity} guests.` };
        const { error } = await sb.from("bookings").update({ ...v, BuildingID: room ? room.buildingID : b.BuildingID }).eq("BookingID", b.BookingID);
        if (error) throw error; toast(`Booking ${b.BookingID} updated.`); bookings(); } });
  }

  // ---------- ROOMS ----------
  async function rooms() {
    loading(); let d, imgs, amen, ra;
    try { d = await loadAll(); [imgs, amen, ra] = await Promise.all([q(sb.from("room_images").select("*").order("sort_order")), q(sb.from("amenities").select("*").order("name")), q(sb.from("room_amenities").select("*"))]); }
    catch (e) { return fail(e); }
    actionsEl.innerHTML = `<button class="btn btn-primary" id="newR">Add room</button>`;
    document.getElementById("newR").onclick = () => roomForm(d, amen, ra, null);
    view.innerHTML = table(["", "Room", "Building", "Type", "Capacity", "Rate / night", "Status", ""], d.rooms.map(r => {
      const im = imgs.find(i => i.RoomID === r.RoomID);
      return `<tr><td>${im ? `<img src="${esc(im.url)}" alt="" style="width:64px;height:44px;object-fit:cover;border-radius:3px">` : ""}</td>
        <td><strong>${esc(r.room_name || r.RoomID)}</strong><div class="muted small">${esc(r.RoomID)}</div></td><td>${esc(bName(d, r.buildingID))}</td><td>${esc(r.TypeName)}</td><td>${r.Capacity}</td><td>${money(r.RatePerNight)}</td>
        <td><span class="dot ${r.is_active ? "on" : "off"}"></span>${r.is_active ? "Active" : "Inactive"}</td>
        <td class="actions"><button class="btn btn-ghost btn-sm" data-img="${esc(r.RoomID)}">Photos (${imgs.filter(i => i.RoomID === r.RoomID).length})</button>
        <button class="btn btn-ghost btn-sm" data-toggle="${esc(r.RoomID)}">${r.is_active ? "Deactivate" : "Activate"}</button>
        <button class="btn btn-ghost btn-sm" data-edit="${esc(r.RoomID)}">Edit</button><button class="btn btn-ghost btn-sm" data-del="${esc(r.RoomID)}">Delete</button></td></tr>`; }), "No rooms yet. Add your first room.");
    view.onclick = async e => {
      const t = e.target.closest("button"); if (!t) return;
      if (t.dataset.edit) return roomForm(d, amen, ra, d.rooms.find(r => r.RoomID === t.dataset.edit));
      if (t.dataset.img) return imageManager(t.dataset.img, d);
      if (t.dataset.toggle) { const r = d.rooms.find(x => x.RoomID === t.dataset.toggle);
        const { error } = await sb.from("rooms").update({ is_active: !r.is_active }).eq("RoomID", r.RoomID);
        if (error) return toast(friendlyError(error), "err"); toast(`${r.room_name || r.RoomID} ${r.is_active ? "deactivated — hidden from the website" : "activated"}.`); return rooms(); }
      if (t.dataset.del) { const id = t.dataset.del;
        if (d.bookings.some(b => b.RoomID === id)) return toast("This room has bookings, so it can’t be deleted. Deactivate it instead.", "err");
        if (await del("rooms", "RoomID", id, "Room " + id)) rooms(); }
    };
  }
  function roomForm(d, amen, ra, r) {
    const has = new Set(r ? ra.filter(x => x.RoomID === r.RoomID).map(x => x.amenity_id) : []);
    const extra = `<h4 style="margin-top:8px">Room amenities</h4><div class="checks">${amen.filter(a => a.category === "room").map(a => `<label class="check"><input type="checkbox" name="am" value="${a.id}" ${has.has(a.id) ? "checked" : ""}> ${esc(a.name)}</label>`).join("")}</div>`;
    formModal({ title: r ? "Edit " + (r.room_name || r.RoomID) : "Add room", values: r || { is_active: true }, extra, fields: [
      { k: "RoomID", label: "Room ID", required: true, readonly: !!r, placeholder: "e.g. R601", help: r ? "IDs are shared with n8n and can't be changed." : "Used by the website and n8n. Can't be changed later." },
      { k: "room_name", label: "Display name", required: true, placeholder: "Room 11 · Garden Standard" },
      { k: "buildingID", label: "Building", type: "select", options: d.buildings.map(b => [b.buildingID, b.buildingName]), required: true },
      { k: "floorID", label: "Floor", type: "select", options: d.floors.map(f => [f.floorID, `${f.floorTitle} (${bName(d, f.buildingID).split("–")[0].trim()})`]), empty: "—" },
      { k: "roomTypeID", label: "Room type", type: "select", options: d.types.map(t => [t.roomTypeID, t.typeName]), required: true },
      { k: "Capacity", label: "Max guests", type: "number", required: true, min: 1 }, { k: "RatePerNight", label: "Rate per night (PKR)", type: "number", required: true, min: 0, step: "0.01" },
      { k: "size_sqm", label: "Size (m²)", type: "number", min: 0 }, { k: "bed_type", label: "Bed type" },
      { k: "description", label: "Description", type: "textarea", wide: true }, { k: "is_active", label: "Active (bookable on the website)", type: "checkbox", wide: true }],
      onSubmit: async (v, dlg) => {
        if (!/^[A-Za-z0-9_-]{2,20}$/.test(v.RoomID)) throw { message: "Room ID can only use letters, numbers, - and _ (2–20 characters)." };
        const f = d.floors.find(x => x.floorID === v.floorID); if (f && f.buildingID !== v.buildingID) throw { message: "That floor belongs to a different building." };
        v.TypeName = (d.types.find(t => t.roomTypeID === v.roomTypeID) || {}).typeName;
        const res = r ? await sb.from("rooms").update(v).eq("RoomID", r.RoomID) : await sb.from("rooms").insert({ ...v, roomStatus: "Available" });
        if (res.error) throw res.error;
        const chosen = [...dlg.querySelectorAll('input[name="am"]:checked')].map(x => +x.value);
        const e1 = await sb.from("room_amenities").delete().eq("RoomID", v.RoomID); if (e1.error) throw e1.error;
        if (chosen.length) { const e2 = await sb.from("room_amenities").insert(chosen.map(id => ({ RoomID: v.RoomID, amenity_id: id }))); if (e2.error) throw e2.error; }
        toast(r ? "Room updated." : "Room added."); rooms(); } });
  }
  async function imageManager(roomId, d) {
    const dlg = infoModal("Photos — " + roomName(d, roomId), `<div id="imgs"><div class="spinner"></div></div>
      <h4 style="margin-top:20px">Add photos</h4><div class="toolbar"><div class="field" style="flex:1"><label for="up">Upload (JPG, PNG or WebP, max 5 MB)</label><input type="file" id="up" accept="image/jpeg,image/png,image/webp" multiple></div></div>
      <div class="toolbar"><div class="field" style="flex:1"><label for="url">Or add by image URL</label><input id="url" placeholder="https://…"></div><button type="button" class="btn btn-ghost" id="addUrl">Add</button></div>`);
    const box = dlg.querySelector("#imgs");
    const load = async () => { const { data, error } = await sb.from("room_images").select("*").eq("RoomID", roomId).order("sort_order");
      if (error) return box.innerHTML = `<p class="form-msg err">${esc(friendlyError(error))}</p>`;
      box.innerHTML = data.length ? `<div class="thumbs">${data.map((i, n) => `<figure><img src="${esc(i.url)}" alt=""><figcaption>
        ${n ? `<button type="button" class="btn btn-ghost btn-sm" data-cover="${i.id}" title="Make cover photo">Cover</button>` : `<span class="tag">Cover</span>`}
        <button type="button" class="btn btn-ghost btn-sm" data-rm="${i.id}">Remove</button></figcaption></figure>`).join("")}</div>` : `<p class="empty">No photos yet.</p>`;
      box.onclick = async e => { const t = e.target.closest("button"); if (!t) return;
        if (t.dataset.rm) { const img = data.find(x => x.id == t.dataset.rm);
          const { error } = await sb.from("room_images").delete().eq("id", img.id); if (error) return toast(friendlyError(error), "err");
          const m = img.url.match(/\/room-images\/(.+)$/); if (m) await sb.storage.from("room-images").remove([decodeURIComponent(m[1])]);
          toast("Photo removed."); load(); }
        if (t.dataset.cover) { const order = [data.find(x => x.id == t.dataset.cover), ...data.filter(x => x.id != t.dataset.cover)];
          for (let k = 0; k < order.length; k++) await sb.from("room_images").update({ sort_order: k }).eq("id", order[k].id);
          toast("Cover photo updated."); load(); } };
      return data; };
    await load();
    const nextOrder = async () => ((await sb.from("room_images").select("sort_order").eq("RoomID", roomId).order("sort_order", { ascending: false }).limit(1)).data?.[0]?.sort_order ?? -1) + 1;
    dlg.querySelector("#up").onchange = async e => {
      for (const file of e.target.files) {
        if (file.size > 5 * 1024 * 1024) { toast(`${file.name} is over 5 MB.`, "err"); continue; }
        const path = `${roomId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
        const up = await sb.storage.from("room-images").upload(path, file, { contentType: file.type });
        if (up.error) { toast(friendlyError(up.error), "err"); continue; }
        const url = sb.storage.from("room-images").getPublicUrl(path).data.publicUrl;
        const { error } = await sb.from("room_images").insert({ RoomID: roomId, url, sort_order: await nextOrder() });
        if (error) toast(friendlyError(error), "err"); else toast(`${file.name} uploaded.`);
      }
      e.target.value = ""; load();
    };
    dlg.querySelector("#addUrl").onclick = async () => { const u = dlg.querySelector("#url").value.trim();
      if (!/^https:\/\/\S+$/.test(u)) return toast("Enter a full https:// image URL.", "err");
      const { error } = await sb.from("room_images").insert({ RoomID: roomId, url: u, sort_order: await nextOrder() });
      if (error) return toast(friendlyError(error), "err"); dlg.querySelector("#url").value = ""; toast("Photo added."); load(); };
  }

  // ---------- BUILDINGS (+ floors) ----------
  async function buildings() {
    loading(); let d; try { d = await loadAll(); } catch (e) { return fail(e); }
    actionsEl.innerHTML = `<button class="btn btn-ghost" id="newF">Add floor</button> <button class="btn btn-primary" id="newBd">Add building</button>`;
    const bFields = (edit) => [{ k: "buildingID", label: "Building ID", required: true, readonly: edit, placeholder: "e.g. B3" }, { k: "buildingName", label: "Name", required: true },
      { k: "numFloors", label: "Number of floors", type: "number", min: 1 }, { k: "address", label: "Address" }, { k: "managerName", label: "Manager name" },
      { k: "managerEmail", label: "Manager email", type: "email" }, { k: "ManagerPh", label: "Manager phone" }, { k: "image_url", label: "Image URL", wide: true },
      { k: "description", label: "Description", type: "textarea", wide: true }];
    const save = (b) => async v => { const res = b ? await sb.from("buildings").update(v).eq("buildingID", b.buildingID) : await sb.from("buildings").insert(v); if (res.error) throw res.error; toast(b ? "Building updated." : "Building added."); buildings(); };
    document.getElementById("newBd").onclick = () => formModal({ title: "Add building", fields: bFields(false), onSubmit: save(null) });
    document.getElementById("newF").onclick = () => formModal({ title: "Add floor", fields: [{ k: "floorID", label: "Floor ID", required: true, placeholder: "e.g. F6" },
      { k: "buildingID", label: "Building", type: "select", options: d.buildings.map(b => [b.buildingID, b.buildingName]), required: true }, { k: "floorTitle", label: "Floor name", required: true }],
      onSubmit: async v => { const { error } = await sb.from("floors").insert(v); if (error) throw error; toast("Floor added."); buildings(); } });
    view.innerHTML = table(["Building", "Rooms", "Floors", "Manager", "Address", ""], d.buildings.map(b => `<tr><td><strong>${esc(b.buildingName)}</strong><div class="muted small">${esc(b.buildingID)}</div></td>
      <td>${d.rooms.filter(r => r.buildingID === b.buildingID).length}</td><td>${d.floors.filter(f => f.buildingID === b.buildingID).map(f => `${esc(f.floorTitle)} <button class="btn btn-ghost btn-sm" data-delf="${esc(f.floorID)}" aria-label="Delete floor ${esc(f.floorTitle)}">×</button>`).join("<br>") || "—"}</td>
      <td>${esc(b.managerName || "—")}<div class="muted small">${esc(b.managerEmail || "")}</div></td><td class="small">${esc(b.address || "—")}</td>
      <td class="actions"><button class="btn btn-ghost btn-sm" data-edit="${esc(b.buildingID)}">Edit</button><button class="btn btn-ghost btn-sm" data-del="${esc(b.buildingID)}">Delete</button></td></tr>`), "No buildings yet.");
    view.onclick = async e => { const t = e.target.closest("button"); if (!t) return;
      if (t.dataset.edit) { const b = d.buildings.find(x => x.buildingID === t.dataset.edit); formModal({ title: "Edit " + b.buildingName, values: b, fields: bFields(true), onSubmit: save(b) }); }
      if (t.dataset.del) { const id = t.dataset.del; if (d.rooms.some(r => r.buildingID === id)) return toast("Move or delete this building’s rooms first.", "err");
        await sb.from("floors").delete().eq("buildingID", id); if (await del("buildings", "buildingID", id, "Building")) buildings(); }
      if (t.dataset.delf) { const id = t.dataset.delf; if (d.rooms.some(r => r.floorID === id)) return toast("Rooms are assigned to this floor. Reassign them first.", "err"); if (await del("floors", "floorID", id, "Floor")) buildings(); } };
  }

  // ---------- GUESTS ----------
  async function guests() {
    loading(); let d; try { d = await loadAll(); } catch (e) { return fail(e); }
    actionsEl.innerHTML = `<button class="btn btn-primary" id="newG">Add guest</button>`;
    const gFields = [{ k: "FullName", label: "Full name", required: true }, { k: "Email", label: "Email", type: "email", required: true }, { k: "Phone", label: "Phone" },
      { k: "Nationality", label: "Nationality" }, { k: "CNIC", label: "CNIC / passport" }, { k: "GuestStatus", label: "Status", type: "select", options: ["Pending", "Confirmed", "Checked in", "Checked out"], empty: "—" }];
    document.getElementById("newG").onclick = () => formModal({ title: "Add guest", fields: gFields, onSubmit: async v => {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.Email)) throw { message: "Enter a valid email address." };
      const n = Math.max(99, ...d.guests.map(g => parseInt(String(g.GuestID).replace(/\D/g, "")) || 0)) + 1;
      const { error } = await sb.from("guests").insert({ ...v, Email: v.Email.toLowerCase(), GuestID: "G" + n }); if (error) throw error; toast("Guest added."); guests(); } });
    let qq = "";
    const draw = () => { document.getElementById("glist").innerHTML = table(["Guest", "Contact", "CNIC", "Bookings", "Status", ""],
      d.guests.filter(g => !qq || [g.FullName, g.Email, g.Phone, g.GuestID].some(x => String(x || "").toLowerCase().includes(qq))).map(g => {
        const n = d.bookings.filter(b => b.GuestID === g.GuestID).length;
        return `<tr><td><strong>${esc(g.FullName || "—")}</strong><div class="muted small">${esc(g.GuestID)}</div></td><td>${esc(g.Email || "")}<div class="muted small">${esc(g.Phone || "")}</div></td>
        <td class="small">${esc(g.CNIC || "—")}</td><td>${n}</td><td class="small">${esc(g.GuestStatus || "—")}</td>
        <td class="actions"><button class="btn btn-ghost btn-sm" data-hist="${esc(g.GuestID)}">History</button><button class="btn btn-ghost btn-sm" data-edit="${esc(g.GuestID)}">Edit</button><button class="btn btn-ghost btn-sm" data-del="${esc(g.GuestID)}">Delete</button></td></tr>`; }),
      "No guests yet."); };
    view.innerHTML = `<div class="toolbar"><div class="field" style="flex:1"><label for="gq">Search guests</label><input id="gq" placeholder="Name, email, phone or ID"></div></div><div id="glist"></div>`;
    document.getElementById("gq").oninput = e => { qq = e.target.value.toLowerCase(); draw(); }; draw();
    view.onclick = async e => { const t = e.target.closest("button"); if (!t) return;
      const g = d.guests.find(x => x.GuestID === (t.dataset.edit || t.dataset.hist || t.dataset.del));
      if (t.dataset.hist) { const list = d.bookings.filter(b => b.GuestID === g.GuestID);
        return infoModal("Booking history — " + (g.FullName || g.GuestID), table(["Ref", "Room", "Dates", "Status", "Total"], list.map(b => `<tr><td>${esc(b.BookingID)}</td><td>${esc(roomName(d, b.RoomID))}</td><td>${fmtDate(b.CheckInDate)} – ${fmtDate(b.CheckOutDate)}</td><td>${statusBadge(b.BookingStatus)}</td><td>${money(b.TotalRoomAmount)}</td></tr>`), "No bookings for this guest.")); }
      if (t.dataset.edit) return formModal({ title: "Edit guest", values: g, fields: gFields, onSubmit: async v => { const { error } = await sb.from("guests").update(v).eq("GuestID", g.GuestID); if (error) throw error; toast("Guest updated."); guests(); } });
      if (t.dataset.del) { if (d.bookings.some(b => b.GuestID === g.GuestID && ACTIVE(b.BookingStatus) && b.CheckOutDate >= today())) return toast("This guest has an upcoming booking. Cancel it before deleting the guest.", "err");
        if (await del("guests", "GuestID", g.GuestID, "Guest")) guests(); } };
  }

  // ---------- PRICING & OFFERS ----------
  async function pricing() {
    loading(); let d, rules, offers; try { d = await loadAll(); [rules, offers] = await Promise.all([q(sb.from("room_pricing").select("*").order("start_date")), q(sb.from("offers").select("*").order("created_at", { ascending: false }))]); } catch (e) { return fail(e); }
    view.innerHTML = `<div class="panel"><h2>Base prices by room type</h2><p class="muted small">Changing a base price can also update every room of that type (used by the website and n8n).</p>
      ${table(["Type", "Base price / night", "Max guests", "Rooms", ""], d.types.map(t => `<tr><td><strong>${esc(t.typeName)}</strong></td><td>${money(t.basePricePerNight)}</td><td>${t.maxGuests ?? "—"}</td>
        <td>${d.rooms.filter(r => r.roomTypeID === t.roomTypeID).length}</td><td class="actions"><button class="btn btn-ghost btn-sm" data-type="${esc(t.roomTypeID)}">Edit price</button></td></tr>`))}</div>
      <div class="panel"><div class="section-head" style="margin-bottom:12px"><h2 style="margin:0">Seasonal pricing</h2><button class="btn btn-primary btn-sm" id="newRule">Add seasonal price</button></div>
      <p class="muted small">For each night, a room-specific rule wins over a room-type rule; nights without a rule use the room’s normal rate.</p>
      ${table(["Label", "Applies to", "From", "To", "Price / night", "Active", ""], rules.map(p => `<tr><td><strong>${esc(p.label)}</strong></td><td>${p.RoomID ? esc(roomName(d, p.RoomID)) : "All " + esc((d.types.find(t => t.roomTypeID === p.roomTypeID) || {}).typeName || "") + " rooms"}</td>
        <td>${fmtDate(p.start_date)}</td><td>${fmtDate(p.end_date)}</td><td>${money(p.price_per_night)}</td><td><span class="dot ${p.is_active ? "on" : "off"}"></span>${p.is_active ? "Yes" : "No"}</td>
        <td class="actions"><button class="btn btn-ghost btn-sm" data-rule="${p.id}">Edit</button><button class="btn btn-ghost btn-sm" data-delrule="${p.id}">Delete</button></td></tr>`), "No seasonal prices. Rooms use their normal rate.")}</div>
      <div class="panel"><div class="section-head" style="margin-bottom:12px"><h2 style="margin:0">Special offers &amp; discounts</h2><button class="btn btn-primary btn-sm" id="newOffer">Add offer</button></div>
      ${table(["Code", "Title", "Discount", "Valid", "Active", ""], offers.map(o => `<tr><td><strong>${esc(o.code)}</strong></td><td>${esc(o.title || "")}</td><td>${o.discount_percent}%</td>
        <td class="small">${o.valid_from ? fmtDate(o.valid_from) : "Any"} – ${o.valid_to ? fmtDate(o.valid_to) : "Any"}</td><td><span class="dot ${o.is_active ? "on" : "off"}"></span>${o.is_active ? "Yes" : "No"}</td>
        <td class="actions"><button class="btn btn-ghost btn-sm" data-offer="${o.id}">Edit</button><button class="btn btn-ghost btn-sm" data-deloffer="${o.id}">Delete</button></td></tr>`), "No offers yet.")}</div>`;
    const ruleFields = [{ k: "label", label: "Label", required: true, placeholder: "e.g. New Year peak" },
      { k: "RoomID", label: "Specific room", type: "select", options: d.rooms.map(r => [r.RoomID, r.room_name || r.RoomID]), empty: "— none (use room type) —" },
      { k: "roomTypeID", label: "Or all rooms of type", type: "select", options: d.types.map(t => [t.roomTypeID, t.typeName]), empty: "—" },
      { k: "price_per_night", label: "Price per night (PKR)", type: "number", required: true, min: 0, step: "0.01" },
      { k: "start_date", label: "From", type: "date", required: true }, { k: "end_date", label: "To (inclusive)", type: "date", required: true }, { k: "is_active", label: "Active", type: "checkbox", default: true }];
    const saveRule = p => async v => { if (!v.RoomID && !v.roomTypeID) throw { message: "Choose a room or a room type." }; if (v.end_date < v.start_date) throw { message: "End date must be on or after the start date." };
      if (v.RoomID) v.roomTypeID = null; const res = p ? await sb.from("room_pricing").update(v).eq("id", p.id) : await sb.from("room_pricing").insert(v); if (res.error) throw res.error; toast("Seasonal price saved."); pricing(); };
    const offerFields = [{ k: "code", label: "Code", required: true, placeholder: "SUMMER15" }, { k: "title", label: "Title" }, { k: "discount_percent", label: "Discount %", type: "number", required: true, min: 1, step: "0.5" },
      { k: "valid_from", label: "Valid from (check-in)", type: "date" }, { k: "valid_to", label: "Valid to (check-in)", type: "date" }, { k: "description", label: "Description", wide: true }, { k: "is_active", label: "Active", type: "checkbox", default: true }];
    const saveOffer = o => async v => { v.code = v.code.toUpperCase().replace(/\s+/g, ""); if (v.discount_percent > 90) throw { message: "Discount can’t be more than 90%." };
      const res = o ? await sb.from("offers").update(v).eq("id", o.id) : await sb.from("offers").insert(v); if (res.error) throw res.error; toast("Offer saved."); pricing(); };
    document.getElementById("newRule").onclick = () => formModal({ title: "Add seasonal price", fields: ruleFields, onSubmit: saveRule(null) });
    document.getElementById("newOffer").onclick = () => formModal({ title: "Add offer", fields: offerFields, onSubmit: saveOffer(null) });
    view.onclick = async e => { const t = e.target.closest("button"); if (!t) return;
      if (t.dataset.type) { const ty = d.types.find(x => x.roomTypeID === t.dataset.type);
        formModal({ title: "Price — " + ty.typeName, values: { ...ty, apply: true }, fields: [{ k: "basePricePerNight", label: "Base price per night (PKR)", type: "number", required: true, min: 0, step: "0.01" },
          { k: "maxGuests", label: "Max guests", type: "number", min: 1 }, { k: "apply", label: `Also set this rate on all ${ty.typeName} rooms`, type: "checkbox", wide: true }],
          onSubmit: async v => { const { error } = await sb.from("room_types").update({ basePricePerNight: v.basePricePerNight, currentPrice: v.basePricePerNight, maxGuests: v.maxGuests }).eq("roomTypeID", ty.roomTypeID); if (error) throw error;
            if (v.apply) { const r2 = await sb.from("rooms").update({ RatePerNight: v.basePricePerNight }).eq("roomTypeID", ty.roomTypeID); if (r2.error) throw r2.error; }
            toast("Price updated."); pricing(); } }); }
      if (t.dataset.rule) { const p = rules.find(x => x.id == t.dataset.rule); formModal({ title: "Edit seasonal price", values: p, fields: ruleFields, onSubmit: saveRule(p) }); }
      if (t.dataset.delrule && await del("room_pricing", "id", t.dataset.delrule, "Seasonal price")) pricing();
      if (t.dataset.offer) { const o = offers.find(x => x.id == t.dataset.offer); formModal({ title: "Edit offer", values: o, fields: offerFields, onSubmit: saveOffer(o) }); }
      if (t.dataset.deloffer && await del("offers", "id", t.dataset.deloffer, "Offer")) pricing(); };
  }

  // ---------- REVIEWS ----------
  async function reviews() {
    loading(); let list, d; try { [list, d] = await Promise.all([q(sb.from("reviews").select("*").order("created_at", { ascending: false })), loadAll()]); } catch (e) { return fail(e); }
    let fs = "pending";
    const draw = () => { document.getElementById("rlist").innerHTML = table(["Guest", "Rating", "Review", "Room", "Date", "Status", ""], list.filter(r => !fs || r.status === fs).map(r => `<tr>
      <td><strong>${esc(r.guest_name)}</strong></td><td style="color:var(--brass)">${"★".repeat(r.rating)}</td><td style="max-width:380px">${esc(r.comment)}</td><td class="small">${esc(roomName(d, r.RoomID))}</td>
      <td class="small">${fmtDate(r.created_at)}</td><td><span class="badge ${r.status === "approved" ? "st-confirmed" : r.status === "rejected" ? "st-cancelled" : "st-pending"}">${esc(r.status)}</span></td>
      <td class="actions">${r.status !== "approved" ? `<button class="btn btn-ghost btn-sm" data-ap="${r.id}">Approve</button>` : ""}${r.status !== "rejected" ? `<button class="btn btn-ghost btn-sm" data-rj="${r.id}">Reject</button>` : ""}<button class="btn btn-ghost btn-sm" data-del="${r.id}">Delete</button></td></tr>`), "No reviews in this list."); };
    view.innerHTML = `<div class="toolbar"><div class="field"><label for="rs">Show</label><select id="rs"><option value="pending">Pending (${list.filter(r => r.status === "pending").length})</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option></select></div></div><div id="rlist"></div>`;
    document.getElementById("rs").onchange = e => { fs = e.target.value; draw(); }; draw();
    view.onclick = async e => { const t = e.target.closest("button[data-ap],button[data-rj],button[data-del]"); if (!t) return;
      if (t.dataset.del) { if (await del("reviews", "id", t.dataset.del, "Review")) reviews(); return; }
      const status = t.dataset.ap ? "approved" : "rejected"; const { error } = await sb.from("reviews").update({ status }).eq("id", t.dataset.ap || t.dataset.rj);
      if (error) return toast(friendlyError(error), "err"); toast(status === "approved" ? "Review approved — now visible on the website." : "Review rejected."); reviews(); };
  }

  // ---------- INQUIRIES ----------
  async function inquiries() {
    loading(); let list; try { list = await q(sb.from("contact_inquiries").select("*").order("created_at", { ascending: false })); } catch (e) { return fail(e); }
    const lab = { new: "New", in_progress: "In progress", resolved: "Resolved" };
    view.innerHTML = table(["From", "Subject", "Message", "Received", "Status", ""], list.map(i => `<tr><td><strong>${esc(i.name)}</strong><div class="small"><a href="mailto:${esc(i.email)}">${esc(i.email)}</a></div><div class="muted small">${esc(i.phone || "")}</div></td>
      <td>${esc(i.subject || "—")}</td><td style="max-width:360px">${esc(i.message)}</td><td class="small">${new Date(i.created_at).toLocaleString()}</td>
      <td><select data-st="${i.id}" aria-label="Status">${Object.entries(lab).map(([k, v]) => `<option value="${k}" ${i.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></td>
      <td class="actions">${i.status === "resolved" ? `<button class="btn btn-ghost btn-sm" data-del="${i.id}">Delete</button>` : ""}</td></tr>`), "No inquiries yet.");
    view.onchange = async e => { const s = e.target.closest("select[data-st]"); if (!s) return;
      const { error } = await sb.from("contact_inquiries").update({ status: s.value }).eq("id", s.dataset.st); if (error) return toast(friendlyError(error), "err"); toast("Inquiry marked " + lab[s.value].toLowerCase() + "."); inquiries(); };
    view.onclick = async e => { const t = e.target.closest("button[data-del]"); if (t && await del("contact_inquiries", "id", t.dataset.del, "Inquiry")) inquiries(); };
  }

  // ---------- REPORTS ----------
  let rep = { from: addDays(today(), -30), to: addDays(today(), 30) };
  async function reports() {
    loading(); let d; try { d = await loadAll(); } catch (e) { return fail(e); }
    actionsEl.innerHTML = `<button class="btn btn-ghost" id="csv">Export CSV</button>`;
    const span = Math.max(1, nightsBetween(rep.from, rep.to));
    const overlapN = b => { const s = b.CheckInDate > rep.from ? b.CheckInDate : rep.from, e = b.CheckOutDate < rep.to ? b.CheckOutDate : rep.to; return s < e ? nightsBetween(s, e) : 0; };
    const inRange = d.bookings.filter(b => b.CheckInDate && b.CheckOutDate && b.CheckInDate < rep.to && b.CheckOutDate > rep.from);
    const active = inRange.filter(b => ACTIVE(b.BookingStatus));
    const rev = inRange.filter(isRevenue).reduce((s, b) => s + Number(b.TotalRoomAmount || 0), 0);
    const booked = active.reduce((s, b) => s + Number(b.TotalRoomAmount || 0), 0);
    const roomOcc = d.rooms.map(r => ({ r, n: active.filter(b => b.RoomID === r.RoomID).reduce((s, b) => s + overlapN(b), 0) }));
    const totalOcc = roomOcc.reduce((s, x) => s + x.n, 0) / Math.max(1, d.rooms.length * span) * 100;
    view.innerHTML = `<div class="toolbar"><div class="field"><label for="rf">From</label><input type="date" id="rf" value="${rep.from}"></div><div class="field"><label for="rt">To</label><input type="date" id="rt" value="${rep.to}"></div>
      <button class="btn btn-primary" id="run">Update report</button><span class="muted small">Bookings with any night in this period.</span></div>
      <div class="cards"><div class="card"><div class="k">Bookings</div><div class="v">${inRange.length}</div></div><div class="card"><div class="k">Cancelled</div><div class="v">${inRange.length - active.length}</div></div>
      <div class="card"><div class="k">Occupancy</div><div class="v">${totalOcc.toFixed(1)}%</div></div><div class="card"><div class="k">Booked value</div><div class="v">${money(booked)}</div></div>
      <div class="card accent"><div class="k">Revenue (paid)</div><div class="v">${money(rev)}</div></div></div>
      <div class="grid2"><div class="panel"><h2>Check-ins per day</h2><canvas id="ch2" height="150"></canvas></div>
      <div class="panel"><h2>By building</h2>${table(["Building", "Bookings", "Nights", "Value"], d.buildings.map(b => { const l = active.filter(x => (d.rooms.find(r => r.RoomID === x.RoomID) || {}).buildingID === b.buildingID);
        return `<tr><td>${esc(b.buildingName)}</td><td>${l.length}</td><td>${l.reduce((s, x) => s + overlapN(x), 0)}</td><td>${money(l.reduce((s, x) => s + Number(x.TotalRoomAmount || 0), 0))}</td></tr>`; }))}</div></div>
      <div class="panel"><h2>Room occupancy</h2><div class="occ">${roomOcc.map(({ r, n }) => { const p = Math.min(100, n / span * 100);
        return `<div class="occ-row"><span>${esc(r.room_name || r.RoomID)}</span><div class="bar"><i style="width:${p}%"></i></div><span class="small">${p.toFixed(0)}%</span></div>`; }).join("")}</div></div>
      <div class="panel"><h2>Bookings in period</h2>${table(["Ref", "Guest", "Room", "Dates", "Status", "Value"], inRange.map(b => `<tr><td>${esc(b.BookingID)}</td><td>${esc(guestOf(d, b.GuestID).FullName || "—")}</td><td>${esc(roomName(d, b.RoomID))}</td><td>${fmtDate(b.CheckInDate)} – ${fmtDate(b.CheckOutDate)}</td><td>${statusBadge(b.BookingStatus)}</td><td>${money(b.TotalRoomAmount)}</td></tr>`), "No bookings in this period.")}</div>`;
    document.getElementById("run").onclick = () => { rep.from = document.getElementById("rf").value; rep.to = document.getElementById("rt").value;
      if (!rep.from || !rep.to || rep.to <= rep.from) return toast("The end date must be after the start date.", "err"); reports(); };
    const days = [...Array(Math.min(span, 120))].map((_, i) => addDays(rep.from, i));
    drawChart("ch2", { type: "bar", data: { labels: days.map(x => fmtDate(x).replace(/,? \d{4}$/, "")), datasets: [{ label: "Check-ins", data: days.map(x => active.filter(b => b.CheckInDate === x).length), backgroundColor: "#A9844B" }] },
      options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { display: false } } } });
    document.getElementById("csv").onclick = () => {
      const rows = [["BookingID", "Guest", "Email", "Room", "Building", "CheckIn", "CheckOut", "Nights", "Status", "PaymentStatus", "Total", "Source"],
        ...inRange.map(b => { const g = guestOf(d, b.GuestID), r = d.rooms.find(x => x.RoomID === b.RoomID) || {}; return [b.BookingID, g.FullName, g.Email, r.room_name || b.RoomID, bName(d, r.buildingID), b.CheckInDate, b.CheckOutDate, nightsBetween(b.CheckInDate, b.CheckOutDate), b.BookingStatus, b.PaymentStatus, b.TotalRoomAmount, b.source || "n8n"]; })];
      const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `bookings_${rep.from}_${rep.to}.csv`; a.click(); };
  }

  // ---------- router ----------
  const ROUTES = { overview: ["Overview", overview], bookings: ["Bookings", bookings], rooms: ["Rooms", rooms], buildings: ["Buildings", buildings], guests: ["Guests", guests],
    pricing: ["Pricing & offers", pricing], reviews: ["Reviews", reviews], inquiries: ["Inquiries", inquiries], reports: ["Reports & analytics", reports] };
  function route() {
    charts.forEach(c => c.destroy()); charts = []; actionsEl.innerHTML = ""; view.onclick = view.onchange = null;
    const key = (location.hash.slice(1) || "overview"); const [t, fn] = ROUTES[key] || ROUTES.overview;
    titleEl.textContent = t; document.title = t + " — Margalla House Admin";
    document.querySelectorAll(".side nav a").forEach(a => a.classList.toggle("active", a.getAttribute("href") === "#" + (ROUTES[key] ? key : "overview")));
    document.getElementById("side").classList.remove("open"); fn();
  }
  window.addEventListener("hashchange", route);
  guard();
})();
