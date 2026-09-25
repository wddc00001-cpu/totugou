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
