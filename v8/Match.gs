/**
 * V8 再突合: 突合エンジン（Lib.gs）の結果を取引台帳・突合台帳へ反映する
 * - 承認済み・却下の突合は変更しない
 * - 状態が変わった取引だけ判定履歴に残す
 * - 条件を満たさなくなった候補は削除せず「失効」にする
 */

function rematch_() {
  const tx = Table.open(SHEET.TX);
  const mt = Table.open(SHEET.MATCH);
  const hist = Table.open(SHEET.HISTORY);
  const settings = loadSettings_();
  const masters = loadCardMasters_();

  const cardMethodsByPerson = {};
  loadFolderMaster_().filter(f => f.kind === KIND.CARD).forEach(f => {
    const list = cardMethodsByPerson[f.person] = cardMethodsByPerson[f.person] || [];
    f.methods.forEach(m => { if (!list.includes(m)) list.push(m); });
  });

  const result = runMatchingEngine({
    transactions: tx.all(),
    matches: mt.all(),
    settings,
    tolByMethod: masters.tolerances(),
    cardMethodsByPerson,
    today: todayYmd_(),
  });

  // 取引の状態
  const summary = {};
  let changed = 0;
  tx.all().forEach(t => {
    const s = result.states[t.id];
    if (!s) return;
    summary[s.state] = (summary[s.state] || 0) + 1;
    if (t.state === s.state && t.state_reason === s.state_reason &&
        String(t.next_check_month || "") === String(s.next_check_month || "")) return;
    logHistory_(hist, "取引", t.id, "判定変更", t.state + "｜" + t.state_reason, s.state + "｜" + s.state_reason);
    t.state = s.state;
    t.state_reason = s.state_reason;
    t.next_check_month = s.next_check_month;
    tx.touch(t);
    changed++;
  });

  // 突合候補
  const key = (r, s) => r + "|" + s;
  const fresh = {};
  result.candidates.forEach(c => { fresh[key(c.receipt_id, c.statement_id)] = c; });
  const seen = new Set();
  mt.all().forEach(m => {
    if (m.status !== MATCH_STATUS.CANDIDATE) return;
    const k = key(m.receipt_id, m.statement_id);
    const c = fresh[k];
    if (!c) {
      m.status = MATCH_STATUS.STALE;
      m.decided_at = nowText_();
      m.decision_memo = "条件を満たさなくなったため失効（再突合）";
      mt.touch(m);
      return;
    }
    seen.add(k);
    if (m.kind !== c.kind || String(m.amount_diff) !== String(c.amount_diff) ||
        String(m.date_diff) !== String(c.date_diff) || m.merchant_eval !== c.merchant_eval) {
      Object.assign(m, { kind: c.kind, amount_diff: c.amount_diff, date_diff: c.date_diff, merchant_eval: c.merchant_eval });
      mt.touch(m);
    }
  });
  let added = 0;
  result.candidates.forEach(c => {
    const k = key(c.receipt_id, c.statement_id);
    if (seen.has(k)) return;
    seen.add(k);
    mt.insert({
      match_id: newId_("M"), status: MATCH_STATUS.CANDIDATE, kind: c.kind, match_type: "レシート×カード明細",
      receipt_id: c.receipt_id, statement_id: c.statement_id,
      amount_diff: c.amount_diff, date_diff: c.date_diff, merchant_eval: c.merchant_eval,
      candidate_at: nowText_(), decided_at: "", decided_by: "", decision_memo: "",
    });
    added++;
  });

  tx.flush();
  mt.flush();
  hist.flush();
  return { summary, changed, added };
}
