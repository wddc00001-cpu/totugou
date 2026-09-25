const test = require("node:test");
const assert = require("node:assert/strict");
const { loadGs } = require("./helpers/load-gs");

const gs = loadGs(["v8/Config.gs", "v8/Lib.gs"]);
const arr = x => JSON.parse(JSON.stringify(x));

test("日付: 各形式と曖昧な形式", () => {
  assert.equal(gs.toYmd("2026/9/3"), "2026-09-03");
  assert.equal(gs.toYmd("2026年09月03日"), "2026-09-03");
  assert.equal(gs.toYmd("令和8年9月3日"), "2026-09-03");
  assert.equal(gs.toYmd("26/09/03"), "2026-09-03");
  assert.equal(gs.toYmd(new Date(2026, 8, 3)), "2026-09-03");
  assert.equal(gs.toYmd("2026/02/30"), "");
  assert.deepEqual(arr(gs.findDates("13/09/2026")), ["2026-09-13"]);
  assert.deepEqual(arr(gs.findDates("03/09/2026")), [], "日/月が曖昧な形式は採用しない");
  assert.deepEqual(arr(gs.findDates("Sep 3, 2026")), ["2026-09-03"]);
  assert.equal(gs.addMonths("2026-12", 1), "2027-01");
  assert.equal(gs.dayDiff("2026-08-30", "2026-09-02"), 3);
});

test("金額: 表記ゆれ", () => {
  assert.equal(gs.parseAmount("¥1,200"), 1200);
  assert.equal(gs.parseAmount("1,200円"), 1200);
  assert.equal(gs.parseAmount("12,000-"), 12000);
  assert.equal(gs.parseAmount("(1,200)"), -1200);
  assert.equal(gs.parseAmount("△500"), -500);
  assert.equal(gs.parseAmount("１，２００"), 1200, "全角");
  assert.ok(isNaN(gs.parseAmount("abc")));
});

test("月フォルダ名とカード名判定", () => {
  assert.equal(gs.parseMonthFolderName("2026-09"), "2026-09");
  assert.equal(gs.parseMonthFolderName("2026年9月"), "2026-09");
  assert.equal(gs.parseMonthFolderName("202609"), "2026-09");
  assert.equal(gs.parseMonthFolderName("9月分"), "");
  const methods = ["楽天", "大丸", "ポケット（ファミマ）", "DC(JAL)"];
  assert.equal(gs.detectMethodFromName("2026-09_楽天.csv", methods, gs.METHOD_ALIASES).method, "楽天");
  assert.equal(gs.detectMethodFromName("famima_202609.csv", methods, gs.METHOD_ALIASES).method, "ポケット（ファミマ）");
  assert.equal(gs.detectMethodFromName("明細.csv", methods, gs.METHOD_ALIASES).method, "");
  assert.equal(gs.detectMethodFromName("楽天_大丸.csv", methods, gs.METHOD_ALIASES).method, "", "2つ当たれば特定しない");
});

test("レシート解析: 1枚", () => {
  const r = gs.parseReceiptText("ローソン 徳島店\nTEL 088-000-0000\n2026/09/03 12:01\n合計 3点 ¥1,200\n(内消費税 ¥88)\nお預り ¥2,000\nお釣り ¥800");
  assert.equal(r.amount, 1200);
  assert.equal(r.date, "2026-09-03");
  assert.equal(r.merchant, "ローソン 徳島店");
  assert.equal(r.currency, "JPY");
});

test("レシート解析: 合計が次行に分かれる OCR", () => {
  const r = gs.parseReceiptText("ガスト\n2026年9月5日\n合計\n¥2,500\n");
  assert.equal(r.amount, 2500);
});

test("レシート解析: 1ページ2枚は自動で選ばない", () => {
  const r = gs.parseReceiptText("店A\n2026/09/04\n合計 ¥1,000\n店B\n2026/09/05\n合計 ¥2,000");
  assert.equal(r.amount, "");
  assert.match(r.notes.join(), /複数の合計金額/);
});

test("レシート解析: 外貨と、円・外貨混在", () => {
  const th = gs.parseReceiptText("JAI LEE SHOP\n13/03/2026\nTotal THB 1,250.00");
  assert.equal(th.currency, "THB");
  assert.equal(th.amount, 1250);
  const mix = gs.parseReceiptText("SHOP\n2026/03/10\nTotal USD 10.00\n¥1,500");
  assert.equal(mix.amount, "", "通貨が確定できなければ金額は空");
});

test("原本区分: ファイル名で紙レシート／ダウンロードを判定", () => {
  const pat = "領収|請求|invoice|receipt|download|ダウンロード|DL_";
  assert.equal(gs.detectSourceType("院長_M-AMEX_2026-09.pdf", pat), "紙レシート（スキャン）");
  assert.equal(gs.detectSourceType("BIGLOBE_請求書_202609.pdf", pat), "ダウンロード（領収書・請求書）");
  assert.equal(gs.detectSourceType("Anthropic Invoice-1234.pdf", pat), "ダウンロード（領収書・請求書）");
  assert.equal(gs.detectSourceType("x.pdf", "[壊れた"), "紙レシート（スキャン）", "不正な正規表現でも止まらない");
});

test("カード番号マスク", () => {
  assert.equal(gs.maskSensitive("カード 4980 1234 5678 9012"), "カード ****9012");
  assert.equal(gs.maskSensitive("TEL 088-123-4567"), "TEL 088-123-4567");
});

test("カード明細: 前置き行・必須列不足・返金", () => {
  const m = gs.DEFAULT_CARD_MASTER_ROW;
  const rows = gs.parseCsv(
    "カード名称,M-AMEX\nお支払日,2026/10/10\n\nご利用日,ご利用店名,ご利用金額,現地通貨額,通貨\n" +
    "2026/09/03,ローソン,\"1,200\",,\n2026/09/15,AMAZON 返品,-3000,,\n2026/09/20,JAI LEE,5631,\"1,250.00\",THB\n,合計,3831,,\n");
  const res = gs.extractStatementRows(rows, m);
  assert.equal(res.error, undefined);
  assert.equal(res.rows.length, 3, "合計行は除外");
  assert.equal(res.rows[0].amount, 1200);
  assert.equal(res.rows[1].special, "返金");
  assert.equal(res.rows[2].foreign_amount, 1250);
  assert.equal(res.rows[2].foreign_currency, "THB");
  const bad = gs.extractStatementRows(gs.parseCsv("店名,備考\nA,B\n"), m);
  assert.match(bad.error, /必須列が見つかりません/);
});

// ===== 突合エンジン =====

const K = { R: "レシート/領収書/請求書", S: "カード明細" };
let seq = 0;
const R = (date, amount, o = {}) => ({ id: "R" + ++seq, kind: K.R, person: "院長", method: "M-AMEX",
  target_month: "2026-09", orig_date: date, orig_amount: amount, currency: "JPY", orig_merchant: "店", ...o });
const S = (date, amount, o = {}) => ({ id: "S" + ++seq, kind: K.S, person: "院長", method: "M-AMEX",
  target_month: "2026-09", orig_date: date, orig_amount: amount, currency: "JPY", orig_merchant: "店", ...o });
const settings = { dateTolerance: 3, amountPct: 20, dateWindow: 45, graceMonths: 1 };
const run = (transactions, matches = [], today = "2026-09-25", extra = {}) =>
  gs.runMatchingEngine({ transactions, matches, settings, tolByMethod: {}, cardMethodsByPerson: { "院長": ["M-AMEX", "個人LC"] }, today, ...extra });

test("突合: 1対1は一致候補（未承認）、店舗名差は理由に残す", () => {
  const r = R("2026-09-03", 1200, { orig_merchant: "ローソン" }), s = S("2026-09-05", 1200, { orig_merchant: "セブンイレブン" });
  const out = run([r, s]);
  assert.equal(out.states[r.id].state, "一致候補");
  assert.equal(gs.merchantEval("ローソン", "ﾛｰｿﾝ 徳島店"), "一致", "NFKC正規化で半角カナも同一視");
  assert.match(out.states[r.id].state_reason, /店舗名差あり/);
  assert.equal(out.states[s.id].state, "一致候補");
  assert.equal(out.candidates.length, 1);
});

test("突合: 同額同日の候補が複数なら候補重複（自動選択しない）", () => {
  const r = R("2026-09-10", 650), s1 = S("2026-09-10", 650), s2 = S("2026-09-10", 650);
  const out = run([r, s1, s2]);
  assert.equal(out.states[r.id].state, "候補重複");
  assert.equal(out.states[s1.id].state, "候補重複");
  assert.equal(out.candidates.filter(c => c.kind === "候補重複").length, 2);
});

test("突合: 明細1件にレシート2件も候補重複", () => {
  const r1 = R("2026-09-10", 650), r2 = R("2026-09-11", 650), s = S("2026-09-10", 650);
  const out = run([r1, r2, s]);
  assert.equal(out.states[r1.id].state, "候補重複");
  assert.equal(out.states[r2.id].state, "候補重複");
});

test("突合: 人物・支払手段が違う明細は候補にしない", () => {
  const r = R("2026-09-03", 1200), s = S("2026-09-03", 1200, { method: "個人LC" });
  const out = run([r, s]);
  assert.notEqual(out.states[r.id].state, "一致候補");
  assert.equal(out.candidates.length, 0);
});

test("突合: 金額不一致・日付要確認・返金は自動確定しない", () => {
  const r1 = R("2026-09-12", 5800), s1 = S("2026-09-12", 5000);
  const r2 = R("2026-08-01", 3000), s2 = S("2026-08-20", 3000);
  const s3 = S("2026-09-15", -3000), r3 = R("2026-09-15", 3000);
  const out = run([r1, s1, r2, s2, s3, r3]);
  assert.equal(out.states[r1.id].state, "金額不一致");
  assert.equal(out.states[s1.id].state, "金額不一致");
  assert.equal(out.states[r2.id].state, "日付要確認");
  assert.equal(out.states[s3.id].state, "未突合");
  assert.match(out.states[s3.id].state_reason, /返金/);
});

test("突合: 修正値があれば修正値で突合", () => {
  const r = R("2026-09-12", 5800, { corr_amount: 5000 }), s = S("2026-09-12", 5000);
  assert.equal(run([r, s]).states[r.id].state, "一致候補");
});

test("突合: 明細期間より後のレシートは翌月確認 → 猶予超過で期限超過", () => {
  const s = S("2026-09-20", 100), r = R("2026-09-28", 5500);
  const out = run([s, r]);
  assert.equal(out.states[r.id].state, "翌月確認");
  assert.equal(out.states[r.id].next_check_month, "2026-10");
  const later = run([s, { ...r, state: "翌月確認", next_check_month: "2026-10" }], [], "2026-12-05");
  assert.equal(later.states[r.id].state, "期限超過");
  const covered = run([s, S("2026-10-20", 1), r]);
  assert.equal(covered.states[r.id].state, "未突合", "明細期間内で該当なし");
});

test("突合: 承認済み・却下の判断は再突合で変わらない", () => {
  const r = R("2026-09-03", 1200), s = S("2026-09-03", 1200);
  const approved = run([r, s], [{ match_id: "M1", receipt_id: r.id, statement_id: s.id, status: "承認済み" }]);
  assert.equal(approved.states[r.id].state, "承認済み");
  assert.equal(approved.candidates.length, 0);
  const rejected = run([r, s], [{ match_id: "M1", receipt_id: r.id, statement_id: s.id, status: "却下" }]);
  assert.notEqual(rejected.states[r.id].state, "一致候補", "却下したペアは再び候補にしない");
});

test("突合: 現金・不明・外貨・OCR欠落", () => {
  const cash = R("2026-09-03", 500, { method: "現金" });
  const unk = R("2026-09-03", 1200, { method: "不明" });
  const s = S("2026-09-04", 1200);
  const unk2 = R("2026-09-03", 777, { method: "不明" });
  const fx = R("2026-09-03", 12.5, { currency: "USD" });
  const sfx = S("2026-09-04", 1890, { foreign_amount: 12.5, foreign_currency: "USD" });
  const fx2 = R("2026-09-03", 40, { currency: "USD" });
  const bad = R("", "", { ocr_note: "合計金額を特定できません" });
  const out = run([cash, unk, s, unk2, fx, sfx, fx2, bad]);
  assert.equal(out.states[cash.id].state, "未突合");
  assert.equal(out.states[unk.id].state, "分類要確認");
  assert.match(out.states[unk.id].state_reason, /M-AMEX/);
  assert.equal(out.states[unk2.id].state, "翌月確認", "個人LCの明細が未到達");
  assert.equal(out.states[fx.id].state, "一致候補", "外貨は外貨額で一致");
  assert.equal(out.states[fx2.id].state, "外貨要確認");
  assert.equal(out.states[bad.id].state, "OCR要確認");
  assert.equal(out.states[bad.id].state_reason, "合計金額を特定できません");
});

test("突合: 旧版の取引は対象外", () => {
  const r = R("2026-09-03", 1200, { superseded: true }), s = S("2026-09-03", 1200);
  const out = run([r, s]);
  assert.equal(out.states[r.id], undefined);
  assert.equal(out.states[s.id].state, "未突合");
});

test("数式インジェクション防止", () => {
  const g = loadGs(["v8/Config.gs", "v8/Lib.gs", "v8/Store.gs"]);
  assert.equal(g.plainCell_("=HYPERLINK(\"x\")"), "'=HYPERLINK(\"x\")");
  assert.equal(g.plainCell_("ローソン"), "ローソン");
  assert.equal(g.plainCell_(1200), 1200);
});

test("1ファイル版 dist/V8_all.gs が v8/ と一致し、単体で読み込める", () => {
  const fs = require("node:fs");
  const { execFileSync } = require("node:child_process");
  const path = require("node:path");
  const dist = path.join(__dirname, "..", "dist", "V8_all.gs");
  const before = fs.readFileSync(dist, "utf8");
  execFileSync("node", [path.join(__dirname, "..", "scripts", "build.js")]);
  assert.equal(fs.readFileSync(dist, "utf8"), before, "npm run build を実行してから commit してください");
  const g = loadGs(["dist/V8_all.gs"]);
  assert.equal(typeof g.onOpen, "function");
  assert.equal(typeof g.menuImportReceipts, "function");
});

test("重複行: 別ファイルの同一行のみ。承認済みの行を優先して残す", () => {
  const row = (id, file, date, amount, o = {}) => ({ id, file_id: file, kind: "カード明細", person: "院長", method: "M-AMEX",
    orig_date: date, orig_amount: amount, orig_merchant: "スタバ", ...o });
  const rows = [row("a1", "A", "2026-09-18", 650), row("a2", "A", "2026-09-18", 650),
    row("b1", "B", "2026-09-18", 650), row("b2", "B", "2026-09-18", 650), row("b3", "B", "2026-09-18", 650),
    row("c1", "A", "2026-09-19", 650), row("c2", "B", "2026-09-19", 651),
    row("d1", "A", "2026-09-20", 650), row("d2", "B", "2026-09-20", 650, { orig_merchant: "ｽﾀﾊﾞ" })];
  const approved = new Set(["b3"]);
  const dup = arr(gs.findDuplicateStatementRows(rows, t => approved.has(t.id)));
  assert.deepEqual(Object.keys(dup).sort(), ["b1", "b2", "d2"], "3件残す（B内の最大件数）。承認済みb3→先に取り込んだa1・a2の順");
  assert.equal(dup.d2, "d1", "半角カナも正規化して同一店とみなす");
  assert.ok(!dup.c2, "金額が1円でも違えば別取引");
  const same = [row("x1", "A", "2026-09-18", 650), row("x2", "A", "2026-09-18", 650)];
  assert.deepEqual(arr(gs.findDuplicateStatementRows(same, () => false)), {}, "同じファイル内の同一行は重複にしない");
});

// ===== 写真明細（実データの Drive OCR 結果） =====
const LC = require("./fixtures/lc-photo-ocr");

test("写真明細: 行と金額が分かれて出るページも、数が一致すれば順番で対応付ける", () => {
  const p6 = gs.parseStatementOcrText(LC.page6, "2026-08");
  assert.equal(p6.paired, true);
  assert.equal(p6.total, 3781601, "当月ご利用金額");
  const rows = p6.rows.map(r => [r.date, r.amount, r.merchant]);
  assert.deepEqual(arr(rows.slice(0, 2)), [["2026-07-01", 9405, "GOOGLE WORKSPACE WD-DC"], ["2026-07-01", 51224, "GOOGLE JAPAN"]]);
  assert.deepEqual(arr(rows[4]), ["2026-07-01", 1034, "AMAZON.CO.JP"], "店名が先にまとめて出る部分");
  assert.deepEqual(arr(rows[8]), ["2026-07-02", 12639, "カブシキガイシャアイプリー"]);
  assert.equal(p6.rows[6].amount, 2750, "「2.750」も 2,750 と読む");
  assert.match(p6.rows[6].note, /店名を読み取れません/, "日付だけの行（20090）も1行として数える");
  assert.equal(p6.rows[2].date, "", "200701（260701の誤読）は期間外なので空欄");
  assert.match(p6.rows[2].note, /読取: 200701/);
});

test("写真明細: 1ページ目（S が次行・回数列・手書きメモ）", () => {
  const p1 = gs.parseStatementOcrText(LC.page1, "2026-08");
  assert.equal(p1.paired, true);
  assert.equal(p1.total, 3781601);
  assert.deepEqual(arr(p1.rows.map(r => r.amount)), [940, 940, 173607, 4818, 908, 17093, 3628]);
  assert.equal(p1.rows[6].date, "", "260007 は存在しない日付");
  assert.ok(!p1.rows.some(r => /氏名|会員|口座/.test(r.merchant)), "見出し・個人情報の行を明細行にしない");
});

test("写真明細: 崩れたページは推測で金額を付けない", () => {
  const p5 = gs.parseStatementOcrText(LC.page5, "2026-08");
  assert.equal(p5.paired, false);
  assert.ok(p5.rows.length > 0);
  assert.ok(p5.rows.every(r => r.amount === "" && /対応付け不可/.test(r.note)));
});

test("写真明細: 1行に日付・店名・金額が並ぶ形式（ダウンロードPDF等）", () => {
  const r = gs.parseStatementOcrText("ご利用明細\n2026/09/03 ローソン 1,200\n2026/09/05 ガスト 2,500\n当月ご請求金額 3,700", "2026-09");
  assert.equal(r.paired, true);
  assert.deepEqual(arr(r.rows.map(x => [x.date, x.amount, x.merchant])),
    [["2026-09-03", 1200, "ローソン"], ["2026-09-05", 2500, "ガスト"]]);
  assert.equal(r.total, 3700);
});
