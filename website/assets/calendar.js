/* Per-room availability calendar.
   Booked ranges are [check_in, check_out): a guest can check in on another guest's check-out day. */
(function () {
  const { sb, iso, parse, addDays, esc } = window.HMS;
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DOW = ["Mo","Tu","We","Th","Fr","Sa","Su"];

  class RoomCalendar {
    constructor(el, roomId, { onChange, months = 2, readOnly = false } = {}) {
      this.el = el; this.roomId = roomId; this.onChange = onChange || (() => {}); this.months = months; this.readOnly = readOnly;
      const now = new Date(); this.view = new Date(now.getFullYear(), now.getMonth(), 1);
      this.ranges = []; this.ci = null; this.co = null; this.loading = true;
      el.addEventListener("click", e => this.onClick(e));
      this.render(); this.refresh();
      // keep in step with n8n / admin bookings, but only while the guest is looking at the page
      this.timer = setInterval(() => { if (!document.hidden) this.refresh(true); }, 45000);
      this.onVis = () => { if (!document.hidden) this.refresh(true); };
      document.addEventListener("visibilitychange", this.onVis);
    }
    destroy() { clearInterval(this.timer); document.removeEventListener("visibilitychange", this.onVis); }
    async refresh(silent) {
      if (!silent) { this.loading = true; this.render(); }
      const { data, error } = await sb.rpc("get_room_booked_ranges", { p_room: this.roomId, p_from: iso(new Date()), p_to: addDays(iso(new Date()), 450) });
      this.loading = false; this.error = error ? "Couldn't load availability. Retrying shortly." : null;
      if (!error) this.ranges = data || [];
      // if a booking elsewhere has just taken our selection, clear it
      if (this.ci && this.co && !this.rangeFree(this.ci, this.co)) { this.ci = this.co = null; this.onChange(null, null, "taken"); }
      this.render();
    }
    isBookedNight(d) { return this.ranges.some(r => d >= r.check_in && d < r.check_out); }
    rangeFree(a, b) { return !this.ranges.some(r => r.check_in < b && r.check_out > a); }
    onClick(e) {
      const nav = e.target.closest("[data-nav]");
      if (nav) { this.view.setMonth(this.view.getMonth() + Number(nav.dataset.nav)); this.render(); return; }
      const cell = e.target.closest("button[data-d]");
      if (!cell || this.readOnly || cell.disabled) return;
      const d = cell.dataset.d;
      if (!this.ci || this.co || d <= this.ci) {
        if (this.isBookedNight(d)) return;
        this.ci = d; this.co = null;
      } else {
        if (!this.rangeFree(this.ci, d)) { this.flash = "Those dates include nights that are already booked. Choose a shorter stay or different dates."; this.ci = d; this.co = null; if (this.isBookedNight(d)) this.ci = null; }
        else this.co = d;
      }
      this.render(); this.onChange(this.ci, this.co);
    }
    setRange(ci, co) { this.ci = ci; this.co = co; this.render(); }
    monthHTML(y, m) {
      const first = new Date(y, m, 1), start = (first.getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
      const t = iso(new Date());
      let cells = "";
      for (let i = 0; i < start; i++) cells += `<span class="cal-pad"></span>`;
      for (let day = 1; day <= days; day++) {
        const d = iso(new Date(y, m, day));
        const past = d < t, booked = this.isBookedNight(d);
        const inSel = this.ci && ((this.co && d >= this.ci && d < this.co) || d === this.ci);
        const isOut = this.co && d === this.co;
        // a booked night can still be a check-out day for a stay ending there
        const canCheckout = this.ci && !this.co && d > this.ci && this.rangeFree(this.ci, d);
        const disabled = this.readOnly || past || (booked && !canCheckout);
        const cls = ["cal-day", past && "is-past", booked && "is-booked", inSel && "is-sel", d === this.ci && "is-start", isOut && "is-end"].filter(Boolean).join(" ");
        const label = `${day} ${MONTHS[m]} ${y}${booked ? ", booked" : past ? ", unavailable" : ", available"}`;
        cells += `<button type="button" class="${cls}" data-d="${d}" ${disabled ? "disabled" : ""} aria-label="${label}" aria-pressed="${!!(inSel || isOut)}">${day}</button>`;
      }
      return `<div class="cal-month"><div class="cal-title">${MONTHS[m]} ${y}</div>
        <div class="cal-dow">${DOW.map(x => `<span>${x}</span>`).join("")}</div><div class="cal-grid">${cells}</div></div>`;
    }
    render() {
      const now = new Date(), atStart = this.view.getFullYear() === now.getFullYear() && this.view.getMonth() === now.getMonth();
      let months = "";
      for (let i = 0; i < this.months; i++) { const v = new Date(this.view.getFullYear(), this.view.getMonth() + i, 1); months += this.monthHTML(v.getFullYear(), v.getMonth()); }
      const msg = this.flash; this.flash = null;
      this.el.innerHTML = `<div class="cal ${this.loading ? "is-loading" : ""}">
        <div class="cal-head"><button type="button" class="cal-nav" data-nav="-1" ${atStart ? "disabled" : ""} aria-label="Previous month">‹</button>
        <div class="cal-legend"><span><i class="lg lg-free"></i>Available</span><span><i class="lg lg-booked"></i>Booked</span><span><i class="lg lg-sel"></i>Your stay</span></div>
        <button type="button" class="cal-nav" data-nav="1" aria-label="Next month">›</button></div>
        <div class="cal-months">${months}</div>
        ${this.loading ? `<p class="cal-note">Loading live availability…</p>` : ""}
        ${this.error ? `<p class="cal-note cal-err">${esc(this.error)}</p>` : ""}
        ${msg ? `<p class="cal-note cal-err" role="alert">${esc(msg)}</p>` : ""}
      </div>`;
    }
  }
  window.RoomCalendar = RoomCalendar;
})();
