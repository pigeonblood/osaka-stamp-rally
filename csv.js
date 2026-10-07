// 区役所CSVの読み込み。列名の表記ゆれ・ヘッダーなし・Shift_JIS（Excel保存）にも対応する。

export function decodeText(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("shift_jis").decode(buf);
  }
}

export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const pushRow = () => {
    row.push(field);
    field = "";
    if (row.some((v) => v.trim() !== "")) rows.push(row.map((v) => v.trim()));
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === "," || c === "\t") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else field += c;
  }
  pushRow();
  return rows;
}

const ALIASES = {
  lat: ["lat", "latitude", "緯度", "y"],
  lng: ["lng", "lon", "long", "longitude", "経度", "x"],
  stamp: ["stamp", "image", "img", "file", "filename", "png", "スタンプ", "画像", "ファイル", "ファイル名", "スタンプ画像"],
  code: ["code", "コード", "区コード", "市区町村コード", "団体コード"],
  name: ["ward", "name", "区", "区名", "名前", "名称", "区役所", "区役所名", "施設名"],
};
const PARTIAL = {
  lat: (h) => h.includes("緯度") || h.startsWith("lat"),
  lng: (h) => h.includes("経度") || h.startsWith("lon") || h.startsWith("lng"),
  stamp: (h) => /画像|スタンプ|image|png|file/.test(h),
  code: (h) => h.includes("コード"),
  name: (h) => /区|名|name|ward/.test(h),
};
const normKey = (s) => s.toLowerCase().replace(/[\s_\-()（）]/g, "");

// rows -> [{ code, name, lat, lng, stamp }]
export function interpretRows(rows) {
  if (!rows.length) return [];
  const head = rows[0].map(normKey);
  const used = new Set();
  const idx = {};
  for (const key of ["lat", "lng", "stamp", "code", "name"]) {
    let i = head.findIndex((h, j) => !used.has(j) && ALIASES[key].includes(h));
    if (i < 0) i = head.findIndex((h, j) => !used.has(j) && PARTIAL[key](h));
    if (i >= 0) {
      used.add(i);
      idx[key] = i;
    }
  }

  let records;
  if (idx.lat !== undefined && idx.lng !== undefined) {
    const get = (r, k) => (idx[k] !== undefined ? r[idx[k]] ?? "" : "");
    records = rows.slice(1).map((r) => ({
      code: get(r, "code"),
      name: get(r, "name"),
      lat: parseFloat(get(r, "lat")),
      lng: parseFloat(get(r, "lng")),
      stamp: get(r, "stamp"),
    }));
  } else {
    // ヘッダーが無い・読めない場合は値の形から推測する
    records = rows.map(inferRow).filter(Boolean);
  }

  return records
    .map((r) => (r.lat > 90 && r.lng < 90 ? { ...r, lat: r.lng, lng: r.lat } : r))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

function inferRow(r) {
  let lat, lng;
  let code = "", name = "", stamp = "";
  for (const v of r) {
    const n = Number(v);
    if (v !== "" && Number.isFinite(n)) {
      if (n > 20 && n < 50 && lat === undefined) lat = n;
      else if (n > 120 && n < 155 && lng === undefined) lng = n;
      else if (/^271\d\d$/.test(v)) code = v;
    } else if (/\.(png|jpe?g|webp|gif|svg)$/i.test(v)) stamp = v;
    else if (!name && v) name = v;
  }
  if (lat === undefined || lng === undefined) return null;
  return { code, name, lat, lng, stamp };
}

export const ROMAJI = {
  "27102": "miyakojima", "27103": "fukushima", "27104": "konohana", "27106": "nishi",
  "27107": "minato", "27108": "taisho", "27109": "tennoji", "27111": "naniwa",
  "27113": "nishiyodogawa", "27114": "higashiyodogawa", "27115": "higashinari", "27116": "ikuno",
  "27117": "asahi", "27118": "joto", "27119": "abeno", "27120": "sumiyoshi",
  "27121": "higashisumiyoshi", "27122": "nishinari", "27123": "yodogawa", "27124": "tsurumi",
  "27125": "suminoe", "27126": "hirano", "27127": "kita", "27128": "chuo",
};
// 長音などの表記ゆれ（ファイル名の候補に使う）
const ROMAJI_VARIANTS = {
  "27108": ["taishou", "taisyo"], "27109": ["tennouji"], "27118": ["jyoto", "joutou", "jyoutou"],
  "27128": ["chuou", "tyuo"]
};
export function romajiNames(code) {
  return [ROMAJI[code], ...(ROMAJI_VARIANTS[code] || [])].filter(Boolean);
}
const ROMAJI_TO_CODE = Object.fromEntries(Object.entries(ROMAJI).map(([c, r]) => [r, c]));

// "大阪市北区役所" "北区" "北" -> "北区"
export function normWardName(s) {
  let t = (s || "").replace(/\s/g, "").replace(/^大阪府/, "").replace(/^大阪市/, "");
  t = t.replace(/役所.*$/, "");
  const m = t.match(/^(.+?区)/);
  if (m) return m[1];
  return t ? t + "区" : "";
}

// "Kita-ku" "kita_ward" "Taishō" -> 区コード
export function codeFromRomaji(s) {
  let t = (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  t = t.replace(/\.(png|jpe?g|webp|gif|svg)$/, "").replace(/[^a-z]/g, "");
  t = t.replace(/(wardoffice|ward|kuyakusho|ku)$/, "");
  t = t.replace(/ou/g, "o").replace(/jyo/g, "jo");
  return ROMAJI_TO_CODE[t] || null;
}

// CSVの1行がどの区か判定する。wardsByCode: Map(code -> ward)
export function matchWard(rec, wardsByCode) {
  if (rec.code && wardsByCode.has(rec.code)) return wardsByCode.get(rec.code);
  const name = normWardName(rec.name);
  for (const w of wardsByCode.values()) if (w.name === name) return w;
  const code = codeFromRomaji(rec.name);
  return code ? wardsByCode.get(code) : null;
}
