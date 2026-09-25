// 一括PDFのページ分割（Drive.gs の loadPdfLib_ / openPdfPages_）を、本物の pdf-lib で検証する。
// Apps Script と同じく setTimeout が無い環境で、UrlFetchApp から取得したコードを eval する。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { loadGs } = require("./helpers/load-gs");
const { makeGas } = require("./helpers/fake-gas");

let PDFLib = null;
try { PDFLib = require("pdf-lib"); } catch (_) {}

test("一括PDF: pdf-lib で1ページずつに分割できる（Apps Script 相当の環境）", { skip: !PDFLib && "pdf-lib 未インストール（npm install）" }, async () => {
  const env = makeGas();
  const src = fs.readFileSync(path.join(__dirname, "..", "node_modules", "pdf-lib", "dist", "pdf-lib.min.js"), "utf8");
  env.globals.UrlFetchApp = { fetch: () => ({ getContentText: () => src }) };
  const gs = loadGs(["v8/Config.gs", "v8/Lib.gs", "v8/Drive.gs"], env.globals);
  assert.equal(vm.runInContext("typeof setTimeout", gs.__ctx), "undefined", "GAS と同じく setTimeout なしで開始");

  // 3ページのPDFを作る（ページごとにサイズを変えて識別）
  const doc = await PDFLib.PDFDocument.create();
  [[200, 300], [210, 310], [220, 320]].forEach(([w, h]) => doc.addPage([w, h]));
  const bytes = await doc.save();
  const blob = env.globals.Utilities.newBlob(Buffer.from(bytes), "application/pdf", "scan.pdf");

  const pages = await gs.openPdfPages_(blob, "https://cdn.example/pdf-lib.min.js");
  assert.equal(pages.count, 3);
  for (let i = 1; i <= 3; i++) {
    const p = await pages.page(i);
    assert.equal(p.getContentType(), "application/pdf");
    const one = await PDFLib.PDFDocument.load(Buffer.from(p.getBytes()));
    assert.equal(one.getPageCount(), 1, i + "ページ目は1ページのPDF");
    assert.equal(Math.round(one.getPage(0).getWidth()), 190 + i * 10, i + "ページ目の内容");
  }
});
