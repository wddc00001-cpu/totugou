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
  return Date.now() - ctx.started > ctx.settings.timeBudgetMs - ctx.settings.reserveMs;
}

// ===== ① レシート読込（ページ単位OCR） =====

async function importReceipts_() {
  const ctx = openImportContext_();
  const report = { files: 0, pages: 0, failedPages: 0, classify: 0, errors: [], interrupted: false, folderErrors: [] };
  const batchSize = Math.max(1, ctx.settings.ocrBatch);
  let tasks = [];

  const runTasks = async () => {
    if (!tasks.length) return;
    await ocrReceiptTasks_(ctx, tasks, report);
    tasks = [];
    flushImportContext_(ctx);
  };

  outer:
  for (const item of listSourceFiles_(KIND.RECEIPT)) {
    if (item.folderError) { report.folderErrors.push(item.folderError); continue; }
    if (!RECEIPT_MIMES.includes(item.file.getMimeType())) continue;
    if (timeUp_(ctx)) { report.interrupted = true; break; }
    const reg = registerFile_(ctx, item);
    if (reg.entry.status === IMPORT_STATUS.CLASSIFY && reg.action === "skip") report.classify++;
    if (reg.action !== "process") continue;
    report.files++;
    const pages = await openReceiptPages_(ctx, item.file, reg.entry, report);
    if (!pages) continue;
    for (let p = Number(reg.entry.pages_done || 0) + 1; p <= pages.count; p++) {
      tasks.push({ entry: reg.entry, pages, p });
      if (tasks.length >= batchSize) {
        await runTasks();
        if (timeUp_(ctx)) { report.interrupted = true; break outer; }
      }
    }
  }
  if (!report.interrupted || tasks.length) await runTasks();
  flushImportContext_(ctx);
  return report;
}

async function openReceiptPages_(ctx, file, entry, report) {
  try {
    // ダウンロードした領収書・請求書（ファイル名で判定）は複数ページでも1枚の書類として読む。
    // スキャンしたPDFは1ページ = 1レシートとしてページごとに読む
    const asOneDocument = detectSourceType(entry.file_name, ctx.settings.downloadPattern) === SOURCE_TYPE.DOWNLOAD;
    const pages = file.getMimeType() === "application/pdf" && !asOneDocument
      ? await openPdfPages_(file.getBlob(), ctx.settings.pdfLibUrl)
      : (blob => ({ count: 1, page: async () => blob }))(file.getBlob());
    entry.pages_total = pages.count;
    ctx.files.touch(entry);
    return pages;
  } catch (e) {
    entry.status = IMPORT_STATUS.ERROR;
    entry.message = "PDFを開けません: " + e.message;
    ctx.files.touch(entry);
    report.errors.push(entry.file_name + ": " + entry.message);
    return null;
  }
}

// 複数ページ（複数ファイル）をまとめてOCR。各ファイルの処理済ページを進め、最終ページで完了にする
async function ocrReceiptTasks_(ctx, tasks, report) {
  const blobs = [];
  for (const t of tasks) blobs.push(await t.pages.page(t.p));
  const results = driveOcrBatch_(blobs);
  tasks.forEach((t, k) => {
    const entry = t.entry;
    const failed = String(entry.failed_pages || "").split(",").filter(Boolean);
    const tx = newReceiptTx_(entry, t.p, ctx.settings);
    const r = results[k] || { error: "結果なし" };
    if (r.error) {
      tx.ocr_status = "失敗";
      tx.ocr_note = "OCR失敗: " + r.error;
      tx.state = STATE.OCR_CHECK;
      tx.state_reason = tx.ocr_note;
      failed.push(String(t.p));
      report.failedPages++;
    } else {
      applyOcrResult_(tx, r.text);
    }
    ctx.tx.insert(tx);
    entry.pages_done = t.p;
    entry.tx_count = Number(entry.tx_count || 0) + 1;
    entry.failed_pages = failed.join(",");
    if (t.p >= t.pages.count) {
      entry.status = IMPORT_STATUS.DONE;
      entry.message = failed.length ? "OCR失敗ページ: " + failed.join(",") + "（「OCR失敗・エラーを再実行」で再試行）" : "";
    }
    ctx.files.touch(entry);
    report.pages++;
  });
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

async function importStatements_() {
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
    await processStatementFile_(ctx, item.file, reg.entry, masters.get(reg.entry.method), report);
    flushImportContext_(ctx);
  }
  report.photoChecks = checkPhotoStatementTotals_(ctx);
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

const PHOTO_STATEMENT_MIMES = ["image/jpeg", "image/png", "image/gif", "image/heic", "image/tiff", "application/pdf"];

async function processStatementFile_(ctx, file, entry, master, report) {
  if (PHOTO_STATEMENT_MIMES.includes(file.getMimeType())) return processPhotoStatement_(ctx, file, entry, master, report);
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
    entry.message = "未対応の形式です（CSV / xlsx / Googleスプレッドシート / 画像 / PDF）";
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

// ===== 写真・PDFのカード明細（Drive OCR。外部AIには送らない） =====
//
// ページごとに OCR → parseStatementOcrText。金額は「ページ内の順番」で対応付けるため、
// すべての行に「写真OCR」と明記し、突合の承認時に原本で確認する前提とする。
// 同じ月フォルダの写真明細をまとめて、読み取った金額の合計と明細に印字された合計を照合する。

async function processPhotoStatement_(ctx, file, entry, master, report) {
  let pages;
  try {
    pages = file.getMimeType() === "application/pdf"
      ? await openPdfPages_(file.getBlob(), ctx.settings.pdfLibUrl)
      : { count: 1, page: async () => file.getBlob() };
  } catch (e) {
    entry.status = IMPORT_STATUS.ERROR;
    entry.message = "PDFを開けません: " + e.message;
    ctx.files.touch(entry);
    report.errors.push(entry.file_name + ": " + entry.message);
    return;
  }
  const special = master.special_pattern ? new RegExp(master.special_pattern) : null;
  const txs = [];
  const failed = [];
  let total = "";
  // ページをまとめて並列にOCR
  const texts = [];
  const batch = Math.max(1, ctx.settings.ocrBatch);
  for (let start = 1; start <= pages.count; start += batch) {
    const blobs = [];
    for (let p = start; p < Math.min(pages.count + 1, start + batch); p++) blobs.push(await pages.page(p));
    driveOcrBatch_(blobs).forEach(r => texts.push(r));
  }
  for (let p = 1; p <= pages.count; p++) {
    let parsed;
    try {
      const r = texts[p - 1];
      if (r.error) throw new Error(r.error);
      parsed = parseStatementOcrText(r.text, entry.target_month);
    } catch (e) {
      failed.push(p + "ページ: " + e.message);
      continue;
    }
    if (parsed.total !== "" && (total === "" || parsed.total > total)) total = parsed.total;
    parsed.rows.forEach(r => {
      const note = r.note || "写真OCR: ページ内の順番で金額を対応付け（原本で確認）";
      const sp = special && (r.merchant.match(special) || [])[0];
      txs.push({
        id: newId_("S"), state: r.note ? STATE.OCR_CHECK : STATE.PENDING, state_reason: r.note, next_check_month: "",
        kind: KIND.CARD, source_type: SOURCE_TYPE.PHOTO, person: entry.person, method: entry.method,
        target_month: entry.target_month, orig_date: r.date, orig_amount: r.amount, currency: "JPY",
        orig_merchant: r.merchant, link: entry.link, page: p, row_no: r.row_no,
        foreign_amount: "", foreign_currency: "", jpy_amount: r.amount, fx_basis: "",
        special: sp || "", ocr_status: r.note ? "要確認" : "成功", ocr_note: note, evidence: "",
        file_id: entry.file_id, version: entry.version, superseded: false, created_at: nowText_(),
      });
    });
  }
  if (!txs.length && failed.length) {
    entry.status = IMPORT_STATUS.ERROR;
    entry.message = "OCR失敗: " + failed.join(" / ");
    ctx.files.touch(entry);
    report.errors.push(entry.file_name + ": " + entry.message);
    return;
  }
  txs.forEach(t => ctx.tx.insert(t));
  const need = txs.filter(t => t.state === STATE.OCR_CHECK).length;
  entry.status = IMPORT_STATUS.DONE;
  entry.pages_total = pages.count;
  entry.pages_done = pages.count;
  entry.tx_count = txs.length;
  entry.ocr_total = total;
  entry.failed_pages = failed.map(f => f.split("ページ")[0]).join(",");
  entry.message = "写真OCR: " + txs.length + "行（要確認 " + need + "行）" + (failed.length ? "／OCR失敗 " + failed.join(" / ") : "");
  ctx.files.touch(entry);
  report.rows += txs.length;
  report.photoRows = (report.photoRows || 0) + txs.length;
  report.photoNeedCheck = (report.photoNeedCheck || 0) + need;
}

/**
 * 同じ 人物・カード・対象月 の写真明細について、読み取った金額の合計と明細に印字された合計を照合する。
 * 結果は各ファイルの「メッセージ」末尾に「｜合計チェック: …」として毎回書き直す。
 */
function checkPhotoStatementTotals_(ctx) {
  const groups = {};
  ctx.files.all().filter(f => f.kind === KIND.CARD && f.status === IMPORT_STATUS.DONE &&
    PHOTO_STATEMENT_MIMES.includes(f.mime_type)).forEach(f => {
    const k = f.person + "|" + f.method + "|" + f.target_month;
    (groups[k] = groups[k] || { files: [], total: "" }).files.push(f);
    if (!isBlank_(f.ocr_total) && (groups[k].total === "" || Number(f.ocr_total) > groups[k].total)) {
      groups[k].total = Number(f.ocr_total);
    }
  });
  const out = [];
  Object.keys(groups).forEach(k => {
    const g = groups[k];
    const ids = new Set(g.files.map(f => f.file_id + "#" + f.version));
    const rows = ctx.tx.all().filter(t => ids.has(t.file_id + "#" + t.version) && !isTrue_(t.superseded));
    const known = rows.filter(t => !isBlank_(t.corr_amount) || !isBlank_(t.orig_amount));
    const sum = known.reduce((a, t) => a + (parseAmount(isBlank_(t.corr_amount) ? t.orig_amount : t.corr_amount) || 0), 0);
    const missing = rows.length - known.length;
    let msg;
    if (g.total === "") msg = "明細の合計金額を読み取れず照合できません（読取合計 " + sum.toLocaleString("ja-JP") + "円）";
    else if (sum === g.total && !missing) msg = "一致（" + sum.toLocaleString("ja-JP") + "円）";
    else msg = "不一致（読取 " + sum.toLocaleString("ja-JP") + "円 / 明細 " + g.total.toLocaleString("ja-JP") +
      "円、差 " + (g.total - sum).toLocaleString("ja-JP") + "円、金額不明 " + missing + "行）";
    g.files.forEach(f => {
      f.message = String(f.message || "").split("｜合計チェック")[0] + "｜合計チェック: " + msg;
      ctx.files.touch(f);
    });
    out.push(k.replace(/\|/g, " ") + ": " + msg);
  });
  return out;
}

// ===== レシートの読み直し（読取ルールを更新したとき） =====
// 取込済みのレシート原本を新しい処理版として読み直す。旧版の取引・判断は削除せず「旧版」として残す。

function rereadReceipts_(targetMonth) {
  const ctx = openImportContext_();
  let n = 0;
  const latest = {};
  ctx.files.all().forEach(f => {
    if (!latest[f.file_id] || Number(f.version) > Number(latest[f.file_id].version)) latest[f.file_id] = f;
  });
  Object.values(latest).filter(f => f.kind === KIND.RECEIPT && f.status === IMPORT_STATUS.DONE &&
    (!targetMonth || toYm(f.target_month) === targetMonth)).forEach(f => {
    f.status = IMPORT_STATUS.SUPERSEDED;
    ctx.files.touch(f);
    ctx.tx.all().filter(t => t.file_id === f.file_id && String(t.version) === String(f.version) && !isTrue_(t.superseded))
      .forEach(t => {
        t.superseded = true;
        ctx.tx.touch(t);
        logHistory_(ctx.hist, "取引", t.id, "旧版化", t.state, "", "レシートの読み直し");
      });
    const next = Object.assign({}, f, {
      version: Number(f.version) + 1, status: IMPORT_STATUS.PROCESSING, message: "読み直し待ち",
      pages_done: 0, failed_pages: "", tx_count: 0, imported_at: nowText_(),
    });
    delete next._i;
    ctx.files.insert(next);
    n++;
  });
  flushImportContext_(ctx);
  return n;
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
