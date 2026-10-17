/* Champion 5 — game logic. Scores, ratings and matchmaking are decided on the
   server (see supabase/setup.sql); this file runs the rounds and the screens. */
(() => {
"use strict";
const ROUND_MS = 15000, ROUNDS = 5, GAME_TZ = "America/New_York";

/* ---------------- Setup check ---------------- */
const CFG = window.D5_CONFIG || {};
const $ = id => document.getElementById(id);
if (!window.supabase || !CFG.url || !CFG.anonKey || CFG.url.includes("PASTE")) {
  $("loadMsg").textContent = "Setup isn't finished: add your Supabase URL and key to config.js.";
  return;
}
// Read the address bar before the client consumes it: a password-reset link
// arrives as #...type=recovery, an expired one as #error=...
const RECOVERY_LINK = /type=recovery/.test(location.hash);
const LINK_ERROR = /error_code=([a-z_]+)/.exec(location.hash);
const sb = window.supabase.createClient(CFG.url, CFG.anonKey);

/* ---------------- Helpers ---------------- */
const fmt = n => Number(n).toLocaleString("en-US");
function rng(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function hash(s){let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function shuffle(a,r=Math.random){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
const wait = ms => new Promise(r => setTimeout(r, ms));
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const sum = a => (a || []).reduce((x, y) => x + (Number(y) || 0), 0);
function show(id){ for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id; window.scrollTo(0,0); }
function chip(text, cls = "", pct){
  const c = document.createElement("span"); c.className = "chip " + cls; c.textContent = text;
  if (pct != null){ const p = document.createElement("span"); p.className = "p"; p.textContent = pct + "%"; c.appendChild(p); }
  return c;
}
function toast(msg){ const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2000); }
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function timeAgo(iso){
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} hr ago`;
}
function shiftDay(d, n){ const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function dayLabel(d, opts = {month:"short", day:"numeric"}){ return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {...opts, timeZone:"UTC"}); }
// Each day picks 5 from the categories that existed that day (so adding new ones never
// changes past days), skipping anything used in the previous 6 days.
const SET_EPOCH = "2026-10-17", NO_REPEAT_DAYS = 6, _sets = {};
function pickSet(day, recent){
  const pool = CATS.filter(c => (!c.from || c.from <= day) && !recent.has(c.id));
  return shuffle(pool, rng(hash("d5-" + day))).slice(0, ROUNDS);
}
function dailyCats(day){
  if (_sets[day]) return _sets[day];
  if (day < SET_EPOCH) return (_sets[day] = pickSet(day, new Set()));
  // Walk forward from the first day so every day's set is fixed and repeat-free.
  let d = SET_EPOCH;
  while (true){
    if (!_sets[d]){
      const recent = new Set();
      for (let k = 1; k <= NO_REPEAT_DAYS; k++){ const p = shiftDay(d, -k); if (p >= SET_EPOCH) _sets[p].forEach(c => recent.add(c.id)); }
      _sets[d] = pickSet(d, recent);
    }
    if (d >= day) return _sets[day];
    d = shiftDay(d, 1);
  }
}
const ADJ=["blitz","clutch","sneaky","turbo","quiet","lucky","frosty","rapid","golden","salty","crispy","hyper","mellow","rogue","cosmic"];
const NOUN=["mango","falcon","panda","noodle","otter","comet","walrus","taco","bison","pickle","heron","waffle","lynx","badger","pretzel"];
const ghostName = () => ADJ[Math.floor(Math.random()*ADJ.length)] + NOUN[Math.floor(Math.random()*NOUN.length)] + "_bot";

/* Seconds until the next set drops (midnight in GAME_TZ). */
function secsToDrop(){
  const p = new Intl.DateTimeFormat("en-US", {timeZone: GAME_TZ, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit"})
    .formatToParts(new Date()).reduce((o, x) => (o[x.type] = x.value, o), {});
  const s = (+p.hour % 24) * 3600 + (+p.minute) * 60 + (+p.second);
  return Math.max(0, 86400 - s);
}
function hms(s){ return [Math.floor(s/3600), Math.floor(s%3600/60), s%60].map(x => String(x).padStart(2, "0")).join(":"); }

/* ---------------- Tiers (display only; the server keeps the real rating) ---------------- */
const TIERS = [
  {n:"Bronze",min:0,c:"#c88a52"},{n:"Silver",min:900,c:"#c3cddc"},{n:"Gold",min:1100,c:"#ffc93c"},
  {n:"Platinum",min:1300,c:"#6fe3d6"},{n:"Diamond",min:1500,c:"#8ab4ff"},{n:"Champion",min:1700,c:"#ff7ad9"}
];
function tierOf(r){
  let i = 0; for (let k = 0; k < TIERS.length; k++) if (r >= TIERS[k].min) i = k;
  const t = TIERS[i], next = TIERS[i+1];
  if (!next) return {name:t.n, short:t.n[0], c:t.c, next:null};
  const lo = i === 0 ? 700 : t.min, span = next.min - lo, into = Math.max(0, r - lo);
  const div = 3 - Math.min(2, Math.floor(into / (span / 3)));
  return {name:`${t.n} ${["","I","II","III"][div]}`, short:t.n[0], c:t.c, next:next.n, toNext:next.min - r};
}
function divisions(){
  const out = [];
  TIERS.forEach((t, i) => {
    const next = TIERS[i+1];
    if (!next){ out.push({name:t.n, tier:t.n, lo:t.min, hi:Infinity, c:t.c}); return; }
    const lo = i === 0 ? 700 : t.min, span = next.min - lo;
    ["III","II","I"].forEach((d, k) => out.push({name:`${t.n} ${d}`, tier:t.n,
      lo:(i === 0 && k === 0) ? -Infinity : Math.ceil(lo + span*k/3), hi:Math.ceil(lo + span*(k+1)/3), c:t.c}));
  });
  return out;
}
const DIVS = divisions();
const kFor = played => played < 5 ? 60 - 6*played : 30;   // mirrors k_for() in setup.sql

/* ---------------- State ---------------- */
let ME = null;      // profile row
let DAY = null;     // today's game day "YYYY-MM-DD" (from the server)
let RUN = null;     // your run row for today, if any
let M = null;       // the match in progress

/* ---------------- Data ---------------- */
async function rpc(name, args){
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}
async function loadState(){
  const st = await rpc("get_state");
  DAY = st.day; ME = st.profile; RUN = st.run;
  return st;
}
async function todaysRuns(day = DAY){
  const { data, error } = await sb.from("runs")
    .select("user_id,total,rounds,answers,times,rating_before,opponent_id,opp_rounds,finished_at,status")
    .eq("day", day).eq("status", "done").limit(1000);
  if (error) throw error;
  return (data || []).filter(r => Array.isArray(r.answers));
}
async function usernames(ids){
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const { data } = await sb.from("profiles").select("id,username").in("id", uniq);
  return Object.fromEntries((data || []).map(p => [p.id, p.username]));
}
function placeOf(total, others){
  return 1 + others.filter(r => r.total > total).length;
}
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th","st","nd","rd"][n % 10] || "th");
function pctOf(total, others){
  if (!others.length) return null;
  let below = 0, eq = 0; for (const r of others){ if (r.total < total) below++; else if (r.total === total) eq++; }
  return Math.round(100 * (below + eq/2) / others.length);
}

/* ---------------- Auth ---------------- */
// "ok" | "taken" | "invalid" | "blocked". Falls back to the older check if update 3 isn't installed.
async function usernameStatus(name){
  try { return await rpc("check_username", { name }); }
  catch (e){ return (await rpc("username_available", { name })) ? "ok" : "taken"; }
}
let mode = "up";
function setMode(m){
  mode = m;
  $("tabUp").setAttribute("aria-selected", m === "up"); $("tabIn").setAttribute("aria-selected", m === "in");
  $("fUser").hidden = m !== "up";
  $("aSubmitT").textContent = m === "up" ? "Create account" : "Log in";
  $("aPass").autocomplete = m === "up" ? "new-password" : "current-password";
  $("aErr").textContent = ""; $("aErr").className = "formerr";
  $("aForgot").hidden = m !== "in";
}
$("tabUp").onclick = () => setMode("up");
$("tabIn").onclick = () => setMode("in");

let userCheck = 0;
$("aUser").addEventListener("input", () => {
  const v = $("aUser").value.trim().toLowerCase(), hint = $("aUserHint"), my = ++userCheck;
  if (!v){ hint.className = ""; hint.textContent = "3–16 letters, numbers or underscores. Other players see this."; return; }
  if (!/^[a-z0-9_]{3,16}$/.test(v)){ hint.className = "bad"; hint.textContent = "Use 3–16 letters, numbers or underscores."; return; }
  hint.className = ""; hint.textContent = "Checking…";
  setTimeout(async () => {
    if (my !== userCheck) return;
    try {
      const st = await usernameStatus(v);
      if (my !== userCheck) return;
      hint.className = st === "ok" ? "ok" : "bad";
      hint.textContent = st === "ok" ? `${v} is available` : st === "blocked" ? "That username isn't allowed. Pick another." : `${v} is taken`;
    } catch (e){ hint.className = ""; hint.textContent = ""; }
  }, 350);
});

$("authForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const err = $("aErr"); err.className = "formerr"; err.textContent = "";
  const email = $("aEmail").value.trim(), password = $("aPass").value;
  const username = $("aUser").value.trim().toLowerCase();
  if (!email || !password) { err.textContent = "Enter your email and password."; return; }
  $("aSubmit").disabled = true;
  try {
    if (mode === "up"){
      if (!/^[a-z0-9_]{3,16}$/.test(username)) throw new Error("Pick a username: 3–16 letters, numbers or underscores.");
      if (password.length < 6) throw new Error("Use a password with at least 6 characters.");
      const st = await usernameStatus(username);
      if (st === "blocked") throw new Error("That username isn't allowed. Pick another one.");
      if (st !== "ok") throw new Error(`${username} is taken. Try another username.`);
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username } } });
      if (error) throw error;
      if (!data.session){
        err.className = "formerr info";
        err.textContent = "Check your email to confirm your account, then log in.";
        setMode("in"); $("aEmail").value = email; err.className = "formerr info";
        err.textContent = "Check your email to confirm your account, then log in.";
        return;
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (e){
    const m = e.message || "";
    err.textContent =
      /Invalid login/i.test(m) ? "That email and password don't match. Check them and try again." :
      /already registered/i.test(m) ? "That email already has an account. Log in instead." :
      /Database error|not_allowed/i.test(m) ? "That username isn't available. Pick another one." :
      m || "Something went wrong. Try again.";
  } finally { $("aSubmit").disabled = false; }
});

$("logout").onclick = async () => { await sb.auth.signOut(); };

/* ---------------- Password reset ---------------- */
$("aForgot").onclick = () => { $("fEmail").value = $("aEmail").value.trim(); $("fpMsg").textContent = ""; show("forgot"); };
$("fpBack").onclick = () => { setMode("in"); show("auth"); };
$("forgotForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const msg = $("fpMsg"), email = $("fEmail").value.trim();
  msg.className = "formerr";
  if (!/^\S+@\S+\.\S+$/.test(email)){ msg.textContent = "Enter the email you signed up with."; return; }
  $("fpSubmit").disabled = true;
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/" });
    if (error) throw error;
    msg.className = "formerr info";
    msg.textContent = "If that email has an account, a reset link is on its way. Check your inbox and spam folder.";
  } catch (e){
    msg.textContent = /rate|too many|429/i.test(e.message || "") ? "Too many reset emails were sent just now. Try again in a little while." : "Couldn't send the email. Check the address and try again.";
  } finally { $("fpSubmit").disabled = false; }
});

let recovering = RECOVERY_LINK;
$("newpassForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const msg = $("npMsg"), a = $("npPass").value, b = $("npPass2").value;
  msg.className = "formerr";
  if (a.length < 6){ msg.textContent = "Use at least 6 characters."; return; }
  if (a !== b){ msg.textContent = "The two passwords don't match."; return; }
  $("npSubmit").disabled = true;
  try {
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) throw error;
    recovering = false;
    history.replaceState(null, "", location.pathname);
    toast("Password updated");
    booted = true; boot();
  } catch (e){
    msg.textContent = /different from the old/i.test(e.message || "") ? "Pick a password you haven't used before." : (e.message || "Couldn't save the password. Try again.");
  } finally { $("npSubmit").disabled = false; }
});

let booted = false;
sb.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY") recovering = true;
  if (recovering && session){
    $("npWho").textContent = session.user && session.user.email ? `For ${session.user.email}` : "";
    show("newpass"); return;
  }
  if (!session){
    booted = false; ME = null; setMode(LINK_ERROR ? "in" : "up"); show("auth");
    if (LINK_ERROR && !booted){
      $("aErr").textContent = /expired/.test(LINK_ERROR[1]) ? "That reset link has expired. Tap “Forgot your password?” to get a new one." : "That link didn't work. Tap “Forgot your password?” to get a new one.";
      history.replaceState(null, "", location.pathname);
    }
    return;
  }
  if (!booted){ booted = true; setTimeout(boot, 0); }   // run outside the auth callback
});

async function boot(){
  show("loading"); $("loadMsg").textContent = "Loading…";
  try {
    await loadState();
    // An unfinished match from this session means you left: that's a forfeit.
    if (RUN && RUN.status === "pending" && !M){ await rpc("forfeit_pending"); await loadState(); }
    if (ME.wins + ME.losses + ME.draws === 0 && !RUN && !seenHowto()) openHowto(); else renderHome();
  } catch (e){
    $("loadMsg").textContent = "Couldn't reach the game server. Refresh to try again.";
    console.error(e);
  }
}

/* ---------------- Rank ladder ---------------- */
const SCALE_LO = 700, SCALE_HI = 1800;
const toPct = r => Math.max(0, Math.min(100, (r - SCALE_LO) / (SCALE_HI - SCALE_LO) * 100));
function renderLadder(el, r, prev){
  const i = DIVS.findIndex(d => r >= d.lo && r < d.hi), d = DIVS[i], up = DIVS[i+1], down = DIVS[i-1];
  const played = ME.wins + ME.losses + ME.draws, perWin = kFor(played) / 2;
  el.textContent = "";
  const h = document.createElement("div"); h.className = "lad-head";
  const hb = document.createElement("b"); hb.textContent = d.name; hb.style.color = d.c;
  const hs = document.createElement("small"); hs.textContent = `${fmt(r)} rating`;
  h.append(hb, hs); el.appendChild(h);
  const sc = document.createElement("div"); sc.className = "lad-scale";
  const tr = document.createElement("div"); tr.className = "lad-track";
  const lb = document.createElement("div"); lb.className = "lad-labels";
  TIERS.forEach((t, ti) => {
    const lo = Math.max(SCALE_LO, t.min), hi = TIERS[ti+1] ? TIERS[ti+1].min : SCALE_HI, w = hi - lo;
    const seg = document.createElement("span"); seg.style.flex = w; seg.style.background = t.c;
    if (t.n === d.tier) seg.classList.add("on");
    DIVS.filter(x => x.tier === t.n && isFinite(x.lo) && x.lo > lo).forEach(x => { const tk = document.createElement("i"); tk.style.left = ((x.lo - lo) / w * 100) + "%"; seg.appendChild(tk); });
    tr.appendChild(seg);
    const l = document.createElement("span"); l.style.flex = w; l.textContent = t.n; if (t.n === d.tier) l.classList.add("on"); lb.appendChild(l);
  });
  sc.appendChild(tr);
  if (prev != null && prev !== r){ const g = document.createElement("span"); g.className = "lad-ghost"; g.style.left = toPct(prev) + "%"; sc.appendChild(g); }
  const me = document.createElement("div"); me.className = "lad-me"; me.innerHTML = "<em>You</em>";
  me.style.left = toPct(prev != null ? prev : r) + "%"; sc.appendChild(me);
  if (prev != null) requestAnimationFrame(() => requestAnimationFrame(() => { me.style.left = toPct(r) + "%"; }));
  el.append(sc, lb);
  const lo = isFinite(d.lo) ? d.lo : d.hi - 67, hi = isFinite(d.hi) ? d.hi : d.lo + 100;
  const bar = document.createElement("div"); bar.className = "div-bar";
  const fill = document.createElement("i"); fill.style.background = d.c;
  fill.style.width = Math.max(3, Math.min(100, (r - lo) / (hi - lo) * 100)) + "%"; bar.appendChild(fill);
  el.appendChild(bar);
  const ends = document.createElement("div"); ends.className = "div-ends";
  const mk = (side, label, title, line, cls) => { const e = document.createElement("div"); e.className = "div-end " + side;
    const a = document.createElement("span"); a.className = "label"; a.textContent = label;
    const b = document.createElement("strong"); b.textContent = title;
    const c = document.createElement("small"); c.textContent = line; if (cls) c.className = cls;
    e.append(a, b, c); return e; };
  if (down && isFinite(d.lo)){
    const cushion = r - d.lo;
    ends.appendChild(mk("l", "Demotion", down.name, cushion === 0 ? "Your next loss drops you" : `${cushion} pt${cushion === 1 ? "" : "s"} of cushion`, cushion <= Math.round(perWin * 0.7) ? "warn" : ""));
  } else ends.appendChild(mk("l", "Demotion", "None", "You're at the bottom rung"));
  if (up && isFinite(d.hi)){
    const need = d.hi - r, wins = Math.max(1, Math.ceil(need / perWin));
    ends.appendChild(mk("r", "Promotion", up.name, `${need} pt${need === 1 ? "" : "s"} · about ${wins} win${wins === 1 ? "" : "s"}`, wins === 1 ? "near" : ""));
  } else ends.appendChild(mk("r", "Promotion", "Top tier", "Champion has no ceiling"));
  el.appendChild(ends);
}

/* ---------------- Share ---------------- */
function shareText(run, line){
  const lines = run.rounds.map((y, i) => { const t = run.opp_rounds[i] || 0; return `${y > t ? "🟩" : y < t ? "🟥" : "🟨"} ${y}`; });
  const margin = run.total - sum(run.opp_rounds);
  const after = run.rating_before + run.rating_delta;
  return [
    `Champion 5 · ${dayLabel(run.day)}`,
    `${run.total} correct · ${margin > 0 ? "Won" : margin < 0 ? "Lost" : "Draw"}`,
    ...(line ? [line] : []),
    ...lines,
    `${tierOf(after).name} (${run.rating_delta >= 0 ? "+" : ""}${run.rating_delta}) · ${fmt(after)}`,
    location.origin
  ].join("\n");
}
function wireShare(btn, box, text){
  box.textContent = text;
  btn.onclick = async () => {
    if (navigator.share){
      try { await navigator.share({ text }); return; } catch (e){ if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(text); toast("Copied. Paste it anywhere."); }
    catch (e){ const r = document.createRange(); r.selectNodeContents(box); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Selected. Copy it with your keyboard."); }
  };
}
function standing(total, others){
  // Under 10 players a percentile is noisy, so show a place instead.
  if (!others.length) return null;
  if (others.length + 1 < 10) return `${ordinal(placeOf(total, others))} of ${others.length + 1} today`;
  return `Top ${Math.max(1, 100 - pctOf(total, others))}% today`;
}
function renderPct(el, p, n, total, others){
  el.hidden = false; el.textContent = "";
  el.append(p == null ? "First to finish today" : n + 1 < 10 ? `${ordinal(placeOf(total, others))} place of ${n + 1} players today` : `Better than ${p}% of players today`);
  const s = document.createElement("small");
  s.textContent = n ? `${n + 1} players so far · updates as more people play` : "Your score sets the bar for everyone after you";
  el.appendChild(s);
}

/* ---------------- Home ---------------- */
function renderHome(){
  const t = tierOf(ME.rating);
  $("meName").textContent = ME.username;
  $("rBadge").textContent = t.short; document.documentElement.style.setProperty("--tier", t.c);
  $("rTier").textContent = t.name; $("rRating").textContent = fmt(ME.rating);
  $("rNext").textContent = t.next ? `${t.toNext} to ${t.next}` : "Top tier";
  renderLadder($("homeLadder"), ME.rating);
  $("sW").textContent = ME.wins; $("sL").textContent = ME.losses; $("sBest").textContent = fmt(ME.best);
  const live = ME.last_day && (ME.last_day === DAY || ME.last_day === shiftDay(DAY, -1));
  $("sStreak").textContent = live ? ME.streak : 0;
  $("openStats").hidden = !ME.is_admin;
  const done = !!RUN;
  $("playDaily").hidden = done || !!ME.banned; $("doneCard").hidden = !done;
  $("bannedNote").hidden = !ME.banned;
  $("dPct").hidden = true; $("dGhost").hidden = true;
  if (done){
    const dr = $("dRes");
    if (RUN.status === "forfeit"){
      dr.className = "done-res l"; dr.textContent = `Forfeit · ${RUN.rating_delta} rating`;
      $("dShare").hidden = true; $("dShareBtn").hidden = true;
    } else {
      const margin = RUN.total - sum(RUN.opp_rounds);
      dr.className = "done-res " + (margin > 0 ? "w" : margin < 0 ? "l" : "t");
      dr.textContent = `${RUN.total} correct · ${margin > 0 ? "Won" : margin < 0 ? "Lost" : "Draw"}`;
      $("dShare").hidden = false; $("dShareBtn").hidden = false;
      wireShare($("dShareBtn"), $("dShare"), shareText(RUN, null));
      const mine = RUN;
      todaysRuns().then(all => {
        if (RUN !== mine) return;
        const others = all.filter(r => r.user_id !== ME.id);
        const p = pctOf(mine.total, others);
        renderPct($("dPct"), p, others.length, mine.total, others);
        wireShare($("dShareBtn"), $("dShare"), shareText(mine, standing(mine.total, others)));
        renderGhostRecord(all);
      }).catch(() => {});
    }
  }
  const dropLocal = new Date(Date.now() + secsToDrop() * 1000).toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit"});
  $("dropTime").textContent = `${dropLocal} your time`;
  show("home");
}

/* How other players did against your run today. */
async function renderGhostRecord(all){
  const el = $("dGhost");
  const ds = all.filter(r => r.opponent_id === ME.id);
  el.hidden = false; el.textContent = "";
  const h = document.createElement("div"); h.className = "gr-head";
  if (!ds.length){
    h.textContent = "Your ghost is waiting";
    const sub = document.createElement("div"); sub.className = "gr-sub";
    sub.textContent = "Your run becomes the opponent for players near your rating. Check back later to see how it does.";
    el.append(h, sub); return;
  }
  const res = r => { const g = sum(r.opp_rounds); return g > r.total ? "w" : g < r.total ? "l" : "t"; };
  const w = ds.filter(r => res(r) === "w").length, l = ds.filter(r => res(r) === "l").length, t = ds.length - w - l;
  h.textContent = `Your ghost went ${w}–${l}${t ? `–${t}` : ""} `;
  const hs = document.createElement("span"); hs.textContent = `· played ${ds.length} time${ds.length === 1 ? "" : "s"} today`; h.appendChild(hs);
  el.appendChild(h);
  ds.sort((a, b) => new Date(b.finished_at) - new Date(a.finished_at));
  const names = await usernames(ds.slice(0, 5).map(r => r.user_id));
  ds.slice(0, 5).forEach(r => {
    const row = document.createElement("div"); row.className = "gr-row";
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = "vs " + (names[r.user_id] || "a player");
    const rs = document.createElement("span"); const x = res(r); rs.className = "rs " + x;
    rs.textContent = `${x === "w" ? "Won" : x === "l" ? "Lost" : "Drew"} ${sum(r.opp_rounds)}–${r.total}`;
    row.append(nm, rs); el.appendChild(row);
  });
  if (ds.length > 5){ const more = document.createElement("div"); more.className = "gr-sub"; more.textContent = `+${ds.length - 5} more`; el.appendChild(more); }
}

setInterval(() => {
  const s = secsToDrop(), t = hms(s);
  $("dCount").textContent = t; $("fCount").textContent = t;
  if (s <= 1 && ME && !M && !$("home").hidden) setTimeout(() => boot(), 2500);
}, 1000);

/* ---------------- Match ---------------- */
$("playDaily").onclick = startMatch;

async function startMatch(){
  show("queue");
  $("qSearch").hidden = false; $("qFound").hidden = true; $("qErr").textContent = "";
  $("qRating").textContent = fmt(ME.rating);
  let start, others = [];
  try {
    [start, others] = await Promise.all([
      rpc("start_match"),
      todaysRuns().catch(() => []),
      wait(1400 + Math.random() * 800)
    ]);
  } catch (e){
    if (/already_played|banned/.test(e.message || "")){ await loadState(); renderHome(); return; }
    $("qErr").textContent = "Couldn't start the match. Check your connection and try again.";
    setTimeout(() => boot(), 2500); return;
  }
  DAY = start.day;
  const cats = dailyCats(DAY), o = start.opponent;
  const opp = { kind: o.kind, rating: o.rating, rounds: o.rounds };
  if (o.kind === "real"){
    opp.name = o.username || "A player";
    opp.answers = o.answers; opp.times = o.times;
    opp.ago = `recorded ${timeAgo(o.finished_at)}`;
  } else {
    // Simulated ghost: the server set how many answers it gets each round; pick which ones here.
    opp.name = ghostName();
    opp.answers = []; opp.times = [];
    o.rounds.forEach((n, i) => {
      const len = cats[i].entries.length, k = Math.min(n, len), picked = new Set();
      while (picked.size < k) picked.add(Math.floor(Math.pow(Math.random(), 1.7) * len));
      opp.answers.push([...picked]);
      opp.times.push(Array.from({length: k}, () => 1200 + Math.random() * (ROUND_MS - 1700)).sort((a, b) => a - b));
    });
    opp.ago = "simulated (you're the first to play today)";
  }
  M = { cats, opp, round: 0, others: others.filter(r => r.user_id !== ME.id),
        you: [], them: [], youAns: [], themAns: [], youTimes: [], submit: null, result: null };

  $("qSearch").hidden = true; $("qFound").hidden = false;
  $("qMode").textContent = `Champion 5 · ${dayLabel(DAY)}`;
  $("qYouN").textContent = ME.username;
  $("qYouR").textContent = fmt(ME.rating); $("qYouT").textContent = tierOf(ME.rating).name;
  $("qOppN").textContent = opp.name; $("qOppR").textContent = fmt(opp.rating); $("qOppT").textContent = tierOf(opp.rating).name;
  $("qAgo").textContent = opp.ago;
  await wait(2200);
  nextRound();
}

// Leaving mid-match (reload or closing the tab) is settled as a forfeit the next time
// the site loads, or by the server after 20 minutes. Briefly switching apps is fine.

function ghostRun(cat){
  const ans = M.opp.answers[M.round] || [], ts = M.opp.times[M.round] || [];
  return ans.map((idx, k) => ({ idx, t: Number(ts[k]) || ((k + 1) * ROUND_MS / (ans.length + 1)) }))
    .filter(g => Number.isInteger(g.idx) && g.idx >= 0 && g.idx < cat.entries.length && g.t <= ROUND_MS + 1000);
}

async function nextRound(){
  const cat = M.cats[M.round];
  show("intro");
  $("iRound").textContent = `Round ${M.round + 1} of ${ROUNDS}`;
  const f = $("iCat"); f.textContent = cat.name; f.style.animation = "none"; void f.offsetWidth; f.style.animation = "";
  for (const n of [3, 2, 1]){
    const c = $("iCount"); c.textContent = n; c.classList.remove("pop"); void c.offsetWidth; c.classList.add("pop");
    await wait(reduce ? 500 : 750);
  }
  playRound(cat);
}

function playRound(cat){
  show("round");
  const ghost = ghostRun(cat);
  const found = new Set(), order = [], hitTimes = [];
  let oppShown = 0, done = false;
  $("gCat").textContent = cat.name; $("gRound").textContent = `Round ${M.round + 1} of ${ROUNDS}`;
  $("gOppN").textContent = M.opp.name; $("gYou").textContent = 0; $("gOpp").textContent = 0;
  $("gChips").innerHTML = ""; $("gFb").textContent = ""; $("gFb").className = "fb";
  const input = $("gInput"); input.value = ""; input.disabled = false; setTimeout(() => input.focus(), 30);
  const start = performance.now();
  const bump = el => { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); };
  const fb = (msg, cls) => { const e = $("gFb"); e.textContent = msg; e.className = "fb " + cls; };
  const entryFx = cls => { const e = $("gForm"); e.classList.remove("shake", "ok"); void e.offsetWidth; e.classList.add(cls); };

  $("gForm").onsubmit = ev => {
    ev.preventDefault(); if (done) return;
    const val = input.value.trim(); if (!val) return;
    input.value = "";
    const idx = matchAnswer(cat, val);
    if (idx < 0){ fb(`“${val}” doesn't count`, "bad"); entryFx("shake"); return; }
    if (found.has(idx)){ fb(`Already got ${cat.entries[idx].show}`, "dupe"); entryFx("shake"); return; }
    found.add(idx); order.push(idx);
    const now = performance.now() - start; hitTimes.push(now);
    const shown = cat.entries[idx].show;
    fb(cat.entries[idx].forms.includes(norm(val)) ? "+1" : `+1 · counted as ${shown}`, "good");
    entryFx("ok");
    $("gChips").appendChild(chip(shown));
    $("gYou").textContent = found.size; bump($("gYou"));
    const recent = hitTimes.filter(t => now - t <= 5000).length;
    if (recent >= 3 && (recent === 3 || recent % 2 === 1)) comboFx(recent >= 5 ? `ON FIRE ×${recent}` : `COMBO ×${recent}`);
  };
  $("gEnd").onclick = () => finish();

  function tick(){
    if (done) return;
    const el = performance.now() - start, left = Math.max(0, ROUND_MS - el);
    $("gBar").style.transform = `scaleX(${left / ROUND_MS})`;
    const secs = Math.ceil(left / 1000), c = $("gClock"); c.textContent = secs; c.classList.toggle("low", secs <= 3 && left > 0);
    const due = ghost.filter(g => g.t <= el).length;
    if (due !== oppShown){ oppShown = due; $("gOpp").textContent = due; bump($("gOpp")); }
    if (left <= 0) return finish();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function finish(){
    if (done) return; done = true; input.disabled = true; input.blur();
    $("gClock").classList.remove("low");
    // The ghost's score is its full recorded round, even if you end early.
    M.you.push(found.size); M.them.push(M.opp.rounds[M.round] || 0);
    M.youAns.push(order); M.themAns.push(ghost.map(g => g.idx));
    M.youTimes.push(hitTimes.map(t => Math.min(16000, Math.round(t))));
    if (M.round === ROUNDS - 1) submitMatch();   // save as soon as the last round ends
    setTimeout(roundResult, 450);
  }
}

function submitMatch(){
  M.submit = rpc("finish_match", { p_answers: M.youAns, p_times: M.youTimes })
    .then(res => { M.result = res; ME = res.profile; return res; });
  M.submit.catch(() => {});
  return M.submit;
}

function boardHTML(cur){
  let ty = 0, tt = 0, rows = "";
  for (let i = 0; i < ROUNDS; i++){
    const played = i < M.you.length, y = M.you[i], t = M.them[i];
    if (played){ ty += y; tt += t; }
    rows += `<tr class="${i === cur ? "cur" : ""} ${played ? "" : "pending"}"><td>${played ? esc(M.cats[i].name) : `Round ${i + 1} · ???`}</td><td class="n y">${played ? y : "–"}</td><td class="n o">${played ? t : "–"}</td></tr>`;
  }
  rows += `<tr class="tot"><td>Total</td><td class="n y">${ty}</td><td class="n o">${tt}</td></tr>`;
  return { html: `<thead><tr><th>Round</th><th class="n">You</th><th class="n">Them</th></tr></thead><tbody>${rows}</tbody>`, ty, tt };
}

function roundResult(){
  const i = M.round, cat = M.cats[i], y = M.you[i], t = M.them[i], diff = y - t;
  show("rres");
  const b = $("rrBanner");
  b.className = "banner big " + (diff > 0 ? "w" : diff < 0 ? "l" : "t");
  b.textContent = diff > 0 ? (diff >= 4 ? "Round crushed" : "Round won") : diff < 0 ? "Round lost" : "Dead even";
  $("rrSub").textContent = `${cat.name} · ${y}–${t}`;
  const bd = boardHTML(i); $("rrTable").innerHTML = bd.html;
  const lead = bd.ty - bd.tt;
  $("rrLead").innerHTML = lead > 0 ? `You lead by <span class="y">${lead}</span>` : lead < 0 ? `You trail by <span class="o">${-lead}</span>` : `All square at ${bd.ty}`;
  // Answer stats: share of today's earlier players who named each answer.
  const N = M.others.length, cnt = new Array(cat.entries.length).fill(0);
  for (const r of M.others) for (const k of new Set(r.answers[i] || [])) if (k >= 0 && k < cnt.length) cnt[k]++;
  const pc = k => N ? Math.round(100 * cnt[k] / N) : null;
  const isRare = k => N >= 5 && pc(k) <= 10;
  const yc = $("rrYou"); yc.innerHTML = "";
  M.youAns[i].forEach(k => yc.appendChild(chip(cat.entries[k].show, isRare(k) ? "rare" : "", pc(k))));
  if (!M.youAns[i].length) yc.appendChild(chip("None this round", "m"));
  $("rrOppL").textContent = `${M.opp.name}'s answers`;
  const oc = $("rrOpp"); oc.innerHTML = ""; M.themAns[i].forEach(k => oc.appendChild(chip(cat.entries[k].show, "o", pc(k))));
  if (!M.themAns[i].length) oc.appendChild(chip("None this round", "m"));
  const byPop = cat.entries.map((e, k) => k).sort((a, b) => cnt[b] - cnt[a]);
  $("rrTopW").hidden = !N;
  const tc = $("rrTop"); tc.innerHTML = ""; byPop.filter(k => cnt[k] > 0).slice(0, 5).forEach(k => tc.appendChild(chip(cat.entries[k].show, "m", pc(k))));
  const got = new Set(M.youAns[i]), mc = $("rrMiss"); mc.innerHTML = "";
  (N ? byPop : cat.entries.map((e, k) => k)).filter(k => !got.has(k)).slice(0, 8).forEach(k => mc.appendChild(chip(cat.entries[k].show, "m", N ? pc(k) : null)));
  const rare = M.youAns[i].filter(isRare).map(k => cat.entries[k].show);
  $("rrNote").textContent = !N ? "You're among the first to play today. Answer stats fill in as more people finish."
    : rare.length ? `Rare find${rare.length > 1 ? "s" : ""}: ${rare.join(", ")}. Named by 10% or fewer of today's ${N} player${N === 1 ? "" : "s"}.`
    : `Percentages show how many of today's ${N} player${N === 1 ? "" : "s"} named each answer.`;
  const last = i === ROUNDS - 1;
  $("rrNextT").textContent = last ? "See final result" : `Round ${i + 2}: get ready`;
  $("rrNext").onclick = () => { if (last) finalResult(); else { M.round++; nextRound(); } };
  if (diff >= 3) confetti(diff >= 6 ? 160 : 90);
  setTimeout(() => $("rrNext").focus(), 300);
}

async function finalResult(){
  const bd = boardHTML(-1), margin = bd.ty - bd.tt;
  show("final");
  const b = $("fBanner"); b.className = "banner big " + (margin > 0 ? "w" : margin < 0 ? "l" : "t");
  b.textContent = margin > 0 ? "Victory" : margin < 0 ? "Defeat" : "Draw";
  $("fSub").innerHTML = `<span class="num">${bd.ty}–${bd.tt}</span> vs ${esc(M.opp.name)} (${fmt(M.opp.rating)})`;
  $("fTable").innerHTML = bd.html;
  $("fErr").textContent = ""; $("fRetry").hidden = true;
  $("fChg").textContent = "…"; $("fChg").className = "chg num"; $("fWhy").textContent = "Saving your result…";
  $("fLadder").hidden = true; $("fPct").hidden = true;
  if (margin > 0) confetti(220);

  let res;
  try { res = await (M.submit || submitMatch()); }
  catch (e){
    const m = e.message || "";
    $("fWhy").textContent = "";
    if (/match_expired/.test(m)) $("fErr").textContent = "This match took longer than 20 minutes, so it counted as a forfeit.";
    else { $("fErr").textContent = "Your result didn't save. Check your connection and try again."; $("fRetry").hidden = false; }
    $("fRetry").onclick = () => { M.submit = null; finalResult(); };
    return;
  }
  const played = ME.wins + ME.losses + ME.draws - 1, before = res.rating_before, d = res.delta, after = res.rating;
  const tBefore = tierOf(before).name, tAfter = tierOf(after);
  $("fRating").textContent = fmt(after);
  $("fTier").textContent = tAfter.name; $("fTier").style.color = tAfter.c;
  const promo = tAfter.name !== tBefore ? (after > before ? ` Promoted from ${tBefore}.` : ` Dropped from ${tBefore}.`) : "";
  const am = Math.abs(res.margin);
  $("fWhy").textContent = (res.margin === 0 ? "A draw only moves you toward your opponent's rating." :
    `${res.margin > 0 ? "Won" : "Lost"} by ${am} point${am === 1 ? "" : "s"}${am >= 12 ? ", the maximum margin weight." : am <= 2 ? ", so the change is small." : "."}`) + promo +
    (played < 5 ? ` New-player boost: your first 5 days move your rating faster.` : "");
  const chg = $("fChg"); chg.className = "chg num " + (d >= 0 ? "up" : "dn");
  const startT = performance.now(), dur = reduce ? 1 : 900;
  (function step(now){ const p = Math.min(1, (now - startT) / dur), v = Math.round(d * p); chg.textContent = (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v); if (p < 1) requestAnimationFrame(step); })(startT);
  $("fLadder").hidden = false; renderLadder($("fLadder"), after, before);

  RUN = { day: DAY, status: "done", total: res.total, rounds: M.you, opp_rounds: M.them, rating_before: before, rating_delta: d };
  const p0 = pctOf(res.total, M.others);
  renderPct($("fPct"), p0, M.others.length, res.total, M.others);
  wireShare($("fShareBtn"), $("fShare"), shareText(RUN, standing(res.total, M.others)));
  todaysRuns().then(all => {
    const others = all.filter(r => r.user_id !== ME.id), p = pctOf(res.total, others);
    renderPct($("fPct"), p, others.length, res.total, others); wireShare($("fShareBtn"), $("fShare"), shareText(RUN, standing(res.total, others)));
  }).catch(() => {});
}
$("fHome").onclick = async () => { M = null; try { await loadState(); } catch (e) {} renderHome(); };

/* ---------------- Owner stats ---------------- */
let stDay = null, stToken = 0;
$("openStats").onclick = () => openStats(DAY);

/* ---------------- How to play ---------------- */
const HT_KEY = "c5_howto_seen";
function seenHowto(){ try { return localStorage.getItem(HT_KEY) === "1"; } catch (e){ return false; } }
function markHowto(){ try { localStorage.setItem(HT_KEY, "1"); } catch (e){} }
let htIdx = 0;
const htCards = () => $("htTrack").children;
function htGo(i){
  const n = htCards().length; htIdx = Math.max(0, Math.min(n - 1, i));
  $("htTrack").scrollTo({ left: htIdx * $("htTrack").clientWidth, behavior: reduce ? "auto" : "smooth" });
  htSync();
}
function htSync(){
  const n = htCards().length, last = htIdx === n - 1;
  $("htStep").textContent = `${htIdx + 1} of ${n}`;
  [...$("htDots").children].forEach((d, k) => d.classList.toggle("on", k === htIdx));
  $("htBack").disabled = htIdx === 0;
  $("htNextT").textContent = last ? "Got it" : "Next";
}
function openHowto(){
  $("htTiers").innerHTML = "";
  TIERS.forEach(t => { const d = document.createElement("span"); d.className = "ht-tier"; const i = document.createElement("i"); i.style.background = t.c; d.append(i, t.n); $("htTiers").appendChild(d); });
  $("htDrop").textContent = new Date(Date.now() + secsToDrop() * 1000).toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit"}) + " your time";
  show("howto"); htIdx = 0; $("htTrack").scrollLeft = 0; htSync();
}
function closeHowto(){
  markHowto();
  renderHome();
}
$("openHowto").onclick = openHowto;
$("htSkip").onclick = closeHowto;
$("htBack").onclick = () => htGo(htIdx - 1);
$("htNext").onclick = () => {
  if (htIdx < htCards().length - 1) return htGo(htIdx + 1);
  closeHowto();
};
// Swiping also moves between cards.
let htScrollT;
$("htTrack").addEventListener("scroll", () => { clearTimeout(htScrollT); htScrollT = setTimeout(() => { htIdx = Math.round($("htTrack").scrollLeft / $("htTrack").clientWidth); htSync(); }, 80); });

/* ---------------- Leaderboard ---------------- */
let LB = null, lbTab = "all";
$("openLeaders").onclick = () => openLeaders();
$("lbBack").onclick = renderHome;
$("lbTabAll").onclick = () => { lbTab = "all"; renderLeaders(); };
$("lbTabToday").onclick = () => { lbTab = "today"; renderLeaders(); };
async function openLeaders(){
  show("leaders");
  $("lbList").innerHTML = ""; $("lbMe").textContent = ""; $("lbNote").textContent = "Loading…";
  try { LB = await rpc("get_leaderboard"); }
  catch (e){ $("lbNote").textContent = /get_leaderboard/.test(e.message || "") ? "The leaderboard isn't set up yet: run update-1-leaderboard.sql in Supabase." : "Couldn't load the leaderboard. Try again in a moment."; return; }
  $("lbDay").textContent = dayLabel(LB.day, {weekday:"short", month:"short", day:"numeric"});
  renderLeaders();
}
function renderLeaders(){
  if (!LB) return;
  $("lbTabAll").setAttribute("aria-selected", lbTab === "all"); $("lbTabToday").setAttribute("aria-selected", lbTab === "today");
  const me = LB.me, list = $("lbList"), box = $("lbMe");
  list.innerHTML = ""; box.textContent = "";
  const rows = lbTab === "all" ? LB.top : LB.today;
  // Competition ranking: ties share a place (1, 2, 2, 4).
  const key = r => lbTab === "all" ? r.rating : r.total;
  let place = 0;
  rows.forEach((r, i) => {
    if (i === 0 || key(r) !== key(rows[i - 1])) place = i + 1;
    const li = document.createElement("li"); li.className = "lbrow" + (place <= 3 ? " p" + place : "") + (r.username === me.username ? " me" : "");
    const rk = document.createElement("span"); rk.className = "rk"; rk.textContent = place;
    const who = document.createElement("span"); who.className = "who";
    const nm = document.createElement("b"); nm.textContent = r.username;
    const sub = document.createElement("small");
    const t = tierOf(r.rating), dot = document.createElement("i"); dot.className = "dot"; dot.style.background = t.c;
    sub.append(dot, t.name);
    who.append(nm, sub);
    const sc = document.createElement("span"); sc.className = "sc";
    const rec = document.createElement("span"); rec.className = "rec";
    if (lbTab === "all"){
      sc.textContent = fmt(r.rating);
      rec.textContent = `${r.wins}–${r.losses}${r.draws ? "–" + r.draws : ""}`;
    } else {
      sc.textContent = r.total;
      rec.className = "rec " + (r.result > 0 ? "w" : r.result < 0 ? "l" : "t");
      rec.textContent = r.result > 0 ? "Won" : r.result < 0 ? "Lost" : "Draw";
    }
    li.append(rk, who, sc, rec); list.appendChild(li);
  });
  const line = (main, small) => { const b = document.createElement("span"); b.textContent = main; const s = document.createElement("small"); s.textContent = small; box.append(b, s); };
  if (lbTab === "all"){
    if (me.rank) line(`You're #${me.rank} of ${me.ranked}`, `${fmt(me.rating)} · ${tierOf(me.rating).name}`);
    else line("You're not ranked yet", "Finish a match to get on the board");
    $("lbNote").textContent = rows.length ? (LB.me.ranked > rows.length ? `Showing the top ${rows.length} of ${LB.me.ranked} ranked players.` : "") : "No ranked players yet. Be the first.";
  } else {
    if (me.today_rank) line(`You're #${me.today_rank} of ${me.today_count} today`, `${me.today_total} correct`);
    else line("You haven't played today", me.today_count ? `${me.today_count} player${me.today_count === 1 ? "" : "s"} so far` : "Nobody has played yet");
    $("lbNote").textContent = rows.length ? `Resets at ${new Date(Date.now() + secsToDrop() * 1000).toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit"})} your time.` : "No finished matches yet today.";
  }
}
$("stBack").onclick = renderHome;
$("stPrev").onclick = () => openStats(shiftDay(stDay, -1));
$("stNext").onclick = () => { if (stDay < DAY) openStats(shiftDay(stDay, 1)); };

async function openStats(day){
  stDay = day; const my = ++stToken;
  show("stats");
  $("stDay").textContent = dayLabel(stDay, {weekday:"short", month:"short", day:"numeric"});
  $("stNext").disabled = stDay >= DAY;
  for (const id of ["stN","stAvg","stHigh","stLow"]) $(id).textContent = "–";
  $("stNote").textContent = "Loading…"; $("stBody").hidden = true;
  let runs = [];
  try { runs = await todaysRuns(stDay); } catch (e){ if (my === stToken) $("stNote").textContent = "Couldn't load stats. Try again in a moment."; return; }
  if (my !== stToken) return;
  const cats = dailyCats(stDay), N = runs.length;
  renderAllPlayers();
  if (!N){ $("stN").textContent = "0"; $("stNote").textContent = "No finished runs this day."; $("stBody").hidden = false; ["stHist","stRounds","stAns","stPlayers"].forEach(id => $(id).innerHTML = ""); return; }
  const totals = runs.map(r => r.total);
  $("stN").textContent = N; $("stAvg").textContent = (sum(totals) / N).toFixed(1);
  $("stHigh").textContent = Math.max(...totals); $("stLow").textContent = Math.min(...totals);
  $("stNote").textContent = ""; $("stBody").hidden = false;
  const top = Math.max(...totals), buckets = [];
  for (let lo = 0; lo <= top; lo += 5) buckets.push({ lo, hi: lo + 4, c: totals.filter(t => t >= lo && t <= lo + 4).length });
  const maxC = Math.max(...buckets.map(b => b.c));
  $("stHist").innerHTML = buckets.map(b => `<div class="hrow"><span class="rg">${b.lo}–${b.hi}</span><span class="tr"><i style="width:${b.c ? Math.max(4, b.c / maxC * 100) : 0}%"></i></span><span class="ct">${b.c}</span></div>`).join("");
  $("stRounds").innerHTML = `<thead><tr><th>Category</th><th class="n">Avg</th><th class="n">Best</th></tr></thead><tbody>` +
    cats.map((c, i) => { const v = runs.map(r => (r.rounds && r.rounds[i]) || 0); return `<tr><td>${esc(c.name)}</td><td class="n">${(sum(v) / N).toFixed(1)}</td><td class="n">${Math.max(...v)}</td></tr>`; }).join("") + `</tbody>`;
  const box = $("stAns"); box.innerHTML = "";
  cats.forEach((c, i) => {
    const cnt = new Array(c.entries.length).fill(0);
    for (const r of runs) for (const k of new Set(r.answers[i] || [])) if (k >= 0 && k < cnt.length) cnt[k]++;
    const order = c.entries.map((e, k) => k).filter(k => cnt[k]).sort((a, b) => cnt[b] - cnt[a]).slice(0, 10);
    const wrap = document.createElement("div"); wrap.className = "catblock";
    const h = document.createElement("div"); h.className = "catname"; h.textContent = c.name; wrap.appendChild(h);
    const ch = document.createElement("div"); ch.className = "chips";
    order.forEach(k => ch.appendChild(chip(c.entries[k].show, "", Math.round(100 * cnt[k] / N))));
    if (!order.length) ch.appendChild(chip("No answers", "m"));
    wrap.appendChild(ch); box.appendChild(wrap);
  });
  runs.sort((a, b) => b.total - a.total);
  const names = await usernames(runs.map(r => r.user_id));
  if (my !== stToken) return;
  const tb = $("stPlayers"); tb.innerHTML = `<thead><tr><th>#</th><th>Player</th><th class="n">Total</th><th>Rounds</th><th>Time</th></tr></thead>`;
  const body = document.createElement("tbody");
  runs.forEach((r, idx) => {
    const tr = document.createElement("tr");
    const cells = [String(idx + 1), names[r.user_id] || "?", String(r.total), (r.rounds || []).join(" · "),
      r.finished_at ? new Date(r.finished_at).toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit"}) : ""];
    cells.forEach((t, ci) => { const td = document.createElement("td"); td.textContent = t; if (ci === 2) td.className = "n"; if (ci === 3 || ci === 4) td.className = "dim"; tr.appendChild(td); });
    body.appendChild(tr);
  });
  tb.appendChild(body);
}
// Everyone signed up. Names the filter flags come first, so you can fix them.
async function renderAllPlayers(){
  const tb = $("stAll");
  let players;
  try { players = await rpc("admin_players"); }
  catch (e){
    // Update 3 not installed yet: plain list without the tools.
    const { data } = await sb.from("profiles").select("id,username,rating,wins,losses,draws,created_at").order("rating", { ascending: false }).limit(500);
    players = data || [];
  }
  const flagged = players.filter(p => p.flagged && !p.banned).length;
  $("stAllNote").textContent = flagged ? `${flagged} username${flagged === 1 ? "" : "s"} flagged by the filter. Tap Manage to rename or ban.` : "";
  tb.innerHTML = `<thead><tr><th>Player</th><th class="n">Rating</th><th>Record</th><th></th></tr></thead>`;
  const body = document.createElement("tbody");
  players.forEach(p => {
    const tr = document.createElement("tr"); if (p.banned) tr.className = "banned";
    const name = document.createElement("td"); name.textContent = p.username;
    if (p.flagged) name.appendChild(el("span", "pill bad", "flagged"));
    if (p.banned) name.appendChild(el("span", "pill", "banned"));
    const rt = el("td", "n", fmt(p.rating)), rec = el("td", "dim", `${p.wins}–${p.losses}${p.draws ? "–" + p.draws : ""}`);
    const act = document.createElement("td"); act.className = "act";
    if (p.id && p.id !== ME.id && "flagged" in p){
      const b = el("button", "mini", "Manage"); b.type = "button";
      b.onclick = () => toggleManage(tr, p); act.appendChild(b);
    }
    tr.append(name, rt, rec, act); body.appendChild(tr);
  });
  tb.appendChild(body);
}
function toggleManage(tr, p){
  const next = tr.nextElementSibling;
  if (next && next.classList.contains("manage")){ next.remove(); return; }
  const row = document.createElement("tr"); row.className = "manage";
  const td = document.createElement("td"); td.colSpan = 4;
  const box = el("div", "managebox");
  const ren = el("div", "renrow"), inp = document.createElement("input");
  inp.type = "text"; inp.maxLength = 16; inp.value = p.username; inp.setAttribute("aria-label", "New username"); inp.autocapitalize = "off"; inp.spellcheck = false;
  const save = el("button", "mini ok", "Rename"); save.type = "button";
  const msg = el("p", "formerr");
  save.onclick = async () => {
    const v = inp.value.trim().toLowerCase(); msg.className = "formerr"; msg.textContent = "";
    if (v === p.username) return;
    save.disabled = true;
    try {
      const r = await rpc("admin_rename", { p_user: p.id, p_new: v });
      if (r === "ok"){ toast(`Renamed to ${v}`); openStats(stDay); return; }
      msg.textContent = r === "blocked" ? "That name is blocked too." : r === "taken" ? "That name is taken." : "Use 3–16 letters, numbers or underscores.";
    } catch (e){ msg.textContent = "Couldn't rename. Try again."; }
    save.disabled = false;
  };
  ren.append(inp, save);
  const ban = el("button", "mini " + (p.banned ? "" : "danger"), p.banned ? "Unban" : "Ban player"); ban.type = "button";
  let armed = false;
  ban.onclick = async () => {
    if (!p.banned && !armed){ armed = true; ban.textContent = "Tap again to ban"; setTimeout(() => { armed = false; ban.textContent = "Ban player"; }, 3000); return; }
    ban.disabled = true;
    try { await rpc("admin_set_banned", { p_user: p.id, p_banned: !p.banned }); toast(p.banned ? "Unbanned" : "Banned"); openStats(stDay); }
    catch (e){ ban.disabled = false; msg.textContent = "Couldn't update. Try again."; }
  };
  const note = el("p", "statnote", p.banned ? "Banned: can't play, hidden from the leaderboard, matchmaking and stats." : "Banning stops them playing and hides them from the leaderboard, matchmaking and stats.");
  box.append(ren, ban, note, msg); td.appendChild(box); row.appendChild(td);
  tr.after(row); inp.focus();
}
function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

/* ---------------- Effects ---------------- */
function comboFx(text){
  if (reduce) return;
  const el = document.createElement("div"); el.className = "combo"; el.textContent = text;
  document.body.appendChild(el); setTimeout(() => el.remove(), 1000);
}
const cv = $("fx"), cx = cv.getContext("2d"); let parts = [], running = false;
function confetti(n){
  if (reduce) return;
  const dpr = devicePixelRatio || 1; cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cols = ["#ffc93c","#4cc9f0","#ff6b5b","#3ddc84","#ffffff"];
  for (let i = 0; i < n; i++) parts.push({x:innerWidth/2+(Math.random()-.5)*120, y:innerHeight*.35, vx:(Math.random()-.5)*14, vy:-Math.random()*14-4, r:Math.random()*Math.PI, vr:(Math.random()-.5)*.3, w:6+Math.random()*6, h:8+Math.random()*8, c:cols[i%cols.length], life:0});
  if (!running){ running = true; requestAnimationFrame(loop); }
}
function loop(){
  cx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter(p => p.life < 160 && p.y < innerHeight + 40);
  for (const p of parts){ p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life++;
    cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.globalAlpha = Math.max(0, 1 - p.life/160); cx.fillStyle = p.c; cx.fillRect(-p.w/2, -p.h/2, p.w, p.h); cx.restore(); }
  if (parts.length) requestAnimationFrame(loop); else { running = false; cx.clearRect(0, 0, innerWidth, innerHeight); }
}
})();
