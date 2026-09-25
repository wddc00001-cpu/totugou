// Apps Script サービスの最小限の擬似実装（V8 の結合テスト用）
const crypto = require("node:crypto");

// 未実装メソッドは何もせず自分自身を返す（書式設定などのチェーン呼び出し用）
function chainable(target) {
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === "symbol") return undefined;
      return () => chainable(t);
    },
  });
}

class FakeSheet {
  constructor(name) { this.name = name; this.grid = []; }
  getName() { return this.name; }
  getLastRow() {
    for (let r = this.grid.length - 1; r >= 0; r--) if ((this.grid[r] || []).some(v => v !== "" && v != null)) return r + 1;
    return 0;
  }
  getLastColumn() { return this.grid.reduce((m, row) => Math.max(m, (row || []).length), 0); }
  getMaxRows() { return Math.max(1000, this.grid.length); }
  getRange(r, c, nr = 1, nc = 1) { return chainable(new FakeRange(this, r, c, nr, nc)); }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  clear() { this.grid = []; return this; }
  getFilter() { return null; }
  getProtections() { return []; }
  cell(r, c) { return ((this.grid[r - 1] || [])[c - 1]) ?? ""; }
  // テスト用: 見出し名で行オブジェクトを取得
  records() {
    const [h, ...rows] = this.grid;
    return rows.filter(r => r && r.some(v => v !== "")).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""])));
  }
}

class FakeRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sheet.cell(this.r + i, this.c + j));
      out.push(row);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(vals) {
    vals.forEach((row, i) => row.forEach((v, j) => {
      const rr = this.r + i - 1;
      this.sheet.grid[rr] = this.sheet.grid[rr] || [];
      for (let k = this.sheet.grid[rr].length; k < this.c + j - 1; k++) this.sheet.grid[rr][k] = "";
      this.sheet.grid[rr][this.c + j - 1] = v;
    }));
    return chainable(this);
  }
  setValue(v) { return this.setValues([[v]]); }
  protect() { return chainable({}); }
}

class FakeSpreadsheet {
  constructor() { this.sheets = []; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = chainable(new FakeSheet(n)); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
}

class FakeBlob {
  constructor(bytes, type, name) { this.bytes = Buffer.from(bytes); this.type = type; this.name = name; }
  getBytes() { return Array.from(new Int8Array(this.bytes.buffer, this.bytes.byteOffset, this.bytes.length)); }
  getDataAsString(cs = "UTF-8") {
    const enc = /shift|sjis|932/i.test(cs) ? "shift_jis" : "utf-8";
    return new TextDecoder(enc).decode(this.bytes);
  }
  getContentType() { return this.type; }
  getName() { return this.name; }
}

class FakeFile {
  constructor(id, name, mime, content) {
    Object.assign(this, { id, name, mime });
    this.setContent(content);
  }
  setContent(content) {
    this.content = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
    this.updated = new Date(Date.now() + Math.floor(Math.random() * 1e6));
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getMimeType() { return this.mime; }
  getBlob() { return new FakeBlob(this.content, this.mime, this.name); }
  getUrl() { return "https://drive.google.com/file/d/" + this.id + "/view"; }
  getLastUpdated() { return this.updated; }
  setTrashed() {}
}

class FakeFolder {
  constructor(id, name) { Object.assign(this, { id, name, files: [], folders: [] }); }
  getName() { return this.name; }
  getId() { return this.id; }
  getFiles() { return iter(this.files); }
  getFolders() { return iter(this.folders); }
  addFolder(f) { this.folders.push(f); return f; }
  addFile(f) { this.files.push(f); return f; }
}

function iter(list) {
  let i = 0;
  const copy = list.slice();
  return { hasNext: () => i < copy.length, next: () => copy[i++] };
}

function makeGas() {
  const ss = new FakeSpreadsheet();
  const alerts = [];
  const prompts = [];
  const folders = {};
  const files = {};
  const fmt = (d, tz, pattern) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(d).map(x => [x.type, x.value]));
    return pattern.replace("yyyy", p.year).replace("yy", p.year.slice(2)).replace("MM", p.month)
      .replace("dd", p.day).replace("HH", p.hour === "24" ? "00" : p.hour).replace("mm", p.minute).replace("ss", p.second);
  };
  const ui = {
    alert: m => { alerts.push(String(m)); },
    prompt: () => {
      const text = prompts.shift();
      return { getSelectedButton: () => (text == null ? "CANCEL" : "OK"), getResponseText: () => text };
    },
    ButtonSet: { OK_CANCEL: "OK_CANCEL" },
    Button: { OK: "OK", CANCEL: "CANCEL" },
    createMenu: () => chainable({}),
  };
  const globals = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getUi: () => ui,
      newDataValidation: () => chainable({ build: () => ({}) }),
      ProtectionType: { RANGE: "RANGE" },
      openById: () => { throw new Error("openById は未実装"); },
    },
    Utilities: {
      formatDate: fmt,
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (alg, bytes) => Array.from(new Int8Array(crypto.createHash("sha256").update(Buffer.from(bytes)).digest())),
      newBlob: (data, type, name) => new FakeBlob(typeof data === "string" ? Buffer.from(data) : Buffer.from(data), type, name),
      sleep: () => {},
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => "keiri@example.com" }),
      getEffectiveUser: () => ({ getEmail: () => "keiri@example.com" }),
      getScriptTimeZone: () => "Asia/Tokyo",
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    DriveApp: {
      getFolderById: id => { if (!folders[id]) throw new Error("no folder " + id); return folders[id]; },
      getFileById: id => { if (!files[id]) throw new Error("no file " + id); return files[id]; },
    },
  };
  let seq = 0;
  const drive = {
    folder(id, name = id) { return (folders[id] = new FakeFolder(id, name)); },
    subfolder(parent, name) { const f = new FakeFolder("sub" + ++seq, name); folders[f.id] = f; return parent.addFolder(f); },
    file(parent, name, mime, content) {
      const f = new FakeFile("file" + ++seq, name, mime, content);
      files[f.id] = f;
      return parent.addFile(f);
    },
  };
  return { globals, ss, alerts, prompts, drive };
}

module.exports = { makeGas };
