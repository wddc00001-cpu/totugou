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
    const tx = newReceiptTx_(entry, p);
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

function newReceiptTx_(entry, page) {
  return {
    id: newId_("R"), state: STATE.PENDING, state_reason: "", next_check_month: "",
    kind: KIND.RECEIPT, person: entry.person, method: entry.method, target_month: entry.target_month,
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
      kind: KIND.CARD, person: entry.person, method: entry.method, target_month: entry.target_month,
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
