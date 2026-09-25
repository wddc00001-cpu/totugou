/** 和田歯科医院 経理突合システム V8 — 1ファイル版（v8/*.gs を連結。直接編集せず v8/ を修正して npm run build） */

// ======================================================================
// ===== v8/Config.gs
// ======================================================================
/**
 * 和田歯科医院 経理突合システム V8 — 設定
 *
 * V8 は V7 と別の Apps Script プロジェクト・別スプレッドシートで動かす（引継ぎ仕様 0.5）。
 * フォルダID・カード明細の列・許容値はシート「フォルダマスタ」「カード明細列マスタ」「設定」で編集する。
 * ここにある値は初期化時にマスタへ書き込む初期値。
 */

const V8_VERSION = "8.0.0";

const SHEET = {
  FILES:         "取込確認",          // 原本ファイル台帳
  TX:            "取引台帳",
  MATCH:         "突合台帳",
  HISTORY:       "判定履歴",
  RESULT:        "突合結果",
  REVIEW:        "要確認一覧",
  CARD_MASTER:   "カード明細列マスタ",
  FOLDER_MASTER: "フォルダマスタ",
  SETTINGS:      "設定",
};

// V7 のタブ名。これらがあるスプレッドシートでは V8 を初期化しない（混在防止）
const V7_SHEET_NAMES = ["レシート一覧", "カード明細一覧", "突合結果", "設定・マスタ"];

const PERSONS = ["院長", "麻記子先生", "銀行"];

const METHODS = [
  "LC法人", "M-AMEX", "A-AMEX", "セゾン", "DC(JAL)", "個人LC",
  "楽天", "大丸", "ポケット（ファミマ）", "現金", "不明", "銀行口座",
];

// カード明細フォルダに複数カードが同居している場合、ファイル名からカードを1つに特定するための別名
// （NFKC・小文字化して部分一致。2つ以上当たる／1つも当たらない場合は「分類要確認」）
const METHOD_ALIASES = {
  "LC法人":             ["lc法人", "法人lc"],
  "M-AMEX":             ["m-amex", "mamex"],
  "A-AMEX":             ["a-amex", "aamex"],
  "セゾン":             ["セゾン", "saison"],
  "DC(JAL)":            ["dc(jal)", "jal", "dcカード"],
  "個人LC":             ["個人lc"],
  "楽天":               ["楽天", "rakuten"],
  "大丸":               ["大丸", "jfr", "daimaru"],
  "ポケット（ファミマ）": ["ポケット", "ファミマ", "pocket", "famima"],
};

const KIND = {
  RECEIPT: "レシート/領収書/請求書",
  CARD:    "カード明細",
  BANK:    "銀行明細",
};

const STATE = {
  PENDING:      "未処理",
  CLASSIFY:     "分類要確認",
  OCR_CHECK:    "OCR要確認",
  UNMATCHED:    "未突合",
  CANDIDATE:    "一致候補",
  DUPLICATE:    "候補重複",
  AMOUNT_DIFF:  "金額不一致",
  DATE_CHECK:   "日付要確認",
  NEXT_MONTH:   "翌月確認",
  EXPIRED:      "期限超過",
  FX_CHECK:     "外貨要確認",
  DUP_ROW:      "重複行",       // 期間が重なる明細ファイルで同じ行が2回取り込まれたもの（突合対象外）
  APPROVED:     "承認済み",
  REJECTED:     "却下",
};

// 要確認一覧に出す状態
const REVIEW_STATES = [
  STATE.CLASSIFY, STATE.OCR_CHECK, STATE.UNMATCHED, STATE.DUPLICATE, STATE.AMOUNT_DIFF,
  STATE.DATE_CHECK, STATE.NEXT_MONTH, STATE.EXPIRED, STATE.FX_CHECK,
];

const MATCH_STATUS = {
  CANDIDATE: "候補",
  APPROVED:  "承認済み",
  REJECTED:  "却下",
  STALE:     "失効",
};

const IMPORT_STATUS = {
  DONE:       "完了",
  PROCESSING: "処理中",
  CLASSIFY:   "分類要確認",
  ERROR:      "エラー",
  DUPLICATE:  "重複（取込済み）",
  UNSUPPORTED:"要確認（未対応形式）",
  SUPERSEDED: "旧版",
};

const DECISION = { APPROVE: "承認", REJECT: "却下" };

// 原本区分（紙のレシートか、ダウンロードした領収書・請求書か。同じ列で区別する）
const SOURCE_TYPE = {
  PAPER:     "紙レシート（スキャン）",
  DOWNLOAD:  "ダウンロード（領収書・請求書）",
  STATEMENT: "カード明細",
};

// 先生＋カード別タブ: 「院長_M-AMEX_突合結果」（レシート｜明細｜結果を横並び）、支払手段不明は「院長_カード不明」。RECEIPT/STATEMENT は旧版タブの片付け用
const CARD_TAB = { RECEIPT: "レシート", STATEMENT: "明細", RESULT: "突合結果", UNKNOWN: "カード不明" };

// 設定シートの初期値
const DEFAULT_SETTINGS = [
  ["日付許容日数",            3,   "カード別の値が「カード明細列マスタ」にあればそちらを優先"],
  ["金額不一致の検出幅(%)",   20,  "同日付近で金額がこの割合以内の差なら『金額不一致』として相手候補を示す"],
  ["日付要確認の検出幅(日)",  45,  "同額でこの日数以内なら『日付要確認』として相手候補を示す"],
  ["翌月確認の猶予(月)",      1,   "翌月確認の対象月からこの月数を過ぎても相手が無ければ『期限超過』"],
  ["処理時間上限(秒)",        270, "Apps Script の6分制限に対する安全マージン。超えたら中断し、再実行で続きから再開"],
  ["ダウンロード判定キーワード", "領収|請求|invoice|receipt|download|ダウンロード|DL_",
   "ファイル名にこの語が入っていれば原本区分を『ダウンロード』、なければ『紙レシート』にする（取引台帳で手修正可）"],
  ["pdf-lib URL", "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js", "一括PDFのページ分割に使用"],
];

// フォルダマスタの初期値（V7 のフォルダIDを流用。各フォルダの直下に「2026-09」形式の月フォルダを作って格納する）
// [フォルダID, 人物, 支払手段（複数は「,」区切り）, 原本種別, メモ]
const DEFAULT_FOLDERS = [
  ["1lTShDGN-mRZHA34Aawsc8LSKMcZn5EAN", "院長", "M-AMEX",  KIND.RECEIPT, "院長_M-AMEX"],
  ["1yE4rMETDeCQKUviwRrCzx-phStmJO1gc", "院長", "A-AMEX",  KIND.RECEIPT, "院長_A-AMEX"],
  ["1NFwXnq9iKpI8aCHmLTg7d-0F35ufRK4d", "院長", "個人LC",  KIND.RECEIPT, "院長_個人LC"],
  ["1VFSh7X4W7uEmTtMuQF8AiRpFI6vtKbVk", "院長", "LC法人",  KIND.RECEIPT, "院長_法人LC"],
  ["1ed_-kzUN3q5YrCQ6lgEmkUx51sxqaTxc", "院長", "セゾン",  KIND.RECEIPT, "院長_セゾン"],
  ["1bm9B-85cqV9en4-iB0WihgWUxvDuS_FA", "院長", "DC(JAL)", KIND.RECEIPT, "院長_DC(JAL)"],
  ["1FqW5nyWdgaML_L07GgHSNrGGFmzvOWNS", "院長", "現金",    KIND.RECEIPT, "院長_現金"],
  ["1aPWJVHh5iN4fBvKwPJKIMDj5QyqetBvY", "麻記子先生", "M-AMEX",  KIND.RECEIPT, "麻記子_M-AMEX"],
  ["1XEcntiqJA5M7juySFFOeQ5PW1Ir69Dt3", "麻記子先生", "A-AMEX",  KIND.RECEIPT, "麻記子_A-AMEX"],
  ["1j7wfgMNo1vjwK8DEFOQ16H5uCQaASj67", "麻記子先生", "DC(JAL)", KIND.RECEIPT, "麻記子_DC(JAL)"],
  ["1ceOj8aEprH3iQZVAbEIZFFzKp5ceJJS8", "麻記子先生", "楽天",    KIND.RECEIPT, "麻記子_楽天"],
  ["10tk6rHz0I0faDXj7cYFBTzwfvNIiTRgv", "麻記子先生", "大丸",    KIND.RECEIPT, "麻記子_大丸"],
  ["1nHWddWB5iMeVayVIQOM6xQ6DUXWTVXkd", "麻記子先生", "ポケット（ファミマ）", KIND.RECEIPT, "麻記子_ポケット(ファミマ)"],
  ["1NekXxy8DXIS4oxq8lH_BsjBGvhWSnNlE", "麻記子先生", "現金",    KIND.RECEIPT, "麻記子_現金"],
  ["1bQvHSpAC04OrVsRbPqasfVueHX4g17Ar", "院長", "M-AMEX",  KIND.CARD, "明細CSV_院長_M-AMEX"],
  ["1-Dwdn68peDf6enummI_pbxuGOtZxaETb", "院長", "A-AMEX",  KIND.CARD, "明細CSV_院長_A-AMEX"],
  ["1OaG9-_jWYOBd6aKHKUVoo4av9vb5nxHe", "院長", "個人LC",  KIND.CARD, "明細CSV_院長_個人LC"],
  ["1QfLDB6ameZUG0tvBb40XKLwUf-WqqzDR", "院長", "LC法人",  KIND.CARD, "明細CSV_法人LC"],
  ["1U6e28HzZn6KYanQWX46Jj78phJ0zKhAE", "院長", "セゾン,DC(JAL)", KIND.CARD, "明細CSV_院長_セゾン・DC（ファイル名にカード名を入れる）"],
  ["1vvJbIvpq0MVxfWJE9btF4mrhvDDQ9q-9", "麻記子先生", "M-AMEX", KIND.CARD, "明細CSV_麻記子_M-AMEX"],
  ["1AYgNMdPHppbbCg4Fdw0MHfaTAkhR1H9z", "麻記子先生", "A-AMEX", KIND.CARD, "明細CSV_麻記子_A-AMEX"],
  ["1wfKb3FPYQ1_PFL2NbA0z_D_osiOlLoc3", "麻記子先生", "楽天,大丸,ポケット（ファミマ）,DC(JAL)", KIND.CARD,
   "明細CSV_麻記子_楽天・大丸・ポケット・DC（ファイル名にカード名を入れる）"],
  // 「不明」レシート用フォルダは未作成。作成したら行を追加する: [ID, 院長, 不明, レシート/領収書/請求書, メモ]
];

// カード明細列マスタの初期値。実ファイル受領後にカード別の行を追加・修正する。
// 列名は「|」区切りの候補。完全一致 → 部分一致の順で探す。
const DEFAULT_CARD_MASTER_ROW = {
  encoding:        "自動",   // 自動 / UTF-8 / Shift_JIS
  sheet_name:      "",       // xlsx の対象シート名（空なら先頭シート）
  date_cols:       "ご利用日|利用日|ご利用年月日|利用年月日|取引日|date",
  amount_cols:     "ご利用金額|利用金額|ご請求金額|請求金額|支払金額|金額|amount",
  merchant_cols:   "ご利用店名|利用店名|ご利用先|ご利用内容|利用内容|店舗名|摘要|description",
  foreign_cols:    "現地通貨額|現地利用額|外貨金額|外貨額",
  currency_cols:   "通貨|通貨コード|現地通貨",
  special_pattern: "取消|返品|返金|分割|リボ|お支払い|引落",
  date_tolerance:  "",
};


// ======================================================================
// ===== v8/Lib.gs
// ======================================================================
/**
 * V8 純粋ロジック（SpreadsheetApp / DriveApp に依存しない。Node のテストから直接呼べる）
 */

// ===== 文字列・数値 =====

function nfkc_(s) {
  return String(s == null ? "" : s).normalize("NFKC");
}

function isBlank_(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

function isTrue_(v) {
  return v === true || String(v).toUpperCase() === "TRUE";
}

// 店舗名比較用: NFKC・小文字化・空白と記号を除去（V8-04 ルール4）
function normalizeMerchant(s) {
  return nfkc_(s).toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function merchantEval(a, b) {
  const x = normalizeMerchant(a), y = normalizeMerchant(b);
  if (!x || !y) return "比較不可";
  if (x === y || x.includes(y) || y.includes(x)) return "一致";
  return "差あり";
}

// 金額セル: 数値、"¥1,200"、"1,200円"、"12,000-"、"(1,200)"、"△1,200"、"-1,200" に対応。解析不能は NaN
function parseAmount(v) {
  if (typeof v === "number") return v;
  let s = nfkc_(v).trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^[△▲-]/.test(s)) { neg = true; s = s.slice(1); }
  s = s.replace(/[¥\\円,\s]/g, "").replace(/-$/, "");
  if (/^[A-Za-z]{3}/.test(s)) s = s.slice(3);
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  return neg ? -n : n;
}

function sameAmount_(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.005;
}

// ===== 日付 =====

function pad2_(n) { return String(n).padStart(2, "0"); }

function isDate_(v) {
  return Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime());
}

function makeYmd_(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return "";
  return y + "-" + pad2_(m) + "-" + pad2_(d);
}

const MONTH_NAMES_ = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 };

// テキスト中の日付をすべて抽出（出現順、YYYY-MM-DD）。曖昧な d/m/yyyy は採用しない
function findDates(text) {
  const s = nfkc_(text);
  const found = [];
  const push = (idx, ymd) => { if (ymd) found.push({ idx, ymd }); };
  let m;
  const reYmd = /(?<!\d)(\d{4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})(?!\d)/g;
  while ((m = reYmd.exec(s))) push(m.index, makeYmd_(m[1], m[2], m[3]));
  const reReiwa = /(?:令和|R)\s*(\d{1,2})\s*[年.\/]\s*(\d{1,2})\s*[月.\/]\s*(\d{1,2})/g;
  while ((m = reReiwa.exec(s))) push(m.index, makeYmd_(2018 + Number(m[1]), m[2], m[3]));
  const reShort = /(?<![\d\/.\-])(\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(?![\d\/.\-])/g;
  while ((m = reShort.exec(s))) push(m.index, makeYmd_(m[1], m[2], m[3]));
  const reDmy = /(?<!\d)(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?!\d)/g;
  while ((m = reDmy.exec(s))) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12 && b <= 12) push(m.index, makeYmd_(m[3], b, a));
    else if (b > 12 && a <= 12) push(m.index, makeYmd_(m[3], a, b));
  }
  const reMon = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi;
  while ((m = reMon.exec(s))) push(m.index, makeYmd_(m[3], MONTH_NAMES_[m[1].toLowerCase()], m[2]));
  const reDMon = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/gi;
  while ((m = reDMon.exec(s))) push(m.index, makeYmd_(m[3], MONTH_NAMES_[m[2].toLowerCase()], m[1]));
  found.sort((a, b) => a.idx - b.idx);
  const out = [];
  found.forEach(f => { if (!out.includes(f.ymd)) out.push(f.ymd); });
  return out;
}

// セル値（Date / 文字列）→ YYYY-MM-DD。解析不能は ""
function toYmd(v) {
  if (isBlank_(v)) return "";
  if (isDate_(v)) return makeYmd_(v.getFullYear(), v.getMonth() + 1, v.getDate());
  const s = nfkc_(v).trim();
  const ds = findDates(s);
  return ds.length === 1 ? ds[0] : "";
}

function dayNumber(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

function dayDiff(a, b) {
  return Math.abs(dayNumber(a) - dayNumber(b));
}

function addDays(ymd, n) {
  const t = new Date((dayNumber(ymd) + n) * 86400000);
  return makeYmd_(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function monthOf(ymd) {
  return ymd ? ymd.slice(0, 7) : "";
}

function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return Math.floor(t / 12) + "-" + pad2_((t % 12) + 1);
}

function fmtYmdJa(ymd) {
  return ymd ? ymd.replace(/-/g, "/") : "";
}

// 月フォルダ名 → "YYYY-MM"。「2026-09」「2026_09」「202609」「2026年9月」を許容
function parseMonthFolderName(name) {
  const s = nfkc_(name).trim();
  const m = s.match(/^(\d{4})\s*[-_\/.年]?\s*(\d{1,2})\s*月?$/);
  if (!m) return "";
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12 || Number(m[1]) < 2000) return "";
  return m[1] + "-" + pad2_(mo);
}

// 複数カードが同居する明細フォルダで、ファイル名からカードを1つに特定する
function detectMethodFromName(fileName, methods, aliases) {
  const name = nfkc_(fileName).toLowerCase();
  const hits = methods.filter(mt => {
    const keys = (aliases && aliases[mt]) || [mt];
    return keys.concat([mt]).some(k => name.includes(nfkc_(k).toLowerCase()));
  });
  return { method: hits.length === 1 ? hits[0] : "", hits };
}

// 原本区分: ファイル名にダウンロード判定キーワードがあればダウンロード、なければ紙レシート（スキャン）
function detectSourceType(fileName, pattern) {
  if (pattern) {
    let re;
    try { re = new RegExp(pattern, "i"); } catch (_) { re = null; }
    if (re && re.test(nfkc_(fileName))) return SOURCE_TYPE.DOWNLOAD;
  }
  return SOURCE_TYPE.PAPER;
}

// ===== CSV =====

// RFC 4180 相当（引用符内のカンマ・改行・"" エスケープ）
function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", inQ = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  rows.push(row);
  return rows.filter(r => r.some(v => String(v).trim() !== ""));
}

// UTF-8 として読んだ結果が文字化けしているか（Shift_JIS 判定用）
function looksMisdecoded(text) {
  return /�/.test(String(text || ""));
}

// ===== カード明細の列判定・行抽出 =====

function splitCandidates_(s) {
  return String(s || "").split("|").map(x => nfkc_(x).trim().toLowerCase()).filter(Boolean);
}

// ヘッダー配列から候補列を探す。完全一致 → 部分一致。used に含まれる列は除外
function findColumn(headers, candidates, used) {
  const hs = headers.map(h => nfkc_(h).replace(/\s/g, "").toLowerCase());
  const cs = splitCandidates_(candidates);
  const skip = used || new Set();
  for (const c of cs) {
    const i = hs.findIndex((h, k) => !skip.has(k) && h === c);
    if (i >= 0) return i;
  }
  for (const c of cs) {
    const i = hs.findIndex((h, k) => !skip.has(k) && h && h.includes(c));
    if (i >= 0) return i;
  }
  return -1;
}

// 先頭30行から「日付列と金額列が両方ある行」をヘッダーとして探す
function detectHeader(rows, master) {
  const limit = Math.min(rows.length, 30);
  for (let r = 0; r < limit; r++) {
    const used = new Set();
    const date = findColumn(rows[r], master.date_cols, used);
    if (date < 0) continue;
    used.add(date);
    const amount = findColumn(rows[r], master.amount_cols, used);
    if (amount < 0) continue;
    used.add(amount);
    const pick = key => {
      const i = findColumn(rows[r], master[key], used);
      if (i >= 0) used.add(i);
      return i;
    };
    const foreign = pick("foreign_cols");
    const currency = pick("currency_cols");
    const merchant = pick("merchant_cols");
    return { headerIndex: r, cols: { date, amount, merchant, foreign, currency } };
  }
  return null;
}

/**
 * カード明細の2次元配列 → 取引候補行
 * 必須列（利用日・金額）が見つからない場合は { error } を返す。0件で黙殺しない（V8-03）
 */
function extractStatementRows(rows, master) {
  const h = detectHeader(rows, master);
  if (!h) {
    return {
      error: "必須列が見つかりません。利用日の候補: " + master.date_cols + " ／ 金額の候補: " + master.amount_cols,
      rows: [],
    };
  }
  const c = h.cols;
  const special = master.special_pattern ? new RegExp(master.special_pattern) : null;
  const out = [];
  for (let i = h.headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const cell = k => (k >= 0 && k < row.length ? row[k] : "");
    if (row.every(isBlank_)) continue;
    const rawDate = cell(c.date), rawAmt = cell(c.amount);
    const merchant = nfkc_(cell(c.merchant)).trim();
    const joined = row.map(v => nfkc_(v)).join(" ");
    if (isBlank_(rawDate) && /(合計|小計|total|ご請求額|お支払額)/i.test(joined)) continue;
    if (isBlank_(rawDate) && isBlank_(rawAmt)) continue;

    const date = toYmd(rawDate);
    const amount = parseAmount(rawAmt);
    const rec = {
      row_no: i + 1, date, amount: isNaN(amount) ? "" : amount, merchant,
      foreign_amount: "", foreign_currency: "", special: "", note: "",
    };
    if (c.foreign >= 0 && !isBlank_(cell(c.foreign))) {
      const fa = parseAmount(cell(c.foreign));
      if (!isNaN(fa)) rec.foreign_amount = Math.abs(fa);
    }
    if (c.currency >= 0) {
      const cur = nfkc_(cell(c.currency)).trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(cur) && cur !== "JPY") rec.foreign_currency = cur;
    }
    if (!date) rec.note = "利用日を解析できません（" + nfkc_(rawDate) + "）";
    else if (isNaN(amount)) rec.note = "金額を解析できません（" + nfkc_(rawAmt) + "）";
    if (!isNaN(amount) && amount < 0) rec.special = "返金";
    else if (special) {
      const m = merchant.match(special) || joined.match(special);
      if (m) rec.special = m[0];
    }
    out.push(rec);
  }
  return { rows: out, headerRow: h.headerIndex + 1, cols: c };
}

// ===== レシートOCRテキスト解析（1ページ = 最大1取引。V8-01） =====

const TOTAL_LINE_ = /(合計|お買上|お買い上げ|ご請求|領収金額|お支払金額|支払金額|ご利用金額|grand\s*total|total|amount\s*due|balance\s*due)/i;
const NOT_TOTAL_LINE_ = /(小計|sub\s*total|点数|預|釣|おつり|change|tendered|cash|ポイント|point)/i;
const TAX_LINE_ = /(消費税|内税|外税|税額|税等|対象|\btax\b|\bvat\b)/i;
const FOREIGN_CURRENCY_ = [
  [/\bUSD\b|US\$/i, "USD"], [/\bEUR\b|€/i, "EUR"], [/\bGBP\b|£/i, "GBP"],
  [/\bTHB\b|฿|\bbaht\b/i, "THB"], [/\bCNY\b|\bRMB\b/i, "CNY"], [/\bKRW\b|₩/i, "KRW"],
  [/\bHKD\b|HK\$/i, "HKD"], [/\bSGD\b|S\$/i, "SGD"], [/\bTWD\b|NT\$/i, "TWD"],
  [/\bAUD\b|A\$/i, "AUD"], [/\bCAD\b|C\$/i, "CAD"], [/\bCHF\b/i, "CHF"],
  [/\bVND\b|₫/i, "VND"], [/\bPHP\b|₱/i, "PHP"], [/\bMYR\b/i, "MYR"], [/\bIDR\b/i, "IDR"],
];
const JPY_MARK_ = /[¥￥]|円|\bJPY\b|\\\s*\d/;

function amountsInLine_(line) {
  const s = nfkc_(line);
  const out = [];
  const re = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;
  let m;
  while ((m = re.exec(s))) {
    const before = s.slice(Math.max(0, m.index - 1), m.index);
    const after = s.slice(m.index + m[0].length).replace(/^\s+/, "").charAt(0);
    if (before === "%" || /[%点個品]/.test(after)) continue;   // 税率・点数
    if (/[:\/]/.test(before) || /[:\/]/.test(after)) continue;   // 時刻・日付
    out.push(Number(m[1].replace(/,/g, "")));
  }
  return out;
}

function detectCurrency_(text) {
  const s = nfkc_(text);
  const foreign = [];
  FOREIGN_CURRENCY_.forEach(([re, code]) => { if (re.test(s) && !foreign.includes(code)) foreign.push(code); });
  let bareDollar = false;
  if (!foreign.length && /\$\s*\d/.test(s)) { foreign.push("USD"); bareDollar = true; }
  return { foreign, jpy: JPY_MARK_.test(s), bareDollar };
}

function parseReceiptText(text) {
  const r = { date: "", amount: "", currency: "JPY", merchant: "", notes: [] };
  const s = nfkc_(text);
  if (!s.trim()) { r.notes.push("OCRテキストが空です"); return r; }
  const lines = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // 通貨
  const cur = detectCurrency_(s);
  if (cur.foreign.length > 1) r.notes.push("複数の外貨を検出: " + cur.foreign.join(", "));
  if (cur.foreign.length && cur.jpy) r.notes.push("円と外貨（" + cur.foreign.join(", ") + "）の両方を検出");
  const currencyAmbiguous = cur.foreign.length > 1 || (cur.foreign.length > 0 && cur.jpy);
  if (cur.foreign.length === 1 && !cur.jpy) {
    r.currency = cur.foreign[0];
    if (cur.bareDollar) r.notes.push("「$」表記のみのためUSDと読取（他のドルなら通貨を修正）");
  }

  // 合計金額
  const totals = [];
  lines.forEach((raw, i) => {
    let line = raw;
    const tax = line.match(TAX_LINE_);
    if (tax && !/税込/.test(line)) line = line.slice(0, tax.index);   // 「合計 ¥1,200 (内税 ¥109)」→ 税の手前まで
    if (!TOTAL_LINE_.test(line) || NOT_TOTAL_LINE_.test(line)) return;
    let nums = amountsInLine_(line);
    if (!nums.length && i + 1 < lines.length && /^[¥￥$€£]?\s*[\d,.]+\s*円?-?$/.test(nfkc_(lines[i + 1]))) {
      nums = amountsInLine_(lines[i + 1]);   // Drive OCR で金額が次行に分かれる場合
    }
    const v = nums.length ? nums[nums.length - 1] : NaN;
    if (v > 0 && !totals.some(t => sameAmount_(t, v))) totals.push(v);
  });
  if (totals.length === 1) r.amount = totals[0];
  else if (totals.length > 1) {
    r.notes.push("複数の合計金額を検出: " + totals.join(" / ") + "（1ページに複数レシートの可能性。自動で選びません）");
  } else {
    const yen = [];
    const re = /[¥￥]\s*(\d{1,3}(?:,\d{3})+|\d+)|(\d{1,3}(?:,\d{3})+|\d+)\s*円/g;
    let m;
    while ((m = re.exec(s))) {
      const v = Number((m[1] || m[2]).replace(/,/g, ""));
      if (v > 0 && !yen.includes(v)) yen.push(v);
    }
    if (yen.length === 1 && r.currency === "JPY") {
      r.amount = yen[0];
      r.notes.push("合計行なし（金額表記が1つのみのため採用）");
    } else {
      r.notes.push("合計金額を特定できません");
    }
  }
  if (currencyAmbiguous && r.amount !== "") {
    r.amount = "";
    r.notes.push("通貨が確定できないため金額は空欄");
  }

  // 日付
  const dates = findDates(s);
  if (dates.length) {
    r.date = dates[0];
    if (dates.length > 1) r.notes.push("複数の日付を検出: " + dates.map(fmtYmdJa).join(" / ") + "（先頭を採用）");
  } else r.notes.push("日付を読み取れません");

  // 店舗名（先頭の意味のある行）
  const skip = /^(領収書|領収証|レシート|receipt|tax invoice|invoice|お客様控え?|ご利用明細)$/i;
  r.merchant = (lines.find(l =>
    l.length >= 2 && !skip.test(l) && !findDates(l).length &&
    !/^[\d\s,.:¥￥$\-*#()]+$/.test(l) && !/(tel|電話|http|www\.)/i.test(l)
  ) || "").slice(0, 60);
  return r;
}

// カード番号など12〜19桁の数字列を末尾4桁以外マスク
function maskSensitive(text) {
  return String(text || "").replace(/(?<!\d)(?:\d[ \-]?){11,18}\d(?!\d)/g, m => {
    const digits = m.replace(/\D/g, "");
    return "****" + digits.slice(-4);
  });
}

// ===== 取引の実効値（修正値があれば修正値。V8-02） =====

function effective(tx) {
  const date = toYmd(tx.corr_date) || toYmd(tx.orig_date);
  const amtSrc = isBlank_(tx.corr_amount) ? tx.orig_amount : tx.corr_amount;
  const amount = isBlank_(amtSrc) ? NaN : parseAmount(amtSrc);
  const currency = nfkc_(tx.corr_currency || tx.currency || "JPY").trim().toUpperCase() || "JPY";
  const merchant = isBlank_(tx.corr_merchant) ? String(tx.orig_merchant || "") : String(tx.corr_merchant);
  return { date, amount, currency, merchant };
}

function correctionSignature(tx) {
  const f = ["corr_date", "corr_amount", "corr_currency", "corr_merchant"];
  if (f.every(k => isBlank_(tx[k]))) return "";
  return JSON.stringify(f.map(k => {
    const v = tx[k];
    return k === "corr_date" ? (toYmd(v) || String(v)) : String(v == null ? "" : v).trim();
  }));
}

// ===== 明細の重複行（期間が重なるファイルを両方取り込んだ場合） =====

/**
 * 別ファイルに同じ行（先生・カード・利用日・金額・店名・外貨額が一致）があるものを重複とみなす。
 * - 日付や金額が1つでも違えば別の取引（同じ店・同じ月の複数回購入は重複にしない）
 * - 同じ日・同じ店・同じ金額が本当に複数回ある場合は「1ファイル内の最大件数」までを残す
 * - 残す行は、承認・個別判断済みの行 → 先に取り込んだ行の順
 * @return { 重複行の取引ID: 残した行の取引ID }
 */
function findDuplicateStatementRows(stmts, isDecided) {
  const groups = {};
  stmts.forEach((t, i) => {
    const e = effective(t);
    if (!e.date || !isFinite(e.amount)) return;
    const key = [t.person, t.method, e.date, e.amount, normalizeMerchant(e.merchant),
      isBlank_(t.foreign_amount) ? "" : Number(t.foreign_amount)].join("|");
    (groups[key] = groups[key] || []).push({ t, i });
  });
  const dupOf = {};
  Object.values(groups).forEach(rows => {
    const perFile = {};
    rows.forEach(({ t }) => { perFile[t.file_id] = (perFile[t.file_id] || 0) + 1; });
    const files = Object.keys(perFile);
    if (files.length < 2) return;
    const keep = Math.max(...files.map(f => perFile[f]));
    const ordered = rows.slice().sort((a, b) =>
      (Number(isDecided(b.t)) - Number(isDecided(a.t))) || (a.i - b.i));
    const kept = ordered.slice(0, keep).map(x => x.t);
    ordered.slice(keep).forEach(({ t }) => { dupOf[t.id] = kept[0].id; });
  });
  return dupOf;
}

// ===== 突合エンジン（V8-04 / V8-05） =====

/**
 * @param input.transactions  取引台帳の全行（オブジェクト）
 * @param input.matches       突合台帳の全行
 * @param input.settings      { dateTolerance, amountPct, dateWindow, graceMonths }
 * @param input.tolByMethod   { 支払手段: 日付許容日数 }
 * @param input.cardMethodsByPerson { 人物: [カード支払手段...] }（不明レシートの探索範囲）
 * @param input.today         "YYYY-MM-DD"
 * @return { states: {txId: {state, state_reason, next_check_month}}, candidates: [...] }
 */
function runMatchingEngine(input) {
  const st = input.settings;
  const tolFor = m => {
    const v = input.tolByMethod && input.tolByMethod[m];
    return isBlank_(v) ? st.dateTolerance : Number(v);
  };
  const states = {};
  const set = (tx, state, reason, next) => {
    states[tx.id] = { state, state_reason: reason, next_check_month: next || "" };
  };
  const active = input.transactions.filter(t => !isTrue_(t.superseded));
  const matches = input.matches || [];
  const approvedBy = {};
  matches.filter(m => m.status === MATCH_STATUS.APPROVED).forEach(m => {
    approvedBy[m.receipt_id] = m.match_id;
    approvedBy[m.statement_id] = m.match_id;
  });
  const rejected = new Set(matches.filter(m => m.status === MATCH_STATUS.REJECTED)
    .map(m => m.receipt_id + "|" + m.statement_id));
  const isRejected = (r, s) => rejected.has(r.id + "|" + s.id);

  const dupOf = findDuplicateStatementRows(active.filter(t => t.kind === KIND.CARD),
    t => !!approvedBy[t.id] || !isBlank_(t.decision));

  const open = [];
  active.forEach(t => {
    if (t.kind !== KIND.RECEIPT && t.kind !== KIND.CARD) return;
    if (dupOf[t.id]) {
      return set(t, STATE.DUP_ROW, "別の明細ファイルで取込済みの行と同一（利用日・金額・店名が一致）: " + dupOf[t.id] +
        "（期間が重なるファイルの重複。突合の対象外）");
    }
    if (approvedBy[t.id]) return set(t, STATE.APPROVED, "突合承認済み（" + approvedBy[t.id] + "）");
    if (t.decision === DECISION.APPROVE) return set(t, STATE.APPROVED, "個別承認: " + (t.review_memo || ""));
    if (t.decision === DECISION.REJECT) return set(t, STATE.REJECTED, "個別却下: " + (t.review_memo || ""));
    open.push(t);
  });

  const eff = {};
  open.forEach(t => { eff[t.id] = effective(t); });
  const valid = t => eff[t.id].date && isFinite(eff[t.id].amount) && eff[t.id].amount !== 0;
  const receipts = open.filter(t => t.kind === KIND.RECEIPT);
  const stmts = open.filter(t => t.kind === KIND.CARD);
  const specialOf = s => s.special || (valid(s) && eff[s.id].amount < 0 ? "返金" : "");
  const usable = stmts.filter(s => valid(s) && !specialOf(s));

  // カード別の取込済み期間の終端（翌月確認の判定に使う）
  const coverage = {};
  active.filter(t => t.kind === KIND.CARD).forEach(t => {
    const d = toYmd(t.corr_date) || toYmd(t.orig_date);
    const k = t.person + "|" + t.method;
    if (d && (!coverage[k] || d > coverage[k])) coverage[k] = d;
  });

  const amountEq = (r, s) => {
    const er = eff[r.id], es = eff[s.id];
    if (er.currency === "JPY") return sameAmount_(er.amount, es.amount);
    if (isBlank_(s.foreign_amount)) return false;
    if (s.foreign_currency && s.foreign_currency !== er.currency) return false;
    return sameAmount_(er.amount, s.foreign_amount);
  };
  const dd = (r, s) => dayDiff(eff[r.id].date, eff[s.id].date);
  const brief = s => fmtYmdJa(eff[s.id].date) + " ¥" + eff[s.id].amount.toLocaleString("ja-JP") +
    " " + eff[s.id].merchant + "（" + s.id + "）";

  // 1) 完全一致候補（人物・支払手段・金額一致・日付許容内）
  const exact = {}, byStmt = {};
  const evaluate = [];
  receipts.forEach(r => {
    if (!valid(r)) return set(r, STATE.OCR_CHECK, r.ocr_note || "日付または金額が未確定です");
    if (r.method === "現金") return set(r, STATE.UNMATCHED, "現金払い（カード突合の対象外。V9で出納帳候補にする）");
    if (r.method === "不明") return evaluate.push(r);
    const tol = tolFor(r.method);
    exact[r.id] = usable.filter(s =>
      s.person === r.person && s.method === r.method && !isRejected(r, s) && amountEq(r, s) && dd(r, s) <= tol);
    exact[r.id].forEach(s => { (byStmt[s.id] = byStmt[s.id] || []).push(r); });
    evaluate.push(r);
  });

  const candidates = [];
  const addCand = (r, s, kind) => candidates.push({
    receipt_id: r.id, statement_id: s.id, kind,
    amount_diff: isFinite(eff[s.id].amount) && eff[r.id].currency === "JPY" ? eff[s.id].amount - eff[r.id].amount : "",
    date_diff: dd(r, s),
    merchant_eval: merchantEval(eff[r.id].merchant, eff[s.id].merchant),
  });
  const stmtNote = {};

  evaluate.forEach(r => {
    const er = eff[r.id];
    if (r.method === "不明") return evaluateUnknown_(r);
    const ex = exact[r.id];
    if (ex.length === 1 && byStmt[ex[0].id].length === 1) {
      const s = ex[0];
      const me = merchantEval(er.merchant, eff[s.id].merchant);
      let reason = "金額・日付・人物・支払手段が一意に一致（未承認）";
      if (me === "差あり") reason += "／店舗名差あり（レシート: " + er.merchant + " ／ 明細: " + eff[s.id].merchant + "）";
      set(r, STATE.CANDIDATE, reason);
      set(s, STATE.CANDIDATE, "レシート " + r.id + " と一意に一致（未承認）");
      addCand(r, s, STATE.CANDIDATE);
      return;
    }
    if (ex.length > 0) {
      set(r, STATE.DUPLICATE, "候補" + ex.length + "件: " + ex.map(brief).join(" / ") + "（手動で選択）");
      ex.forEach(s => {
        const rs = byStmt[s.id];
        set(s, STATE.DUPLICATE, "レシート候補" + rs.length + "件: " + rs.map(x => x.id).join(", ") + "（手動で選択）");
        addCand(r, s, STATE.DUPLICATE);
      });
      return;
    }
    const tol = tolFor(r.method);
    const pool = usable.filter(s => s.person === r.person && s.method === r.method && !isRejected(r, s) && !byStmt[s.id]);

    if (er.currency !== "JPY") {
      const near = pool.filter(s => dd(r, s) <= tol);
      near.forEach(s => addCand(r, s, STATE.FX_CHECK));
      set(r, STATE.FX_CHECK, "外貨 " + er.currency + " " + er.amount + " と一致する外貨額の明細がありません。" +
        (near.length ? "日付が近い明細: " + near.slice(0, 3).map(brief).join(" / ") : "カード明細の円貨額・両替明細を確認"));
      return;
    }
    const amtNear = pool.filter(s => dd(r, s) <= tol &&
      Math.abs(eff[s.id].amount - er.amount) <= Math.abs(er.amount) * st.amountPct / 100);
    if (amtNear.length) {
      amtNear.forEach(s => {
        addCand(r, s, STATE.AMOUNT_DIFF);
        stmtNote[s.id] = stmtNote[s.id] || { state: STATE.AMOUNT_DIFF, rs: [] };
        stmtNote[s.id].rs.push(r.id);
      });
      set(r, STATE.AMOUNT_DIFF, "日付が近く金額の違う明細: " + amtNear.slice(0, 3).map(s =>
        brief(s) + " 差" + signed_(eff[s.id].amount - er.amount)).join(" / ") + "（返金・合算・チップ等を確認）");
      return;
    }
    const dateNear = pool.filter(s => amountEq(r, s) && dd(r, s) <= st.dateWindow);
    if (dateNear.length) {
      dateNear.forEach(s => {
        addCand(r, s, STATE.DATE_CHECK);
        stmtNote[s.id] = stmtNote[s.id] || { state: STATE.DATE_CHECK, rs: [] };
        stmtNote[s.id].rs.push(r.id);
      });
      set(r, STATE.DATE_CHECK, "同額で日付が離れた明細: " + dateNear.slice(0, 3).map(s =>
        brief(s) + " 差" + dd(r, s) + "日").join(" / ") + "（利用日・請求月・引落日を確認）");
      return;
    }
    const cov = coverage[r.person + "|" + r.method];
    if (!cov || addDays(er.date, tol) > cov) {
      return setNextMonth_(r, cov ? r.method + "明細は " + fmtYmdJa(cov) + " 分まで取込済み" : r.method + "明細が未取込");
    }
    set(r, STATE.UNMATCHED, r.method + "明細（〜" + fmtYmdJa(cov) + "）に該当なし（明細なし）");
  });

  function evaluateUnknown_(r) {
    const er = eff[r.id];
    const hits = usable.filter(s => s.person === r.person && !isRejected(r, s) && amountEq(r, s) &&
      dd(r, s) <= tolFor(s.method));
    if (hits.length) {
      set(r, STATE.CLASSIFY, "支払手段不明。同額の明細: " + hits.slice(0, 5).map(s => s.method + " " + brief(s)).join(" / ") +
        "（原本を確認し、該当カードのフォルダへ移動してください）");
      return;
    }
    const cards = (input.cardMethodsByPerson && input.cardMethodsByPerson[r.person]) || [];
    const waiting = cards.filter(m => {
      const cov = coverage[r.person + "|" + m];
      return !cov || addDays(er.date, tolFor(m)) > cov;
    });
    if (waiting.length) return setNextMonth_(r, "支払手段不明。明細が未到達のカード: " + waiting.join(", "));
    set(r, STATE.UNMATCHED, "支払手段不明。全カード明細の期間内に該当なし → 現金の可能性（判断してください）");
  }

  function setNextMonth_(r, why) {
    const er = eff[r.id];
    const keep = (r.state === STATE.NEXT_MONTH || r.state === STATE.EXPIRED) && r.next_check_month;
    const nm = keep ? String(r.next_check_month) : addMonths(r.target_month || monthOf(er.date), 1);
    if (monthOf(input.today) > addMonths(nm, st.graceMonths)) {
      set(r, STATE.EXPIRED, why + "。" + nm + " 分の明細確認期限を超過（現金扱い等を判断してください）", nm);
    } else {
      set(r, STATE.NEXT_MONTH, why + "。" + nm + " 分の明細取込後に自動で再突合します", nm);
    }
  }

  // 2) 明細側の状態
  stmts.forEach(s => {
    if (states[s.id]) return;
    if (!valid(s)) return set(s, STATE.OCR_CHECK, s.ocr_note || "利用日または金額を解析できません");
    if (specialOf(s)) return set(s, STATE.UNMATCHED, specialOf(s) + "（自動確定の対象外。内容を確認）");
    const n = stmtNote[s.id];
    if (n) return set(s, n.state, "レシート候補: " + n.rs.join(", "));
    set(s, STATE.UNMATCHED, "レシートなし（明細のみ）");
  });

  return { states, candidates };
}

function signed_(n) {
  return (n > 0 ? "+" : "") + Number(n).toLocaleString("ja-JP");
}


// ======================================================================
// ===== v8/Store.gs
// ======================================================================
/**
 * V8 データ台帳（スプレッドシートの各タブをテーブルとして扱う）
 * - 列は見出し名で対応付ける。利用者が列を追加・並べ替えても壊れない
 * - 既存行を削除しない。更新は該当セルのみ書き戻す
 */

// [キー, 見出し]
const FIELDS = {};

FIELDS[SHEET.FILES] = [
  ["file_id", "DriveファイルID"], ["version", "処理版"], ["file_name", "ファイル名"], ["link", "原本リンク"],
  ["person", "人物"], ["method", "支払手段"], ["kind", "原本種別"], ["target_month", "対象月"],
  ["status", "取込状態"], ["message", "メッセージ"], ["pages_total", "総ページ"], ["pages_done", "処理済ページ"],
  ["failed_pages", "失敗ページ"], ["tx_count", "取引数"], ["imported_at", "取込日時"],
  ["mime_type", "形式"], ["content_hash", "内容ハッシュ"], ["drive_updated", "Drive更新日時"], ["folder_id", "格納フォルダID"],
];

FIELDS[SHEET.TX] = [
  ["id", "取引ID"], ["state", "状態"], ["state_reason", "状態理由"], ["next_check_month", "翌月確認月"],
  ["kind", "原本種別"], ["source_type", "原本区分"], ["person", "人物"], ["method", "支払手段"], ["target_month", "対象月"],
  ["orig_date", "原本_日付"], ["orig_amount", "原本_金額"], ["currency", "通貨"], ["orig_merchant", "原本_店舗名"],
  ["corr_date", "修正_日付"], ["corr_amount", "修正_金額"], ["corr_currency", "修正_通貨"], ["corr_merchant", "修正_店舗名"],
  ["corr_reason", "修正理由"], ["corr_by", "修正者"], ["corr_at", "修正日時"],
  ["link", "原本リンク"], ["page", "ページ"], ["row_no", "明細行"],
  ["foreign_amount", "外貨額"], ["foreign_currency", "外貨通貨"], ["jpy_amount", "円貨額"], ["fx_basis", "換算根拠"],
  ["special", "特殊区分"], ["ocr_status", "読取結果"], ["ocr_note", "読取メモ"], ["evidence", "根拠テキスト"],
  ["decision", "個別判断"], ["reviewed_by", "確認者"], ["reviewed_at", "確認日時"], ["review_memo", "確認メモ"],
  ["file_id", "DriveファイルID"], ["version", "処理版"], ["superseded", "旧版"], ["corr_sig", "修正署名"],
  ["created_at", "作成日時"],
];

FIELDS[SHEET.MATCH] = [
  ["match_id", "突合ID"], ["status", "状態"], ["kind", "候補区分"], ["match_type", "突合種別"],
  ["receipt_id", "レシート取引ID"], ["statement_id", "明細取引ID"],
  ["amount_diff", "金額差"], ["date_diff", "日付差"], ["merchant_eval", "店舗名評価"],
  ["candidate_at", "候補日時"], ["decided_at", "判断日時"], ["decided_by", "判断者"], ["decision_memo", "判断メモ"],
];

FIELDS[SHEET.HISTORY] = [
  ["at", "日時"], ["actor", "実行者"], ["entity", "対象"], ["entity_id", "対象ID"],
  ["action", "操作"], ["before", "変更前"], ["after", "変更後"], ["memo", "メモ"],
];

FIELDS[SHEET.CARD_MASTER] = [
  ["method", "支払手段"], ["encoding", "文字コード"], ["sheet_name", "xlsxシート名"],
  ["date_cols", "利用日列"], ["amount_cols", "金額列"], ["merchant_cols", "店舗名列"],
  ["foreign_cols", "外貨額列"], ["currency_cols", "通貨列"], ["special_pattern", "特殊区分パターン"],
  ["date_tolerance", "日付許容日数"], ["memo", "メモ"],
];

FIELDS[SHEET.FOLDER_MASTER] = [
  ["folder_id", "フォルダID"], ["person", "人物"], ["methods", "支払手段"], ["kind", "原本種別"], ["memo", "メモ"],
];

FIELDS[SHEET.SETTINGS] = [["key", "項目"], ["value", "値"], ["memo", "説明"]];

const CARD_MASTER_DEFAULT_KEY = "*";

// ===== テーブル =====

class Table {
  constructor(sheet, fields) {
    this.sheet = sheet;
    this.fields = fields;
    const lastCol = sheet.getLastColumn();
    const header = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
    this.width = header.length;
    this.col = {};
    const missing = [];
    fields.forEach(([key, label]) => {
      const i = header.indexOf(label);
      if (i < 0) missing.push(label); else this.col[key] = i;
    });
    if (missing.length) {
      throw new Error("シート「" + sheet.getName() + "」に列がありません: " + missing.join(", ") +
        "（メニュー【初回】V8シート作成で列を補完できます）");
    }
    const n = sheet.getLastRow() - 1;
    this.values = n > 0 ? sheet.getRange(2, 1, n, this.width).getValues() : [];
    this.rows = this.values.map((v, i) => this.toObj_(v, i));
    this.dirty = new Set();
    this.added = [];
  }

  static open(name) {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if (!sh) throw new Error("シート「" + name + "」がありません。メニュー【初回】V8シート作成を実行してください。");
    return new Table(sh, FIELDS[name]);
  }

  toObj_(v, i) {
    const o = { _i: i };
    this.fields.forEach(([key]) => { o[key] = v[this.col[key]]; });
    return o;
  }

  all() { return this.rows; }

  find(pred) { return this.rows.find(pred); }

  insert(obj) {
    const o = obj;   // 呼び出し元が挿入後に値を更新しても flush で書き込まれるよう、同じオブジェクトを保持
    o._i = this.values.length + this.added.length;
    this.added.push(o);
    this.rows.push(o);
    return o;
  }

  touch(obj) {
    if (obj._i < this.values.length) this.dirty.add(obj._i);
  }

  rowValues_(o, base) {
    const v = base ? base.slice() : new Array(this.width).fill("");
    this.fields.forEach(([key]) => {
      const x = o[key];
      v[this.col[key]] = x === undefined || x === null ? "" : plainCell_(x);
    });
    return v;
  }

  flush() {
    if (this.dirty.size) {
      const idx = Array.from(this.dirty).sort((a, b) => a - b);
      if (idx.length > 30) {
        const all = this.rows.slice(0, this.values.length).map((o, i) => this.rowValues_(o, this.values[i]));
        this.sheet.getRange(2, 1, all.length, this.width).setValues(all);
        this.values = all;
      } else {
        idx.forEach(i => {
          const v = this.rowValues_(this.rows[i], this.values[i]);
          this.sheet.getRange(i + 2, 1, 1, this.width).setValues([v]);
          this.values[i] = v;
        });
      }
      this.dirty.clear();
    }
    if (this.added.length) {
      const vals = this.added.map(o => this.rowValues_(o));
      this.sheet.getRange(this.values.length + 2, 1, vals.length, this.width).setValues(vals);
      this.values = this.values.concat(vals);
      this.added = [];
    }
  }
}

// OCR・CSV 由来の文字列が「=」で始まっても数式として評価させない
function plainCell_(v) {
  return typeof v === "string" && /^[=]/.test(v) ? "'" + v : v;
}

// ===== シート作成（既存データは消さない。足りない列だけ末尾に追加） =====

function ensureSheet_(name, headers, color) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const lastCol = sh.getLastColumn();
  const current = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  const add = headers.filter(h => !current.includes(h));
  if (add.length) {
    const start = current.filter(String).length ? current.length + 1 : 1;
    sh.getRange(1, start, 1, add.length).setValues([add]);
  }
  const width = sh.getLastColumn();
  sh.getRange(1, 1, 1, width).setBackground(color).setFontColor("#ffffff").setFontWeight("bold");
  sh.setFrozenRows(1);
  return sh;
}

// ===== 設定・マスタ読込 =====

function loadSettings_() {
  const map = {};
  Table.open(SHEET.SETTINGS).all().forEach(r => { map[String(r.key)] = r.value; });
  const num = (k, d) => (isBlank_(map[k]) || isNaN(Number(map[k])) ? d : Number(map[k]));
  return {
    dateTolerance: num("日付許容日数", 3),
    amountPct:     num("金額不一致の検出幅(%)", 20),
    dateWindow:    num("日付要確認の検出幅(日)", 45),
    graceMonths:   num("翌月確認の猶予(月)", 1),
    timeBudgetMs:  num("処理時間上限(秒)", 270) * 1000,
    downloadPattern: String(isBlank_(map["ダウンロード判定キーワード"])
      ? DEFAULT_SETTINGS.find(r => r[0] === "ダウンロード判定キーワード")[1] : map["ダウンロード判定キーワード"]),
    pdfLibUrl:     String(map["pdf-lib URL"] || DEFAULT_SETTINGS.find(r => r[0] === "pdf-lib URL")[1]),
  };
}

function loadCardMasters_() {
  const rows = Table.open(SHEET.CARD_MASTER).all();
  const base = rows.find(r => String(r.method).trim() === CARD_MASTER_DEFAULT_KEY) || DEFAULT_CARD_MASTER_ROW;
  const byMethod = {};
  rows.forEach(r => { byMethod[String(r.method).trim()] = r; });
  return {
    get(method) {
      const own = byMethod[method] || {};
      const out = {};
      Object.keys(DEFAULT_CARD_MASTER_ROW).forEach(k => {
        out[k] = !isBlank_(own[k]) ? own[k] : (!isBlank_(base[k]) ? base[k] : DEFAULT_CARD_MASTER_ROW[k]);
      });
      return out;
    },
    tolerances() {
      const t = {};
      rows.forEach(r => { if (!isBlank_(r.date_tolerance)) t[String(r.method).trim()] = Number(r.date_tolerance); });
      return t;
    },
  };
}

function loadFolderMaster_() {
  return Table.open(SHEET.FOLDER_MASTER).all()
    .filter(r => !isBlank_(r.folder_id))
    .map(r => ({
      folder_id: String(r.folder_id).trim(),
      person:    String(r.person).trim(),
      methods:   String(r.methods).split(/[,、，]/).map(s => s.trim()).filter(Boolean),
      kind:      String(r.kind).trim(),
      memo:      r.memo,
    }));
}

// ===== 共通 =====

function actor_() {
  try {
    return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || "不明";
  } catch (_) {
    return "不明";
  }
}

function nowText_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");
}

function todayYmd_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Tokyo", "yyyy-MM-dd");
}

function newId_(prefix) {
  return prefix + Utilities.formatDate(new Date(), "Asia/Tokyo", "yyMMdd") + "-" +
    Utilities.getUuid().replace(/-/g, "").slice(0, 8);
}

function logHistory_(hist, entity, id, action, before, after, memo) {
  hist.insert({
    at: nowText_(), actor: actor_(), entity, entity_id: id, action,
    before: before || "", after: after || "", memo: memo || "",
  });
}


// ======================================================================
// ===== v8/Drive.gs
// ======================================================================
/**
 * V8 Drive 連携: OCR・xlsx 変換・PDF ページ分割
 * 一時ファイルは成功・失敗にかかわらずゴミ箱へ移動する。
 */

// Drive へ Google 形式に変換してアップロードし、一時ファイルIDを返す
function uploadConverted_(blob, googleMime, extraQuery) {
  const boundary = "wada_v8_" + Utilities.getUuid();
  const meta = JSON.stringify({ name: "v8_tmp_" + Date.now(), mimeType: googleMime });
  const head =
    "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta +
    "\r\n--" + boundary + "\r\nContent-Type: " + blob.getContentType() + "\r\n\r\n";
  const tail = "\r\n--" + boundary + "--";
  const payload = Utilities.newBlob(head).getBytes()
    .concat(blob.getBytes())
    .concat(Utilities.newBlob(tail).getBytes());
  const res = UrlFetchApp.fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id" + (extraQuery || ""),
    {
      method: "post",
      contentType: "multipart/related; boundary=" + boundary,
      payload,
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    }
  );
  if (res.getResponseCode() >= 300) {
    throw new Error("Drive 変換に失敗 HTTP " + res.getResponseCode() + " " + res.getContentText().slice(0, 200));
  }
  return JSON.parse(res.getContentText()).id;
}

function trashQuietly_(id) {
  try { DriveApp.getFileById(id).setTrashed(true); } catch (_) {}
}

// 画像・1ページPDF → OCRテキスト（Drive OCR。外部AIには送信しない）
function driveOcr_(blob) {
  const id = uploadConverted_(blob, "application/vnd.google-apps.document", "&ocrLanguage=ja");
  try {
    return DocumentApp.openById(id).getBody().getText();
  } finally {
    trashQuietly_(id);
  }
}

// xlsx → 2次元配列（Date はそのまま Date で返る）
function xlsxToValues_(blob, sheetName) {
  const id = uploadConverted_(blob, "application/vnd.google-apps.spreadsheet", "");
  try {
    return googleSheetToValues_(id, sheetName);
  } finally {
    trashQuietly_(id);
  }
}

function googleSheetToValues_(id, sheetName) {
  const ss = SpreadsheetApp.openById(id);
  const sh = sheetName ? ss.getSheetByName(sheetName) : ss.getSheets()[0];
  if (!sh) throw new Error("シート「" + sheetName + "」がありません（カード明細列マスタの xlsxシート名 を確認）");
  return sh.getDataRange().getValues();
}

// ===== PDF ページ分割（pdf-lib） =====

let PDF_LIB_ = null;

function loadPdfLib_(url) {
  if (PDF_LIB_) return PDF_LIB_;
  if (typeof globalThis.setTimeout === "undefined") {
    // pdf-lib が内部で使う setTimeout の代替（Apps Script には無い）
    globalThis.setTimeout = function (fn, ms) { if (ms) Utilities.sleep(ms); fn(); return 0; };
  }
  const code = UrlFetchApp.fetch(url).getContentText();
  (0, eval)(code);
  if (!globalThis.PDFLib) throw new Error("pdf-lib を読み込めませんでした: " + url);
  PDF_LIB_ = globalThis.PDFLib;
  return PDF_LIB_;
}

/**
 * PDF を開き、ページ数と「iページ目だけのPDF Blob を返す関数」を返す（i は 1 始まり）
 */
async function openPdfPages_(blob, pdfLibUrl) {
  const PDFLib = loadPdfLib_(pdfLibUrl);
  const src = await PDFLib.PDFDocument.load(new Uint8Array(blob.getBytes()), { ignoreEncryption: true });
  const count = src.getPageCount();
  return {
    count,
    async page(i) {
      if (count === 1) return blob;
      const out = await PDFLib.PDFDocument.create();
      const [p] = await out.copyPages(src, [i - 1]);
      out.addPage(p);
      const bytes = await out.save();
      return Utilities.newBlob(Array.from(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)),
        "application/pdf", blob.getName() + "_p" + i + ".pdf");
    },
  };
}

function contentHash_(blob) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, blob.getBytes());
  return d.map(b => ((b + 256) % 256).toString(16).padStart(2, "0")).join("");
}

// CSV の文字コード判定（自動: UTF-8 で読めなければ Shift_JIS）
function decodeCsv_(blob, encoding) {
  const enc = String(encoding || "自動").trim();
  if (/shift|sjis|932/i.test(enc)) return blob.getDataAsString("Shift_JIS");
  const utf8 = blob.getDataAsString("UTF-8");
  if (/utf/i.test(enc)) return utf8;
  return looksMisdecoded(utf8) ? blob.getDataAsString("Shift_JIS") : utf8;
}


// ======================================================================
// ===== v8/Import.gs
// ======================================================================
/**
 * V8 取込: 原本ファイル台帳・レシートのページ単位OCR（V8-01）・カード明細取込（V8-03）
 *
 * 保存規則: フォルダマスタの各フォルダ直下に「2026-09」形式の月フォルダを作り、その中に原本を置く。
 * 人物・支払手段・月・種別を一意に判別できない原本は取り込まず「分類要確認」にする。
 */

const RECEIPT_MIMES = ["image/jpeg", "image/png", "image/gif", "image/heic", "image/tiff", "application/pdf"];
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const GSHEET_MIME = "application/vnd.google-apps.spreadsheet";

// ===== 原本の列挙と分類 =====

function listSourceFiles_(kind) {
  const out = [];
  loadFolderMaster_().filter(f => f.kind === kind).forEach(f => {
    let folder;
    try { folder = DriveApp.getFolderById(f.folder_id); }
    catch (e) {
      out.push({ folderError: "フォルダにアクセスできません: " + f.folder_id + "（" + (f.memo || "") + "）" });
      return;
    }
    const baseError = validateFolderRow_(f);
    const direct = folder.getFiles();
    while (direct.hasNext()) {
      out.push(classify_(direct.next(), f, "", baseError ||
        "月フォルダの外にあります（「2026-09」形式の月フォルダへ移動してください）"));
    }
    const subs = folder.getFolders();
    while (subs.hasNext()) {
      const sub = subs.next();
      const month = parseMonthFolderName(sub.getName());
      const files = sub.getFiles();
      while (files.hasNext()) {
        out.push(classify_(files.next(), f, month, baseError ||
          (month ? "" : "月フォルダ名を解釈できません: 「" + sub.getName() + "」（例: 2026-09）")));
      }
    }
  });
  return out;
}

function validateFolderRow_(f) {
  if (!PERSONS.includes(f.person)) return "フォルダマスタの人物が不正: " + f.person;
  const bad = f.methods.filter(m => !METHODS.includes(m));
  if (!f.methods.length || bad.length) return "フォルダマスタの支払手段が不正: " + (bad.join(",") || "（空）");
  return "";
}

function classify_(file, f, month, error) {
  const item = {
    file, folder: f, person: f.person, kind: f.kind, target_month: month, method: "", error: error || "",
  };
  if (item.error) return item;
  if (f.methods.length === 1) {
    item.method = f.methods[0];
  } else {
    const d = detectMethodFromName(file.getName(), f.methods, METHOD_ALIASES);
    if (d.method) item.method = d.method;
    else item.error = "ファイル名からカードを1つに特定できません（候補: " + f.methods.join(" / ") +
      (d.hits.length ? "、該当: " + d.hits.join(" / ") : "") + "）";
  }
  return item;
}

// ===== 原本ファイル台帳への登録（重複・版管理） =====

/**
 * @return { action: "skip" | "process", entry }
 */
function registerFile_(ctx, item) {
  const files = ctx.files;
  const file = item.file;
  const id = file.getId();
  const versions = files.all().filter(r => r.file_id === id);
  const latest = versions.reduce((a, b) => (!a || Number(b.version) > Number(a.version) ? b : a), null);
  const updated = file.getLastUpdated().toISOString();
  const sameClass = latest && latest.person === item.person && latest.method === (item.method || latest.method) &&
    latest.kind === item.kind && String(latest.target_month) === String(item.target_month);

  // 既に処理中なら再開、変化がなければスキップ
  if (latest && sameClass && latest.drive_updated === updated && !item.error) {
    if (latest.status === IMPORT_STATUS.PROCESSING) return { action: "process", entry: latest };
    if (latest.status !== IMPORT_STATUS.CLASSIFY) return { action: "skip", entry: latest };
  }
  const blob = file.getBlob();
  const hash = contentHash_(blob);
  if (latest && sameClass && latest.content_hash === hash && !item.error) {
    latest.drive_updated = updated;
    files.touch(latest);
    if (latest.status === IMPORT_STATUS.PROCESSING) return { action: "process", entry: latest };
    if (latest.status !== IMPORT_STATUS.CLASSIFY) return { action: "skip", entry: latest };
  }
  if (item.error && latest && latest.status === IMPORT_STATUS.CLASSIFY &&
      latest.content_hash === hash && latest.message === item.error) {
    return { action: "skip", entry: latest };
  }

  const entry = {
    file_id: id, version: latest ? Number(latest.version) + 1 : 1, file_name: file.getName(),
    link: file.getUrl(), person: item.person, method: item.method, kind: item.kind,
    target_month: item.target_month, status: IMPORT_STATUS.PROCESSING, message: "",
    pages_total: "", pages_done: 0, failed_pages: "", tx_count: 0, imported_at: nowText_(),
    mime_type: file.getMimeType(), content_hash: hash, drive_updated: updated, folder_id: item.folder.folder_id,
  };

  if (item.error) {
    entry.status = IMPORT_STATUS.CLASSIFY;
    entry.message = item.error;
    files.insert(entry);
    return { action: "skip", entry };
  }

  // 別ファイルとして同一内容が取込済みなら二重取込しない
  const twin = files.all().find(r => r.file_id !== id && r.content_hash === hash && r.status === IMPORT_STATUS.DONE);
  if (twin) {
    entry.status = IMPORT_STATUS.DUPLICATE;
    entry.message = "同一内容のファイルが取込済み: " + twin.file_name + "（" + twin.file_id + "）";
    files.insert(entry);
    return { action: "skip", entry };
  }

  // 内容・分類が変わった → 旧版の取引は削除せず「旧版」にする
  if (latest) {
    versions.forEach(v => {
      if (v.status !== IMPORT_STATUS.SUPERSEDED) { v.status = IMPORT_STATUS.SUPERSEDED; files.touch(v); }
    });
    ctx.tx.all().filter(t => t.file_id === id && !isTrue_(t.superseded)).forEach(t => {
      t.superseded = true;
      ctx.tx.touch(t);
      logHistory_(ctx.hist, "取引", t.id, "旧版化", t.state, "", "原本が更新されたため（処理版 " + entry.version + "）");
    });
  }
  files.insert(entry);
  return { action: "process", entry };
}

function openImportContext_() {
  return {
    files: Table.open(SHEET.FILES),
    tx: Table.open(SHEET.TX),
    hist: Table.open(SHEET.HISTORY),
    settings: loadSettings_(),
    started: Date.now(),
  };
}

function flushImportContext_(ctx) {
  ctx.files.flush();
  ctx.tx.flush();
  ctx.hist.flush();
}

function timeUp_(ctx) {
  return Date.now() - ctx.started > ctx.settings.timeBudgetMs;
}

// ===== ① レシート読込（ページ単位OCR） =====

async function importReceipts_() {
  const ctx = openImportContext_();
  const report = { files: 0, pages: 0, failedPages: 0, classify: 0, errors: [], interrupted: false, folderErrors: [] };

  for (const item of listSourceFiles_(KIND.RECEIPT)) {
    if (item.folderError) { report.folderErrors.push(item.folderError); continue; }
    if (!RECEIPT_MIMES.includes(item.file.getMimeType())) continue;
    if (timeUp_(ctx)) { report.interrupted = true; break; }
    const reg = registerFile_(ctx, item);
    if (reg.entry.status === IMPORT_STATUS.CLASSIFY && reg.action === "skip") report.classify++;
    if (reg.action !== "process") continue;
    report.files++;
    const done = await processReceiptFile_(ctx, item.file, reg.entry, report);
    flushImportContext_(ctx);
    if (!done) { report.interrupted = true; break; }
  }
  flushImportContext_(ctx);
  return report;
}

/**
 * 1ファイルをページ単位でOCR。時間切れなら false（処理済ページを保存し、次回はその次のページから再開）
 */
async function processReceiptFile_(ctx, file, entry, report) {
  let pages;
  try {
    if (file.getMimeType() === "application/pdf") {
      pages = await openPdfPages_(file.getBlob(), ctx.settings.pdfLibUrl);
    } else {
      const blob = file.getBlob();
      pages = { count: 1, page: async () => blob };
    }
  } catch (e) {
    entry.status = IMPORT_STATUS.ERROR;
    entry.message = "PDFを開けません: " + e.message;
    ctx.files.touch(entry);
    report.errors.push(entry.file_name + ": " + entry.message);
    return true;
  }
  entry.pages_total = pages.count;
  const failed = String(entry.failed_pages || "").split(",").filter(Boolean);

  for (let p = Number(entry.pages_done || 0) + 1; p <= pages.count; p++) {
    if (timeUp_(ctx)) {
      ctx.files.touch(entry);
      return false;
    }
    const tx = newReceiptTx_(entry, p, ctx.settings);
    try {
      const text = driveOcr_(await pages.page(p));
      applyOcrResult_(tx, text);
    } catch (e) {
      tx.ocr_status = "失敗";
      tx.ocr_note = "OCR失敗: " + e.message;
      tx.state = STATE.OCR_CHECK;
      tx.state_reason = tx.ocr_note;
      failed.push(String(p));
      report.failedPages++;
    }
    ctx.tx.insert(tx);
    entry.pages_done = p;
    entry.tx_count = Number(entry.tx_count || 0) + 1;
    entry.failed_pages = failed.join(",");
    ctx.files.touch(entry);
    report.pages++;
    if (p % 5 === 0) flushImportContext_(ctx);
  }
  entry.status = IMPORT_STATUS.DONE;
  entry.message = failed.length ? "OCR失敗ページ: " + failed.join(",") + "（「OCR失敗・エラーを再実行」で再試行）" : "";
  ctx.files.touch(entry);
  return true;
}

function newReceiptTx_(entry, page, settings) {
  return {
    id: newId_("R"), state: STATE.PENDING, state_reason: "", next_check_month: "",
    kind: KIND.RECEIPT, source_type: detectSourceType(entry.file_name, settings.downloadPattern), person: entry.person, method: entry.method, target_month: entry.target_month,
    orig_date: "", orig_amount: "", currency: "JPY", orig_merchant: "",
    link: entry.link, page, row_no: "",
    foreign_amount: "", foreign_currency: "", jpy_amount: "", fx_basis: "",
    special: "", ocr_status: "", ocr_note: "", evidence: "",
    file_id: entry.file_id, version: entry.version, superseded: false, created_at: nowText_(),
  };
}

// OCRテキストを取引の「原本値」に反映。1ページで合計が一意に決まらなければ値は空のまま OCR要確認
function applyOcrResult_(tx, text) {
  const p = parseReceiptText(text);
  tx.ocr_status = "成功";
  tx.orig_date = p.date;
  tx.orig_amount = p.amount;
  tx.currency = p.currency;
  tx.orig_merchant = p.merchant;
  if (p.currency !== "JPY") {
    tx.foreign_amount = p.amount;
    tx.foreign_currency = p.currency;
    tx.jpy_amount = "";
  } else {
    tx.jpy_amount = p.amount;
  }
  tx.ocr_note = p.notes.join("／");
  tx.evidence = maskSensitive(text).slice(0, 1500);
  if (!p.date || p.amount === "") {
    tx.state = STATE.OCR_CHECK;
    tx.state_reason = tx.ocr_note;
  }
}

// ===== ② カード明細読込 =====

function importStatements_() {
  const ctx = openImportContext_();
  const masters = loadCardMasters_();
  const report = { files: 0, rows: 0, classify: 0, errors: [], unsupported: [], folderErrors: [], interrupted: false };

  for (const item of listSourceFiles_(KIND.CARD)) {
    if (item.folderError) { report.folderErrors.push(item.folderError); continue; }
    if (timeUp_(ctx)) { report.interrupted = true; break; }
    const reg = registerFile_(ctx, item);
    if (reg.entry.status === IMPORT_STATUS.CLASSIFY && reg.action === "skip") report.classify++;
    if (reg.action !== "process") continue;
    report.files++;
    processStatementFile_(ctx, item.file, reg.entry, masters.get(reg.entry.method), report);
    flushImportContext_(ctx);
  }
  flushImportContext_(ctx);
  return report;
}

function readStatementValues_(file, master) {
  const mime = file.getMimeType();
  const name = file.getName().toLowerCase();
  if (mime === GSHEET_MIME) return googleSheetToValues_(file.getId(), master.sheet_name);
  if (mime === XLSX_MIME || name.endsWith(".xlsx")) return xlsxToValues_(file.getBlob(), master.sheet_name);
  if (name.endsWith(".csv") || /csv|text\/plain/.test(mime)) return parseCsv(decodeCsv_(file.getBlob(), master.encoding));
  return null;
}

function processStatementFile_(ctx, file, entry, master, report) {
  let values;
  try {
    values = readStatementValues_(file, master);
  } catch (e) {
    values = undefined;
    entry.status = IMPORT_STATUS.ERROR;
    entry.message = "読込失敗: " + e.message;
  }
  if (values === null) {
    entry.status = IMPORT_STATUS.UNSUPPORTED;
    entry.message = file.getMimeType() === "application/pdf"
      ? "PDF明細は実データで精度確認後に対応（V8-03 条件付き）。CSV/xlsx で保存してください"
      : "未対応の形式です（CSV / xlsx / Googleスプレッドシート）";
    report.unsupported.push(entry.file_name);
  }
  if (!values) {
    if (entry.status === IMPORT_STATUS.ERROR) report.errors.push(entry.file_name + ": " + entry.message);
    ctx.files.touch(entry);
    return;
  }

  const res = extractStatementRows(values, master);
  if (res.error) {
    entry.status = IMPORT_STATUS.ERROR;
    entry.message = res.error;
    report.errors.push(entry.file_name + ": " + res.error);
    ctx.files.touch(entry);
    return;
  }
  res.rows.forEach(r => {
    const bad = !!r.note;
    ctx.tx.insert({
      id: newId_("S"), state: bad ? STATE.OCR_CHECK : STATE.PENDING, state_reason: r.note, next_check_month: "",
      kind: KIND.CARD, source_type: SOURCE_TYPE.STATEMENT, person: entry.person, method: entry.method, target_month: entry.target_month,
      orig_date: r.date, orig_amount: r.amount, currency: "JPY", orig_merchant: r.merchant,
      link: entry.link, page: "", row_no: r.row_no,
      foreign_amount: r.foreign_amount, foreign_currency: r.foreign_currency, jpy_amount: r.amount,
      fx_basis: r.foreign_amount !== "" ? "カード明細の円貨額" : "",
      special: r.special, ocr_status: bad ? "要確認" : "成功", ocr_note: r.note,
      evidence: maskSensitive(values[r.row_no - 1].map(String).join(" | ")).slice(0, 500),
      file_id: entry.file_id, version: entry.version, superseded: false, created_at: nowText_(),
    });
  });
  entry.status = IMPORT_STATUS.DONE;
  entry.pages_total = 1;
  entry.pages_done = 1;
  entry.tx_count = res.rows.length;
  entry.message = res.rows.length ? "" : "見出し行（" + res.headerRow + "行目）の後にデータ行がありません";
  ctx.files.touch(entry);
  report.rows += res.rows.length;
}

// ===== OCR失敗ページ・エラーの再実行（当該ファイル・ページだけ） =====

async function retryFailures_() {
  const ctx = openImportContext_();
  const report = { pages: 0, fixed: 0, files: 0, interrupted: false, errors: [] };

  // 1) OCR失敗ページ: 同じ取引行の原本値を埋める（失敗時は値が空なので上書きにはならない）
  const failedTx = ctx.tx.all().filter(t => t.kind === KIND.RECEIPT && t.ocr_status === "失敗" && !isTrue_(t.superseded));
  const byFile = {};
  failedTx.forEach(t => { (byFile[t.file_id + "#" + t.version] = byFile[t.file_id + "#" + t.version] || []).push(t); });
  for (const key of Object.keys(byFile)) {
    if (timeUp_(ctx)) { report.interrupted = true; break; }
    const [fileId] = key.split("#");
    const entry = ctx.files.all().find(r => r.file_id === fileId && String(r.version) === key.split("#")[1]);
    let file, pages;
    try {
      file = DriveApp.getFileById(fileId);
      pages = file.getMimeType() === "application/pdf"
        ? await openPdfPages_(file.getBlob(), ctx.settings.pdfLibUrl)
        : { count: 1, page: async () => file.getBlob() };
    } catch (e) {
      report.errors.push(fileId + ": " + e.message);
      continue;
    }
    for (const t of byFile[key]) {
      if (timeUp_(ctx)) { report.interrupted = true; break; }
      report.pages++;
      try {
        const before = t.ocr_note;
        applyOcrResult_(t, driveOcr_(await pages.page(Number(t.page))));
        if (t.state !== STATE.OCR_CHECK) { t.state = STATE.PENDING; t.state_reason = ""; }
        logHistory_(ctx.hist, "取引", t.id, "OCR再実行", before, t.ocr_note);
        report.fixed++;
      } catch (e) {
        t.ocr_note = "OCR失敗: " + e.message;
        t.state_reason = t.ocr_note;
      }
      ctx.tx.touch(t);
    }
    if (entry) {
      const still = ctx.tx.all().filter(t => t.file_id === fileId && String(t.version) === String(entry.version) &&
        t.ocr_status === "失敗").map(t => t.page);
      entry.failed_pages = still.join(",");
      entry.message = still.length ? "OCR失敗ページ: " + still.join(",") : "";
      ctx.files.touch(entry);
    }
    flushImportContext_(ctx);
  }

  // 2) ファイル単位のエラー: 処理中に戻して、次回の読込で再処理させる
  ctx.files.all().filter(r => r.status === IMPORT_STATUS.ERROR).forEach(r => {
    r.status = IMPORT_STATUS.PROCESSING;
    r.drive_updated = "";
    r.message = "再実行待ち";
    ctx.files.touch(r);
    report.files++;
  });
  flushImportContext_(ctx);
  return report;
}


// ======================================================================
// ===== v8/Match.gs
// ======================================================================
/**
 * V8 再突合: 突合エンジン（Lib.gs）の結果を取引台帳・突合台帳へ反映する
 * - 承認済み・却下の突合は変更しない
 * - 状態が変わった取引だけ判定履歴に残す
 * - 条件を満たさなくなった候補は削除せず「失効」にする
 */

function rematch_() {
  const tx = Table.open(SHEET.TX);
  const mt = Table.open(SHEET.MATCH);
  const hist = Table.open(SHEET.HISTORY);
  const settings = loadSettings_();
  const masters = loadCardMasters_();

  const cardMethodsByPerson = {};
  loadFolderMaster_().filter(f => f.kind === KIND.CARD).forEach(f => {
    const list = cardMethodsByPerson[f.person] = cardMethodsByPerson[f.person] || [];
    f.methods.forEach(m => { if (!list.includes(m)) list.push(m); });
  });

  const result = runMatchingEngine({
    transactions: tx.all(),
    matches: mt.all(),
    settings,
    tolByMethod: masters.tolerances(),
    cardMethodsByPerson,
    today: todayYmd_(),
  });

  // 取引の状態
  const summary = {};
  let changed = 0;
  tx.all().forEach(t => {
    const s = result.states[t.id];
    if (!s) return;
    summary[s.state] = (summary[s.state] || 0) + 1;
    if (t.state === s.state && t.state_reason === s.state_reason &&
        String(t.next_check_month || "") === String(s.next_check_month || "")) return;
    logHistory_(hist, "取引", t.id, "判定変更", t.state + "｜" + t.state_reason, s.state + "｜" + s.state_reason);
    t.state = s.state;
    t.state_reason = s.state_reason;
    t.next_check_month = s.next_check_month;
    tx.touch(t);
    changed++;
  });

  // 突合候補
  const key = (r, s) => r + "|" + s;
  const fresh = {};
  result.candidates.forEach(c => { fresh[key(c.receipt_id, c.statement_id)] = c; });
  const seen = new Set();
  mt.all().forEach(m => {
    if (m.status !== MATCH_STATUS.CANDIDATE) return;
    const k = key(m.receipt_id, m.statement_id);
    const c = fresh[k];
    if (!c) {
      m.status = MATCH_STATUS.STALE;
      m.decided_at = nowText_();
      m.decision_memo = "条件を満たさなくなったため失効（再突合）";
      mt.touch(m);
      return;
    }
    seen.add(k);
    if (m.kind !== c.kind || String(m.amount_diff) !== String(c.amount_diff) ||
        String(m.date_diff) !== String(c.date_diff) || m.merchant_eval !== c.merchant_eval) {
      Object.assign(m, { kind: c.kind, amount_diff: c.amount_diff, date_diff: c.date_diff, merchant_eval: c.merchant_eval });
      mt.touch(m);
    }
  });
  let added = 0;
  result.candidates.forEach(c => {
    const k = key(c.receipt_id, c.statement_id);
    if (seen.has(k)) return;
    seen.add(k);
    mt.insert({
      match_id: newId_("M"), status: MATCH_STATUS.CANDIDATE, kind: c.kind, match_type: "レシート×カード明細",
      receipt_id: c.receipt_id, statement_id: c.statement_id,
      amount_diff: c.amount_diff, date_diff: c.date_diff, merchant_eval: c.merchant_eval,
      candidate_at: nowText_(), decided_at: "", decided_by: "", decision_memo: "",
    });
    added++;
  });

  tx.flush();
  mt.flush();
  hist.flush();
  return { summary, changed, added };
}


// ======================================================================
// ===== v8/Views.gs
// ======================================================================
/**
 * V8 画面（台帳から毎回生成する表示用シート）
 *   - 突合結果・要確認一覧: 全カード横断
 *   - 先生＋カード別: 「院長_M-AMEX_突合結果」1タブ。1行に レシート｜明細｜結果 を横並び・日付順
 *   - 支払手段不明のレシート: 「院長_カード不明」
 * 判断（承認/却下）とメモは「判断を反映」で台帳へ保存してから再生成するため、手入力は失われない。
 * 未反映の判断がある状態で再生成しようとした場合は処理を止める。
 */

const RESULT_HEADERS = [
  "判断", "判断メモ", "突合ID", "候補区分", "突合状態", "人物", "支払手段", "対象月",
  "レシート日付", "レシート金額", "明細日付", "明細金額", "金額差", "日付差", "店舗名評価",
  "レシート店舗名", "明細店舗名", "原本区分", "レシート原本", "明細原本", "レシート取引ID", "明細取引ID",
  "判断者", "判断日時", "記録済みメモ",
];

const REVIEW_HEADERS = [
  "判断", "判断メモ", "取引ID", "状態", "状態理由", "翌月確認月", "人物", "支払手段", "対象月",
  "原本種別", "原本区分", "日付", "金額", "通貨", "店舗名", "原本", "ページ/行",
];

// 旧版（V8.0）で作っていたタブの見出し。これと完全に一致する表示用タブだけを片付ける
const LEGACY_CARD_TAB_HEADERS = {
  "レシート": ["取引ID", "状態", "日付", "店舗名", "金額", "通貨", "原本区分", "原本", "ページ", "読取メモ", "修正", "状態理由"],
  "明細": ["取引ID", "状態", "利用日", "利用店名", "金額", "外貨額", "外貨通貨", "特殊区分", "原本", "明細行", "状態理由"],
};

const CARD_RESULT_HEADERS = [
  "判断", "判断メモ", "突合ID", "取引ID", "結果", "理由", "日付",
  "レシート店舗名", "レシート金額", "原本区分", "レシート原本",
  "明細日付", "明細店舗名", "明細金額", "明細原本",
  "金額差", "日付差", "店舗名評価", "翌月確認月", "レシート取引ID", "明細取引ID",
];

const CARD_UNKNOWN_HEADERS = [
  "判断", "判断メモ", "取引ID", "状態", "状態理由（候補カード・翌月確認）", "日付", "店舗名", "金額", "通貨",
  "原本区分", "原本", "翌月確認月",
];

const STATE_COLORS = {
  "一致候補": "#e6f4ea", "候補重複": "#e8f0fe", "金額不一致": "#fce8e6", "日付要確認": "#fef7e0",
  "外貨要確認": "#f3e8fd", "翌月確認": "#e0f7fa", "期限超過": "#fad2cf", "未突合": "#fff4e5",
  "OCR要確認": "#f1f3f4", "分類要確認": "#f1f3f4", "承認済み": "#ffffff", "却下": "#eeeeee",
};

function sourceLink_(t) {
  if (!t || !t.link) return "";
  const label = t.page ? "原本 p." + t.page : (t.row_no ? "原本 " + t.row_no + "行" : "原本");
  return '=HYPERLINK("' + String(t.link).replace(/"/g, '""') + '","' + label + '")';
}

function cardTabName_(person, method, kind) {
  return method ? person + "_" + method + "_" + kind : person + "_" + kind;
}

// 判断（承認/却下）を入力できるシート: 突合結果・要確認一覧・先生＋カード別の突合結果・カード不明
function isDecisionSheetName_(name) {
  return name === SHEET.RESULT || name === SHEET.REVIEW ||
    name.endsWith("_" + CARD_TAB.RESULT) || name.endsWith("_" + CARD_TAB.UNKNOWN);
}

function decisionSheets_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets().filter(sh => isDecisionSheetName_(sh.getName()));
}

function pendingDecisionCount_() {
  let n = 0;
  decisionSheets_().forEach(sh => {
    if (sh.getLastRow() < 2) return;
    n += sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().filter(r => !isBlank_(r[0])).length;
  });
  return n;
}

function writeView_(name, headers, rows, colors, color, opts) {
  const o = Object.assign({ decision: true, frozenCols: 3 }, opts || {});
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getFilter()) sh.getFilter().remove();
  sh.clear();
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground(color).setFontColor("#ffffff").setFontWeight("bold");
  sh.setFrozenRows(1);
  sh.setFrozenColumns(o.frozenCols);
  if (rows.length) {
    const range = sh.getRange(2, 1, rows.length, headers.length);
    range.setValues(rows.map(r => r.map((v, j) => (/原本$/.test(headers[j]) ? v : plainCell_(v)))));
    range.setBackgrounds(colors.map(c => headers.map(() => c)));
    if (o.decision) {
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList([DECISION.APPROVE, DECISION.REJECT], true).setAllowInvalid(false).build();
      sh.getRange(2, 1, rows.length, 1).setDataValidation(rule).setBackground("#fff8e1");
      sh.getRange(2, 2, rows.length, 1).setBackground("#fff8e1");
    }
  }
  sh.getRange(1, 1, Math.max(rows.length, 1) + 1, headers.length).createFilter();
  return sh;
}

const amt_ = e => (isFinite(e.amount) ? e.amount : "");

function refreshViews_() {
  const tx = Table.open(SHEET.TX).all().filter(t => !isTrue_(t.superseded));
  const byId = {};
  tx.forEach(t => { byId[t.id] = t; });
  const files = Table.open(SHEET.FILES).all();
  const matches = Table.open(SHEET.MATCH).all();

  // 突合結果: 未判断の候補を先頭、判断済みを後ろに
  const order = { [MATCH_STATUS.CANDIDATE]: 0, [MATCH_STATUS.APPROVED]: 1, [MATCH_STATUS.REJECTED]: 2 };
  const kindOrder = [STATE.CANDIDATE, STATE.DUPLICATE, STATE.AMOUNT_DIFF, STATE.DATE_CHECK, STATE.FX_CHECK];
  const resRows = [], resColors = [];
  matches
    .filter(m => m.status !== MATCH_STATUS.STALE && byId[m.receipt_id] && byId[m.statement_id])
    .sort((a, b) => (order[a.status] - order[b.status]) ||
      (kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind)) ||
      String(byId[a.receipt_id].person + byId[a.receipt_id].method).localeCompare(
        String(byId[b.receipt_id].person + byId[b.receipt_id].method)) ||
      String(effective(byId[a.receipt_id]).date).localeCompare(String(effective(byId[b.receipt_id]).date)))
    .forEach(m => {
      const r = byId[m.receipt_id], s = byId[m.statement_id];
      const er = effective(r), es = effective(s);
      resRows.push([
        "", "", m.match_id, m.kind, m.status, r.person, r.method, r.target_month,
        fmtYmdJa(er.date), amt_(er), fmtYmdJa(es.date), amt_(es),
        m.amount_diff, m.date_diff, m.merchant_eval, er.merchant, es.merchant, r.source_type,
        sourceLink_(r), sourceLink_(s), r.id, s.id, m.decided_by, m.decided_at, m.decision_memo,
      ]);
      resColors.push(m.status === MATCH_STATUS.CANDIDATE ? (STATE_COLORS[m.kind] || "#ffffff") : "#eeeeee");
    });
  writeView_(SHEET.RESULT, RESULT_HEADERS, resRows, resColors, "#37474f");

  // 要確認一覧: 人物 → 支払手段 → 日付順（カードごと・日付ごとに原本をめくれる並び）
  const revRows = [], revColors = [];
  files.filter(f => [IMPORT_STATUS.CLASSIFY, IMPORT_STATUS.ERROR, IMPORT_STATUS.UNSUPPORTED, IMPORT_STATUS.PROCESSING]
    .includes(f.status))
    .forEach(f => {
      revRows.push(["", "", "", f.status, f.message, "", f.person, f.method, f.target_month, f.kind, "",
        "", "", "", f.file_name, '=HYPERLINK("' + f.link + '","原本")', ""]);
      revColors.push("#f1f3f4");
    });
  tx.filter(t => REVIEW_STATES.includes(t.state))
    .map(t => ({ t, e: effective(t) }))
    .sort((a, b) => String(a.t.person).localeCompare(String(b.t.person)) ||
      String(a.t.method).localeCompare(String(b.t.method)) ||
      String(a.e.date).localeCompare(String(b.e.date)))
    .forEach(({ t, e }) => {
      revRows.push([
        "", "", t.id, t.state, t.state_reason, t.next_check_month, t.person, t.method, t.target_month,
        t.kind, t.source_type, fmtYmdJa(e.date), amt_(e), e.currency, e.merchant,
        sourceLink_(t), t.page || t.row_no || "",
      ]);
      revColors.push(STATE_COLORS[t.state] || "#ffffff");
    });
  writeView_(SHEET.REVIEW, REVIEW_HEADERS, revRows, revColors, "#b3261e");

  refreshCardTabs_(tx, byId, matches);
}

// ===== 先生＋カード別タブ =====

// フォルダマスタと取引から「先生＋支払手段」の組と、作るタブの種類を決める
function cardCombos_(tx) {
  const combos = {};
  const add = (person, method, kind) => {
    if (!person || !method) return;
    const k = person + "|" + method;
    const c = combos[k] = combos[k] || { person, method, receipt: false, statement: false };
    if (kind === KIND.RECEIPT) c.receipt = true;
    if (kind === KIND.CARD) c.statement = true;
  };
  loadFolderMaster_().forEach(f => f.methods.forEach(m => add(f.person, m, f.kind)));
  tx.forEach(t => add(t.person, t.method, t.kind));
  const persons = [];
  Object.values(combos).forEach(c => { if (c.receipt && !persons.includes(c.person)) persons.push(c.person); });
  const list = Object.values(combos).filter(c => c.method !== "不明" && c.person !== "銀行");
  list.sort((a, b) => (PERSONS.indexOf(a.person) - PERSONS.indexOf(b.person)) ||
    (METHODS.indexOf(a.method) - METHODS.indexOf(b.method)));
  return { list, unknownPersons: persons.filter(p => p !== "銀行") };
}

function refreshCardTabs_(tx, byId, matches) {
  const { list, unknownPersons } = cardCombos_(tx);
  removeLegacyCardTabs_();
  const byDate = (a, b) => String(a.date).localeCompare(String(b.date));

  list.forEach(c => {
    const mine = t => t.person === c.person && t.method === c.method;
    const receipts = tx.filter(t => t.kind === KIND.RECEIPT && mine(t))
      .map(t => ({ t, e: effective(t) })).map(x => Object.assign(x, { date: x.e.date })).sort(byDate);
    const stmts = tx.filter(t => t.kind === KIND.CARD && mine(t) && t.state !== STATE.DUP_ROW)
      .map(t => ({ t, e: effective(t) })).map(x => Object.assign(x, { date: x.e.date })).sort(byDate);

    // 突合結果: 候補・承認済みの組は1行に横並び。相手のない取引も1行ずつ出す
    const rows = [];
    const shown = new Set();
    matches.filter(m => (m.status === MATCH_STATUS.CANDIDATE || m.status === MATCH_STATUS.APPROVED) &&
      byId[m.receipt_id] && byId[m.statement_id] && (mine(byId[m.receipt_id]) || mine(byId[m.statement_id])))
      .forEach(m => {
        const r = byId[m.receipt_id], s = byId[m.statement_id];
        const er = effective(r), es = effective(s);
        shown.add(r.id); shown.add(s.id);
        rows.push({
          date: er.date || es.date,
          color: m.status === MATCH_STATUS.APPROVED ? "#ffffff" : (STATE_COLORS[m.kind] || "#ffffff"),
          v: ["", "", m.match_id, "", m.status === MATCH_STATUS.APPROVED ? STATE.APPROVED : m.kind,
            m.status === MATCH_STATUS.APPROVED ? m.decision_memo : r.state_reason, fmtYmdJa(er.date || es.date),
            er.merchant, amt_(er), r.source_type, sourceLink_(r),
            fmtYmdJa(es.date), es.merchant, amt_(es), sourceLink_(s),
            m.amount_diff, m.date_diff, m.merchant_eval, r.next_check_month, r.id, s.id],
        });
      });
    receipts.filter(({ t }) => !shown.has(t.id)).forEach(({ t, e }) => rows.push({
      date: e.date, color: STATE_COLORS[t.state] || "#ffffff",
      v: ["", "", "", t.id, t.state, t.state_reason, fmtYmdJa(e.date), e.merchant, amt_(e), t.source_type, sourceLink_(t),
        "", "", "", "", "", "", "", t.next_check_month, t.id, ""],
    }));
    stmts.filter(({ t }) => !shown.has(t.id)).forEach(({ t, e }) => rows.push({
      date: e.date, color: STATE_COLORS[t.state] || "#ffffff",
      v: ["", "", "", t.id, t.state, t.state_reason, fmtYmdJa(e.date), "", "", "", "",
        fmtYmdJa(e.date), e.merchant, amt_(e), sourceLink_(t), "", "", "", "", "", t.id],
    }));
    rows.sort(byDate);
    writeView_(cardTabName_(c.person, c.method, CARD_TAB.RESULT), CARD_RESULT_HEADERS,
      rows.map(r => r.v), rows.map(r => r.color), "#37474f", { frozenCols: 4 });
  });

  // カード不明: 支払手段「不明」のレシート（同額の明細があるカード、翌月確認、現金の可能性）
  unknownPersons.forEach(p => {
    const list = tx.filter(t => t.kind === KIND.RECEIPT && t.person === p && t.method === "不明")
      .map(t => ({ t, e: effective(t) })).map(x => Object.assign(x, { date: x.e.date })).sort(byDate);
    writeView_(cardTabName_(p, "", CARD_TAB.UNKNOWN), CARD_UNKNOWN_HEADERS,
      list.map(({ t, e }) => ["", "", t.id, t.state, t.state_reason, fmtYmdJa(e.date), e.merchant, amt_(e), e.currency,
        t.source_type, sourceLink_(t), t.next_check_month]),
      list.map(({ t }) => STATE_COLORS[t.state] || "#ffffff"), "#8e24aa");
  });
}

// 旧版の「_レシート」「_明細」タブ（表示専用・入力欄なし）を削除する。見出しが一致しないシートには触れない
function removeLegacyCardTabs_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(sh => {
    const m = sh.getName().match(/_(レシート|明細)$/);
    if (!m || ss.getSheets().length < 2) return;
    const want = LEGACY_CARD_TAB_HEADERS[m[1]];
    const width = sh.getLastColumn();
    if (width !== want.length) return;
    const head = sh.getRange(1, 1, 1, width).getValues()[0].map(String);
    if (head.every((h, i) => h === want[i])) ss.deleteSheet(sh);
  });
}


// ======================================================================
// ===== v8/Review.gs
// ======================================================================
/**
 * V8 人の判断: 承認/却下・OCR修正・手動紐付け・取引の分割
 * AI/OCR は候補を出すだけ。確定は必ずここを通り、判断者・日時・メモを台帳と判定履歴に残す。
 */

// ===== 判断を反映 =====

function applyDecisions_() {
  const mt = Table.open(SHEET.MATCH);
  const tx = Table.open(SHEET.TX);
  const hist = Table.open(SHEET.HISTORY);
  const who = actor_(), at = nowText_();
  const report = { approved: 0, rejected: 0, txDecided: 0, errors: [] };

  const approvedTx = new Set();
  mt.all().filter(m => m.status === MATCH_STATUS.APPROVED).forEach(m => {
    approvedTx.add(m.receipt_id); approvedTx.add(m.statement_id);
  });

  // 判断を入力できる全シート（突合結果・要確認一覧・先生＋カード別の突合結果・カード不明）
  const decisions = [];
  decisionSheets_().forEach(sh => readDecisions_(sh).forEach(d => decisions.push(d)));
  const done = new Set();

  decisions.forEach(d => {
    const where = "［" + d.sheet + "］";
    if (d.matchId) {
      // 突合単位
      if (done.has(d.matchId)) return;
      done.add(d.matchId);
      const m = mt.find(x => x.match_id === d.matchId);
      if (!m) return report.errors.push(where + d.matchId + ": 突合IDが台帳にありません");
      if (m.status !== MATCH_STATUS.CANDIDATE) return report.errors.push(where + d.matchId + ": 既に「" + m.status + "」です");
      if (d.decision === DECISION.APPROVE) {
        if (approvedTx.has(m.receipt_id) || approvedTx.has(m.statement_id)) {
          return report.errors.push(where + d.matchId + ": どちらかの取引が別の突合で承認済みです（1対多は「手動紐付け」を使用）");
        }
        approvedTx.add(m.receipt_id); approvedTx.add(m.statement_id);
        m.status = MATCH_STATUS.APPROVED;
        report.approved++;
      } else {
        m.status = MATCH_STATUS.REJECTED;
        report.rejected++;
      }
      Object.assign(m, { decided_at: at, decided_by: who, decision_memo: d.memo });
      mt.touch(m);
      logHistory_(hist, "突合", m.match_id, d.decision, MATCH_STATUS.CANDIDATE + "（" + m.kind + "）", m.status, d.memo);
      return;
    }
    // 取引単位（理由メモ必須）
    if (!d.txId) return report.errors.push(where + "原本ファイル行には判断を入れられません（保存先・ファイルを修正してください）");
    if (done.has(d.txId)) return;
    done.add(d.txId);
    const t = tx.find(x => x.id === d.txId);
    if (!t) return report.errors.push(where + d.txId + ": 取引IDが台帳にありません");
    if (isBlank_(d.memo)) return report.errors.push(where + d.txId + ": 個別の" + d.decision + "には判断メモ（理由）が必要です");
    const before = t.state;
    Object.assign(t, { decision: d.decision, reviewed_by: who, reviewed_at: at, review_memo: d.memo });
    tx.touch(t);
    logHistory_(hist, "取引", t.id, "個別" + d.decision, before, d.decision, d.memo);
    report.txDecided++;
  });

  mt.flush(); tx.flush(); hist.flush();
  return report;
}

// 見出し「判断」「判断メモ」「突合ID」「取引ID」で読む（シートごとの列位置の違いを吸収）
function readDecisions_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const h = values[0].map(String);
  const col = name => h.indexOf(name);
  const cDec = col("判断"), cMemo = col("判断メモ"), cMatch = col("突合ID"), cTx = col("取引ID");
  if (cDec < 0) return [];
  const get = (r, c) => (c >= 0 ? String(r[c] || "").trim() : "");
  return values.slice(1)
    .filter(r => r[cDec] === DECISION.APPROVE || r[cDec] === DECISION.REJECT)
    .map(r => ({ sheet: sh.getName(), decision: r[cDec], memo: get(r, cMemo), matchId: get(r, cMatch), txId: get(r, cTx) }));
}

// ===== OCR修正を反映（V8-02） =====

function applyCorrections_() {
  const tx = Table.open(SHEET.TX);
  const hist = Table.open(SHEET.HISTORY);
  const who = actor_(), at = nowText_();
  const report = { applied: 0, errors: [] };

  tx.all().filter(t => !isTrue_(t.superseded)).forEach(t => {
    const sig = correctionSignature(t);
    if (sig === String(t.corr_sig || "")) return;
    const problems = [];
    if (!isBlank_(t.corr_date) && !toYmd(t.corr_date)) problems.push("修正_日付");
    if (!isBlank_(t.corr_amount) && isNaN(parseAmount(t.corr_amount))) problems.push("修正_金額");
    if (!isBlank_(t.corr_currency) && !/^[A-Za-z]{3}$/.test(String(t.corr_currency).trim())) problems.push("修正_通貨（USD等の3文字）");
    if (problems.length) return report.errors.push(t.id + ": " + problems.join("・") + " を解釈できません");
    logHistory_(hist, "取引", t.id, "OCR修正",
      t.corr_sig ? "修正前: " + t.corr_sig : "原本値: " + JSON.stringify([toYmd(t.orig_date), t.orig_amount, t.currency, t.orig_merchant]),
      sig ? "修正後: " + sig : "修正を取消（原本値に戻す）", t.corr_reason);
    Object.assign(t, { corr_sig: sig, corr_by: sig ? who : "", corr_at: sig ? at : "" });
    tx.touch(t);
    report.applied++;
  });
  tx.flush(); hist.flush();
  return report;
}

// ===== 手動紐付け（1対多・多対1） =====

function manualLink_(receiptIds, statementIds, memo) {
  const tx = Table.open(SHEET.TX);
  const mt = Table.open(SHEET.MATCH);
  const hist = Table.open(SHEET.HISTORY);
  const rs = receiptIds.map(id => tx.find(t => t.id === id && !isTrue_(t.superseded)));
  const ss = statementIds.map(id => tx.find(t => t.id === id && !isTrue_(t.superseded)));
  const missing = receiptIds.filter((id, i) => !rs[i] || rs[i].kind !== KIND.RECEIPT)
    .concat(statementIds.filter((id, i) => !ss[i] || ss[i].kind !== KIND.CARD));
  if (missing.length) throw new Error("取引IDが見つからないか種別が違います: " + missing.join(", "));
  if (rs.length > 1 && ss.length > 1) throw new Error("多対多は紐付けできません（1対多 または 多対1）");
  const approved = new Set();
  mt.all().filter(m => m.status === MATCH_STATUS.APPROVED).forEach(m => { approved.add(m.receipt_id); approved.add(m.statement_id); });
  const dup = receiptIds.concat(statementIds).filter(id => approved.has(id));
  if (dup.length) throw new Error("既に承認済みの取引が含まれています: " + dup.join(", "));
  const persons = new Set(rs.concat(ss).map(t => t.person));
  if (persons.size > 1) throw new Error("人物が異なる取引は紐付けできません");

  const sum = list => list.reduce((a, t) => a + (isFinite(effective(t).amount) ? effective(t).amount : 0), 0);
  const diff = sum(ss) - sum(rs);
  const group = newId_("G");
  const who = actor_(), at = nowText_();
  const note = "手動紐付け " + group + "（合計差 " + diff + "）" + (memo ? "：" + memo : "");
  rs.forEach(r => ss.forEach(s => {
    mt.all().filter(m => m.status === MATCH_STATUS.CANDIDATE &&
      (m.receipt_id === r.id || m.statement_id === s.id)).forEach(m => {
      m.status = MATCH_STATUS.STALE; m.decided_at = at; m.decision_memo = "手動紐付け " + group + " により失効";
      mt.touch(m);
    });
    const m = mt.insert({
      match_id: newId_("M"), status: MATCH_STATUS.APPROVED, kind: "手動紐付け", match_type: "レシート×カード明細",
      receipt_id: r.id, statement_id: s.id, amount_diff: diff, date_diff: dayDiffSafe_(r, s),
      merchant_eval: merchantEval(effective(r).merchant, effective(s).merchant),
      candidate_at: at, decided_at: at, decided_by: who, decision_memo: note,
    });
    logHistory_(hist, "突合", m.match_id, "手動紐付け", "", MATCH_STATUS.APPROVED, note);
  }));
  mt.flush(); hist.flush();
  return { group, diff };
}

function dayDiffSafe_(r, s) {
  const a = effective(r).date, b = effective(s).date;
  return a && b ? dayDiff(a, b) : "";
}

// ===== 取引の分割（1ページに複数レシート） =====

function splitTx_(txId) {
  const tx = Table.open(SHEET.TX);
  const hist = Table.open(SHEET.HISTORY);
  const src = tx.find(t => t.id === txId && !isTrue_(t.superseded));
  if (!src) throw new Error("取引IDが見つかりません: " + txId);
  if (src.kind !== KIND.RECEIPT) throw new Error("分割できるのはレシート/領収書の取引だけです");
  const copy = Object.assign({}, src);
  delete copy._i;
  Object.assign(copy, {
    id: newId_("R"), state: STATE.OCR_CHECK, state_reason: "分割で追加（" + txId + " と同じページ）。修正列に値を入力",
    orig_date: "", orig_amount: "", orig_merchant: "", jpy_amount: "", foreign_amount: "",
    corr_date: "", corr_amount: "", corr_currency: "", corr_merchant: "", corr_reason: "",
    corr_by: "", corr_at: "", corr_sig: "", decision: "", reviewed_by: "", reviewed_at: "", review_memo: "",
    ocr_note: "分割元: " + txId, created_at: nowText_(),
  });
  tx.insert(copy);
  logHistory_(hist, "取引", copy.id, "分割", txId, copy.id);
  tx.flush(); hist.flush();
  return copy.id;
}


// ======================================================================
// ===== v8/Menu.gs
// ======================================================================
/**
 * V8 メニューと実行入口
 * 取込・突合・判断は同時実行しない（ScriptLock）。
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🦷 突合V8")
    .addItem("① レシート読込（ページ単位OCR）", "menuImportReceipts")
    .addItem("② カード明細読込（CSV/xlsx）", "menuImportStatements")
    .addItem("③ 再突合・画面更新", "menuRematch")
    .addSeparator()
    .addItem("判断を反映（承認／却下）", "menuApplyDecisions")
    .addItem("修正を反映して再突合", "menuApplyCorrections")
    .addItem("手動紐付け（1対多・多対1）", "menuManualLink")
    .addItem("取引を分割（1ページ複数レシート）", "menuSplitTx")
    .addItem("OCR失敗・エラーを再実行", "menuRetry")
    .addSeparator()
    .addItem("【初回】V8シート作成", "menuInit")
    .addToUi();
}

// ===== 共通ラッパー =====

async function guarded_(label, fn, opts) {
  const ui = SpreadsheetApp.getUi();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    ui.alert("⏳ 別の処理が実行中です。終了してから「" + label + "」を再実行してください。");
    return;
  }
  try {
    assertNotV7_();
    if (!(opts && opts.allowPending)) {
      const pending = pendingDecisionCount_();
      if (pending) {
        ui.alert("⛔ 未反映の判断が " + pending + " 件あります。\n先に「判断を反映（承認／却下）」を実行してください。\n" +
          "（画面を作り直すと入力した判断が消えるため中止しました）");
        return;
      }
    }
    return await fn(ui);
  } catch (e) {
    console.error(e && e.stack || e);
    ui.alert("❌ " + label + " でエラーが発生しました。\n\n" + (e && e.message || e) +
      "\n\n原本と既存の結果は変更されていません。原因を解消して再実行してください。");
  } finally {
    lock.releaseLock();
  }
}

function assertNotV7_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hits = V7_SHEET_NAMES.filter(n => n !== SHEET.RESULT && ss.getSheetByName(n));
  if (hits.length) {
    throw new Error("このスプレッドシートには V7 のタブ（" + hits.join("・") + "）があります。" +
      "V8 は V7 と混在させず、新しいスプレッドシートで使ってください。");
  }
}

function rematchAndRefresh_() {
  const r = rematch_();
  refreshViews_();
  return r;
}

function summaryText_(r) {
  const order = [STATE.CANDIDATE, STATE.DUPLICATE, STATE.AMOUNT_DIFF, STATE.DATE_CHECK, STATE.FX_CHECK,
    STATE.NEXT_MONTH, STATE.EXPIRED, STATE.UNMATCHED, STATE.OCR_CHECK, STATE.CLASSIFY, STATE.DUP_ROW,
    STATE.APPROVED, STATE.REJECTED];
  return order.filter(s => r.summary[s]).map(s => "  " + s + ": " + r.summary[s] + "件").join("\n") +
    "\n（状態変更 " + r.changed + "件・新規候補 " + r.added + "件）";
}

function listText_(title, list) {
  return list.length ? "\n\n" + title + "\n・" + list.slice(0, 10).join("\n・") + (list.length > 10 ? "\n…ほか" + (list.length - 10) + "件" : "") : "";
}

// ===== メニュー =====

function menuImportReceipts() {
  return guarded_("① レシート読込", async ui => {
    const rep = await importReceipts_();
    const r = rematchAndRefresh_();
    ui.alert(
      (rep.interrupted ? "⏸ 時間制限のため途中で中断しました。もう一度実行すると続きのページから再開します。\n\n" : "✅ レシート読込完了\n\n") +
      "処理ファイル: " + rep.files + "件 / OCRページ: " + rep.pages + "（失敗 " + rep.failedPages + "）\n" +
      "分類要確認: " + rep.classify + "件" +
      listText_("⚠️ エラー", rep.errors) + listText_("⚠️ フォルダ", rep.folderErrors) +
      "\n\n【突合状態】\n" + summaryText_(r));
  });
}

function menuImportStatements() {
  return guarded_("② カード明細読込", async ui => {
    const rep = importStatements_();
    const r = rematchAndRefresh_();   // 翌月確認の取引もここで優先的に再判定される
    ui.alert(
      (rep.interrupted ? "⏸ 時間制限のため途中で中断しました。もう一度実行してください。\n\n" : "✅ カード明細読込完了\n\n") +
      "処理ファイル: " + rep.files + "件 / 明細行: " + rep.rows + "行\n分類要確認: " + rep.classify + "件" +
      listText_("⚠️ 読み込めなかったファイル（必須列不足など）", rep.errors) +
      listText_("⚠️ 未対応形式", rep.unsupported) + listText_("⚠️ フォルダ", rep.folderErrors) +
      "\n\n【突合状態】\n" + summaryText_(r));
  });
}

function menuRematch() {
  return guarded_("③ 再突合", async ui => {
    const r = rematchAndRefresh_();
    ui.alert("✅ 再突合・画面更新完了\n\n" + summaryText_(r) +
      "\n\n※ 一致候補も未承認です。原本を確認し、突合結果シートで承認／却下してください。");
  });
}

function menuApplyDecisions() {
  return guarded_("判断を反映", async ui => {
    const rep = applyDecisions_();
    const r = rematchAndRefresh_();
    ui.alert("✅ 判断を反映しました\n\n承認: " + rep.approved + "件 / 却下: " + rep.rejected + "件 / 個別判断: " + rep.txDecided + "件" +
      listText_("⚠️ 反映できなかった判断（画面から消えています。再入力してください）", rep.errors) +
      "\n\n【突合状態】\n" + summaryText_(r));
  }, { allowPending: true });
}

function menuApplyCorrections() {
  return guarded_("修正を反映", async ui => {
    const rep = applyCorrections_();
    const r = rematchAndRefresh_();
    ui.alert("✅ 修正 " + rep.applied + "件を反映して再突合しました（原本値は残っています）" +
      listText_("⚠️ 反映できなかった修正", rep.errors) + "\n\n【突合状態】\n" + summaryText_(r));
  });
}

function menuManualLink() {
  return guarded_("手動紐付け", async ui => {
    const ask = (msg) => {
      const res = ui.prompt("手動紐付け", msg, ui.ButtonSet.OK_CANCEL);
      if (res.getSelectedButton() !== ui.Button.OK) throw new Error("キャンセルしました");
      return res.getResponseText();
    };
    const ids = s => s.split(/[,、\s]+/).map(x => x.trim()).filter(Boolean);
    const rIds = ids(ask("レシート取引ID（複数は「,」区切り）"));
    const sIds = ids(ask("明細取引ID（複数は「,」区切り）"));
    const memo = ask("判断メモ（例: 分割払い、合算レシート）");
    const g = manualLink_(rIds, sIds, memo);
    rematchAndRefresh_();
    ui.alert("✅ 紐付けました（" + g.group + "）\n金額合計の差: " + g.diff + "円");
  });
}

function menuSplitTx() {
  return guarded_("取引を分割", async ui => {
    const res = ui.prompt("取引を分割", "分割するレシートの取引ID（同じページに2枚目の取引行を追加します）", ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return;
    const id = splitTx_(res.getResponseText().trim());
    rematchAndRefresh_();
    ui.alert("✅ 取引 " + id + " を追加しました。\n取引台帳で両方の行の「修正_日付・修正_金額・修正_店舗名」を入力し、「修正を反映して再突合」を実行してください。");
  });
}

function menuRetry() {
  return guarded_("OCR失敗・エラーを再実行", async ui => {
    const rep = await retryFailures_();
    const r = rematchAndRefresh_();
    ui.alert((rep.interrupted ? "⏸ 時間制限のため中断しました。もう一度実行してください。\n\n" : "✅ 再実行完了\n\n") +
      "OCR再実行: " + rep.pages + "ページ（成功 " + rep.fixed + "）\n" +
      "エラーファイル: " + rep.files + "件を再処理待ちにしました（①または②を実行してください）" +
      listText_("⚠️", rep.errors) + "\n\n【突合状態】\n" + summaryText_(r));
  });
}

// ===== 初期化（既存データは消さない） =====

function menuInit() {
  return guarded_("V8シート作成", async ui => {
    ensureSheet_(SHEET.REVIEW, REVIEW_HEADERS, "#b3261e");
    ensureSheet_(SHEET.RESULT, RESULT_HEADERS, "#37474f");
    const tx = ensureSheet_(SHEET.TX, FIELDS[SHEET.TX].map(f => f[1]), "#1a73e8");
    ensureSheet_(SHEET.MATCH, FIELDS[SHEET.MATCH].map(f => f[1]), "#0f9d58");
    ensureSheet_(SHEET.FILES, FIELDS[SHEET.FILES].map(f => f[1]), "#5f6368");
    ensureSheet_(SHEET.HISTORY, FIELDS[SHEET.HISTORY].map(f => f[1]), "#5f6368");
    const fm = ensureSheet_(SHEET.FOLDER_MASTER, FIELDS[SHEET.FOLDER_MASTER].map(f => f[1]), "#8e24aa");
    const cm = ensureSheet_(SHEET.CARD_MASTER, FIELDS[SHEET.CARD_MASTER].map(f => f[1]), "#8e24aa");
    const st = ensureSheet_(SHEET.SETTINGS, FIELDS[SHEET.SETTINGS].map(f => f[1]), "#8e24aa");

    if (fm.getLastRow() < 2) fm.getRange(2, 1, DEFAULT_FOLDERS.length, 5).setValues(DEFAULT_FOLDERS);
    if (cm.getLastRow() < 2) {
      const d = DEFAULT_CARD_MASTER_ROW;
      cm.getRange(2, 1, 1, 11).setValues([[CARD_MASTER_DEFAULT_KEY, d.encoding, d.sheet_name, d.date_cols, d.amount_cols,
        d.merchant_cols, d.foreign_cols, d.currency_cols, d.special_pattern, d.date_tolerance,
        "全カード共通の初期値。実ファイル受領後、カード別の行（支払手段名）を追加して上書きする"]]);
    }
    const keys = st.getLastRow() > 1 ? st.getRange(2, 1, st.getLastRow() - 1, 1).getValues().flat().map(String) : [];
    const add = DEFAULT_SETTINGS.filter(r => !keys.includes(r[0]));
    if (add.length) st.getRange(st.getLastRow() + 1, 1, add.length, 3).setValues(add);

    // 原本値の列は誤編集防止（警告のみ）。修正は「修正_」列へ
    const tbl = new Table(tx, FIELDS[SHEET.TX]);
    ["orig_date", "orig_amount", "currency", "orig_merchant"].forEach(k => {
      const col = tbl.col[k] + 1;
      const exists = tx.getProtections(SpreadsheetApp.ProtectionType.RANGE)
        .some(p => p.getDescription() === "V8原本値:" + k);
      if (!exists) tx.getRange(1, col, tx.getMaxRows(), 1).protect().setDescription("V8原本値:" + k).setWarningOnly(true);
    });
    ["corr_date", "corr_amount", "corr_currency", "corr_merchant", "corr_reason"].forEach(k => {
      tx.getRange(2, tbl.col[k] + 1, Math.max(tx.getMaxRows() - 1, 1), 1).setBackground("#fff8e1");
    });
    refreshViews_();
    ui.alert("✅ V8シートを作成しました（V" + V8_VERSION + "）\n\n" +
      "【最初に確認すること】\n" +
      "1. フォルダマスタ: V7のフォルダIDを登録済み。各フォルダ直下に「2026-09」形式の月フォルダを作って原本を入れる\n" +
      "2. セゾン・DC などが同居する明細フォルダは、ファイル名にカード名を入れる（例: 2026-09_セゾン.csv）\n" +
      "3. カード明細列マスタ: 実ファイルの列名に合わせてカード別の行を追加\n" +
      "4. 先生＋カード別の「_突合結果」タブ（レシート｜明細｜結果の横並び）と「_カード不明」タブを作成済み\n" +
      "5. ダウンロードした領収書・請求書はファイル名に「領収書」「請求書」等を入れる（原本区分の判定）\n\n" +
      "【月次の手順】\n① レシート読込 → ② カード明細読込 → 要確認一覧・突合結果で原本確認 → 判断を反映");
  });
}
