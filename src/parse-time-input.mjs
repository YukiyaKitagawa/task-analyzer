// 活動時間の入力をパースする
// 入力例:
//   CAD2 資料2 Zoom1.5 AI3 調査1 他0.5
//   8h 事務所 DXハイスクール資料作成とAI画像生成

const KNOWN_CATEGORIES = new Set([
  // ファイル操作系
  "CAD", "設計", "測量", "点群", "文書", "文書作成", "資料作成", "資料",
  "集計", "集計・表計算", "画像", "動画", "開発", "メール",
  // Web活動系
  "会議", "Zoom", "Meet", "Teams",
  "Web作業", "Gmail", "Docs", "Notion", "Slack",
  "AI活用", "AI", "ChatGPT", "Claude",
  "調査", "調査・リサーチ", "リサーチ",
  "その他", "他",
]);

// 省略形→正式名のマッピング
const ALIAS = {
  "資料": "資料作成",
  "集計": "集計・表計算",
  "Zoom": "会議",
  "Meet": "会議",
  "Teams": "会議",
  "Gmail": "Web作業",
  "Docs": "Web作業",
  "Notion": "Web作業",
  "Slack": "Web作業",
  "AI": "AI活用",
  "ChatGPT": "AI活用",
  "Claude": "AI活用",
  "調査": "調査・リサーチ",
  "リサーチ": "調査・リサーチ",
  "他": "その他",
};

export function parseTimeInput(text) {
  const lines = text.trim().split("\n").map(l => l.trim()).filter(Boolean);

  if (lines.length < 2) {
    return { error: "最低2行必要です（1行目: 分類と時間、2行目: 総時間 場所 作業内容）" };
  }

  // 1行目: 分類名+時間のペア
  const timeEntries = [];
  const unknowns = [];
  const pairs = lines[0].match(/\S+/g) || [];
  for (const pair of pairs) {
    const m = pair.match(/^(.+?)(\d+\.?\d*)$/);
    if (!m) continue;
    const [, name, hours] = m;
    const canonical = ALIAS[name] || name;
    const source = isWebCategory(canonical) ? "web" : "file";
    if (KNOWN_CATEGORIES.has(name) || ALIAS[name]) {
      timeEntries.push({ category: canonical, hours: parseFloat(hours), source });
    } else {
      unknowns.push(name);
      timeEntries.push({ category: "不明", hours: parseFloat(hours), source: "file", originalInput: name });
    }
  }

  // 2行目: 場所 作業内容
  const line2 = lines[1];
  const spaceIdx = line2.indexOf(" ");
  let location, mainTask;
  if (spaceIdx > 0) {
    location = line2.substring(0, spaceIdx);
    mainTask = line2.substring(spaceIdx + 1);
  } else {
    location = line2;
    mainTask = "";
  }

  // 合計時間は各分類の合算
  const totalHours = timeEntries.reduce((sum, e) => sum + e.hours, 0);

  return {
    timeEntries,
    unknowns,
    totalHours,
    location,
    mainTask,
  };
}

function isWebCategory(cat) {
  return ["会議", "Web作業", "AI活用", "調査・リサーチ", "その他"].includes(cat);
}

// CLIテスト用
if (process.argv[2] === "--test") {
  const testInput = `CAD2 資料2 Zoom1.5 AI3 調査1 他0.5
事務所 DXハイスクール資料作成とAI画像生成`;
  console.log(JSON.stringify(parseTimeInput(testInput), null, 2));
}
