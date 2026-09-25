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
  ["ocr_total", "明細合計（読取）"],
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
    this.fields.forEach(([key]) => {
      const x = v[this.col[key]];
      o[key] = MONTH_KEYS_.includes(key) ? toYm(x) : x;
    });
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
      v[this.col[key]] = x === undefined || x === null ? "" : (TEXT_KEYS_.includes(key) ? asText_(x) : plainCell_(x));
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

// シートに自動変換させたくない列（月・ハッシュ）は文字として書き込む
const MONTH_KEYS_ = ["target_month", "next_check_month"];
const TEXT_KEYS_ = MONTH_KEYS_.concat(["content_hash"]);

function asText_(v) {
  const s = String(v);
  return s === "" || s.charAt(0) === "'" ? s : "'" + s;
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
    reserveMs:     num("画面更新の予備時間(秒)", 90) * 1000,
    ocrBatch:      num("OCR同時処理数", 6),
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
