/* Public website: hash router + pages */
(function () {
  const { sb, C, iso, addDays, nightsBetween, fmtDate, money, esc, today, toast, friendlyError } = window.HMS;
  const app = document.getElementById("app");
  const U = id => `https://images.unsplash.com/photo-${id}?w=2000&q=80`;
  let currentCal = null;

  // ---------- data: one request for the whole public catalog, cached for instant repeat visits ----------
  // Availability is never cached — calendars and bookings always ask the database live.
  const CACHE_KEY = "hms_catalog_v2", CACHE_TTL = 10 * 60 * 1000;
  let catalog = null, inflight = null;
  function readCache() { try { const c = JSON.parse(localStorage.getItem(CACHE_KEY)); return c && c.data ? c : null; } catch (e) { return null; } }
  async function fetchCatalog() {
    const { data, error } = await sb.rpc("get_public_catalog");
    if (error) throw error;
    const amenById = Object.fromEntries(data.amenities.map(a => [a.id, a]));
    data.rooms.forEach(r => { r.amenities = (r.amenities || []).map(a => amenById[a.id] || a); r.images = r.images || []; });
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data })); } catch (e) {}
    return data;
  }
  async function loadCatalog(force) {
    if (catalog && !force) return catalog;
    const c = readCache();
    if (c && !force) {
      catalog = c.data;
      if (Date.now() - c.t > CACHE_TTL && !inflight) inflight = fetchCatalog().then(d => { catalog = d; }).catch(() => {}).finally(() => { inflight = null; });
      return catalog;
    }
    inflight = inflight || fetchCatalog().finally(() => { inflight = null; });
    catalog = await inflight;
    return catalog;
  }
  // warm the catalog in the background as soon as the script runs
  loadCatalog().catch(() => {});

  // ---------- responsive, modern-format images (AVIF/WebP via Unsplash auto=format) ----------
  function sized(url, w) {
    if (!url) return url;
    if (!/images\.unsplash\.com/.test(url)) return url;
    const base = url.split("?")[0];
    return `${base}?auto=format&fit=crop&w=${w}&q=${w > 1200 ? 65 : 70}`;
  }
  function srcset(url, widths) { return /images\.unsplash\.com/.test(url || "") ? widths.map(w => `${sized(url, w)} ${w}w`).join(", ") : ""; }
  function img(url, { widths = [480, 800, 1200], sizes = "100vw", alt = "", lazy = true, cls = "", w, h } = {}) {
    const ss = srcset(url, widths);
    return `<img src="${esc(sized(url, widths[widths.length - 1]))}"${ss ? ` srcset="${esc(ss)}" sizes="${sizes}"` : ""} alt="${esc(alt)}"${lazy ? ' loading="lazy" decoding="async"' : ' fetchpriority="high"'}${cls ? ` class="${cls}"` : ""}${w ? ` width="${w}" height="${h}"` : ""}>`;
  }
  const roomImg = (r, i = 0) => r.images[i] || r.images[0] || U("1611892440504-42a792e24d32");
  const bName = (id) => (catalog.buildings.find(b => b.buildingID === id) || {}).buildingName || id;
  const shortB = (id) => bName(id).split("–")[0].trim();

  function roomCard(r) {
    return `<article class="room-card">
      <a href="#/room/${esc(r.RoomID)}">${img(roomImg(r), { widths: [400, 640, 900], sizes: "(max-width:620px) 100vw, (max-width:980px) 50vw, 380px", alt: r.room_name || r.RoomID, w: 600, h: 400 })}</a>
      <div class="body">
        <span class="tag">${esc(r.TypeName)}</span>
        <h3 style="margin-top:10px"><a href="#/room/${esc(r.RoomID)}" style="text-decoration:none">${esc(r.room_name || r.RoomID)}</a></h3>
        <div class="room-meta"><span>${esc(shortB(r.buildingID))}</span><span>Up to ${r.Capacity} guests</span>${r.size_sqm ? `<span>${r.size_sqm} m²</span>` : ""}${r.bed_type ? `<span>${esc(r.bed_type)} bed</span>` : ""}</div>
        <p class="muted small">${esc(r.description || "")}</p>
        <div class="foot"><span class="price">${money(r.RatePerNight)} <small>/ night</small></span>
          <a class="btn btn-primary btn-sm" href="#/room/${esc(r.RoomID)}">View dates</a></div>
      </div></article>`;
  }
  const loading = () => { app.innerHTML = `<div class="spinner" role="status" aria-label="Loading"></div>`; };
  const failed = (e) => { app.innerHTML = `<div class="wrap section"><div class="empty"><h2>We couldn't load this page</h2><p>${esc(friendlyError(e))}</p><button class="btn btn-primary" onclick="location.reload()">Try again</button></div></div>`; };

  // ---------- HOME (9 sections) ----------
  const SLIDES = [
    { img: "1542314831-068cd1dbfeeb", tag: "Building A · Main Tower", h: "Stay a while in the city’s quiet corner",
      p: "Ten rooms across two buildings, each with its own live calendar — pick your dates and book in minutes.", cta: ["Browse rooms", "#/rooms"] },
    { img: "1520250497591-112f2f40a3f4", tag: "Building B · Garden Wing", h: "Mornings by the garden pool",
      p: "The Garden Wing opens onto landscaped lawns and an outdoor pool, a short walk from the city centre.", cta: ["See Garden Wing rooms", "#/rooms?b=B2"] },
    { img: "1578683010236-d716f9a3f461", tag: "Skyline &amp; Terrace Suites", h: "Suites made for longer stays",
      p: "Separate living rooms, soaking tubs and terraces — space to settle in properly.", cta: ["View suites", "#/rooms?t=Suite"] }
  ];
  const SLIDE_MS = 7000;

  function initHero(hero) {
    const slides = [...hero.querySelectorAll(".hero-slide")], dots = [...hero.querySelectorAll(".hero-dots button")];
    const count = hero.querySelector(".hero-count b"), pauseBtn = hero.querySelector(".hero-pause");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let idx = 0, timer = null, userPaused = reduce, hoverPaused = false;
    hero.style.setProperty("--slide-ms", SLIDE_MS + "ms");
    function show(i, dir) {
      const n = slides.length; i = (i + n) % n; if (i === idx && dir !== "init") return;
      slides[idx].classList.remove("on"); slides[idx].classList.add("leaving"); const prev = slides[idx];
      setTimeout(() => prev.classList.remove("leaving"), 1200);
      idx = i;
      slides.forEach((s, j) => { s.classList.toggle("on", j === i); s.setAttribute("aria-hidden", j !== i); });
      dots.forEach((d, j) => { d.classList.toggle("on", j === i); d.setAttribute("aria-selected", j === i); d.classList.remove("run"); });
      count.textContent = String(i + 1).padStart(2, "0");
      restart(); warmNext && warmNext();
    }
    let warmNext = null;
    function restart() {
      clearTimeout(timer);
      const d = dots[idx]; d.classList.remove("run"); void d.offsetWidth;
      if (userPaused || hoverPaused || document.hidden) { hero.classList.add("paused"); return; }
      hero.classList.remove("paused"); d.classList.add("run");
      timer = setTimeout(() => { if (!document.body.contains(hero)) return; show(idx + 1); }, SLIDE_MS);
    }
    hero.querySelector(".prev").onclick = () => show(idx - 1);
    hero.querySelector(".next").onclick = () => show(idx + 1);
    dots.forEach(d => d.onclick = () => show(+d.dataset.slide));
    pauseBtn.onclick = () => { userPaused = !userPaused; pauseBtn.setAttribute("aria-pressed", userPaused); pauseBtn.setAttribute("aria-label", userPaused ? "Play slideshow" : "Pause slideshow"); restart(); };
    if (reduce) { pauseBtn.setAttribute("aria-pressed", "true"); pauseBtn.setAttribute("aria-label", "Play slideshow"); }
    hero.addEventListener("mouseenter", () => { hoverPaused = true; restart(); });
    hero.addEventListener("mouseleave", () => { hoverPaused = false; restart(); });
    hero.addEventListener("focusin", () => { hoverPaused = true; restart(); });
    hero.addEventListener("focusout", e => { if (!hero.contains(e.relatedTarget)) { hoverPaused = false; restart(); } });
    hero.addEventListener("keydown", e => { if (e.key === "ArrowLeft") { e.preventDefault(); show(idx - 1); } if (e.key === "ArrowRight") { e.preventDefault(); show(idx + 1); } });
    const onVis = () => { if (!document.body.contains(hero)) return document.removeEventListener("visibilitychange", onVis); restart(); };
    document.addEventListener("visibilitychange", onVis);
    let x0 = null, y0 = null;
    hero.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    hero.addEventListener("touchend", e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) show(idx + (dx < 0 ? 1 : -1)); x0 = null; }, { passive: true });
    // load the next slide's image shortly before it is shown (not all at once)
    const warm = i => { const im = slides[(i + slides.length) % slides.length].querySelector("img"); if (im) im.loading = "eager"; };
    warmNext = () => setTimeout(() => warm(idx + 1), SLIDE_MS - 2500);
    hero.addEventListener("pointerenter", () => { warm(idx + 1); warm(idx - 1); }, { once: true });
    show(0, "init");
  }

  async function home() {
    loading();
    let cat, reviews = [];
    try { cat = await loadCatalog(); reviews = cat.reviews || []; }
    catch (e) { return failed(e); }
    const featured = [...cat.rooms].sort((a, b) => b.RatePerNight - a.RatePerNight).slice(0, 3);
    const hotelAmen = cat.amenities.filter(a => a.category === "hotel");
    const amenCopy = { "Outdoor pool": "Heated pool in the Garden Wing, open 7am–9pm.", "Spa & wellness": "Massage and treatments by appointment.",
      "Restaurant": "All-day dining and breakfast buffet.", "Fitness centre": "Open 24 hours for hotel guests.", "Airport transfer": "Book a pickup when you reserve.",
      "24-hour front desk": "Someone is always here to help.", "Free parking": "Secure on-site parking for guests.", "Laundry service": "Same-day laundry and pressing." };
    app.innerHTML = `
    <section class="hero" aria-roledescription="carousel" aria-label="Hotel highlights" tabindex="0">
      <div class="hero-track">
      ${SLIDES.map((sl, i) => `<div class="hero-slide ${i === 0 ? "on" : ""}" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${SLIDES.length}" aria-hidden="${i !== 0}">
        ${img(U(sl.img), { widths: [640, 1024, 1600, 2000], sizes: "100vw", lazy: i > 0 })}
        <div class="hero-copy"><div class="wrap"><div class="hero-text">
          <p class="hero-tag">${sl.tag}</p><h1>${sl.h}</h1><p class="hero-lead">${sl.p}</p>
          <p class="hero-ctas"><a class="btn btn-brass" href="${sl.cta[1]}">${sl.cta[0]}</a> <a class="btn btn-outline-light" href="#availability">Check availability</a></p>
        </div></div></div></div>`).join("")}
      </div>
      <button class="hero-arrow prev" aria-label="Previous slide"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
      <button class="hero-arrow next" aria-label="Next slide"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
      <div class="hero-nav"><div class="wrap">
        <div class="hero-dots" role="tablist" aria-label="Choose slide">${SLIDES.map((sl, i) => `<button role="tab" class="${i === 0 ? "on" : ""}" data-slide="${i}" aria-selected="${i === 0}" aria-label="Slide ${i + 1}: ${sl.h}"><i></i></button>`).join("")}</div>
        <span class="hero-count" aria-hidden="true"><b>01</b> / 0${SLIDES.length}</span>
        <button class="hero-pause" aria-label="Pause slideshow" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="i-pause" d="M8 5v14M16 5v14"/><path class="i-play" d="M7 5l12 7-12 7z"/></svg></button>
      </div></div>
    </section>
    <div class="wrap booking-bar"><form id="quick" aria-label="Quick availability search">
      <div class="field"><label for="q-in">Check-in</label><input type="date" id="q-in" required min="${today()}" value="${addDays(today(), 1)}"></div>
      <div class="field"><label for="q-out">Check-out</label><input type="date" id="q-out" required min="${addDays(today(), 1)}" value="${addDays(today(), 3)}"></div>
      <div class="field"><label for="q-g">Guests</label><select id="q-g">${[1, 2, 3, 4].map(n => `<option ${n === 2 ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      <button class="btn btn-primary">Find available rooms</button></form></div>

    <section class="section" id="about"><div class="wrap split">
      <div><h2>A small hotel that remembers your name</h2>
        <p>Margalla House is two buildings and ten rooms run by one team. The Main Tower puts you above the city; the Garden Wing keeps you close to the lawns and pool.</p>
        <p class="muted">Every room is booked from its own calendar, so what you see is exactly what’s free — whether a guest books here, with our front desk, or through our chat and voice assistants.</p>
        <div class="facts"><div><strong>2</strong><span class="muted small">buildings</span></div><div><strong>${cat.rooms.length}</strong><span class="muted small">rooms &amp; suites</span></div><div><strong>24h</strong><span class="muted small">front desk</span></div></div>
        <p style="margin-top:24px"><a href="#/about">More about us</a></p></div>
      ${img(U("1564501049412-61c2a3083791"), { widths: [480, 800, 1100], sizes: "(max-width:860px) 100vw, 560px", alt: "Hotel lobby", w: 800, h: 600 })}
    </div></section>

    <section class="section section-tint"><div class="wrap">
      <div class="section-head"><h2>Our buildings</h2><p>Two different moods, one front desk.</p></div>
      <div class="buildings">${cat.buildings.map(b => `<a class="building" href="#/rooms?b=${esc(b.buildingID)}" style="text-decoration:none">
        ${img(b.image_url || U("1542314831-068cd1dbfeeb"), { widths: [480, 800, 1200], sizes: "(max-width:760px) 100vw, 580px" })}
        <div class="building-body"><h3>${esc(b.buildingName)}</h3><p>${esc(b.description || "")}</p>
        <span class="small" style="color:var(--brass-l)">${cat.rooms.filter(r => r.buildingID === b.buildingID).length} rooms · view rooms</span></div></a>`).join("")}</div>
    </div></section>

    <section class="section"><div class="wrap">
      <div class="section-head"><h2>Featured rooms</h2><a class="btn btn-ghost" href="#/rooms">See all ${cat.rooms.length} rooms</a></div>
      <div class="rooms-grid">${featured.map(roomCard).join("")}</div>
    </div></section>

    <section class="section section-tint" id="availability"><div class="wrap">
      <div class="section-head"><h2>Room availability</h2><p>Live from our booking system.</p></div>
      <div class="avail">
        <div><div class="field"><label for="av-room">Choose a room</label><select id="av-room">${cat.rooms.map(r => `<option value="${esc(r.RoomID)}">${esc(r.room_name)} — ${esc(shortB(r.buildingID))}</option>`).join("")}</select></div>
          <p class="muted small">Hatched days are already booked. Pick a check-in and check-out to continue to booking.</p>
          <div id="av-sum"></div>
          <h3 style="margin-top:28px;font-size:1.1rem">Or find every free room</h3>
          <div id="avail-results" class="avail-results"><p class="muted small">Use the search bar above to list rooms free for your dates.</p></div></div>
        <div id="av-cal"></div>
      </div>
    </div></section>

    <section class="section"><div class="wrap">
      <div class="section-head"><h2>Hotel amenities</h2><p>Included or available on request.</p></div>
      <div class="amen-grid">${hotelAmen.map(a => `<div><h4>${esc(a.name)}</h4><p>${esc(amenCopy[a.name] || "")}</p></div>`).join("")}</div>
    </div></section>

    <section class="section section-tint"><div class="wrap">
      <div class="section-head"><h2>Why guests choose us</h2></div>
      <div class="why">
        <div><h3>What you see is free</h3><p>Each room has its own calendar. Dates update as soon as anyone books, on any channel.</p></div>
        <div><h3>No double bookings</h3><p>Our system checks every reservation at the moment it’s made, so your room is guaranteed.</p></div>
        <div><h3>Best rate, direct</h3><p>Book here for our lowest prices and offers like WELCOME10.</p></div>
        <div><h3>Help at any hour</h3><p>Front desk, chat and our voice concierge around the clock.</p></div>
      </div>
      <div class="voice-cta"><div><h3>Rather just ask?</h3><p>Talk to our voice concierge — check dates, get prices or book a room in a two-minute conversation.</p></div>
        <button class="btn btn-brass" data-voice-open>Talk to the concierge</button></div>
    </div></section>

    <section class="section"><div class="wrap">
      <div class="section-head"><h2>What guests say</h2><a href="#/contact#review">Leave a review</a></div>
      ${reviews.length ? `<div class="quotes">${reviews.slice(0, 3).map(r => `<figure class="quote"><div class="stars" aria-label="${r.rating} out of 5">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</div>
        <blockquote>“${esc(r.comment)}”</blockquote><figcaption class="muted small">${esc(r.guest_name)}</figcaption></figure>`).join("")}</div>` : `<p class="empty">No reviews yet — be the first.</p>`}
    </div></section>

    <section class="section section-tint" id="contact"><div class="wrap contact">
      <div><h2>Contact &amp; location</h2>
        <p>${esc(C.ADDRESS)}<br>${esc(C.PHONE)}<br><a href="mailto:${esc(C.EMAIL)}">${esc(C.EMAIL)}</a></p>
        <iframe class="map" title="Map" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=73.03%2C33.68%2C73.10%2C33.73&layer=mapnik"></iframe>
        <p style="margin-top:20px"><a class="btn btn-primary" href="#/rooms">Book your stay</a></p></div>
      <div>${inquiryForm()}</div>
    </div></section>`;

    // carousel: autoplay with progress, arrows, dots, swipe, keyboard, pause on hover/focus/hidden tab
    initHero(app.querySelector(".hero"));
    // quick search
    document.getElementById("quick").onsubmit = async e => {
      e.preventDefault();
      const ci = document.getElementById("q-in").value, co = document.getElementById("q-out").value, g = +document.getElementById("q-g").value;
      const box = document.getElementById("avail-results");
      if (!ci || !co || co <= ci) { box.innerHTML = `<p class="form-msg err">Check-out must be after check-in.</p>`; document.getElementById("availability").scrollIntoView(); return; }
      box.innerHTML = `<div class="spinner"></div>`; document.getElementById("availability").scrollIntoView();
      const { data, error } = await sb.rpc("get_available_rooms", { p_check_in: ci, p_check_out: co });
      if (error) { box.innerHTML = `<p class="form-msg err">${esc(friendlyError(error))}</p>`; return; }
      const list = (data || []).filter(r => r.Capacity >= g);
      const n = nightsBetween(ci, co);
      box.innerHTML = list.length ? list.map(r => { const full = cat.rooms.find(x => x.RoomID === r.RoomID) || { images: [] };
        return `<div class="avail-row">${img(roomImg(full), { widths: [160], sizes: "72px", w: 72, h: 52 })}<div style="flex:1"><strong>${esc(r.room_name)}</strong><div class="muted small">${esc(shortB(r.buildingID))} · ${money(r.RatePerNight * n)} for ${n} night${n > 1 ? "s" : ""}</div></div>
        <a class="btn btn-primary btn-sm" href="#/room/${esc(r.RoomID)}?in=${ci}&out=${co}&g=${g}">Book</a></div>`; }).join("")
        : `<p class="form-msg err">No rooms are free for ${fmtDate(ci)} – ${fmtDate(co)} for ${g} guest${g > 1 ? "s" : ""}. Try different dates.</p>`;
    };

    // availability calendar
    const avSel = document.getElementById("av-room"), avSum = document.getElementById("av-sum");
    const mount = () => { if (currentCal) currentCal.destroy(); avSum.innerHTML = "";
      currentCal = new RoomCalendar(document.getElementById("av-cal"), avSel.value, { onChange: (ci, co, why) => {
        if (why === "taken") { avSum.innerHTML = `<p class="form-msg err">Those dates were just booked by someone else. Please choose again.</p>`; return; }
        avSum.innerHTML = ci && co ? `<div class="summary"><dl><dt>Stay</dt><dd>${fmtDate(ci)} – ${fmtDate(co)}</dd><dt>Nights</dt><dd>${nightsBetween(ci, co)}</dd></dl></div>
          <a class="btn btn-primary" href="#/room/${esc(avSel.value)}?in=${ci}&out=${co}">Continue to booking</a>` : ci ? `<p class="muted small">Now choose your check-out date.</p>` : ""; } }); };
    avSel.onchange = mount; mount();
    bindInquiry();
  }

  // ---------- inquiry & review forms ----------
  function inquiryForm() {
    return `<form id="inq" novalidate><h3>Send us a message</h3><div id="inq-msg"></div>
      <div class="field-row"><div class="field"><label for="i-name">Name</label><input id="i-name" required maxlength="120" autocomplete="name"></div>
      <div class="field"><label for="i-email">Email</label><input id="i-email" type="email" required maxlength="200" autocomplete="email"></div></div>
      <div class="field-row"><div class="field"><label for="i-phone">Phone (optional)</label><input id="i-phone" maxlength="40" autocomplete="tel"></div>
      <div class="field"><label for="i-subj">Subject</label><select id="i-subj"><option>Booking question</option><option>Group or event</option><option>Feedback</option><option>Other</option></select></div></div>
      <div class="field"><label for="i-msg">Message</label><textarea id="i-msg" rows="5" required maxlength="5000"></textarea></div>
      <button class="btn btn-primary">Send message</button></form>`;
  }
  function bindInquiry() {
    const f = document.getElementById("inq"); if (!f) return;
    f.onsubmit = async e => {
      e.preventDefault(); const m = document.getElementById("inq-msg"), v = id => document.getElementById(id).value.trim();
      if (v("i-name").length < 2) return m.innerHTML = `<p class="form-msg err">Please enter your name.</p>`;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v("i-email"))) return m.innerHTML = `<p class="form-msg err">Please enter a valid email address.</p>`;
      if (v("i-msg").length < 5) return m.innerHTML = `<p class="form-msg err">Please write a short message (at least 5 characters).</p>`;
      const btn = f.querySelector("button"); btn.disabled = true; btn.textContent = "Sending…";
      const { error } = await sb.from("contact_inquiries").insert({ name: v("i-name"), email: v("i-email"), phone: v("i-phone") || null, subject: v("i-subj"), message: v("i-msg") });
      btn.disabled = false; btn.textContent = "Send message";
      if (error) return m.innerHTML = `<p class="form-msg err">${esc(friendlyError(error))}</p>`;
      f.reset(); m.innerHTML = `<p class="form-msg ok">Message sent. We’ll reply within one business day.</p>`;
    };
  }

  // ---------- ROOMS ----------
  async function rooms(params) {
    loading(); let cat; try { cat = await loadCatalog(); } catch (e) { return failed(e); }
    const fb = params.get("b") || "", ft = params.get("t") || "";
    const types = [...new Set(cat.rooms.map(r => r.TypeName))];
    const groups = cat.buildings.filter(b => !fb || b.buildingID === fb).map(b => {
      const list = cat.rooms.filter(r => r.buildingID === b.buildingID && (!ft || r.TypeName === ft));
      return list.length ? `<section class="building-group"><h2>${esc(b.buildingName)} <span>${list.length} room${list.length > 1 ? "s" : ""}</span></h2>
        <p class="muted">${esc(b.description || "")}</p><div class="rooms-grid">${list.map(roomCard).join("")}</div></section>` : "";
    }).join("");
    app.innerHTML = `<section class="page-hero"><div class="wrap"><h1>Rooms &amp; suites</h1><p>${cat.rooms.length} rooms across our two buildings. Open any room to see its own live calendar.</p></div></section>
      <div class="wrap section"><form class="field-row" style="max-width:560px;margin-bottom:40px" id="filt">
        <div class="field"><label for="f-b">Building</label><select id="f-b"><option value="">All buildings</option>${cat.buildings.map(b => `<option value="${esc(b.buildingID)}" ${b.buildingID === fb ? "selected" : ""}>${esc(b.buildingName)}</option>`).join("")}</select></div>
        <div class="field"><label for="f-t">Room type</label><select id="f-t"><option value="">All types</option>${types.map(t => `<option ${t === ft ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div></form>
        ${groups || `<div class="empty"><h3>No rooms match these filters</h3><p><a href="#/rooms">Show all rooms</a></p></div>`}</div>`;
    const go = () => { const q = new URLSearchParams(); const b = document.getElementById("f-b").value, t = document.getElementById("f-t").value; if (b) q.set("b", b); if (t) q.set("t", t); location.hash = "#/rooms" + (q.toString() ? "?" + q : ""); };
    document.getElementById("f-b").onchange = go; document.getElementById("f-t").onchange = go;
  }

  // ---------- ROOM DETAIL + BOOKING FLOW ----------
  async function room(id, params) {
    loading(); let cat; try { cat = await loadCatalog(); } catch (e) { return failed(e); }
    const r = cat.rooms.find(x => x.RoomID === id);
    if (!r) { app.innerHTML = `<div class="wrap section empty"><h2>Room not found</h2><p>This room may no longer be available.</p><a class="btn btn-primary" href="#/rooms">See all rooms</a></div>`; return; }
    const st = { ci: params.get("in"), co: params.get("out"), guests: Math.min(+params.get("g") || 1, r.Capacity), quote: null, offer: "", step: 1 };
    app.innerHTML = `<div class="wrap" style="padding-top:36px">
      <p class="small"><a href="#/rooms">Rooms</a> / <a href="#/rooms?b=${esc(r.buildingID)}">${esc(shortB(r.buildingID))}</a></p>
      <h1 style="font-size:clamp(2rem,4vw,3rem)">${esc(r.room_name)}</h1>
      <div class="room-meta" style="font-size:.95rem"><span class="tag">${esc(r.TypeName)}</span><span>${esc(bName(r.buildingID))}</span><span>Up to ${r.Capacity} guests</span>${r.size_sqm ? `<span>${r.size_sqm} m²</span>` : ""}${r.bed_type ? `<span>${esc(r.bed_type)} bed</span>` : ""}</div>
      <div class="gallery">${[0, 1, 2].map(i => img(roomImg(r, i), i ? { widths: [400, 700], sizes: "(max-width:760px) 100vw, 380px", alt: `${r.room_name} photo ${i + 1}` } : { widths: [640, 1000, 1400], sizes: "(max-width:760px) 100vw, 760px", alt: `${r.room_name} photo 1`, lazy: false })).join("")}</div>
      <div class="detail"><div>
        <p style="font-size:1.1rem">${esc(r.description || "")}</p>
        <h3>In the room</h3><ul class="amen-list">${r.amenities.map(a => `<li>${esc(a.name)}</li>`).join("") || "<li>Details coming soon</li>"}</ul>
        <h3>Availability for this room</h3><p class="muted small">This calendar belongs to ${esc(r.room_name)} only. It updates automatically every 30 seconds.</p>
        <div id="cal"></div>
        <p class="small" style="margin-top:14px">Questions about this room? <a href="#" data-voice-open="Tell me about ${esc(r.room_name)}">Ask our voice concierge</a>.</p>
        <h3 style="margin-top:32px">Good to know</h3><p class="muted">Check-in from 2:00 pm, check-out by 12:00 pm. Your booking is held as <em>pending</em> until our team confirms it; you can cancel by contacting the front desk.</p>
      </div>
      <aside class="book-panel" aria-label="Booking"><div id="panel"></div></aside></div></div>`;

    const panel = document.getElementById("panel");
    const steps = () => `<div class="steps">${["Dates", "Your details", "Review"].map((s, i) => `<span class="${st.step >= i + 1 ? "on" : ""}">${i + 1}. ${s}</span>`).join("")}</div>`;
    async function requote() {
      st.quote = null; if (!(st.ci && st.co)) return;
      const { data, error } = await sb.rpc("quote_booking", { p_room: r.RoomID, p_check_in: st.ci, p_check_out: st.co, p_offer_code: st.offer || null });
      if (error) { st.quoteErr = friendlyError(error); if (st.offer) { st.offer = ""; return requote(); } } else { st.quote = data[0]; st.quoteErr = null; }
    }
    const summaryHTML = () => st.quote ? `<div class="summary"><dl>
      <dt>Check-in</dt><dd>${fmtDate(st.ci)}</dd><dt>Check-out</dt><dd>${fmtDate(st.co)}</dd>
      <dt>Nights</dt><dd>${st.quote.nights}</dd><dt>Guests</dt><dd>${st.guests}</dd>
      ${st.quote.discount_percent > 0 ? `<dt>Room total</dt><dd>${money(st.quote.base_total)}</dd><dt>Offer ${esc(st.offer.toUpperCase())}</dt><dd>−${st.quote.discount_percent}%</dd>` : ""}
      <dt class="total">Total</dt><dd class="total">${money(st.quote.total)}</dd></dl></div>` : "";

    function renderPanel() {
      if (st.step === 1) {
        panel.innerHTML = `${steps()}<div class="price" style="margin-bottom:12px">${money(r.RatePerNight)} <small>/ night</small></div>
          ${st.ci && st.co ? summaryHTML() : `<p class="muted">${st.ci ? "Now pick your check-out date on the calendar." : "Pick your check-in date on the calendar."}</p>`}
          ${st.quoteErr ? `<p class="form-msg err">${esc(st.quoteErr)}</p>` : ""}
          <div class="field"><label for="g">Guests</label><select id="g">${Array.from({ length: r.Capacity }, (_, i) => `<option ${i + 1 === st.guests ? "selected" : ""}>${i + 1}</option>`).join("")}</select></div>
          <div class="field"><label for="offer">Offer code (optional)</label><div style="display:flex;gap:8px"><input id="offer" value="${esc(st.offer)}" placeholder="e.g. WELCOME10"><button type="button" class="btn btn-ghost btn-sm" id="apply">Apply</button></div></div>
          <button class="btn btn-primary" style="width:100%" id="next1" ${st.quote ? "" : "disabled"}>Continue</button>`;
        document.getElementById("g").onchange = e => st.guests = +e.target.value;
        document.getElementById("apply").onclick = async () => { st.offer = document.getElementById("offer").value.trim(); await requote();
          if (st.offer && st.quote && st.quote.discount_percent > 0) toast("Offer applied."); else if (document.getElementById("offer").value.trim()) toast("That offer code isn’t valid for these dates.", "err"); renderPanel(); };
        document.getElementById("next1").onclick = () => { st.step = 2; renderPanel(); };
      } else if (st.step === 2) {
        const g = st.guest || {};
        panel.innerHTML = `${steps()}<form id="gf" novalidate><div id="gf-msg"></div>
          <div class="field"><label for="g-name">Full name</label><input id="g-name" required autocomplete="name" value="${esc(g.name || "")}"></div>
          <div class="field"><label for="g-email">Email</label><input id="g-email" type="email" required autocomplete="email" value="${esc(g.email || "")}"></div>
          <div class="field"><label for="g-phone">Phone</label><input id="g-phone" required autocomplete="tel" placeholder="+92 300 1234567" value="${esc(g.phone || "")}"></div>
          <div class="field-row"><div class="field"><label for="g-nat">Nationality</label><input id="g-nat" value="${esc(g.nat || "")}"></div>
          <div class="field"><label for="g-cnic">CNIC / passport (optional)</label><input id="g-cnic" value="${esc(g.cnic || "")}"></div></div>
          <div class="field"><label for="g-notes">Special requests (optional)</label><textarea id="g-notes" rows="3">${esc(g.notes || "")}</textarea></div>
          <div style="display:flex;gap:8px"><button type="button" class="btn btn-ghost" id="back2">Back</button><button class="btn btn-primary" style="flex:1">Review booking</button></div></form>`;
        document.getElementById("back2").onclick = () => { st.step = 1; renderPanel(); };
        document.getElementById("gf").onsubmit = e => { e.preventDefault(); const v = id => document.getElementById(id).value.trim();
          const gu = { name: v("g-name"), email: v("g-email"), phone: v("g-phone"), nat: v("g-nat"), cnic: v("g-cnic"), notes: v("g-notes") };
          const errs = []; if (gu.name.length < 2) errs.push("Enter your full name."); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(gu.email)) errs.push("Enter a valid email address.");
          if (gu.phone.replace(/\D/g, "").length < 7) errs.push("Enter a phone number we can reach you on.");
          if (errs.length) { document.getElementById("gf-msg").innerHTML = `<p class="form-msg err">${errs.join(" ")}</p>`; return; }
          st.guest = gu; st.step = 3; renderPanel(); };
      } else {
        const g = st.guest;
        panel.innerHTML = `${steps()}<h3>Review your booking</h3><p class="muted small">${esc(r.room_name)} · ${esc(shortB(r.buildingID))}</p>${summaryHTML()}
          <div class="summary"><dl><dt>Guest</dt><dd>${esc(g.name)}</dd><dt>Email</dt><dd>${esc(g.email)}</dd><dt>Phone</dt><dd>${esc(g.phone)}</dd></dl></div>
          <div id="bk-msg"></div>
          <div style="display:flex;gap:8px"><button class="btn btn-ghost" id="back3">Back</button><button class="btn btn-brass" style="flex:1" id="confirm">Confirm booking</button></div>
          <p class="muted small" style="margin-top:12px">Payment is taken at the hotel. Your dates are reserved the moment you confirm.</p>`;
        document.getElementById("back3").onclick = () => { st.step = 2; renderPanel(); };
        document.getElementById("confirm").onclick = async e => {
          const btn = e.target; btn.disabled = true; btn.textContent = "Reserving your room…";
          const { data, error } = await sb.rpc("create_booking", { p_room: r.RoomID, p_check_in: st.ci, p_check_out: st.co, p_full_name: g.name, p_email: g.email,
            p_phone: g.phone, p_num_guests: st.guests, p_nationality: g.nat || null, p_cnic: g.cnic || null, p_notes: g.notes || null, p_offer_code: st.offer || null, p_source: "website" });
          if (error) { btn.disabled = false; btn.textContent = "Confirm booking";
            document.getElementById("bk-msg").innerHTML = `<p class="form-msg err" role="alert">${esc(friendlyError(error))}</p>`;
            if (/already booked/.test(friendlyError(error))) { currentCal.refresh(); }
            return; }
          const b = data[0];
          sessionStorage.setItem("hms_last_booking", JSON.stringify({ ...b, room: r.room_name, building: bName(r.buildingID), ci: st.ci, co: st.co, guests: st.guests, name: g.name, email: g.email }));
          location.hash = "#/booking/" + b.booking_id;
        };
      }
    }
    if (currentCal) currentCal.destroy();
    currentCal = new RoomCalendar(document.getElementById("cal"), r.RoomID, { onChange: async (ci, co, why) => {
      if (why === "taken") toast("Those dates were just booked by someone else. Please choose again.", "err");
      st.ci = ci; st.co = co; st.step = 1; await requote(); renderPanel(); } });
    if (st.ci && st.co) { currentCal.setRange(st.ci, st.co); await requote(); }
    renderPanel();
  }

  // ---------- CONFIRMATION ----------
  function confirmation(id) {
    let b = null; try { b = JSON.parse(sessionStorage.getItem("hms_last_booking")); } catch (e) {}
    if (!b || b.booking_id !== id) { app.innerHTML = `<div class="wrap section confirm"><h1>Booking ${esc(id)}</h1><p>Keep this reference for your records. For changes, contact the front desk.</p><a class="btn btn-primary" href="#/">Back to home</a></div>`; return; }
    app.innerHTML = `<div class="wrap section confirm">
      <h1>Your room is reserved</h1><p>Thank you, ${esc(b.name)}. Your booking reference is</p><div class="ref">${esc(b.booking_id)}</div>
      <div class="summary" style="text-align:left"><dl><dt>Room</dt><dd>${esc(b.room)}</dd><dt>Building</dt><dd>${esc(b.building)}</dd>
      <dt>Check-in</dt><dd>${fmtDate(b.ci)}</dd><dt>Check-out</dt><dd>${fmtDate(b.co)}</dd><dt>Nights</dt><dd>${b.nights}</dd><dt>Guests</dt><dd>${b.guests}</dd>
      <dt>Status</dt><dd>${window.HMS.statusBadge(b.status)}</dd><dt class="total">Total</dt><dd class="total">${money(b.total)}</dd></dl></div>
      <p class="muted">Our team will confirm your booking shortly. Please quote <strong>${esc(b.booking_id)}</strong> if you contact us.</p>
      <p><button class="btn btn-ghost" onclick="window.print()">Print confirmation</button> <a class="btn btn-primary" href="#/">Back to home</a></p></div>`;
  }

  // ---------- ABOUT ----------
  async function about() {
    loading(); let cat; try { cat = await loadCatalog(); } catch (e) { return failed(e); }
    app.innerHTML = `<section class="page-hero"><div class="wrap"><h1>About Margalla House</h1><p>A ten-room hotel in two buildings, run by people who live here.</p></div></section>
    <section class="section"><div class="wrap split"><div><h2>Our story</h2>
      <p>We started with the Main Tower: five rooms stacked above the city, each finished by local craftspeople. When guests kept asking for somewhere quieter, we opened the Garden Wing around the old courtyard and pool.</p>
      <p>Today one team looks after both buildings. Breakfast, housekeeping and the front desk are shared, so wherever you stay, you get the same care.</p></div>
      ${img(U("1542314831-068cd1dbfeeb"), { widths: [480, 800, 1100], sizes: "(max-width:860px) 100vw, 560px", alt: "Hotel exterior", w: 800, h: 600 })}</div></section>
    <section class="section section-tint"><div class="wrap"><h2>Our buildings</h2><div class="buildings" style="margin-top:28px">${cat.buildings.map(b => `<a class="building" href="#/rooms?b=${esc(b.buildingID)}" style="text-decoration:none">${img(b.image_url, { widths: [480, 800, 1200], sizes: "(max-width:760px) 100vw, 580px" })}
      <div class="building-body"><h3>${esc(b.buildingName)}</h3><p>${esc(b.description || "")}</p><span class="small" style="color:var(--brass-l)">${esc(b.address || "")}</span></div></a>`).join("")}</div></div></section>
    <section class="section"><div class="wrap"><h2>Services</h2><div class="amen-grid" style="margin-top:28px">${cat.amenities.filter(a => a.category === "hotel").map(a => `<div><h4>${esc(a.name)}</h4></div>`).join("")}</div>
      <h2 style="margin-top:56px">Hospitality, the simple way</h2><p class="muted">Clear prices, no surprise fees, and a real person at the desk day and night. If something isn’t right, tell us and we’ll fix it.</p>
      <p><a class="btn btn-primary" href="#/rooms">Find your room</a></p></div></section>`;
  }

  // ---------- CONTACT (+ review) ----------
  async function contact() {
    let cat; try { cat = await loadCatalog(); } catch (e) { cat = { rooms: [] }; }
    app.innerHTML = `<section class="page-hero"><div class="wrap"><h1>Contact us</h1><p>Questions about a stay, a group booking or an event — we reply within one business day.</p></div></section>
    <section class="section"><div class="wrap contact"><div><h2>Find us</h2><p>${esc(C.ADDRESS)}<br>${esc(C.PHONE)}<br><a href="mailto:${esc(C.EMAIL)}">${esc(C.EMAIL)}</a></p>
      <p><button class="btn btn-brass" data-voice-open>Talk to our voice concierge</button></p>
      <p class="muted">Front desk: open 24 hours<br>Check-in from 2:00 pm · Check-out by 12:00 pm</p>
      <iframe class="map" title="Map" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=73.03%2C33.68%2C73.10%2C33.73&layer=mapnik"></iframe></div>
      <div>${inquiryForm()}</div></div></section>
    <section class="section section-tint" id="review"><div class="wrap" style="max-width:720px"><h2>Leave a review</h2><p class="muted">Reviews appear on the site after our team approves them.</p>
      <form id="rv" novalidate><div id="rv-msg"></div>
        <div class="field-row"><div class="field"><label for="r-name">Your name</label><input id="r-name" required maxlength="80"></div>
        <div class="field"><label for="r-rating">Rating</label><select id="r-rating">${[5, 4, 3, 2, 1].map(n => `<option value="${n}">${n} star${n > 1 ? "s" : ""}</option>`).join("")}</select></div></div>
        <div class="field"><label for="r-room">Room (optional)</label><select id="r-room"><option value="">—</option>${cat.rooms.map(r => `<option value="${esc(r.RoomID)}">${esc(r.room_name)}</option>`).join("")}</select></div>
        <div class="field"><label for="r-text">Your review</label><textarea id="r-text" rows="4" required maxlength="2000"></textarea></div>
        <button class="btn btn-primary">Submit review</button></form></div></section>`;
    bindInquiry();
    document.getElementById("rv").onsubmit = async e => {
      e.preventDefault(); const m = document.getElementById("rv-msg"), v = id => document.getElementById(id).value.trim();
      if (v("r-name").length < 2) return m.innerHTML = `<p class="form-msg err">Please enter your name.</p>`;
      if (v("r-text").length < 5) return m.innerHTML = `<p class="form-msg err">Please write at least a few words.</p>`;
      const { error } = await sb.from("reviews").insert({ guest_name: v("r-name"), rating: +v("r-rating"), comment: v("r-text"), RoomID: v("r-room") || null });
      if (error) return m.innerHTML = `<p class="form-msg err">${esc(friendlyError(error))}</p>`;
      e.target.reset(); m.innerHTML = `<p class="form-msg ok">Thank you! Your review will appear once approved.</p>`;
    };
    if (location.hash.includes("#review")) document.getElementById("review").scrollIntoView();
  }

  // ---------- router ----------
  async function route() {
    if (currentCal) { currentCal.destroy(); currentCal = null; }
    const raw = location.hash.replace(/^#/, "") || "/";
    const [pathPart, qs] = raw.split("?"); const path = pathPart.split("#")[0]; const params = new URLSearchParams(qs || "");
    document.querySelectorAll(".nav-links a").forEach(a => a.classList.toggle("active", a.getAttribute("href") === "#" + (path.split("/")[1] ? "/" + path.split("/")[1] : "/") && !a.classList.contains("btn")));
    document.getElementById("navlinks").classList.remove("open");
    window.scrollTo(0, 0);
    let m;
    if (path === "/" || path === "") await home();
    else if (path === "/rooms") await rooms(params);
    else if ((m = path.match(/^\/room\/([\w-]+)$/))) await room(m[1], params);
    else if ((m = path.match(/^\/booking\/([\w-]+)$/))) confirmation(m[1]);
    else if (path === "/about") await about();
    else if (path === "/contact") await contact();
    else app.innerHTML = `<div class="wrap section empty"><h1>Page not found</h1><a class="btn btn-primary" href="#/">Go home</a></div>`;
    document.title = (document.querySelector("#app h1")?.textContent || "Home") + " — " + C.HOTEL_NAME;
  }
  document.querySelector(".nav-toggle").onclick = e => { const l = document.getElementById("navlinks"); l.classList.toggle("open"); e.currentTarget.setAttribute("aria-expanded", l.classList.contains("open")); };
  document.getElementById("year").textContent = new Date().getFullYear();
  document.getElementById("footer-contact").innerHTML = `${esc(C.ADDRESS)}<br>${esc(C.PHONE)}<br><a href="mailto:${esc(C.EMAIL)}">${esc(C.EMAIL)}</a>`;
  window.addEventListener("hashchange", route); route();
})();
