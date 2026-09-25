// Apps Script (.gs) ファイルを Node の vm 上で読み込み、GAS と同じく1つのグローバルスコープで共有する。
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadGs(files, globals = {}) {
  const ctx = vm.createContext({ console, ...globals });
  const root = path.join(__dirname, "..", "..");
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
  }
  // top-level の const / function を名前で取り出す
  // __ctx でグローバルを直接差し替えられる（例: gs.__ctx.driveOcr_ = ...）
  return new Proxy({}, { get: (_, name) => (name === "__ctx" ? ctx : vm.runInContext(String(name), ctx)) });
}

module.exports = { loadGs };
