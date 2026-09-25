/**
 * V8 画面: 突合結果・要確認一覧（台帳から毎回生成する表示用シート）
 * 判断（承認/却下）とメモは「判断を反映」で台帳へ保存してから再生成するため、手入力は失われない。
 * 未反映の判断がある状態で再生成しようとした場合は処理を止める。
 */

const RESULT_HEADERS = [
  "判断", "判断メモ", "突合ID", "候補区分", "突合状態", "人物", "支払手段", "対象月",
  "レシート日付", "レシート金額", "明細日付", "明細金額", "金額差", "日付差", "店舗名評価",
  "レシート店舗名", "明細店舗名", "レシート原本", "明細原本", "レシート取引ID", "明細取引ID",
  "判断者", "判断日時", "記録済みメモ",
];

const REVIEW_HEADERS = [
  "判断", "判断メモ", "取引ID", "状態", "状態理由", "翌月確認月", "人物", "支払手段", "対象月",
  "原本種別", "日付", "金額", "通貨", "店舗名", "原本", "ページ/行",
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

function pendingDecisionCount_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let n = 0;
  [SHEET.RESULT, SHEET.REVIEW].forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    n += sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().filter(r => !isBlank_(r[0])).length;
  });
  return n;
}

function writeView_(name, headers, rows, colors, color) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getFilter()) sh.getFilter().remove();
  sh.clear();
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground(color).setFontColor("#ffffff").setFontWeight("bold");
  sh.setFrozenRows(1);
  sh.setFrozenColumns(3);
  if (rows.length) {
    const range = sh.getRange(2, 1, rows.length, headers.length);
    range.setValues(rows.map(r => r.map((v, j) => (/原本$/.test(headers[j]) ? v : plainCell_(v)))));
    range.setBackgrounds(colors.map(c => headers.map(() => c)));
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList([DECISION.APPROVE, DECISION.REJECT], true).setAllowInvalid(false).build();
    sh.getRange(2, 1, rows.length, 1).setDataValidation(rule).setBackground("#fff8e1");
    sh.getRange(2, 2, rows.length, 1).setBackground("#fff8e1");
  }
  sh.getRange(1, 1, Math.max(rows.length, 1) + 1, headers.length).createFilter();
  return sh;
}

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
        fmtYmdJa(er.date), isFinite(er.amount) ? er.amount : "", fmtYmdJa(es.date), isFinite(es.amount) ? es.amount : "",
        m.amount_diff, m.date_diff, m.merchant_eval, er.merchant, es.merchant,
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
      revRows.push(["", "", "", f.status, f.message, "", f.person, f.method, f.target_month, f.kind,
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
        t.kind, fmtYmdJa(e.date), isFinite(e.amount) ? e.amount : "", e.currency, e.merchant,
        sourceLink_(t), t.page || t.row_no || "",
      ]);
      revColors.push(STATE_COLORS[t.state] || "#ffffff");
    });
  writeView_(SHEET.REVIEW, REVIEW_HEADERS, revRows, revColors, "#b3261e");
}
