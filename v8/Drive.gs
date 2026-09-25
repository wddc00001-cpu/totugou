/**
 * V8 Drive 連携: OCR・xlsx 変換・PDF ページ分割
 * 一時ファイルは成功・失敗にかかわらずゴミ箱へ移動する。
 */

// Drive へ Google 形式に変換してアップロードし、一時ファイルIDを返す
function uploadConverted_(blob, googleMime, extraQuery) {
  const boundary = "wada_v8_" + Utilities.getUuid();
  const meta = JSON.stringify({ name: "v8_tmp_" + Date.now(), mimeType: googleMime });
  const head =
    "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta +
    "\r\n--" + boundary + "\r\nContent-Type: " + blob.getContentType() + "\r\n\r\n";
  const tail = "\r\n--" + boundary + "--";
  const payload = Utilities.newBlob(head).getBytes()
    .concat(blob.getBytes())
    .concat(Utilities.newBlob(tail).getBytes());
  const res = UrlFetchApp.fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id" + (extraQuery || ""),
    {
      method: "post",
      contentType: "multipart/related; boundary=" + boundary,
      payload,
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    }
  );
  if (res.getResponseCode() >= 300) {
    throw new Error("Drive 変換に失敗 HTTP " + res.getResponseCode() + " " + res.getContentText().slice(0, 200));
  }
  return JSON.parse(res.getContentText()).id;
}

function trashQuietly_(id) {
  try { DriveApp.getFileById(id).setTrashed(true); } catch (_) {}
}

// 画像・1ページPDF → OCRテキスト（Drive OCR。外部AIには送信しない）
function driveOcr_(blob) {
  const r = driveOcrBatch_([blob])[0];
  if (r.error) throw new Error(r.error);
  return r.text;
}

function multipartRequest_(blob, googleMime, extraQuery) {
  const boundary = "wada_v8_" + Utilities.getUuid();
  const meta = JSON.stringify({ name: "v8_tmp_" + Date.now(), mimeType: googleMime });
  const head =
    "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta +
    "\r\n--" + boundary + "\r\nContent-Type: " + blob.getContentType() + "\r\n\r\n";
  const tail = "\r\n--" + boundary + "--";
  return {
    url: "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id" + (extraQuery || ""),
    method: "post",
    contentType: "multipart/related; boundary=" + boundary,
    payload: Utilities.newBlob(head).getBytes().concat(blob.getBytes()).concat(Utilities.newBlob(tail).getBytes()),
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  };
}

/**
 * 複数の画像・1ページPDFをまとめてOCR（アップロード・テキスト取得・一時ファイル削除を並列実行）
 * @return [{ text } | { error }]（入力と同じ順）
 */
function driveOcrBatch_(blobs) {
  if (!blobs.length) return [];
  const auth = { Authorization: "Bearer " + ScriptApp.getOAuthToken() };
  const out = blobs.map(() => ({}));
  const ups = UrlFetchApp.fetchAll(blobs.map(b => multipartRequest_(b, "application/vnd.google-apps.document", "&ocrLanguage=ja")));
  const ids = ups.map((res, i) => {
    if (res.getResponseCode() >= 300) {
      out[i].error = "Drive OCR 失敗 HTTP " + res.getResponseCode() + " " + res.getContentText().slice(0, 120);
      return "";
    }
    return JSON.parse(res.getContentText()).id;
  });
  const live = ids.map((id, i) => ({ id, i })).filter(x => x.id);
  try {
    const texts = UrlFetchApp.fetchAll(live.map(x => ({
      url: "https://www.googleapis.com/drive/v3/files/" + x.id + "/export?mimeType=text/plain",
      headers: auth, muteHttpExceptions: true,
    })));
    texts.forEach((res, k) => {
      const i = live[k].i;
      if (res.getResponseCode() >= 300) out[i].error = "OCRテキスト取得失敗 HTTP " + res.getResponseCode();
      else out[i].text = res.getContentText("UTF-8").replace(/^\uFEFF/, "");
    });
  } finally {
    // 一時ドキュメントは成功・失敗にかかわらずゴミ箱へ
    try {
      UrlFetchApp.fetchAll(live.map(x => ({
        url: "https://www.googleapis.com/drive/v3/files/" + x.id, method: "patch",
        contentType: "application/json", payload: JSON.stringify({ trashed: true }),
        headers: auth, muteHttpExceptions: true,
      })));
    } catch (_) {}
  }
  return out;
}

// xlsx → 2次元配列（Date はそのまま Date で返る）
function xlsxToValues_(blob, sheetName) {
  const id = uploadConverted_(blob, "application/vnd.google-apps.spreadsheet", "");
  try {
    return googleSheetToValues_(id, sheetName);
  } finally {
    trashQuietly_(id);
  }
}

function googleSheetToValues_(id, sheetName) {
  const ss = SpreadsheetApp.openById(id);
  const sh = sheetName ? ss.getSheetByName(sheetName) : ss.getSheets()[0];
  if (!sh) throw new Error("シート「" + sheetName + "」がありません（カード明細列マスタの xlsxシート名 を確認）");
  return sh.getDataRange().getValues();
}

// ===== PDF ページ分割（pdf-lib） =====

let PDF_LIB_ = null;

function loadPdfLib_(url) {
  if (PDF_LIB_) return PDF_LIB_;
  if (typeof globalThis.setTimeout === "undefined") {
    // pdf-lib が内部で使う setTimeout の代替（Apps Script には無い）
    globalThis.setTimeout = function (fn, ms) { if (ms) Utilities.sleep(ms); fn(); return 0; };
  }
  const code = UrlFetchApp.fetch(url).getContentText();
  (0, eval)(code);
  if (!globalThis.PDFLib) throw new Error("pdf-lib を読み込めませんでした: " + url);
  PDF_LIB_ = globalThis.PDFLib;
  return PDF_LIB_;
}

/**
 * PDF を開き、ページ数と「iページ目だけのPDF Blob を返す関数」を返す（i は 1 始まり）
 */
async function openPdfPages_(blob, pdfLibUrl) {
  const PDFLib = loadPdfLib_(pdfLibUrl);
  const src = await PDFLib.PDFDocument.load(new Uint8Array(blob.getBytes()), { ignoreEncryption: true });
  const count = src.getPageCount();
  return {
    count,
    async page(i) {
      if (count === 1) return blob;
      const out = await PDFLib.PDFDocument.create();
      const [p] = await out.copyPages(src, [i - 1]);
      out.addPage(p);
      const bytes = await out.save();
      return Utilities.newBlob(Array.from(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)),
        "application/pdf", blob.getName() + "_p" + i + ".pdf");
    },
  };
}

function contentHash_(blob) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, blob.getBytes());
  return d.map(b => ((b + 256) % 256).toString(16).padStart(2, "0")).join("");
}

// CSV の文字コード判定（自動: UTF-8 で読めなければ Shift_JIS）
function decodeCsv_(blob, encoding) {
  const enc = String(encoding || "自動").trim();
  if (/shift|sjis|932/i.test(enc)) return blob.getDataAsString("Shift_JIS");
  const utf8 = blob.getDataAsString("UTF-8");
  if (/utf/i.test(enc)) return utf8;
  return looksMisdecoded(utf8) ? blob.getDataAsString("Shift_JIS") : utf8;
}
