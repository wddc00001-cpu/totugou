const test = require("node:test");
const assert = require("node:assert/strict");
const { loadGs } = require("./helpers/load-gs");

const gs = loadGs(["v7/Code.gs"]);

test("V7.2: 構文とメニュー関数が読み込める", () => {
  for (const fn of ["onOpen", "initSheets", "runAllOCR", "runAllCSV", "runMatching"]) {
    assert.equal(typeof gs[fn], "function", fn);
  }
});

test("V7.2: OCRテキスト解析", () => {
  const r = gs.parseReceipt("ローソン 徳島店\n2026/04/05 12:30\n合計 ¥1,200\n");
  assert.equal(r.amount, 1200);
  assert.equal(r.date, "2026/04/05");
  assert.equal(r.store, "ローソン 徳島店");
  const reiwa = gs.parseReceipt("店\n令和8年4月5日\n合計 500円");
  assert.equal(reiwa.date, "2026/04/05");
});

test("V7.2: CSV解析（引用符内カンマ・改行・エスケープ）", () => {
  const rows = gs.parseCSV('﻿利用日,利用店名,金額\r\n2026/04/05,"A,B ""店""\n2F",1200\n\n2026/04/06,C,"3,000"\n');
  assert.equal(rows.length, 3);
  assert.equal(rows[1][1], 'A,B "店"\n2F');
  const st = gs.csvToStatementRows('利用日,利用店名,金額\n2026/04/06,C,"3,000"\n');
  assert.equal(st[0].amount, 3000);
  assert.ok(gs.csvToStatementRows("店名,備考\nA,B\n").error, "必須列なしはエラーで返す");
});

test("V7.2: 日付型セル値をそのまま解析できる", () => {
  const d = gs.parseDate(new Date(2026, 3, 5));
  assert.equal(gs.fmtDate_(d), "2026/04/05");
  assert.equal(gs.parseDate("2026年4月5日").getDate(), 5);
  assert.equal(gs.parseDate("2026/02/30"), null);
});

test("V7.2: 候補1件は一致、候補複数は候補重複で後続に自動一致させない", () => {
  const R = (d, a, f) => ({ filename: f, person: "院長", card: "M-AMEX", date: d, amount: a, store: "" });
  const S = (d, a) => ({ person: "院長", card: "M-AMEX", date: d, amount: a, store: "s" + d });
  const res = gs.matchReceipts(
    [R("2026/04/05", 1000, "a"), R("2026/04/10", 500, "b"), R("2026/04/10", 500, "c")],
    [S("2026/04/06", 1000), S("2026/04/09", 500), S("2026/04/11", 500), S("2026/04/20", 9)]
  );
  const st = Object.fromEntries(res.filter(r => r[10]).map(r => [r[10], r[1]]));
  assert.equal(st.a, gs.STATUS.MATCH);
  assert.equal(st.b, gs.STATUS.DUPLICATE);
  assert.equal(st.c, gs.STATUS.NO_STMT, "候補重複で予約された明細は後続レシートへ一致させない");
  assert.equal(res.filter(r => r[1] === gs.STATUS.NO_RECEIPT).length, 1);
});

test("V7.2: 人物・カードが違う明細とは一致しない", () => {
  const res = gs.matchReceipts(
    [{ filename: "a", person: "院長", card: "M-AMEX", date: "2026/04/05", amount: 1000 }],
    [{ person: "麻記子", card: "M-AMEX", date: "2026/04/05", amount: 1000 }]
  );
  assert.equal(res[0][1], gs.STATUS.NO_STMT);
});
