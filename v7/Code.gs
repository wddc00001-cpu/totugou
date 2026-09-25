/**
 * 和田歯科グループ 経理突合システム v7.2
 *
 * v7.0 からの変更（安全対策のみ。機能は広げない）
 *   - レシート・CSVの取込済み判定をファイル名ではなく DriveファイルID で行う
 *   - 同一人物・同一カード・同額・日付差3日以内の候補が1件だけの場合に自動一致
 *   - 候補が複数なら「候補重複（手動確認）」とし、その候補明細を後続レシートへ自動一致させない
 *   - 既存データ行がある場合、シート初期化は中止する
 *   - OCR・CSV取込・突合は同時実行しない（ScriptLock）
 *   - CSVは UTF-8 限定。引用符内のカンマ・改行・エスケープされた引用符を解析できる
 *   - OCR用の一時Googleドキュメントは成功・失敗にかかわらずゴミ箱へ移動する
 *   - シート上で日付型になった値を文字列化してから解析していた不具合を修正
 *
 * V8以降の機能（一括PDF、Excel/PDF明細、Shift_JIS、銀行、請求書、現金・外貨、AI推測）は
 * このファイルに追加しない。v8/ の別プロジェクトで扱う。
 *
 * 【フォルダ構成】
 * 📁 院長フォルダ (1fyWVu2eghFz25JWVuo7ZplSoAnmVa8nn)
 *   └─ 📁 レシート (1YDsJH9sOxWy1B1htAYl--7FB-7IaPHDS)
 *       ├─ 院長_M-AMEX          (1lTShDGN-mRZHA34Aawsc8LSKMcZn5EAN)
 *       ├─ 院長_A-AMEX          (1yE4rMETDeCQKUviwRrCzx-phStmJO1gc)
 *       ├─ 院長_個人LC          (1NFwXnq9iKpI8aCHmLTg7d-0F35ufRK4d)
 *       ├─ 院長_法人LC          (1VFSh7X4W7uEmTtMuQF8AiRpFI6vtKbVk)
 *       ├─ 院長_セゾン          (1ed_-kzUN3q5YrCQ6lgEmkUx51sxqaTxc)
 *       ├─ 院長_DC(JAL)         (1bm9B-85cqV9en4-iB0WihgWUxvDuS_FA)
 *       └─ 院長_現金            (1FqW5nyWdgaML_L07GgHSNrGGFmzvOWNS)
 *   └─ 📁 明細 (1AaTu6wqzxB4rTudsFqeonuaq7JlsF3mY)
 *       ├─ 明細CSV_院長_M-AMEX     (1bQvHSpAC04OrVsRbPqasfVueHX4g17Ar)
 *       ├─ 明細CSV_院長_A-AMEX     (1-Dwdn68peDf6enummI_pbxuGOtZxaETb)
 *       ├─ 明細CSV_院長_個人LC     (1OaG9-_jWYOBd6aKHKUVoo4av9vb5nxHe)
 *       ├─ 明細CSV_法人LC          (1QfLDB6ameZUG0tvBb40XKLwUf-WqqzDR)
 *       └─ 明細CSV_院長_セゾン・DC (1U6e28HzZn6KYanQWX46Jj78phJ0zKhAE)
 *
 * 📁 副院長フォルダ (18zuti8hN-4-f52UBYrYoqLfDBFe0bPor)
 *   └─ 📁 レシート (14QIGwWQHdn6ir-ikwgsVZg9KgBh27gjR)
 *       ├─ 麻記子_M-AMEX            (1aPWJVHh5iN4fBvKwPJKIMDj5QyqetBvY)
 *       ├─ 麻記子_A-AMEX            (1XEcntiqJA5M7juySFFOeQ5PW1Ir69Dt3)
 *       ├─ 麻記子_DC(JAL)           (1j7wfgMNo1vjwK8DEFOQ16H5uCQaASj67)
 *       ├─ 麻記子_楽天              (1ceOj8aEprH3iQZVAbEIZFFzKp5ceJJS8)
 *       ├─ 麻記子_大丸              (10tk6rHz0I0faDXj7cYFBTzwfvNIiTRgv)
 *       ├─ 麻記子_ポケット(ファミマ) (1nHWddWB5iMeVayVIQOM6xQ6DUXWTVXkd)
 *       └─ 麻記子_現金              (1NekXxy8DXIS4oxq8lH_BsjBGvhWSnNlE)
 *   └─ 📁 明細 (1zR8qq_CaJKYh3i5rDy8293G2oIeYZGyU)
 *       ├─ 明細CSV_麻記子_M-AMEX               (1vvJbIvpq0MVxfWJE9btF4mrhvDDQ9q-9)
 *       ├─ 明細CSV_麻記子_A-AMEX               (1AYgNMdPHppbbCg4Fdw0MHfaTAkhR1H9z)
 *       └─ 明細CSV_麻記子_楽天・大丸・ポケット・DC (1wfKb3FPYQ1_PFL2NbA0z_D_osiOlLoc3)
 */

// ===== フォルダID定義 =====
const FOLDERS = {
  REC: {
    "院長_M-AMEX":               "1lTShDGN-mRZHA34Aawsc8LSKMcZn5EAN",
    "院長_A-AMEX":               "1yE4rMETDeCQKUviwRrCzx-phStmJO1gc",
    "院長_個人LC":               "1NFwXnq9iKpI8aCHmLTg7d-0F35ufRK4d",
    "院長_法人LC":               "1VFSh7X4W7uEmTtMuQF8AiRpFI6vtKbVk",
    "院長_セゾン":               "1ed_-kzUN3q5YrCQ6lgEmkUx51sxqaTxc",
    "院長_DC(JAL)":              "1bm9B-85cqV9en4-iB0WihgWUxvDuS_FA",
    "院長_現金":                 "1FqW5nyWdgaML_L07GgHSNrGGFmzvOWNS",
    "麻記子_M-AMEX":             "1aPWJVHh5iN4fBvKwPJKIMDj5QyqetBvY",
    "麻記子_A-AMEX":             "1XEcntiqJA5M7juySFFOeQ5PW1Ir69Dt3",
    "麻記子_DC(JAL)":            "1j7wfgMNo1vjwK8DEFOQ16H5uCQaASj67",
    "麻記子_楽天":               "1ceOj8aEprH3iQZVAbEIZFFzKp5ceJJS8",
    "麻記子_大丸":               "10tk6rHz0I0faDXj7cYFBTzwfvNIiTRgv",
    "麻記子_ポケット(ファミマ)":  "1nHWddWB5iMeVayVIQOM6xQ6DUXWTVXkd",
    "麻記子_現金":               "1NekXxy8DXIS4oxq8lH_BsjBGvhWSnNlE",
  },
  CSV: {
    "院長_M-AMEX":                    "1bQvHSpAC04OrVsRbPqasfVueHX4g17Ar",
    "院長_A-AMEX":                    "1-Dwdn68peDf6enummI_pbxuGOtZxaETb",
    "院長_個人LC":                    "1OaG9-_jWYOBd6aKHKUVoo4av9vb5nxHe",
    "院長_法人LC":                    "1QfLDB6ameZUG0tvBb40XKLwUf-WqqzDR",
    "院長_セゾン・DC":                "1U6e28HzZn6KYanQWX46Jj78phJ0zKhAE",
    "麻記子_M-AMEX":                  "1vvJbIvpq0MVxfWJE9btF4mrhvDDQ9q-9",
    "麻記子_A-AMEX":                  "1AYgNMdPHppbbCg4Fdw0MHfaTAkhR1H9z",
    "麻記子_楽天・大丸・ポケット・DC": "1wfKb3FPYQ1_PFL2NbA0z_D_osiOlLoc3",
  },
};

// 突合設定
const MATCH_TOLERANCE_YEN = 0;
const DATE_TOLERANCE_DAYS = 3;
const LOCK_WAIT_MS = 1000;

// シート名
const SH = {
  RECEIPT: "レシート一覧",
  STMT:    "カード明細一覧",
  RESULT:  "突合結果",
  MASTER:  "設定・マスタ",
};

// 列数（DriveファイルID列を末尾に追加）
const RECEIPT_COLS = 12;  // 12列目: DriveファイルID
const STMT_COLS    = 8;   //  8列目: DriveファイルID

// 突合ステータス
const STATUS = {
  MATCH:     "✅ 一致",
  DUPLICATE: "候補重複（手動確認）",
  NO_STMT:   "❌ 未一致（レシートあり・明細なし）",
  NO_RECEIPT:"⚠️ 明細のみ（レシート欠落）",
  OCR_BAD:   "⚠️ OCR読取不完全",
};

// CSVヘッダー候補
const COL_MAP = {
  date:   ["ご利用日", "利用日", "取引日", "date"],
  amount: ["金額", "ご請求金額", "利用金額", "請求金額", "amount"],
  store:  ["ご利用内容", "利用内容", "利用店名", "店舗名", "description"],
};

// ===== メニュー =====
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🦷 突合システム")
    .addItem("① レシートOCR読込",   "runAllOCR")
    .addSeparator()
    .addItem("② カード明細CSV読込", "runAllCSV")
    .addSeparator()
    .addItem("③ 突合実行",          "runMatching")
    .addSeparator()
    .addItem("【初回】シート初期化", "initSheets")
    .addToUi();
}

// ===== 排他制御 =====
function withLock_(label, fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    SpreadsheetApp.getUi().alert(
      "⏳ 別の処理（OCR・CSV取込・突合）が実行中です。\n終了してから「" + label + "」を再実行してください。"
    );
    return;
  }
  try { return fn(); }
  finally { lock.releaseLock(); }
}

// ===== シート初期化 =====
function initSheets() {
  withLock_("シート初期化", initSheets_);
}

function initSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const defs = [
    {
      name: SH.RECEIPT, color: "#1a73e8",
      headers: ["#","ファイル名","担当者","カード種別","読取日付","読取金額（円）",
                "通貨","原価金額","店舗名（OCR）","OCRテキスト抜粋","ステータス","DriveファイルID"],
    },
    {
      name: SH.STMT, color: "#0f9d58",
      headers: ["#","担当者","カード種別","利用日","金額（円）","利用内容・店舗名","取込元ファイル","DriveファイルID"],
    },
    {
      name: SH.RESULT, color: "#37474f",
      headers: ["#","ステータス","担当者","カード種別",
                "レシート日付","レシート金額","明細日付","明細金額",
                "店舗名（レシート）","店舗名（明細）","ファイル名","備考"],
    },
    {
      name: SH.MASTER, color: "#5f6368",
      headers: ["項目","値","備考"],
    },
  ];

  // 既存データ行が1行でもあれば初期化しない（本番データ保護）
  const withData = defs
    .map(d => ss.getSheetByName(d.name))
    .filter(sh => sh && sh.getLastRow() > 1)
    .map(sh => sh.getName());
  if (withData.length) {
    SpreadsheetApp.getUi().alert(
      "⛔ 初期化を中止しました。\n\n既存データ行があるシート:\n・" + withData.join("\n・") +
      "\n\nデータを消さないため、初期化は空のシートでのみ実行できます。"
    );
    return;
  }

  defs.forEach(d => {
    const sh = ss.getSheetByName(d.name) || ss.insertSheet(d.name);
    sh.clearContents();
    sh.getRange(1, 1, 1, d.headers.length)
      .setValues([d.headers])
      .setBackground(d.color)
      .setFontColor("#ffffff")
      .setFontWeight("bold");
    sh.setFrozenRows(1);
  });

  ss.getSheetByName(SH.MASTER).getRange("A2:C5").setValues([
    ["MATCH_TOLERANCE", MATCH_TOLERANCE_YEN, "突合許容誤差（円）"],
    ["LAST_OCR",        "",                  "最終OCR実行日時"],
    ["LAST_MATCH",      "",                  "最終突合実行日時"],
    ["LAST_CSV",        "",                  "最終CSV取込日時"],
  ]);

  SpreadsheetApp.getUi().alert(
    "✅ シート初期化完了\n\n" +
    "【月次の作業手順】\n" +
    "1. レシートをカード別・日付順に仕分け\n" +
    "2. スキャンして対応レシートフォルダへ格納\n" +
    "3. 「① レシートOCR読込」実行\n" +
    "─────────────────\n" +
    "4. カード明細CSV（UTF-8）を対応明細フォルダへ格納\n" +
    "5. 「② カード明細CSV読込」実行\n" +
    "6. 「③ 突合実行」実行"
  );
}

// ===== ① レシートOCR読込 =====
function runAllOCR() {
  withLock_("① レシートOCR読込", runAllOCR_);
}

function runAllOCR_() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SH.RECEIPT);

  const existing = new Set(existingIds_(sheet, RECEIPT_COLS));
  const allRows = [];
  let idx = sheet.getLastRow() > 1 ? sheet.getLastRow()-1 : 0;

  Object.entries(FOLDERS.REC).forEach(([folderKey, folderId]) => {
    const { person, card } = splitKey_(folderKey);

    let folder;
    try { folder = DriveApp.getFolderById(folderId); }
    catch(e) { Logger.log("フォルダ取得失敗: " + folderKey); return; }

    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const id   = file.getId();
      const mime = file.getMimeType();
      if (!["image/jpeg","image/png","image/gif","application/pdf"].includes(mime)) continue;
      if (existing.has(id)) continue;
      existing.add(id);

      let ocrText = "";
      try { ocrText = doDriveOCR(file); }
      catch(e) { ocrText = "[OCRエラー:" + e.message + "]"; }

      const p = parseReceipt(ocrText);
      allRows.push([
        ++idx, file.getName(), person, card,
        p.date||"", p.amount||"", p.currency||"JPY", p.origAmount||"",
        p.store||"", ocrText.substring(0, 400), "未突合", id,
      ]);
    }
  });

  if (!allRows.length) {
    SpreadsheetApp.getUi().alert("新規レシートが見つかりませんでした。"); return;
  }
  sheet.getRange(sheet.getLastRow()+1, 1, allRows.length, RECEIPT_COLS).setValues(allRows);
  setMaster_(ss, "LAST_OCR");
  SpreadsheetApp.getUi().alert("✅ レシートOCR完了\n" + allRows.length + "件を読み込みました。");
}

// Google Drive OCR（一時ドキュメントは必ずゴミ箱へ）
function doDriveOCR(file) {
  const tok  = ScriptApp.getOAuthToken();
  const b    = "wada_b";
  const meta = JSON.stringify({
    name: "ocr_tmp_" + Date.now(),
    mimeType: "application/vnd.google-apps.document"
  });
  const body =
    "--"+b+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"+meta+
    "\r\n--"+b+"\r\nContent-Type: "+file.getMimeType()+
    "\r\nContent-Transfer-Encoding: base64\r\n\r\n"+
    Utilities.base64Encode(file.getBlob().getBytes())+
    "\r\n--"+b+"--";

  const up = UrlFetchApp.fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocrLanguage=ja",
    { method:"post", headers:{ Authorization:"Bearer "+tok },
      contentType:"multipart/related; boundary="+b, payload:body, muteHttpExceptions:true }
  );
  if (up.getResponseCode() >= 300) {
    throw new Error("Drive OCR 失敗 HTTP " + up.getResponseCode());
  }
  const id = JSON.parse(up.getContentText()).id;
  try {
    return DocumentApp.openById(id).getBody().getText().trim();
  } finally {
    try { DriveApp.getFileById(id).setTrashed(true); } catch(_) {}
  }
}

// OCRテキスト解析
function parseReceipt(text) {
  const r = { date:"", amount:"", currency:"JPY", origAmount:"", store:"" };
  if (!text) return r;

  for (const p of [
    /(?:合計|お買上げ合計|total)[^\d]*([0-9,，]+)/i,
    /¥([0-9,，]+)/,
    /([0-9,，]+)円/,
  ]) {
    const m = text.match(p);
    if (m) { r.amount = parseInt(m[1].replace(/[,，]/g,""), 10); break; }
  }
  for (const p of [
    /(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/,
    /令和\s*(\d+)年\s*(\d{1,2})月\s*(\d{1,2})日/,
  ]) {
    const m = text.match(p);
    if (m) {
      const y = p.source.includes("令和") ? 2018+parseInt(m[1], 10) : m[1];
      r.date = y+"/"+String(m[2]).padStart(2,"0")+"/"+String(m[3]).padStart(2,"0");
      break;
    }
  }
  const cur = text.match(/USD|EUR|GBP|THB|CNY/i);
  if (cur) {
    r.currency = cur[0].toUpperCase();
    const fa = text.match(/([0-9,.]+)\s*(?:USD|EUR|GBP|THB)/i);
    if (fa) r.origAmount = fa[1];
  }
  const lines = text.split("\n").map(l=>l.trim()).filter(l=>l.length>2);
  if (lines.length) r.store = lines[0].substring(0, 50);
  return r;
}

// ===== ② カード明細CSV読込 =====
function runAllCSV() {
  withLock_("② カード明細CSV読込", runAllCSV_);
}

function runAllCSV_() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SH.STMT);

  const existing = new Set(existingIds_(sheet, STMT_COLS));
  let idx = sheet.getLastRow() > 1 ? sheet.getLastRow()-1 : 0;
  const allRows = [];
  const failed  = [];

  Object.entries(FOLDERS.CSV).forEach(([folderKey, folderId]) => {
    const { person, card } = splitKey_(folderKey);

    let folder;
    try { folder = DriveApp.getFolderById(folderId); }
    catch(e) { failed.push(folderKey + "（フォルダ取得失敗）"); return; }

    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const name = file.getName();
      const id   = file.getId();
      if (!name.toLowerCase().endsWith(".csv")) continue;
      if (existing.has(id)) continue;

      const rows = csvToStatementRows(file.getBlob().getDataAsString("UTF-8"));
      if (rows.error) {
        failed.push(name + "（" + rows.error + "）");
        Logger.log("[列判定失敗] " + name + " " + rows.error);
        continue;
      }
      existing.add(id);
      rows.forEach(r => allRows.push([++idx, person, card, r.date, r.amount, r.store, name, id]));
    }
  });

  if (allRows.length) {
    sheet.getRange(sheet.getLastRow()+1, 1, allRows.length, STMT_COLS).setValues(allRows);
  }
  setMaster_(ss, "LAST_CSV");
  SpreadsheetApp.getUi().alert(
    "✅ カード明細CSV読込完了\n計" + allRows.length + "件" +
    (failed.length ? "\n\n⚠️ 読み込めなかったファイル:\n・" + failed.join("\n・") : "") +
    "\n\n続けて「③ 突合実行」を実行してください。"
  );
}

// CSVテキスト → 明細行。列が特定できない場合は { error } を返す（0件で黙殺しない）
function csvToStatementRows(text) {
  const parsed = parseCSV(text);
  if (parsed.length < 2) return { error: "データ行なし" };

  const headers = parsed[0].map(h => String(h).replace(/^﻿/, "").trim().toLowerCase());
  const dIdx = findCol(headers, COL_MAP.date);
  const aIdx = findCol(headers, COL_MAP.amount);
  const sIdx = findCol(headers, COL_MAP.store);
  if (dIdx === -1 || aIdx === -1) {
    return { error: "日付または金額の列が見つかりません headers=" + headers.join(",") };
  }

  const out = [];
  for (let i = 1; i < parsed.length; i++) {
    const row = parsed[i];
    const dt  = String(row[dIdx] || "").trim();
    const amt = Number(String(row[aIdx] || "").replace(/[,，¥￥\s]/g, ""));
    const st  = sIdx >= 0 ? String(row[sIdx] || "").trim() : "";
    if (!dt && !amt) continue;
    out.push({ date: dt, amount: isNaN(amt) ? 0 : amt, store: st });
  }
  return out;
}

// ===== ③ 突合実行 =====
function runMatching() {
  withLock_("③ 突合実行", runMatching_);
}

function runMatching_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const recSheet  = ss.getSheetByName(SH.RECEIPT);
  const stmtSheet = ss.getSheetByName(SH.STMT);
  const resSheet  = ss.getSheetByName(SH.RESULT);

  if (resSheet.getLastRow() > 1) resSheet.deleteRows(2, resSheet.getLastRow()-1);

  const receipts = recSheet.getLastRow() > 1
    ? recSheet.getRange(2,1,recSheet.getLastRow()-1,RECEIPT_COLS).getValues()
        .filter(r=>r[1])
        .map(r=>({ filename:r[1], person:r[2], card:r[3],
                   date:r[4], amount:r[5], store:r[8], fileId:r[11] }))
    : [];

  const stmts = stmtSheet.getLastRow() > 1
    ? stmtSheet.getRange(2,1,stmtSheet.getLastRow()-1,STMT_COLS).getValues()
        .filter(r=>r[3]||r[4])
        .map(r=>({ person:r[1], card:r[2], date:r[3], amount:r[4], store:r[5] }))
    : [];

  const results = matchReceipts(receipts, stmts);

  if (results.length) {
    resSheet.getRange(2,1,results.length,results[0].length).setValues(results);
    colorResults(resSheet, results);
  }
  updateReceiptStatus(recSheet, results);
  setMaster_(ss, "LAST_MATCH");

  SpreadsheetApp.getUi().alert(
    "✅ 突合完了\n\n" +
    "一致:         " + countStatus_(results, STATUS.MATCH)      + "件\n" +
    "候補重複:     " + countStatus_(results, STATUS.DUPLICATE)  + "件\n" +
    "未一致:       " + countStatus_(results, STATUS.NO_STMT)    + "件\n" +
    "レシート欠落: " + countStatus_(results, STATUS.NO_RECEIPT) + "件\n" +
    "OCR不完全:    " + countStatus_(results, STATUS.OCR_BAD)    + "件\n\n" +
    "※ 店舗名は自動突合の条件に含めていません。一致でも原本を確認してください。"
  );
}

/**
 * 突合ロジック本体（シートに依存しない）
 * - 同一人物・同一カード・金額差 ≤ MATCH_TOLERANCE_YEN・日付差 ≤ DATE_TOLERANCE_DAYS を候補とする
 * - 候補が1件だけ → 一致
 * - 候補が複数   → 候補重複。候補明細はすべて予約し、後続レシートへ自動一致させない
 */
function matchReceipts(receipts, stmts) {
  const results  = [];
  const reserved = new Set();  // 一致済み or 候補重複で予約された明細

  receipts.forEach(r => {
    const rDate = parseDate(r.date);
    const rAmt  = parseFloat(r.amount);
    if (!rDate || isNaN(rAmt) || rAmt===0) {
      results.push(buildRow(STATUS.OCR_BAD, r, null)); return;
    }
    const cands = [];
    stmts.forEach((s, si) => {
      if (reserved.has(si)) return;
      if (s.person !== r.person || s.card !== r.card) return;
      const sDate = parseDate(s.date);
      const sAmt  = parseFloat(s.amount);
      if (!sDate || isNaN(sAmt)) return;
      const dd = Math.abs(dayNumber_(rDate) - dayNumber_(sDate));
      const ad = Math.abs(rAmt - sAmt);
      if (dd <= DATE_TOLERANCE_DAYS && ad <= MATCH_TOLERANCE_YEN) cands.push({ s, si });
    });

    if (cands.length === 1) {
      reserved.add(cands[0].si);
      results.push(buildRow(STATUS.MATCH, r, cands[0].s));
    } else if (cands.length > 1) {
      cands.forEach(c => reserved.add(c.si));
      const note = "候補" + cands.length + "件: " +
        cands.map(c => fmtDate_(parseDate(c.s.date)) + " " + c.s.amount + "円 " + c.s.store).join(" / ");
      results.push(buildRow(STATUS.DUPLICATE, r, null, note));
    } else {
      results.push(buildRow(STATUS.NO_STMT, r, null));
    }
  });

  stmts.forEach((s, si) => {
    if (!reserved.has(si)) results.push(buildRow(STATUS.NO_RECEIPT, null, s));
  });
  return results;
}

// ===== ユーティリティ =====
function buildRow(status, r, s, note) {
  return [
    "", status,
    r ? r.person   : (s ? s.person : ""),
    r ? r.card     : (s ? s.card   : ""),
    r ? r.date     : "", r ? r.amount : "",
    s ? s.date     : "", s ? s.amount : "",
    r ? r.store    : "", s ? s.store  : "",
    r ? r.filename : "", note || "",
  ];
}

function countStatus_(results, status) {
  return results.filter(r => r[1] === status).length;
}

function colorResults(sheet, results) {
  const nums = results.map((_, i) => [i+1]);
  sheet.getRange(2, 1, results.length, 1).setValues(nums);
  const bgs = results.map(r => {
    const color =
      r[1]===STATUS.MATCH      ? "#e6f4ea" :
      r[1]===STATUS.DUPLICATE  ? "#e8f0fe" :
      r[1]===STATUS.NO_STMT    ? "#fce8e6" :
      r[1]===STATUS.NO_RECEIPT ? "#fef7e0" : "#f3e8fd";
    return r.map(() => color);
  });
  sheet.getRange(2, 1, results.length, results[0].length).setBackgrounds(bgs);
}

function updateReceiptStatus(sheet, results) {
  if (!sheet || sheet.getLastRow()<2) return;
  const n     = sheet.getLastRow()-1;
  const files = sheet.getRange(2,2,n,1).getValues();
  const cur   = sheet.getRange(2,11,n,1).getValues();
  const map   = {};
  results.forEach(r=>{ if(r[10]) map[r[10]]=r[1]; });
  const next = files.map((row,i)=>[map[row[0]] || cur[i][0]]);
  sheet.getRange(2,11,n,1).setValues(next);
}

function existingIds_(sheet, col) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, col, sheet.getLastRow()-1, 1).getValues().flat().filter(String);
}

function splitKey_(folderKey) {
  const sep = folderKey.indexOf("_");
  return { person: folderKey.substring(0, sep), card: folderKey.substring(sep + 1) };
}

function setMaster_(ss, key) {
  const sh = ss.getSheetByName(SH.MASTER);
  const keys = sh.getRange(2, 1, Math.max(sh.getLastRow()-1, 1), 1).getValues().flat();
  const i = keys.indexOf(key);
  const row = i >= 0 ? i + 2 : sh.getLastRow() + 1;
  if (i < 0) sh.getRange(row, 1).setValue(key);
  sh.getRange(row, 2).setValue(new Date().toLocaleString("ja-JP"));
}

// 日付解析: Date型・"2026/04/05"・"2026-04-05"・"2026年4月5日" を受け付ける
function parseDate(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === "[object Date]") return isNaN(v.getTime()) ? null : v;
  const m = String(v).trim().match(/^(\d{4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getMonth() !== Number(m[2]) - 1) return null;
  return d;
}

function dayNumber_(d) {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

function fmtDate_(d) {
  if (!d) return "";
  return d.getFullYear() + "/" + String(d.getMonth()+1).padStart(2,"0") + "/" + String(d.getDate()).padStart(2,"0");
}

function findCol(headers, candidates) {
  for (let i=0; i<headers.length; i++)
    for (const c of candidates)
      if (headers[i].includes(c.toLowerCase())) return i;
  return -1;
}

// RFC 4180 相当のCSV解析（引用符内のカンマ・改行・"" エスケープに対応）
function parseCSV(text) {
  const rows = [];
  let row = [], cur = "", inQ = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i+1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') {
      inQ = true;
    } else if (c === ",") {
      row.push(cur); cur = "";
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && s[i+1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some(v => v.trim() !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some(v => v.trim() !== "")) rows.push(row);
  return rows;
}
