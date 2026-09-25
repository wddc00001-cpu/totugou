// V8 受入条件（引継ぎ仕様 6章・11章）を擬似 GAS 環境で通しで確認する
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadGs } = require("./helpers/load-gs");
const { makeGas } = require("./helpers/fake-gas");

const FILES = ["Config", "Lib", "Store", "Drive", "Import", "Match", "Views", "Review", "Menu"].map(f => "v8/" + f + ".gs");
const CSV = "text/csv";
const SJIS_CSV = Buffer.from(
  "9798977093fa2c82b297989770935896bc2c82b2979897708be08a7a0d0a323032362f30392f30332cdbb0bfdd2093bf938793582c313230300d0a", "hex");

// 10ページPDF: p3 はOCR失敗、p7 は1ページに2枚
const PAGES = {
  1: "ローソン徳島店\n2026/09/03 12:01\n合計 ¥1,200",
  2: "スターバックス\n2026年9月10日\n合計 ¥650",
  3: "（再実行で読める）ENEOS 藍住\n2026/09/13\n合計 ¥3,300",
  4: "ENEOS\n2026/09/12\n合計 ¥5,800",
  5: "ホテル\n2026/09/28\n合計 ¥5,500",
  6: "コンビニ\n2026/09/01\n合計 ¥300",
  7: "店A\n2026/09/04\n合計 ¥1,000\n店B\n2026/09/05\n合計 ¥2,000",
  8: "書店\n2026/09/06\n合計 ¥1,650",
  9: "薬局\n2026/09/07\n合計 ¥980",
  10: "駐車場\n2026/09/08\n合計 ¥400",
};

function setup() {
  const env = makeGas();
  const gs = loadGs(FILES, env.globals);
  const ctx = gs.__ctx;
  let failPage3 = true;
  ctx.openPdfPages_ = async blob => ({
    count: 10,
    page: async i => ({ page: i, getName: () => blob.getName() }),
  });
  ctx.driveOcr_ = blob => {
    if (blob.page === 3 && failPage3) throw new Error("Drive OCR 失敗 HTTP 500");
    return blob.page ? PAGES[blob.page] : "";
  };
  const { drive } = env;
  const recRoot = drive.folder("REC_INCHO_MAMEX");
  const csvRoot = drive.folder("CSV_INCHO_MAMEX");
  const csvMulti = drive.folder("CSV_MAKIKO_MULTI");
  const recMonth = drive.subfolder(recRoot, "2026-09");
  const csvMonth = drive.subfolder(csvRoot, "2026-09");
  const multiMonth = drive.subfolder(csvMulti, "2026-09");
  return { env, gs, ctx, drive, recRoot, recMonth, csvRoot, csvMonth, multiMonth, fixPage3: () => { failPage3 = false; } };
}

async function init(t) {
  await t.gs.menuInit();
  const fm = t.env.ss.getSheetByName("フォルダマスタ");
  fm.grid = [fm.grid[0],
    ["REC_INCHO_MAMEX", "院長", "M-AMEX", "レシート/領収書/請求書", ""],
    ["CSV_INCHO_MAMEX", "院長", "M-AMEX", "カード明細", ""],
    ["CSV_MAKIKO_MULTI", "麻記子先生", "楽天,大丸", "カード明細", ""]];
}

const txs = t => t.env.ss.getSheetByName("取引台帳").records();
const byPage = (t, p) => txs(t).find(x => x["原本種別"] === "レシート/領収書/請求書" && Number(x["ページ"]) === p && x["旧版"] !== true);
const matches = t => t.env.ss.getSheetByName("突合台帳").records();
const lastAlert = t => t.env.alerts[t.env.alerts.length - 1];

function setCell(sheet, rowPred, header, value) {
  const h = sheet.grid[0];
  const col = h.indexOf(header);
  const r = sheet.grid.findIndex((row, i) => i > 0 && rowPred(Object.fromEntries(h.map((k, j) => [k, row[j]]))));
  assert.ok(r > 0, "行が見つかりません: " + header);
  sheet.grid[r][col] = value;
}

test("V8 受入フロー", async () => {
  const t = setup();
  await init(t);
  assert.match(lastAlert(t), /V8シートを作成しました/);

  // カード明細（院長 M-AMEX 2026-09）
  t.drive.file(t.csvMonth, "2026-09_M-AMEX.csv", CSV,
    "ご利用日,ご利用店名,ご利用金額\n" +
    "2026/09/03,ﾛｰｿﾝ 徳島店,1200\n" +
    "2026/09/10,スターバックス,650\n2026/09/10,スターバックス,650\n" +
    "2026/09/12,ENEOS,5000\n" +
    "2026/09/13,ENEOS 藍住,3300\n" +
    "2026/09/15,AMAZON,-3000\n" +
    "2026/09/20,年会費,11000\n");
  // 麻記子先生: 楽天(Shift_JIS)・カード名なし・必須列不足
  t.drive.file(t.multiMonth, "2026-09_楽天.csv", CSV, SJIS_CSV);
  t.drive.file(t.multiMonth, "明細.csv", CSV, "ご利用日,ご利用金額\n2026/09/01,100\n");
  t.drive.file(t.multiMonth, "2026-09_大丸.csv", CSV, "店名,備考\nA,B\n");
  // 月フォルダの外に置かれた原本
  t.drive.file(t.recRoot, "迷子.jpg", "image/jpeg", "x");

  await t.gs.menuImportStatements();
  assert.match(lastAlert(t), /明細行: 8行/);
  assert.match(lastAlert(t), /必須列が見つかりません/, "必須列不足を黙殺しない");
  const files = t.env.ss.getSheetByName("取込確認").records();
  assert.equal(files.find(f => f["ファイル名"] === "明細.csv")["取込状態"], "分類要確認");
  assert.equal(files.find(f => f["ファイル名"] === "2026-09_大丸.csv")["取込状態"], "エラー");
  const rakuten = txs(t).find(x => x["支払手段"] === "楽天");
  assert.equal(rakuten["原本_店舗名"], "ローソン 徳島店", "Shift_JIS を自動判定（半角カナはNFKC）");

  // レシート: 10ページPDF
  t.drive.file(t.recMonth, "院長_M-AMEX_2026-09.pdf", "application/pdf", "%PDF-fake");
  await t.gs.menuImportReceipts();
  assert.match(lastAlert(t), /OCRページ: 10（失敗 1）/);
  const receipts = txs(t).filter(x => x["原本種別"] === "レシート/領収書/請求書");
  assert.equal(receipts.length, 10, "10ページすべてにページ別の結果が残る");
  assert.match(byPage(t, 3)["読取メモ"], /OCR失敗: Drive OCR 失敗 HTTP 500/, "3ページ目だけ失敗理由が残る");
  assert.equal(byPage(t, 4)["原本_金額"], 5800);
  const p7 = byPage(t, 7);
  assert.equal(p7["原本_金額"], "", "1ページ2枚は勝手に合算・選択しない");
  assert.equal(p7["状態"], "OCR要確認");
  assert.equal(t.env.ss.getSheetByName("取込確認").records().find(f => f["ファイル名"] === "迷子.jpg")["取込状態"], "分類要確認");

  // 判定
  assert.equal(byPage(t, 1)["状態"], "一致候補");
  assert.equal(byPage(t, 2)["状態"], "候補重複");
  assert.equal(byPage(t, 4)["状態"], "金額不一致");
  assert.equal(byPage(t, 5)["状態"], "翌月確認");
  assert.equal(byPage(t, 5)["翌月確認月"], "2026-10");
  assert.equal(byPage(t, 6)["状態"], "未突合");
  assert.ok(!txs(t).some(x => x["状態"] === "承認済み"), "人の承認なしに確定しない");

  // 同じファイルを再取込しても行が増えない
  const before = txs(t).length;
  await t.gs.menuImportReceipts();
  await t.gs.menuImportStatements();
  assert.equal(txs(t).length, before);

  // OCR失敗ページだけ再実行
  t.fixPage3();
  await t.gs.menuRetry();
  assert.equal(byPage(t, 3)["原本_金額"], 3300);
  assert.equal(byPage(t, 3)["状態"], "一致候補");

  // OCR修正 → 候補が再計算され、原本値は残る
  const txSheet = t.env.ss.getSheetByName("取引台帳");
  const p4id = byPage(t, 4)["取引ID"];
  setCell(txSheet, r => r["取引ID"] === p4id, "修正_金額", 5000);
  setCell(txSheet, r => r["取引ID"] === p4id, "修正理由", "OCR誤読 8→0");
  await t.gs.menuApplyCorrections();
  assert.equal(byPage(t, 4)["状態"], "一致候補");
  assert.equal(byPage(t, 4)["原本_金額"], 5800, "原本値が残る");
  assert.equal(byPage(t, 4)["修正者"], "keiri@example.com");
  const hist = t.env.ss.getSheetByName("判定履歴").records();
  assert.ok(hist.some(h => h["対象ID"] === p4id && h["操作"] === "OCR修正" && h["メモ"] === "OCR誤読 8→0"));
  assert.ok(hist.some(h => h["対象ID"] === p4id && h["操作"] === "判定変更" && /金額不一致/.test(h["変更前"])),
    "再突合前後の判定が履歴に残る");

  // 未反映の判断があると画面を作り直さない
  const res = t.env.ss.getSheetByName("突合結果");
  const p1id = byPage(t, 1)["取引ID"];
  setCell(res, r => r["レシート取引ID"] === p1id, "判断", "承認");
  await t.gs.menuRematch();
  assert.match(lastAlert(t), /未反映の判断が 1 件/);

  // 承認・候補重複の手動選択・却下
  const p2id = byPage(t, 2)["取引ID"];
  const dupRows = res.records().filter(r => r["レシート取引ID"] === p2id);
  assert.equal(dupRows.length, 2);
  setCell(res, r => r["突合ID"] === dupRows[0]["突合ID"], "判断", "承認");
  const p3id = byPage(t, 3)["取引ID"];
  setCell(res, r => r["レシート取引ID"] === p3id, "判断", "却下");
  setCell(res, r => r["レシート取引ID"] === p3id, "判断メモ", "別日の給油");
  await t.gs.menuApplyDecisions();
  assert.match(lastAlert(t), /承認: 2件 \/ 却下: 1件/);
  assert.equal(byPage(t, 1)["状態"], "承認済み");
  assert.equal(byPage(t, 2)["状態"], "承認済み");
  assert.notEqual(byPage(t, 3)["状態"], "一致候補", "却下したペアは候補に戻らない");
  const m = matches(t);
  assert.equal(m.find(x => x["突合ID"] === dupRows[1]["突合ID"])["状態"], "失効", "選ばなかった重複候補は失効（削除しない）");
  const approved = m.find(x => x["突合ID"] === dupRows[0]["突合ID"]);
  assert.equal(approved["判断者"], "keiri@example.com");
  assert.ok(approved["判断日時"]);
  assert.equal(m.find(x => x["レシート取引ID"] === p3id && x["状態"] === "却下")["判断メモ"], "別日の給油");

  // 要確認一覧の個別判断は理由メモ必須
  const rev = t.env.ss.getSheetByName("要確認一覧");
  const p6id = byPage(t, 6)["取引ID"];
  setCell(rev, r => r["取引ID"] === p6id, "判断", "承認");
  await t.gs.menuApplyDecisions();
  assert.match(lastAlert(t), /判断メモ（理由）が必要/);
  assert.equal(byPage(t, 6)["状態"], "未突合");

  // 取引の分割（1ページ2枚）
  t.env.prompts.push(p7["取引ID"]);
  await t.gs.menuSplitTx();
  const p7rows = txs(t).filter(x => Number(x["ページ"]) === 7);
  assert.equal(p7rows.length, 2);

  // 翌月明細の取込で翌月確認が再突合される
  const oct = t.drive.subfolder(t.csvRoot, "2026-10");
  t.drive.file(oct, "2026-10_M-AMEX.csv", CSV, "ご利用日,ご利用店名,ご利用金額\n2026/09/28,ホテル,5500\n2026/10/02,X,1\n");
  await t.gs.menuImportStatements();
  assert.equal(byPage(t, 5)["状態"], "一致候補");

  // 原本の差替え（同じDriveファイルIDで内容変更）→ 処理版が増え、旧版は削除せず残る
  const stmtFile = t.csvMonth.files[0];
  stmtFile.setContent("ご利用日,ご利用店名,ご利用金額\n2026/09/03,ﾛｰｿﾝ 徳島店,1200\n");
  await t.gs.menuImportStatements();
  const vers = t.env.ss.getSheetByName("取込確認").records().filter(f => f["DriveファイルID"] === stmtFile.id);
  assert.deepEqual(vers.map(v => [v["処理版"], v["取込状態"]]), [[1, "旧版"], [2, "完了"]]);
  assert.equal(txs(t).filter(x => x["旧版"] === true).length, 7, "旧版の取引7行は削除せず残す");
});

test("V7 のタブがあるスプレッドシートでは動かない", async () => {
  const t = setup();
  t.env.ss.insertSheet("レシート一覧");
  await t.gs.menuInit();
  assert.match(lastAlert(t), /V7 のタブ/);
  assert.equal(t.env.ss.getSheetByName("取引台帳"), null);
});

test("初期化を再実行してもデータは消えない", async () => {
  const t = setup();
  await init(t);
  t.drive.file(t.csvMonth, "a_M-AMEX.csv", CSV, "ご利用日,ご利用店名,ご利用金額\n2026/09/03,A,100\n");
  await t.gs.menuImportStatements();
  const n = txs(t).length;
  await t.gs.menuInit();
  assert.equal(txs(t).length, n);
  assert.equal(t.env.ss.getSheetByName("フォルダマスタ").records().length, 3, "マスタを上書きしない");
});
