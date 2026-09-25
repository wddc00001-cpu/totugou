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
    STATE.NEXT_MONTH, STATE.EXPIRED, STATE.UNMATCHED, STATE.OCR_CHECK, STATE.CLASSIFY, STATE.APPROVED, STATE.REJECTED];
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
      "3. カード明細列マスタ: 実ファイルの列名に合わせてカード別の行を追加\n\n" +
      "【月次の手順】\n① レシート読込 → ② カード明細読込 → 要確認一覧・突合結果で原本確認 → 判断を反映");
  });
}
