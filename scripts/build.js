// v8/*.gs を連結して、Apps Script エディタへ貼り付けられる1ファイル版 dist/V8_all.gs を作る
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const order = ["Config", "Lib", "Store", "Drive", "Import", "Match", "Views", "Review", "Menu"];
const bar = "// " + "=".repeat(70);
const parts = ["/** 和田歯科医院 経理突合システム V8 — 1ファイル版（v8/*.gs を連結。直接編集せず v8/ を修正して npm run build） */"];
for (const f of order) {
  parts.push("", bar, "// ===== v8/" + f + ".gs", bar, fs.readFileSync(path.join(root, "v8", f + ".gs"), "utf8"));
}
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist", "V8_all.gs"), parts.join("\n"));
console.log("dist/V8_all.gs を作成しました");
