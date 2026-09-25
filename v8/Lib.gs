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

// 対象月の正規化: シートが「2026-08」を日付に自動変換しても "2026-08" に戻す
function toYm(v) {
  if (isBlank_(v)) return "";
  if (isDate_(v)) return v.getFullYear() + "-" + pad2_(v.getMonth() + 1);
  const s = nfkc_(v).trim().replace(/^'/, "");
  const m = s.match(/^(\d{4})[-\/年.](\d{1,2})/);
  return m ? m[1] + "-" + pad2_(Number(m[2])) : s;
}

function addMonths(ym, n) {
  const [y, m] = toYm(ym).split("-").map(Number);
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

// ===== 写真・スキャンPDFのカード明細（OCRテキスト）解析 =====
//
// 1ページ = 1回のOCR。Drive OCR は表を列ごとに読むことがあり「日付＋店名」の行と金額が離れて出てくる。
// そこで「日付＋店名」の行と、売上金額（S 付きの金額）をそれぞれ順番に集め、
//   - 数が一致したページだけ順番で対応付ける（それでも原本確認が前提）
//   - 数が合わないページは金額を空欄にして OCR要確認（推測で組み合わせない）
// 日付は明細の期間（対象月の前後）から外れるもの（例: 260701 → 200701 の誤読）は空欄にする。

const STMT_ROW_START_ = /^[~\-\\*\s]*(\d{6}|\d{2,4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}|\d{2,5})\s*(?=[A-Za-z\u3040-\u30ff\u4e00-\u9fff*＊])(.*)$/;
const STMT_NOT_ROW_ = /(\d\s*年|\d+\s*月\s*\d+\s*日|円|%|件|レート|現地通貨|作成日|会員番号|口座|利用可能枠)/;
// 金額は1,000以上なら区切り付き（明細の印字）。区切りのない4桁以上の数字は日付の誤読として扱う
const STMT_AMOUNT_LINE_ = /^((?:\d{1,3}(?:[,.]\s?\d{3})+)|\d{1,3})\s*([S8§$]?)(?:\s*現地通貨.*|\s+[\d.,\/][\d\s.,\/]*)?$/;
const STMT_DATE_ONLY_ = /^[~\-\\*\s]*(2\d{4,5})$/;   // 店名が読めなかった行（例: 20090）
const STMT_TOTAL_LINE_ = /(当月ご利用金額|当月お支払合計金額|ご請求金額|今回お支払金額)/;

function parseStmtAmount_(s) {
  const v = Number(String(s).replace(/[,.\s]/g, ""));
  return isFinite(v) ? v : NaN;
}

function parseStmtDate_(raw, targetMonth) {
  const s = String(raw);
  let ymd = "";
  if (/^\d{6}$/.test(s)) ymd = makeYmd_(s.slice(0, 2), s.slice(2, 4), s.slice(4, 6));
  else if (/[\/.\-]/.test(s)) ymd = toYmd(s);
  if (!ymd) return "";
  if (targetMonth) {
    const m = monthOf(ymd);
    if (m < addMonths(targetMonth, -4) || m > addMonths(targetMonth, 1)) return "";   // 明細期間から外れる → 誤読扱い
  }
  return ymd;
}

/**
 * @return { rows: [{row_no, date, amount, merchant, note}], total, saleAmounts, paired }
 */
function parseStatementOcrText(text, targetMonth) {
  const lines = nfkc_(text).split(/\r?\n/).map(l => l.replace(/\\([+*~\-\[\]])/g, "$1").trim()).filter(Boolean);
  const starts = [], tokens = [];
  let total = "";
  lines.forEach((line, i) => {
    if (STMT_TOTAL_LINE_.test(line)) {
      if (total === "") {
        for (let k = i; k < Math.min(lines.length, i + 3); k++) {
          const m = lines[k].replace(STMT_TOTAL_LINE_, "").match(/(\d{1,3}(?:[,.]\s?\d{3})+)/);
          if (m) { total = parseStmtAmount_(m[1]); break; }
        }
      }
      return;
    }
    if (total !== "" && i > 0 && STMT_TOTAL_LINE_.test(lines[i - 1])) return;   // 合計行の金額は明細行にしない
    const am = line.match(STMT_AMOUNT_LINE_);
    if (am) {
      const s = !!am[2] || /^[S8]$/.test(lines[i + 1] || "");
      if (parseStmtAmount_(am[1]) < 100 && !s) return;   // 支払回数（1・01）などの小さい数字
      tokens.push({ i, value: parseStmtAmount_(am[1]), s });
      return;
    }
    const only = line.match(STMT_DATE_ONLY_);
    if (only) { starts.push({ raw: only[1], merchant: "", inlineAmount: "" }); return; }
    const st = line.match(STMT_ROW_START_);
    if (st && !STMT_NOT_ROW_.test(line)) {
      const rest = st[2].trim();
      const inline = rest.match(/^(.*?)\s+((?:\d{1,3}(?:[,.]\s?\d{3})+)|\d{1,3})\s*[S8]?$/);
      starts.push({
        raw: st[1], merchant: (inline ? inline[1] : rest).slice(0, 60),
        inlineAmount: inline ? parseStmtAmount_(inline[2]) : "",
      });
    }
  });

  // 売上金額: S 付き、または直後（4行以内）に同じ金額（お支払金額）が繰り返されるもの。繰り返し側は数えない
  const sales = [];
  const used = new Set();
  tokens.forEach((t, k) => {
    if (used.has(k)) return;
    const twin = tokens.findIndex((u, j) => j > k && !used.has(j) && u.i - t.i <= 4 && u.value === t.value);
    if (!t.s && twin < 0) return;
    if (twin >= 0) used.add(twin);
    sales.push(t.value);
  });

  const allInline = starts.length > 0 && starts.every(s => s.inlineAmount !== "");
  const paired = allInline || (starts.length > 0 && starts.length === sales.length);
  const rows = starts.map((s, i) => {
    const date = parseStmtDate_(s.raw, targetMonth);
    const amount = allInline ? s.inlineAmount : (paired ? sales[i] : "");
    const notes = [];
    if (!s.merchant) notes.push("店名を読み取れません");
    if (!date) notes.push("日付を読み取れません（読取: " + s.raw + "）");
    if (amount === "") notes.push("金額との対応付け不可（行 " + starts.length + " 件・金額 " + sales.length + " 件）");
    return { row_no: i + 1, date, amount, merchant: s.merchant, note: notes.join("／") };
  });
  return { rows, total, saleAmounts: sales, paired };
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
  // OCR で「26, 290」「1. 400」のように区切りの後に空白が入るのを詰める
  const s = nfkc_(text).replace(/(\d)([,.])\s+(\d{3})(?!\d)/g, "$1$2$3");
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
  // 領収書の金額表記「¥11,990-」「¥11,990.-」
  const receiptMarks = [];
  const reMark = /[¥￥\\]\s*(\d{1,3}(?:,\d{3})+|\d+)\s*(?:\.-|-|ー|―)(?!\d)/g;
  let mk;
  while ((mk = reMark.exec(s))) {
    const v = Number(mk[1].replace(/,/g, ""));
    if (v > 0 && !receiptMarks.includes(v)) receiptMarks.push(v);
  }
  if (totals.length === 1) r.amount = totals[0];
  else if (totals.length > 1) {
    r.notes.push("複数の合計金額を検出: " + totals.join(" / ") + "（1ページに複数レシートの可能性。自動で選びません）");
  } else if (receiptMarks.length === 1) {
    r.amount = receiptMarks[0];
    r.notes.push("領収書の金額表記（¥…-）を採用");
  } else {
    const yen = [];
    const re = /[¥￥]\s*(\d{1,3}(?:,\d{3})+|\d+)|(\d{1,3}(?:,\d{3})+|\d+)\s*円/g;
    let m;
    while ((m = re.exec(s))) {
      const v = Number((m[1] || m[2]).replace(/,/g, ""));
      if (v > 0 && !yen.includes(v)) yen.push(v);
    }
    if (yen.length === 1 && yen[0] >= 100 && r.currency === "JPY") {
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

  // 1枚に複数のレシートが写っていないか（日付・時刻・登録番号・金額表記が複数）
  const dates = findDates(s);
  const times = [];
  const reTime = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?![\d:])/g;
  let tm;
  while ((tm = reTime.exec(s))) { const k = Number(tm[1]) + ":" + tm[2]; if (!times.includes(k)) times.push(k); }
  const regNos = [];
  (s.match(/T\d{13}/g) || []).forEach(x => { if (!regNos.includes(x)) regNos.push(x); });
  const hints = [];
  if (dates.length > 1) hints.push("日付" + dates.length + "件");
  if (times.length > 1) hints.push("時刻" + times.length + "件");
  if (regNos.length > 1) hints.push("登録番号" + regNos.length + "件");
  if (receiptMarks.length > 1) hints.push("領収金額" + receiptMarks.length + "件");
  if (r.amount !== "" && totals.length <= 1 && receiptMarks.length === 1) {
    const other = yenAmounts_(s).filter(v => v !== r.amount && !isTaxPartOf_(v, r.amount, s));
    if (other.length) hints.push("別の金額 ¥" + other.slice(0, 3).map(v => v.toLocaleString("ja-JP")).join("・¥"));
  }
  if (hints.length && r.amount !== "") {
    r.amount = "";
    r.notes.push("1枚に複数のレシートが写っている可能性（" + hints.join("・") + "）。1枚ずつ撮影・スキャンするか「取引を分割」で入力");
  }

  // 日付
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

function yenAmounts_(s) {
  const out = [];
  const re = /[¥￥]\s*(\d{1,3}(?:,\d{3})+|\d+)/g;
  let m;
  while ((m = re.exec(s))) {
    const v = Number(m[1].replace(/,/g, ""));
    if (v > 0 && !out.includes(v)) out.push(v);
  }
  return out;
}

// 合計に付随する金額（税抜対象額・消費税・小計・0円のお釣り等）か
function isTaxPartOf_(v, total, s) {
  if (v >= total) return false;
  const rest = total - v;
  const all = yenAmounts_(s).concat((s.match(/\d{1,3}(?:,\d{3})+/g) || []).map(x => Number(x.replace(/,/g, ""))));
  if (all.includes(rest)) return true;                        // 税抜額＋消費税＝合計
  const rate = v / total;
  if (Math.abs(rate - 10 / 110) < 0.002 || Math.abs(rate - 8 / 108) < 0.002) return true;   // 内消費税
  if (Math.abs(v - Math.round(total / 1.1)) <= 1 || Math.abs(v - Math.round(total / 1.08)) <= 1) return true;   // 税抜対象額
  return false;
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
      if (s.source_type === SOURCE_TYPE.PHOTO) reason += "／明細は写真OCR（原本で金額・日付を確認）";
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
