/**
 * V8 人の判断: 承認/却下・OCR修正・手動紐付け・取引の分割
 * AI/OCR は候補を出すだけ。確定は必ずここを通り、判断者・日時・メモを台帳と判定履歴に残す。
 */

// ===== 判断を反映 =====

function applyDecisions_() {
  const mt = Table.open(SHEET.MATCH);
  const tx = Table.open(SHEET.TX);
  const hist = Table.open(SHEET.HISTORY);
  const who = actor_(), at = nowText_();
  const report = { approved: 0, rejected: 0, txDecided: 0, errors: [] };

  const approvedTx = new Set();
  mt.all().filter(m => m.status === MATCH_STATUS.APPROVED).forEach(m => {
    approvedTx.add(m.receipt_id); approvedTx.add(m.statement_id);
  });

  // 判断を入力できる全シート（突合結果・要確認一覧・先生＋カード別の突合結果・カード不明）
  const decisions = [];
  decisionSheets_().forEach(sh => readDecisions_(sh).forEach(d => decisions.push(d)));
  const done = new Set();

  decisions.forEach(d => {
    const where = "［" + d.sheet + "］";
    if (d.matchId) {
      // 突合単位
      if (done.has(d.matchId)) return;
      done.add(d.matchId);
      const m = mt.find(x => x.match_id === d.matchId);
      if (!m) return report.errors.push(where + d.matchId + ": 突合IDが台帳にありません");
      if (m.status !== MATCH_STATUS.CANDIDATE) return report.errors.push(where + d.matchId + ": 既に「" + m.status + "」です");
      if (d.decision === DECISION.APPROVE) {
        if (approvedTx.has(m.receipt_id) || approvedTx.has(m.statement_id)) {
          return report.errors.push(where + d.matchId + ": どちらかの取引が別の突合で承認済みです（1対多は「手動紐付け」を使用）");
        }
        approvedTx.add(m.receipt_id); approvedTx.add(m.statement_id);
        m.status = MATCH_STATUS.APPROVED;
        report.approved++;
      } else {
        m.status = MATCH_STATUS.REJECTED;
        report.rejected++;
      }
      Object.assign(m, { decided_at: at, decided_by: who, decision_memo: d.memo });
      mt.touch(m);
      logHistory_(hist, "突合", m.match_id, d.decision, MATCH_STATUS.CANDIDATE + "（" + m.kind + "）", m.status, d.memo);
      return;
    }
    // 取引単位（理由メモ必須）
    if (!d.txId) return report.errors.push(where + "原本ファイル行には判断を入れられません（保存先・ファイルを修正してください）");
    if (done.has(d.txId)) return;
    done.add(d.txId);
    const t = tx.find(x => x.id === d.txId);
    if (!t) return report.errors.push(where + d.txId + ": 取引IDが台帳にありません");
    if (isBlank_(d.memo)) return report.errors.push(where + d.txId + ": 個別の" + d.decision + "には判断メモ（理由）が必要です");
    const before = t.state;
    Object.assign(t, { decision: d.decision, reviewed_by: who, reviewed_at: at, review_memo: d.memo });
    tx.touch(t);
    logHistory_(hist, "取引", t.id, "個別" + d.decision, before, d.decision, d.memo);
    report.txDecided++;
  });

  mt.flush(); tx.flush(); hist.flush();
  return report;
}

// 見出し「判断」「判断メモ」「突合ID」「取引ID」で読む（シートごとの列位置の違いを吸収）
function readDecisions_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const h = values[0].map(String);
  const col = name => h.indexOf(name);
  const cDec = col("判断"), cMemo = col("判断メモ"), cMatch = col("突合ID"), cTx = col("取引ID");
  if (cDec < 0) return [];
  const get = (r, c) => (c >= 0 ? String(r[c] || "").trim() : "");
  return values.slice(1)
    .filter(r => r[cDec] === DECISION.APPROVE || r[cDec] === DECISION.REJECT)
    .map(r => ({ sheet: sh.getName(), decision: r[cDec], memo: get(r, cMemo), matchId: get(r, cMatch), txId: get(r, cTx) }));
}

// ===== OCR修正を反映（V8-02） =====

function applyCorrections_() {
  const tx = Table.open(SHEET.TX);
  const hist = Table.open(SHEET.HISTORY);
  const who = actor_(), at = nowText_();
  const report = { applied: 0, errors: [] };

  tx.all().filter(t => !isTrue_(t.superseded)).forEach(t => {
    const sig = correctionSignature(t);
    if (sig === String(t.corr_sig || "")) return;
    const problems = [];
    if (!isBlank_(t.corr_date) && !toYmd(t.corr_date)) problems.push("修正_日付");
    if (!isBlank_(t.corr_amount) && isNaN(parseAmount(t.corr_amount))) problems.push("修正_金額");
    if (!isBlank_(t.corr_currency) && !/^[A-Za-z]{3}$/.test(String(t.corr_currency).trim())) problems.push("修正_通貨（USD等の3文字）");
    if (problems.length) return report.errors.push(t.id + ": " + problems.join("・") + " を解釈できません");
    logHistory_(hist, "取引", t.id, "OCR修正",
      t.corr_sig ? "修正前: " + t.corr_sig : "原本値: " + JSON.stringify([toYmd(t.orig_date), t.orig_amount, t.currency, t.orig_merchant]),
      sig ? "修正後: " + sig : "修正を取消（原本値に戻す）", t.corr_reason);
    Object.assign(t, { corr_sig: sig, corr_by: sig ? who : "", corr_at: sig ? at : "" });
    tx.touch(t);
    report.applied++;
  });
  tx.flush(); hist.flush();
  return report;
}

// ===== 手動紐付け（1対多・多対1） =====

function manualLink_(receiptIds, statementIds, memo) {
  const tx = Table.open(SHEET.TX);
  const mt = Table.open(SHEET.MATCH);
  const hist = Table.open(SHEET.HISTORY);
  const rs = receiptIds.map(id => tx.find(t => t.id === id && !isTrue_(t.superseded)));
  const ss = statementIds.map(id => tx.find(t => t.id === id && !isTrue_(t.superseded)));
  const missing = receiptIds.filter((id, i) => !rs[i] || rs[i].kind !== KIND.RECEIPT)
    .concat(statementIds.filter((id, i) => !ss[i] || ss[i].kind !== KIND.CARD));
  if (missing.length) throw new Error("取引IDが見つからないか種別が違います: " + missing.join(", "));
  if (rs.length > 1 && ss.length > 1) throw new Error("多対多は紐付けできません（1対多 または 多対1）");
  const approved = new Set();
  mt.all().filter(m => m.status === MATCH_STATUS.APPROVED).forEach(m => { approved.add(m.receipt_id); approved.add(m.statement_id); });
  const dup = receiptIds.concat(statementIds).filter(id => approved.has(id));
  if (dup.length) throw new Error("既に承認済みの取引が含まれています: " + dup.join(", "));
  const persons = new Set(rs.concat(ss).map(t => t.person));
  if (persons.size > 1) throw new Error("人物が異なる取引は紐付けできません");

  const sum = list => list.reduce((a, t) => a + (isFinite(effective(t).amount) ? effective(t).amount : 0), 0);
  const diff = sum(ss) - sum(rs);
  const group = newId_("G");
  const who = actor_(), at = nowText_();
  const note = "手動紐付け " + group + "（合計差 " + diff + "）" + (memo ? "：" + memo : "");
  rs.forEach(r => ss.forEach(s => {
    mt.all().filter(m => m.status === MATCH_STATUS.CANDIDATE &&
      (m.receipt_id === r.id || m.statement_id === s.id)).forEach(m => {
      m.status = MATCH_STATUS.STALE; m.decided_at = at; m.decision_memo = "手動紐付け " + group + " により失効";
      mt.touch(m);
    });
    const m = mt.insert({
      match_id: newId_("M"), status: MATCH_STATUS.APPROVED, kind: "手動紐付け", match_type: "レシート×カード明細",
      receipt_id: r.id, statement_id: s.id, amount_diff: diff, date_diff: dayDiffSafe_(r, s),
      merchant_eval: merchantEval(effective(r).merchant, effective(s).merchant),
      candidate_at: at, decided_at: at, decided_by: who, decision_memo: note,
    });
    logHistory_(hist, "突合", m.match_id, "手動紐付け", "", MATCH_STATUS.APPROVED, note);
  }));
  mt.flush(); hist.flush();
  return { group, diff };
}

function dayDiffSafe_(r, s) {
  const a = effective(r).date, b = effective(s).date;
  return a && b ? dayDiff(a, b) : "";
}

// ===== 取引の分割（1ページに複数レシート） =====

function splitTx_(txId) {
  const tx = Table.open(SHEET.TX);
  const hist = Table.open(SHEET.HISTORY);
  const src = tx.find(t => t.id === txId && !isTrue_(t.superseded));
  if (!src) throw new Error("取引IDが見つかりません: " + txId);
  if (src.kind !== KIND.RECEIPT) throw new Error("分割できるのはレシート/領収書の取引だけです");
  const copy = Object.assign({}, src);
  delete copy._i;
  Object.assign(copy, {
    id: newId_("R"), state: STATE.OCR_CHECK, state_reason: "分割で追加（" + txId + " と同じページ）。修正列に値を入力",
    orig_date: "", orig_amount: "", orig_merchant: "", jpy_amount: "", foreign_amount: "",
    corr_date: "", corr_amount: "", corr_currency: "", corr_merchant: "", corr_reason: "",
    corr_by: "", corr_at: "", corr_sig: "", decision: "", reviewed_by: "", reviewed_at: "", review_memo: "",
    ocr_note: "分割元: " + txId, created_at: nowText_(),
  });
  tx.insert(copy);
  logHistory_(hist, "取引", copy.id, "分割", txId, copy.id);
  tx.flush(); hist.flush();
  return copy.id;
}
