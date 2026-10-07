import { firebaseConfig, settings } from "./config.js";
import { decodeText, parseCSV, interpretRows, matchWard, romajiNames } from "./csv.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const TOTAL = 24;
const INK = "#1F2B3D";
const SHU = "#FF3300";
const ME = "#2F6FB8";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = {
  wards: new Map(), // code -> ward
  stamps: new Map(), // code -> { at: Date }
  user: null,
  me: null, // { lat, lng, accuracy }
};

/* ---------------- Firebase ---------------- */

const firebaseReady = Boolean(firebaseConfig.apiKey) && !firebaseConfig.apiKey.startsWith("YOUR");
let auth = null;
let db = null;
let unsubStamps = null;
if (firebaseReady) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

async function login() {
  if (!auth) return;
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    if (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return;
    if (e.code === "auth/unauthorized-domain") toast("このURLがFirebaseの承認済みドメインに登録されていません。README の手順を確認してください。");
    else if (e.code === "auth/popup-blocked") toast("ログイン画面がブロックされました。ブラウザでポップアップを許可してください。");
    else toast(`ログインできませんでした（${e.code || e.message}）`);
  }
}

function watchAuth() {
  onAuthStateChanged(auth, (user) => {
    state.user = user;
    unsubStamps?.();
    unsubStamps = null;
    state.stamps.clear();
    if (user) {
      unsubStamps = onSnapshot(
        collection(db, "users", user.uid, "stamps"),
        (snap) => {
          state.stamps.clear();
          snap.forEach((d) => {
            if (!state.wards.has(d.id)) return;
            const v = d.data({ serverTimestamps: "estimate" });
            state.stamps.set(d.id, { at: v.stampedAt?.toDate?.() ?? new Date() });
          });
          setNotice("db", null);
          renderAll();
        },
        (err) => {
          console.error(err);
          setNotice("db", `スタンプの記録を読み込めませんでした（${esc(err.code)}）。Firestoreのルール設定を確認してください。`);
        },
      );
    }
    renderAccount();
    renderAll();
  });
}

/* ---------------- データ読み込み ---------------- */

async function loadWards() {
  const gj = await (await fetch("data/wards.geojson")).json();
  for (const f of gj.features) {
    const { code, name } = f.properties;
    state.wards.set(code, {
      code, name, short: name.replace(/区$/, ""),
      feature: f, office: null, stampFile: "", layer: null, marker: null, stampSrc: null, stampMissing: false,
    });
  }
}

async function loadOffices() {
  let text;
  try {
    const res = await fetch(settings.officesCsv, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    text = decodeText(await res.arrayBuffer());
  } catch {
    setNotice("csv", `区役所の座標ファイル（${esc(settings.officesCsv)}）を読み込めませんでした。ファイルの場所と名前を確認してください。`);
    return;
  }
  const unmatched = [];
  for (const rec of interpretRows(parseCSV(text))) {
    const ward = matchWard(rec, state.wards);
    if (!ward) {
      unmatched.push(rec.name || rec.code || `${rec.lat},${rec.lng}`);
      continue;
    }
    ward.office = { lat: rec.lat, lng: rec.lng };
    if (rec.stamp) ward.stampFile = rec.stamp;
  }
  const missing = [...state.wards.values()].filter((w) => !w.office).map((w) => w.name);
  const msgs = [];
  if (unmatched.length) msgs.push(`CSVのうち、どの区か判別できなかった行：${unmatched.map(esc).join("、")}`);
  if (missing.length) msgs.push(`座標が登録されていない区：${missing.join("、")}`);
  setNotice("csv", msgs.join("<br>") || null);
}

// スタンプ画像：CSVの指定 →「Abeno.png」「abeno.png」→「阿倍野区.png」→「27119.png」の順に探し、無ければ自動生成
function stampSrc(ward) {
  if (!ward.stampSrc) {
    const dir = settings.stampDir.replace(/\/?$/, "/");
    const list = [];
    if (ward.stampFile) list.push(ward.stampFile.includes("/") ? ward.stampFile : dir + ward.stampFile);
    for (const r of romajiNames(ward.code)) list.push(`${dir}${r[0].toUpperCase()}${r.slice(1)}.png`, `${dir}${r}.png`);
    list.push(`${dir}${ward.name}.png`, `${dir}${ward.code}.png`);
    ward.stampSrc = [...new Set(list)]
      .reduce((p, src) => p.then((found) => found || probe(src)), Promise.resolve(null))
      .then((src) => {
        if (src) return src;
        ward.stampMissing = true;
        return generatedStamp(ward);
      });
  }
  return ward.stampSrc;
}

// テストモードのときだけ、全区のスタンプ画像があるか確かめて知らせる
async function checkStampFiles() {
  const wards = [...state.wards.values()];
  await Promise.all(wards.map(stampSrc));
  const missing = wards.filter((w) => w.stampMissing);
  setNotice("stamps", missing.length
    ? `スタンプ画像が見つからない区（仮のスタンプを表示します）：${missing.map((w) => { const r = romajiNames(w.code)[0]; return `${w.name}（${r[0].toUpperCase()}${r.slice(1)}.png）`; }).join("、")}`
    : null);
}

function probe(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function generatedStamp(ward) {
  const n = ward.short.length;
  const size = n > 3 ? 20 : n > 2 ? 25 : n > 1 ? 34 : 46;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" fill="none" stroke="${SHU}" stroke-width="6"/><circle cx="60" cy="60" r="45" fill="none" stroke="${SHU}" stroke-width="1.5"/><text x="60" y="${60 + size * 0.36}" font-family="serif" font-weight="700" font-size="${size}" text-anchor="middle" fill="${SHU}">${ward.short}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/* ---------------- 地図 ---------------- */

let map;
let popup;
let openCode = null;
let meDot = null;
let meRing = null;

function initMap() {
  map = L.map("map", { zoomControl: false, zoomSnap: 0.25 });
  L.control.zoom({ position: "topright" }).addTo(map);
  map.createPane("offices").style.zIndex = 450;
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | 国土数値情報',
  }).addTo(map);

  const group = L.featureGroup();
  for (const ward of state.wards.values()) {
    ward.layer = L.geoJSON(ward.feature, { style: () => polyStyle(ward) })
      .on("click", (e) => openWard(ward, e.latlng))
      .addTo(group);
  }
  group.addTo(map);
  const bounds = group.getBounds();
  map.fitBounds(bounds, { padding: [6, 6] });
  map.setMaxBounds(bounds.pad(0.4));
  map.setMinZoom(Math.floor(map.getZoom()) - 1);

  popup = L.popup({ minWidth: 230, maxWidth: 260, autoPanPadding: [52, 56], className: "ward-pop" });
  map.on("popupclose", () => {
    openCode = null;
    restyle();
  });
}

function polyStyle(ward) {
  const stamped = state.stamps.has(ward.code);
  const active = openCode === ward.code;
  return {
    color: stamped ? SHU : INK,
    weight: active ? 3 : stamped ? 1.6 : 1.1,
    opacity: active ? 1 : 0.7,
    fillColor: stamped ? SHU : INK,
    fillOpacity: stamped ? 0.2 : active ? 0.1 : 0.03,
  };
}

function restyle() {
  for (const w of state.wards.values()) {
    w.layer.setStyle(polyStyle(w));
    if (openCode === w.code) w.layer.bringToFront();
  }
}

function anchorOf(ward) {
  return ward.office ? L.latLng(ward.office.lat, ward.office.lng) : ward.layer.getBounds().getCenter();
}

function renderMarkers() {
  for (const ward of state.wards.values()) {
    ward.marker?.remove();
    const pos = anchorOf(ward);
    const stamped = state.stamps.has(ward.code);
    let m;
    if (stamped) {
      m = L.marker(pos, {
        keyboard: false,
        icon: L.divIcon({ className: "map-stamp", html: `<img alt="" style="--tilt:${tilt(ward.code)}deg">`, iconSize: [34, 34], iconAnchor: [17, 17] }),
      });
      stampSrc(ward).then((src) => {
        const img = m.getElement()?.querySelector("img");
        if (img) img.src = src;
      });
    } else {
      const visible = Boolean(ward.office);
      m = L.circleMarker(pos, {
        pane: "offices", radius: visible ? 4.5 : 0, color: "#F7F8F4", weight: visible ? 2 : 0,
        fillColor: INK, fillOpacity: visible ? 1 : 0,
      });
    }
    m.bindTooltip(ward.short, { permanent: true, direction: "bottom", offset: [0, stamped ? 14 : 3], className: "ward-label" });
    m.on("click", () => openWard(ward, pos));
    m.addTo(map);
    ward.marker = m;
  }
}

function openWard(ward, latlng) {
  openCode = ward.code;
  popup.setLatLng(latlng || anchorOf(ward)).setContent(popupHTML(ward)).openOn(map);
  wirePopup(ward);
  restyle();
}

function refreshPopup() {
  if (!openCode || !map.hasLayer(popup)) return;
  const ward = state.wards.get(openCode);
  popup.setContent(popupHTML(ward));
  wirePopup(ward);
}

function popupHTML(ward) {
  const st = state.stamps.get(ward.code);
  let body;
  if (st) {
    body = `<div class="pop__done"><img class="pop__stamp" alt="" style="--tilt:${tilt(ward.code)}deg"><p>${fmtDateTime(st.at)}<br>に押しました</p></div>`;
  } else {
    const dist = state.me && ward.office
      ? `<p class="pop__dist">現在地から${esc(ward.name)}役所まで約${fmtDist(distance(state.me, ward.office))}</p>` : "";
    const label = !firebaseReady ? "設定が完了していません" : state.user ? "スタンプを押す" : "ログインしてスタンプを押す";
    body = `${dist}<button type="button" class="pop__btn" data-act="stamp" ${firebaseReady ? "" : "disabled"}>${label}</button>
      <p class="pop__hint">区役所から${settings.radiusMeters}m以内で押せます</p>`;
  }
  return `<div class="pop"><h3 class="pop__name">${esc(ward.name)}</h3>${body}<p class="pop__msg" role="status" aria-live="polite"></p></div>`;
}

function wirePopup(ward) {
  const el = popup.getElement();
  if (!el) return;
  el.querySelector('[data-act="stamp"]')?.addEventListener("click", () => tryStamp(ward));
  const img = el.querySelector(".pop__stamp");
  if (img) stampSrc(ward).then((src) => (img.src = src));
}

function popMsg(text, kind = "") {
  const el = popup?.getElement()?.querySelector(".pop__msg");
  if (!el) return toast(text);
  el.textContent = text;
  el.className = "pop__msg" + (kind ? ` is-${kind}` : "");
}

function setStampBusy(busy) {
  const btn = popup?.getElement()?.querySelector('[data-act="stamp"]');
  if (!btn) return;
  btn.disabled = busy;
  btn.setAttribute("aria-busy", String(busy));
}

function focusWard(ward) {
  $(".map-wrap").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  map.flyToBounds(ward.layer.getBounds(), { padding: [40, 40], maxZoom: 14.5, duration: reduceMotion ? 0 : 0.6 });
  map.once("moveend", () => openWard(ward));
}

/* ---------------- 位置情報 ---------------- */

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject({ code: 0 });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  });
}

function geoErrorText(e) {
  switch (e?.code) {
    case 1: return "位置情報の利用が許可されていません。ブラウザの設定でこのサイトの位置情報を「許可」にしてから、もう一度押してください。";
    case 2: return "現在地を取得できませんでした。屋外の見通しの良い場所で、もう一度押してください。";
    case 3: return "現在地の取得に時間がかかっています。もう一度押してください。";
    default: return "このブラウザでは位置情報を使えません。";
  }
}

function showMe(pos) {
  state.me = pos;
  const ll = [pos.lat, pos.lng];
  if (!meDot) {
    meRing = L.circle(ll, { radius: pos.accuracy, color: ME, weight: 1, opacity: 0.5, fillColor: ME, fillOpacity: 0.1, interactive: false }).addTo(map);
    meDot = L.circleMarker(ll, { pane: "offices", radius: 7, color: "#fff", weight: 2.5, fillColor: ME, fillOpacity: 1, interactive: false }).addTo(map);
  } else {
    meRing.setLatLng(ll).setRadius(pos.accuracy);
    meDot.setLatLng(ll);
  }
}

function distance(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function locate() {
  const btn = $("#locate-btn");
  btn.disabled = true;
  btn.lastElementChild.textContent = "取得中…";
  try {
    const pos = await getPosition();
    showMe(pos);
    map.flyTo([pos.lat, pos.lng], Math.max(map.getZoom(), 14), { duration: reduceMotion ? 0 : 0.6 });
    refreshPopup();
    const nearest = [...state.wards.values()]
      .filter((w) => w.office && !state.stamps.has(w.code))
      .map((w) => ({ w, d: distance(pos, w.office) }))
      .sort((a, b) => a.d - b.d)[0];
    if (nearest) toast(`いちばん近い未踏破の区役所：${nearest.w.name}役所（約${fmtDist(nearest.d)}）`);
  } catch (e) {
    toast(geoErrorText(e));
  } finally {
    btn.disabled = false;
    btn.lastElementChild.textContent = "現在地";
  }
}

/* ---------------- 押印 ---------------- */

let busy = false;

async function tryStamp(ward) {
  if (busy) return;
  if (!state.user) {
    login();
    return;
  }
  if (state.stamps.has(ward.code)) return;
  if (!ward.office) {
    popMsg("この区の区役所の座標がCSVに無いため、押せません。", "error");
    return;
  }
  busy = true;
  setStampBusy(true);
  try {
    let pos;
    if (settings.skipLocationCheck) {
      pos = { ...ward.office, accuracy: 0 };
    } else {
      popMsg("現在地を確認しています…");
      try {
        pos = await getPosition();
      } catch (e) {
        popMsg(geoErrorText(e), "error");
        return;
      }
      showMe(pos);
    }
    const d = distance(pos, ward.office);
    if (d > settings.radiusMeters) {
      const weak = pos.accuracy > 150 ? `位置の誤差が約${fmtDist(pos.accuracy)}あるので、屋外で試すと精度が上がります。` : "";
      popMsg(`${ward.name}役所まで約${fmtDist(d)}あります。${settings.radiusMeters}m以内に近づいてから押してください。${weak}`, "error");
      return;
    }
    popMsg("記録しています…");
    await setDoc(doc(db, "users", state.user.uid, "stamps", ward.code), {
      ward: ward.name,
      stampedAt: serverTimestamp(),
      lat: Math.round(pos.lat * 1e6) / 1e6,
      lng: Math.round(pos.lng * 1e6) / 1e6,
      distance: Math.round(d),
      accuracy: Math.round(pos.accuracy || 0),
    });
    map.closePopup();
    pressStamp(ward);
  } catch (e) {
    console.error(e);
    popMsg(`記録できませんでした（${e.code || e.message}）。通信状況を確認して、もう一度押してください。`, "error");
  } finally {
    busy = false;
    setStampBusy(false);
  }
}

let pressedCode = null;

async function pressStamp(ward) {
  const ov = $("#press");
  const img = $("#press-img");
  img.style.setProperty("--tilt", `${tilt(ward.code)}deg`);
  img.src = await stampSrc(ward);
  await img.decode().catch(() => {});
  $("#press-ward").textContent = `${ward.name}役所`;
  $("#press-date").textContent = fmtDateTime(new Date());
  const n = countStamped();
  $("#press-count").textContent = n >= TOTAL ? "全24区を踏破しました。" : `${n}区目のスタンプです。あと${TOTAL - n}区。`;
  pressedCode = ward.code;
  ov.hidden = false;
  ov.classList.remove("is-pressing");
  void ov.offsetWidth;
  ov.classList.add("is-pressing");
  setTimeout(() => navigator.vibrate?.(30), reduceMotion ? 0 : 280);
  $("#press-close").focus();
}

function closePress() {
  $("#press").hidden = true;
  const cell = pressedCode && document.querySelector(`.cell[data-code="${pressedCode}"]`);
  if (cell) {
    cell.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    cell.classList.add("is-flash");
    setTimeout(() => cell.classList.remove("is-flash"), 1600);
  }
  pressedCode = null;
}

/* ---------------- 描画 ---------------- */

function countStamped() {
  return state.stamps.size;
}

function renderAll() {
  if (!map) return;
  restyle();
  renderMarkers();
  renderBook();
  renderProgress();
  refreshPopup();
}

function renderProgress() {
  const n = countStamped();
  $("#ticks").innerHTML = [...state.wards.values()]
    .map((w) => `<li${state.stamps.has(w.code) ? ' class="on"' : ""}></li>`).join("");
  $("#tally").innerHTML = `<b>${n}</b> / ${TOTAL}区`;
  $("#progress").setAttribute("aria-label", `${TOTAL}区中${n}区を踏破`);
  const note = $("#book-note");
  if (!state.user) note.textContent = firebaseReady ? "ログインすると記録が残ります" : "";
  else if (n >= TOTAL) note.textContent = "全24区を踏破しました";
  else note.textContent = `あと${TOTAL - n}区`;
}

function renderBook() {
  const ul = $("#book");
  ul.textContent = "";
  for (const ward of state.wards.values()) {
    const st = state.stamps.get(ward.code);
    const li = document.createElement("li");
    li.className = "cell" + (st ? " is-stamped" : "");
    li.dataset.code = ward.code;
    li.innerHTML = `<button type="button" class="cell__btn" aria-label="${ward.name}（${st ? "押印済み" : "未踏破"}）を地図で見る">
      <span class="cell__slot">${st ? `<img alt="" style="--tilt:${tilt(ward.code)}deg">` : ""}</span>
      <span class="cell__name">${ward.name}</span>
      <span class="cell__date">${st ? fmtDate(st.at) : ""}</span></button>`;
    if (st) stampSrc(ward).then((src) => (li.querySelector("img").src = src));
    li.firstElementChild.addEventListener("click", () => focusWard(ward));
    ul.appendChild(li);
  }
}

function renderAccount() {
  const el = $("#account");
  if (!firebaseReady) {
    el.textContent = "";
    return;
  }
  if (state.user) {
    const name = state.user.displayName || "ログイン中";
    const face = state.user.photoURL
      ? `<img src="${esc(state.user.photoURL)}" alt="" referrerpolicy="no-referrer">`
      : `<span>${esc(name.slice(0, 1))}</span>`;
    el.innerHTML = `<button type="button" class="acct" id="logout-btn" aria-label="${esc(name)}でログイン中。ログアウトする">${face}</button>`;
    $("#logout-btn").addEventListener("click", () => {
      if (confirm(`${name} でログイン中です。ログアウトしますか？`)) signOut(auth);
    });
  } else {
    el.innerHTML = `<button type="button" class="login" id="login-btn">Googleでログイン</button>`;
    $("#login-btn").addEventListener("click", login);
  }
}

/* ---------------- 小物 ---------------- */

const notices = new Map();
function setNotice(key, html) {
  if (html) notices.set(key, html);
  else notices.delete(key);
  const el = $("#notice");
  el.innerHTML = [...notices.values()].map((h) => `<p>${h}</p>`).join("");
  el.hidden = notices.size === 0;
}

let toastTimer;
function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("is-shown");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-shown"), 5000);
}

function tilt(code) {
  return ((Number(code) * 7) % 11) - 5;
}

function fmtDist(m) {
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)}m` : `${(m / 1000).toFixed(1)}km`;
}

function fmtDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtDateTime(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function checkInAppBrowser() {
  const ua = navigator.userAgent;
  if (/ Line\//i.test(ua)) {
    const u = new URL(location.href);
    u.searchParams.set("openExternalBrowser", "1");
    setNotice("inapp", `LINEの中のブラウザではGoogleログインができません。<a href="${esc(u.href)}">SafariやChromeで開き直す</a>`);
  } else if (/FBAN|FBAV|Instagram/i.test(ua)) {
    setNotice("inapp", "アプリの中のブラウザではGoogleログインができません。メニューから「ブラウザで開く」を選んでください。");
  }
}

/* ---------------- 起動 ---------------- */

async function main() {
  checkInAppBrowser();
  if (!firebaseReady) setNotice("config", "config.js にFirebaseの設定がまだ入っていません。地図とスタンプ帳の表示だけ確認できます。");
  if (settings.skipLocationCheck) setNotice("debug", "テストモード：位置チェックを省略しています。公開前に config.js の skipLocationCheck を false に戻してください。");

  $("#locate-btn").addEventListener("click", locate);
  $("#press-close").addEventListener("click", closePress);
  $("#press").addEventListener("click", (e) => { if (e.target.id === "press") closePress(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#press").hidden) closePress(); });

  try {
    await loadWards();
  } catch {
    setNotice("geo", "data/wards.geojson を読み込めませんでした。");
    return;
  }
  await loadOffices();
  initMap();
  renderAll();
  renderAccount();
  if (firebaseReady) watchAuth();
  if (settings.skipLocationCheck) checkStampFiles();
}

main();
