/* Voice concierge: branded UI on top of the ElevenLabs Conversational AI client.
   The SDK is loaded only when a guest opens the panel. If it can't start, the official
   ElevenLabs widget is offered as a fallback. */
(function () {
  const C = window.HMS_CONFIG, AGENT = C.ELEVENLABS_AGENT_ID;
  if (!AGENT) return;
  const SDK = "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.32.0/dist/lib.iife.js";
  const WIDGET = "https://cdn.jsdelivr.net/npm/@elevenlabs/convai-widget-embed@0.22.0";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MARK = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 58V30a20 20 0 0 1 40 0v28" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/><path d="M14.5 58V45l8.5-8 6 5 9-11 11.5 13v14z" fill="#A9844B"/><path d="M7 58.5h50" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>`;
  const ICON = {
    mic: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`,
    micOff: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.9 2.3M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18"/></svg>`,
    end: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15.5c5-4.7 13-4.7 18 0l-2.2 2.4a1.4 1.4 0 0 1-1.8.2l-2.3-1.6a1.4 1.4 0 0 1-.6-1.1v-1.6c-2-.6-4.2-.6-6.2 0v1.6c0 .4-.2.8-.6 1.1l-2.3 1.6a1.4 1.4 0 0 1-1.8-.2z"/></svg>`,
    close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
    send: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5z"/></svg>`
  };
  const PROMPTS = ["Which rooms are free this weekend?", "How much is a suite for 3 nights?", "What time is check-in?", "I want to change my booking"];

  // ---------- markup ----------
  const launcher = document.createElement("button");
  launcher.className = "vc-launcher"; launcher.type = "button";
  launcher.setAttribute("aria-haspopup", "dialog"); launcher.setAttribute("aria-controls", "vc-panel");
  launcher.innerHTML = `<span class="vc-launcher-icon">${ICON.mic}</span><span class="vc-launcher-text">Talk to our concierge</span>`;
  const panel = document.createElement("section");
  panel.id = "vc-panel"; panel.className = "vc-panel"; panel.hidden = true;
  panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "false"); panel.setAttribute("aria-labelledby", "vc-title");
  panel.innerHTML = `
    <header class="vc-head"><span class="vc-mark">${MARK}</span>
      <div><h2 id="vc-title">Voice concierge</h2><p class="vc-status" id="vc-status" aria-live="polite">Ready when you are</p></div>
      <button class="vc-icon-btn" data-act="close" aria-label="Close concierge">${ICON.close}</button></header>
    <div class="vc-stage" data-state="idle">
      <div class="vc-orb" aria-hidden="true"><i class="vc-ring r3"></i><i class="vc-ring r2"></i><i class="vc-ring r1"></i><span class="vc-core">${MARK}</span></div>
      <p class="vc-hint" id="vc-hint">Ask about rooms, prices and availability, or make and change a booking — just speak naturally.</p>
    </div>
    <div class="vc-log" id="vc-log" aria-live="polite" aria-label="Conversation transcript"></div>
    <div class="vc-chips" id="vc-chips">${PROMPTS.map(p => `<button type="button" class="vc-chip">${esc(p)}</button>`).join("")}</div>
    <form class="vc-type" id="vc-type" hidden><label class="sr-only" for="vc-input">Type a message</label>
      <input id="vc-input" autocomplete="off" placeholder="Or type a message…"><button class="vc-icon-btn" aria-label="Send message">${ICON.send}</button></form>
    <footer class="vc-foot">
      <button type="button" class="vc-icon-btn vc-mute" data-act="mute" aria-pressed="false" aria-label="Mute microphone" hidden>${ICON.mic}</button>
      <button type="button" class="vc-call" data-act="call"><span class="vc-call-icon">${ICON.mic}</span><span class="vc-call-text">Start conversation</span></button>
    </footer>
    <p class="vc-legal">Uses your microphone. Calls are handled by our AI concierge (ElevenLabs). Please don’t share card numbers.</p>`;
  document.body.append(launcher, panel);

  const $ = s => panel.querySelector(s);
  const stage = $(".vc-stage"), statusEl = $("#vc-status"), hint = $("#vc-hint"), log = $("#vc-log"), chips = $("#vc-chips");
  const callBtn = $(".vc-call"), muteBtn = $(".vc-mute"), typeForm = $("#vc-type"), input = $("#vc-input"), orb = $(".vc-orb");
  let conv = null, state = "idle", muted = false, raf = 0, pendingPrompt = null, sdkPromise = null;

  // ---------- helpers ----------
  function setState(s, text) {
    state = s; stage.dataset.state = s; panel.dataset.state = s; launcher.dataset.state = s;
    statusEl.textContent = text;
    const live = s === "listening" || s === "speaking";
    callBtn.classList.toggle("is-live", live || s === "connecting");
    callBtn.querySelector(".vc-call-icon").innerHTML = live || s === "connecting" ? ICON.end : ICON.mic;
    callBtn.querySelector(".vc-call-text").textContent = s === "connecting" ? "Connecting…" : live ? "End conversation" : "Start conversation";
    callBtn.disabled = s === "connecting";
    muteBtn.hidden = typeForm.hidden = !live;
    launcher.querySelector(".vc-launcher-text").textContent = live ? (s === "speaking" ? "Concierge is speaking…" : "Listening…") : "Talk to our concierge";
  }
  function addMsg(role, text) {
    if (!text) return;
    chips.hidden = true;
    const el = document.createElement("div");
    el.className = "vc-msg " + (role === "user" ? "from-user" : role === "agent" ? "from-agent" : "from-system");
    el.innerHTML = role === "system" ? esc(text) : `<span class="vc-who">${role === "user" ? "You" : "Concierge"}</span>${esc(text)}`;
    log.appendChild(el); log.scrollTop = log.scrollHeight;
  }
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.async = true; s.onload = res; s.onerror = () => rej(new Error("load")); document.head.appendChild(s); });
  }
  const loadSDK = () => sdkPromise || (sdkPromise = window.ElevenLabsClient ? Promise.resolve() : loadScript(SDK));
  function animate() {
    cancelAnimationFrame(raf);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      if (!conv) return;
      let v = 0;
      try { v = state === "speaking" ? conv.getOutputVolume() : conv.getInputVolume(); } catch (e) {}
      const level = reduce ? 0 : Math.min(1, v * 2.2);
      orb.style.setProperty("--lvl", level.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    tick();
  }
  function today() {
    const d = new Date();
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + " (" + d.toISOString().slice(0, 10) + ")";
  }

  // ---------- conversation ----------
  async function start() {
    if (state !== "idle" && state !== "ended" && state !== "error") return;
    log.querySelectorAll(".from-system.vc-err").forEach(n => n.remove());
    setState("connecting", "Connecting to the concierge…");
    hint.textContent = "Allow microphone access when your browser asks.";
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()));
    } catch (e) {
      setState("error", "Microphone is blocked");
      hint.innerHTML = "Allow microphone access for this site (the camera/mic icon in your browser’s address bar), then try again.";
      return;
    }
    try { await loadSDK(); }
    catch (e) { return fail("Couldn’t load the voice service. Check your connection."); }
    try {
      conv = await window.ElevenLabsClient.Conversation.startSession({
        agentId: AGENT,
        connectionType: "webrtc",
        onConnect: () => {
          setState("listening", "Connected — go ahead and speak");
          hint.textContent = "Speak naturally. You can interrupt at any time.";
          try { conv.sendContextualUpdate(`Today's date is ${today()}. The guest is on the ${C.HOTEL_NAME} website, page: ${location.hash || "#/"}.`); } catch (e) {}
          // send a tapped question right after the agent's greeting (or after 3 s if there is none)
          if (pendingPrompt) setTimeout(flushPrompt, 3000);
          animate();
        },
        onModeChange: ({ mode }) => { if (state === "listening" || state === "speaking") setState(mode === "speaking" ? "speaking" : "listening", mode === "speaking" ? "Concierge is speaking" : "Listening…"); },
        onMessage: m => { const role = m.role || (m.source === "user" ? "user" : "agent"); addMsg(role, m.message); if (role === "agent") setTimeout(flushPrompt, 400); },
        onError: (msg) => { console.warn("Voice concierge error:", msg); if (state === "connecting") fail("The concierge couldn’t start."); },
        onDisconnect: () => {
          cancelAnimationFrame(raf); orb.style.setProperty("--lvl", 0); conv = null;
          if (state !== "error") { setState("ended", "Conversation ended"); hint.textContent = "Start again whenever you like."; if (log.children.length) addMsg("system", "Conversation ended."); }
          muted = false; muteBtn.setAttribute("aria-pressed", "false"); muteBtn.innerHTML = ICON.mic;
        }
      });
    } catch (e) {
      console.warn(e);
      fail("The concierge couldn’t start. The agent may not allow this website yet.");
    }
  }
  function flushPrompt() {
    if (!pendingPrompt || !conv) return;
    const t = pendingPrompt; pendingPrompt = null;
    try { conv.sendUserMessage(t); addMsg("user", t); } catch (e) {}
  }
  function fail(msg) {
    conv = null; cancelAnimationFrame(raf);
    setState("error", "Couldn’t connect");
    hint.textContent = "";
    const el = document.createElement("div"); el.className = "vc-msg from-system vc-err";
    el.innerHTML = `${esc(msg)}<div class="vc-err-actions"><button type="button" class="vc-chip" data-act="retry">Try again</button><button type="button" class="vc-chip" data-act="widget">Use the standard voice widget</button></div>`;
    log.appendChild(el); log.scrollTop = log.scrollHeight;
  }
  async function stop() { if (conv) { setState("connecting", "Ending…"); try { await conv.endSession(); } catch (e) { conv = null; setState("ended", "Conversation ended"); } } }
  function fallbackWidget() {
    if (!document.querySelector("elevenlabs-convai")) {
      const w = document.createElement("elevenlabs-convai"); w.setAttribute("agent-id", AGENT); document.body.appendChild(w);
      loadScript(WIDGET).catch(() => addMsg("system", "The standard widget couldn’t load either. Please call us on " + C.PHONE + "."));
    }
    close(); launcher.hidden = true;
  }

  // ---------- open / close ----------
  function open(prompt) {
    panel.hidden = false; requestAnimationFrame(() => panel.classList.add("open"));
    launcher.setAttribute("aria-expanded", "true"); launcher.classList.add("is-open");
    loadSDK().catch(() => {}); // warm up
    if (prompt) { if (conv) { conv.sendUserMessage(prompt); addMsg("user", prompt); } else { pendingPrompt = prompt; start(); } }
    setTimeout(() => (conv ? input : callBtn).focus(), 60);
  }
  function close() {
    panel.classList.remove("open"); launcher.setAttribute("aria-expanded", "false"); launcher.classList.remove("is-open");
    setTimeout(() => { if (!panel.classList.contains("open")) panel.hidden = true; }, 250);
    launcher.focus();
  }
  launcher.onclick = () => (panel.classList.contains("open") ? close() : open());
  panel.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const act = b.dataset.act;
    if (act === "close") return close();
    if (act === "call") return conv ? stop() : start();
    if (act === "retry") return start();
    if (act === "widget") return fallbackWidget();
    if (act === "mute" && conv) { muted = !muted; conv.setMicMuted(muted); b.setAttribute("aria-pressed", muted); b.setAttribute("aria-label", muted ? "Unmute microphone" : "Mute microphone"); b.innerHTML = muted ? ICON.micOff : ICON.mic; statusEl.textContent = muted ? "Microphone muted" : "Listening…"; return; }
    if (b.classList.contains("vc-chip") && !act) { const t = b.textContent; if (conv) { conv.sendUserMessage(t); addMsg("user", t); } else { pendingPrompt = t; start(); } }
  });
  typeForm.onsubmit = e => { e.preventDefault(); const t = input.value.trim(); if (!t || !conv) return; conv.sendUserMessage(t); addMsg("user", t); input.value = ""; };
  document.addEventListener("keydown", e => { if (e.key === "Escape" && panel.classList.contains("open")) close(); });
  document.addEventListener("click", e => { const t = e.target.closest("[data-voice-open]"); if (t) { e.preventDefault(); open(t.dataset.voiceOpen || undefined); } });
  window.addEventListener("pagehide", () => { if (conv) conv.endSession(); });
  setState("idle", "Ready when you are");
  window.HMSVoice = { open, close };
})();
