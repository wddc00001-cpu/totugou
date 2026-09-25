/**
 * 和田歯科医院 経理突合システム V8 — 設定
 *
 * V8 は V7 と別の Apps Script プロジェクト・別スプレッドシートで動かす（引継ぎ仕様 0.5）。
 * フォルダID・カード明細の列・許容値はシート「フォルダマスタ」「カード明細列マスタ」「設定」で編集する。
 * ここにある値は初期化時にマスタへ書き込む初期値。
 */

const V8_VERSION = "8.0.0";

const SHEET = {
  FILES:         "取込確認",          // 原本ファイル台帳
  TX:            "取引台帳",
  MATCH:         "突合台帳",
  HISTORY:       "判定履歴",
  RESULT:        "突合結果",
  REVIEW:        "要確認一覧",
  CARD_MASTER:   "カード明細列マスタ",
  FOLDER_MASTER: "フォルダマスタ",
  SETTINGS:      "設定",
};

// V7 のタブ名。これらがあるスプレッドシートでは V8 を初期化しない（混在防止）
const V7_SHEET_NAMES = ["レシート一覧", "カード明細一覧", "突合結果", "設定・マスタ"];

const PERSONS = ["院長", "麻記子先生", "銀行"];

const METHODS = [
  "LC法人", "M-AMEX", "A-AMEX", "セゾン", "DC(JAL)", "個人LC",
  "楽天", "大丸", "ポケット（ファミマ）", "現金", "不明", "銀行口座",
];

// カード明細フォルダに複数カードが同居している場合、ファイル名からカードを1つに特定するための別名
// （NFKC・小文字化して部分一致。2つ以上当たる／1つも当たらない場合は「分類要確認」）
const METHOD_ALIASES = {
  "LC法人":             ["lc法人", "法人lc"],
  "M-AMEX":             ["m-amex", "mamex"],
  "A-AMEX":             ["a-amex", "aamex"],
  "セゾン":             ["セゾン", "saison"],
  "DC(JAL)":            ["dc(jal)", "jal", "dcカード"],
  "個人LC":             ["個人lc"],
  "楽天":               ["楽天", "rakuten"],
  "大丸":               ["大丸", "jfr", "daimaru"],
  "ポケット（ファミマ）": ["ポケット", "ファミマ", "pocket", "famima"],
};

const KIND = {
  RECEIPT: "レシート/領収書/請求書",
  CARD:    "カード明細",
  BANK:    "銀行明細",
};

const STATE = {
  PENDING:      "未処理",
  CLASSIFY:     "分類要確認",
  OCR_CHECK:    "OCR要確認",
  UNMATCHED:    "未突合",
  CANDIDATE:    "一致候補",
  DUPLICATE:    "候補重複",
  AMOUNT_DIFF:  "金額不一致",
  DATE_CHECK:   "日付要確認",
  NEXT_MONTH:   "翌月確認",
  EXPIRED:      "期限超過",
  FX_CHECK:     "外貨要確認",
  DUP_ROW:      "重複行",       // 期間が重なる明細ファイルで同じ行が2回取り込まれたもの（突合対象外）
  APPROVED:     "承認済み",
  REJECTED:     "却下",
};

// 要確認一覧に出す状態
const REVIEW_STATES = [
  STATE.CLASSIFY, STATE.OCR_CHECK, STATE.UNMATCHED, STATE.DUPLICATE, STATE.AMOUNT_DIFF,
  STATE.DATE_CHECK, STATE.NEXT_MONTH, STATE.EXPIRED, STATE.FX_CHECK,
];

const MATCH_STATUS = {
  CANDIDATE: "候補",
  APPROVED:  "承認済み",
  REJECTED:  "却下",
  STALE:     "失効",
};

const IMPORT_STATUS = {
  DONE:       "完了",
  PROCESSING: "処理中",
  CLASSIFY:   "分類要確認",
  ERROR:      "エラー",
  DUPLICATE:  "重複（取込済み）",
  UNSUPPORTED:"要確認（未対応形式）",
  SUPERSEDED: "旧版",
};

const DECISION = { APPROVE: "承認", REJECT: "却下" };

// 原本区分（紙のレシートか、ダウンロードした領収書・請求書か。同じ列で区別する）
const SOURCE_TYPE = {
  PAPER:     "紙レシート（スキャン）",
  DOWNLOAD:  "ダウンロード（領収書・請求書）",
  STATEMENT: "カード明細",
};

// 先生＋カード別タブ: 「院長_M-AMEX_突合結果」（レシート｜明細｜結果を横並び）、支払手段不明は「院長_カード不明」。RECEIPT/STATEMENT は旧版タブの片付け用
const CARD_TAB = { RECEIPT: "レシート", STATEMENT: "明細", RESULT: "突合結果", UNKNOWN: "カード不明" };

// 設定シートの初期値
const DEFAULT_SETTINGS = [
  ["日付許容日数",            3,   "カード別の値が「カード明細列マスタ」にあればそちらを優先"],
  ["金額不一致の検出幅(%)",   20,  "同日付近で金額がこの割合以内の差なら『金額不一致』として相手候補を示す"],
  ["日付要確認の検出幅(日)",  45,  "同額でこの日数以内なら『日付要確認』として相手候補を示す"],
  ["翌月確認の猶予(月)",      1,   "翌月確認の対象月からこの月数を過ぎても相手が無ければ『期限超過』"],
  ["処理時間上限(秒)",        270, "Apps Script の6分制限に対する安全マージン。超えたら中断し、再実行で続きから再開"],
  ["ダウンロード判定キーワード", "領収|請求|invoice|receipt|download|ダウンロード|DL_",
   "ファイル名にこの語が入っていれば原本区分を『ダウンロード』、なければ『紙レシート』にする（取引台帳で手修正可）"],
  ["pdf-lib URL", "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js", "一括PDFのページ分割に使用"],
];

// フォルダマスタの初期値（V7 のフォルダIDを流用。各フォルダの直下に「2026-09」形式の月フォルダを作って格納する）
// [フォルダID, 人物, 支払手段（複数は「,」区切り）, 原本種別, メモ]
const DEFAULT_FOLDERS = [
  ["1lTShDGN-mRZHA34Aawsc8LSKMcZn5EAN", "院長", "M-AMEX",  KIND.RECEIPT, "院長_M-AMEX"],
  ["1yE4rMETDeCQKUviwRrCzx-phStmJO1gc", "院長", "A-AMEX",  KIND.RECEIPT, "院長_A-AMEX"],
  ["1NFwXnq9iKpI8aCHmLTg7d-0F35ufRK4d", "院長", "個人LC",  KIND.RECEIPT, "院長_個人LC"],
  ["1VFSh7X4W7uEmTtMuQF8AiRpFI6vtKbVk", "院長", "LC法人",  KIND.RECEIPT, "院長_法人LC"],
  ["1ed_-kzUN3q5YrCQ6lgEmkUx51sxqaTxc", "院長", "セゾン",  KIND.RECEIPT, "院長_セゾン"],
  ["1bm9B-85cqV9en4-iB0WihgWUxvDuS_FA", "院長", "DC(JAL)", KIND.RECEIPT, "院長_DC(JAL)"],
  ["1FqW5nyWdgaML_L07GgHSNrGGFmzvOWNS", "院長", "現金",    KIND.RECEIPT, "院長_現金"],
  ["1aPWJVHh5iN4fBvKwPJKIMDj5QyqetBvY", "麻記子先生", "M-AMEX",  KIND.RECEIPT, "麻記子_M-AMEX"],
  ["1XEcntiqJA5M7juySFFOeQ5PW1Ir69Dt3", "麻記子先生", "A-AMEX",  KIND.RECEIPT, "麻記子_A-AMEX"],
  ["1j7wfgMNo1vjwK8DEFOQ16H5uCQaASj67", "麻記子先生", "DC(JAL)", KIND.RECEIPT, "麻記子_DC(JAL)"],
  ["1ceOj8aEprH3iQZVAbEIZFFzKp5ceJJS8", "麻記子先生", "楽天",    KIND.RECEIPT, "麻記子_楽天"],
  ["10tk6rHz0I0faDXj7cYFBTzwfvNIiTRgv", "麻記子先生", "大丸",    KIND.RECEIPT, "麻記子_大丸"],
  ["1nHWddWB5iMeVayVIQOM6xQ6DUXWTVXkd", "麻記子先生", "ポケット（ファミマ）", KIND.RECEIPT, "麻記子_ポケット(ファミマ)"],
  ["1NekXxy8DXIS4oxq8lH_BsjBGvhWSnNlE", "麻記子先生", "現金",    KIND.RECEIPT, "麻記子_現金"],
  ["1bQvHSpAC04OrVsRbPqasfVueHX4g17Ar", "院長", "M-AMEX",  KIND.CARD, "明細CSV_院長_M-AMEX"],
  ["1-Dwdn68peDf6enummI_pbxuGOtZxaETb", "院長", "A-AMEX",  KIND.CARD, "明細CSV_院長_A-AMEX"],
  ["1OaG9-_jWYOBd6aKHKUVoo4av9vb5nxHe", "院長", "個人LC",  KIND.CARD, "明細CSV_院長_個人LC"],
  ["1QfLDB6ameZUG0tvBb40XKLwUf-WqqzDR", "院長", "LC法人",  KIND.CARD, "明細CSV_法人LC"],
  ["1U6e28HzZn6KYanQWX46Jj78phJ0zKhAE", "院長", "セゾン,DC(JAL)", KIND.CARD, "明細CSV_院長_セゾン・DC（ファイル名にカード名を入れる）"],
  ["1vvJbIvpq0MVxfWJE9btF4mrhvDDQ9q-9", "麻記子先生", "M-AMEX", KIND.CARD, "明細CSV_麻記子_M-AMEX"],
  ["1AYgNMdPHppbbCg4Fdw0MHfaTAkhR1H9z", "麻記子先生", "A-AMEX", KIND.CARD, "明細CSV_麻記子_A-AMEX"],
  ["1wfKb3FPYQ1_PFL2NbA0z_D_osiOlLoc3", "麻記子先生", "楽天,大丸,ポケット（ファミマ）,DC(JAL)", KIND.CARD,
   "明細CSV_麻記子_楽天・大丸・ポケット・DC（ファイル名にカード名を入れる）"],
  // 「不明」レシート用フォルダは未作成。作成したら行を追加する: [ID, 院長, 不明, レシート/領収書/請求書, メモ]
];

// カード明細列マスタの初期値。実ファイル受領後にカード別の行を追加・修正する。
// 列名は「|」区切りの候補。完全一致 → 部分一致の順で探す。
const DEFAULT_CARD_MASTER_ROW = {
  encoding:        "自動",   // 自動 / UTF-8 / Shift_JIS
  sheet_name:      "",       // xlsx の対象シート名（空なら先頭シート）
  date_cols:       "ご利用日|利用日|ご利用年月日|利用年月日|取引日|date",
  amount_cols:     "ご利用金額|利用金額|ご請求金額|請求金額|支払金額|金額|amount",
  merchant_cols:   "ご利用店名|利用店名|ご利用先|ご利用内容|利用内容|店舗名|摘要|description",
  foreign_cols:    "現地通貨額|現地利用額|外貨金額|外貨額",
  currency_cols:   "通貨|通貨コード|現地通貨",
  special_pattern: "取消|返品|返金|分割|リボ|お支払い|引落",
  date_tolerance:  "",
};
