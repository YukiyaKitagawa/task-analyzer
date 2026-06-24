import fs from "fs/promises";
import path from "path";

const outputDir = path.join(path.dirname(new URL(import.meta.url).pathname.substring(1)), "..", "output");

const GAP_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2時間

// AIチャットのタイトルから作業トピックを抽出・集約
function extractAiTopics(entries) {
  const titleCounts = new Map();
  for (const e of entries) {
    let title = e.title || "";
    // 汎用タイトルをスキップ
    if (/^(ChatGPT|Claude|New chat|チャットGPT|My GPTs)$/i.test(title.trim())) continue;
    // URLの末尾IDを除去
    title = title.replace(/\s*[-–]\s*(ChatGPT|Claude).*$/i, "").trim();
    if (!title) continue;
    titleCounts.set(title, (titleCounts.get(title) || 0) + (e.visitCount || 1));
  }

  // 類似タイトルをグループ化（先頭4文字が同じならまとめる）
  const groups = [];
  const used = new Set();
  const titles = [...titleCounts.entries()].sort((a, b) => b[1] - a[1]);

  for (const [title, count] of titles) {
    if (used.has(title)) continue;
    const prefix = title.substring(0, 4);
    const related = titles.filter(([t]) => !used.has(t) && t.substring(0, 4) === prefix);
    const groupTitles = related.map(([t]) => t);
    groupTitles.forEach(t => used.add(t));
    const totalCount = related.reduce((s, [, c]) => s + c, 0);
    groups.push({ summary: `${groupTitles[0]}${groupTitles.length > 1 ? ` 他${groupTitles.length - 1}件` : ""}`, count: totalCount });
  }

  return groups.slice(0, 5);
}

// Google検索キーワード＋アクセスサイトから調査テーマを推定
function extractResearchThemes(byTag, excludeTags) {
  const themes = [];
  const usedSites = new Set();

  // Google検索からキーワード抽出
  const googleEntries = byTag["google.com"] || [];
  const searchQueries = [];
  for (const e of googleEntries) {
    const qMatch = e.url?.match(/[?&]q=([^&]+)/);
    if (qMatch) {
      try {
        const q = decodeURIComponent(qMatch[1].replace(/\+/g, " "));
        searchQueries.push({ query: q, time: e.visitedAt });
      } catch {}
    }
  }

  // 検索クエリをテーマ別にグループ化（キーワードの類似性）
  const queryGroups = [];
  const usedQueries = new Set();
  for (const sq of searchQueries) {
    if (usedQueries.has(sq.query)) continue;
    const words = sq.query.split(/\s+/).filter(w => w.length > 1);
    const related = searchQueries.filter(s => {
      if (usedQueries.has(s.query)) return false;
      const sWords = s.query.split(/\s+/);
      return words.some(w => sWords.some(sw => sw.includes(w) || w.includes(sw)));
    });
    related.forEach(r => usedQueries.add(r.query));
    if (related.length > 0) {
      queryGroups.push({ queries: related.map(r => r.query), count: related.length });
    }
  }

  for (const g of queryGroups.slice(0, 5)) {
    themes.push({ summary: `検索「${g.queries[0]}」${g.count > 1 ? ` 他${g.count - 1}件` : ""}`, sites: [] });
  }

  // 検索以外のサイト（excludeTagsとgoogle系を除く）で3件以上アクセスのあるサイトをテーマ化
  const excludeSet = new Set([...excludeTags, "google.com", "accounts.google.com", "GitHub"]);
  const researchSites = Object.entries(byTag)
    .filter(([tag, entries]) => !excludeSet.has(tag) && entries.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5);

  for (const [tag, entries] of researchSites) {
    const sampleTitles = entries
      .filter(e => e.title && !/^\(タイトルなし\)$/.test(e.title))
      .slice(0, 2)
      .map(e => e.title.length > 25 ? e.title.substring(0, 25) + "…" : e.title);
    const detail = sampleTitles.length > 0 ? `${tag}（${sampleTitles.join("、")}）` : `${tag}（${entries.length}件）`;
    themes.push({ summary: detail, sites: [tag] });
    usedSites.add(tag);
  }

  return themes;
}

function inferActivities(byCategory, files) {
  const activities = [];

  const catMap = {
    "CAD":            { type: "CAD",              fmt: names => `CADファイル操作（${names}）` },
    "設計":           { type: "設計",              fmt: names => `設計ファイル操作（${names}）` },
    "測量":           { type: "測量",              fmt: names => `測量データ（${names}）` },
    "点群":           { type: "点群",              fmt: names => `点群データ（${names}）` },
    "資料作成":       { type: "資料作成",          fmt: names => `プレゼン/資料の編集（${names}）` },
    "文書作成":       { type: "文書作成",          fmt: names => `文書の作成・編集（${names}）` },
    "文書":           { type: "文書",              fmt: names => `PDF/DocuWorks（${names}）` },
    "集計・表計算":   { type: "集計作業",          fmt: names => `表計算・データ整理（${names}）` },
    "開発":           { type: "開発作業",          fmt: (_,c) => `コード関連ファイル ${c}件` },
    "メール":         { type: "メール対応",        fmt: (_,c) => `メールファイル ${c}件` },
  };

  for (const [cat, conf] of Object.entries(catMap)) {
    if (!byCategory[cat]) continue;
    const names = byCategory[cat].slice(0, 3).map(f => f.name).join("、");
    const more = byCategory[cat].length > 3 ? `他${byCategory[cat].length - 3}件` : "";
    activities.push({ type: conf.type, detail: conf.fmt(names + (more ? " " + more : ""), byCategory[cat].length), priority: 1 });
  }

  if (byCategory["画像"]) {
    // スクリーンショットは一時ログのため除外
    const others = byCategory["画像"].filter(f => !/スクリーンショット|screenshot/i.test(f.name));
    if (others.length > 0) {
      const names = others.slice(0, 3).map(f => f.name).join("、");
      activities.push({ type: "画像関連", detail: `画像ファイル操作（${names}）`, priority: 3 });
    }
  }

  activities.sort((a, b) => a.priority - b.priority);
  return activities;
}

function inferBrowserActivities(byTag) {
  const activities = [];
  const meetingTags = ["会議 (Google Meet)", "会議 (Zoom)", "会議 (Teams)"];
  // GitHubは一時ログのため除外
  const workTags = ["Google Workspace", "Google Docs", "Gmail", "Google Calendar", "Microsoft 365", "Slack", "Notion"];

  for (const tag of meetingTags) {
    if (byTag[tag]?.length) {
      activities.push({ type: "会議", detail: `${tag.replace("会議 ", "")} ${byTag[tag].length}件のアクセス`, priority: 1 });
    }
  }

  for (const tag of workTags) {
    if (byTag[tag]?.length) {
      activities.push({ type: "Web作業", detail: `${tag}（${byTag[tag].length}件）`, priority: 2 });
    }
  }

  // AI活用（チャットタイトルから作業内容を抽出）
  for (const aiTag of ["ChatGPT", "Claude"]) {
    const entries = byTag[aiTag];
    if (!entries?.length) continue;
    const topics = extractAiTopics(entries);
    if (topics.length > 0) {
      for (const t of topics) {
        activities.push({ type: `AI活用（${aiTag}）`, detail: t.summary, priority: 2 });
      }
    } else {
      activities.push({ type: `AI活用（${aiTag}）`, detail: `${entries.length}件のアクセス`, priority: 2 });
    }
  }

  // 調査・リサーチ（検索キーワードとアクセスサイトからテーマを推定）
  const researchThemes = extractResearchThemes(byTag, [...meetingTags, ...workTags, "YouTube", "Amazon", "ChatGPT", "Claude"]);
  for (const theme of researchThemes) {
    activities.push({ type: "調査・リサーチ", detail: theme.summary, priority: 3 });
  }

  // その他（未分類）
  const knownTags = new Set([...meetingTags, ...workTags, "YouTube", "Amazon", "ChatGPT", "Claude", "google.com", "accounts.google.com", "GitHub"]);
  const allResearchSites = new Set(researchThemes.flatMap(t => t.sites || []));
  const otherEntries = Object.entries(byTag)
    .filter(([tag]) => !knownTags.has(tag) && !allResearchSites.has(tag))
    .sort((a, b) => b[1].length - a[1].length);

  if (otherEntries.length > 0) {
    const otherSummary = otherEntries.slice(0, 5).map(([tag, e]) => `${tag}(${e.length}件)`).join("、");
    const totalOther = otherEntries.reduce((s, [, e]) => s + e.length, 0);
    activities.push({ type: "その他", detail: `${otherSummary}（計${totalOther}件）`, priority: 9 });
  }

  return activities;
}

// 検出された分類から入力テンプレートを生成
function buildInputTemplate(fileActivities, browserActivities) {
  const SHORT_NAMES = {
    "資料作成": "資料", "文書作成": "文書", "集計作業": "集計",
    "画像関連": "画像", "設計": "設計", "CAD": "CAD",
    "測量": "測量", "点群": "点群",
    "会議": "Zoom", "Web作業": "Gmail",
    "AI活用（ChatGPT）": "AI", "AI活用（Claude）": "AI",
    "調査・リサーチ": "調査", "その他": "他",
    "開発作業": "開発", "メール対応": "メール",
    "文書": "文書", "動画": "動画",
  };

  const seen = new Set();
  const parts = [];
  for (const a of [...fileActivities, ...browserActivities]) {
    const short = SHORT_NAMES[a.type] || a.type;
    if (seen.has(short)) continue;
    seen.add(short);
    parts.push(short);
  }
  // 各分類に仮の時間0を付けて並べる
  return parts.map(p => `${p}0`).join(" ");
}

function detectGaps(fileEvents, browserEvents, startHour, endHour) {
  // 全イベントのタイムスタンプを抽出（時刻のみ）
  const timestamps = [];

  for (const f of fileEvents) {
    const m = f.modified.match(/(\d+):(\d+):(\d+)/);
    if (m) timestamps.push(parseInt(m[1]) * 60 + parseInt(m[2]));
  }
  for (const e of browserEvents) {
    const m = e.visitedAt.match(/(\d+):(\d+):(\d+)/);
    if (m) timestamps.push(parseInt(m[1]) * 60 + parseInt(m[2]));
  }

  timestamps.sort((a, b) => a - b);

  // startHour〜endHour の間で2時間以上の空白を検出
  const startMin = startHour * 60;
  const endMin = endHour * 60;
  const gaps = [];

  let prev = startMin;
  for (const t of timestamps) {
    if (t < startMin || t > endMin) continue;
    if (t - prev >= 120) {
      const fromH = Math.floor(prev / 60);
      const fromM = prev % 60;
      const toH = Math.floor(t / 60);
      const toM = t % 60;
      gaps.push({
        from: `${String(fromH).padStart(2, "0")}:${String(fromM).padStart(2, "0")}`,
        to: `${String(toH).padStart(2, "0")}:${String(toM).padStart(2, "0")}`,
        durationMin: t - prev,
      });
    }
    prev = t;
  }
  // 最後のイベントからendHourまで
  if (endMin - prev >= 120) {
    const fromH = Math.floor(prev / 60);
    const fromM = prev % 60;
    gaps.push({
      from: `${String(fromH).padStart(2, "0")}:${String(fromM).padStart(2, "0")}`,
      to: `${String(endHour).padStart(2, "0")}:00`,
      durationMin: endMin - prev,
    });
  }

  return gaps;
}

function groupByTimeBlock(files, browserEntries) {
  const blocks = {
    "午前 (08-12時)": { files: 0, web: 0, details: [] },
    "午後前半 (12-15時)": { files: 0, web: 0, details: [] },
    "午後後半 (15-18時)": { files: 0, web: 0, details: [] },
    "夜間 (18時以降)": { files: 0, web: 0, details: [] },
  };

  function getBlock(hour) {
    if (hour < 12) return "午前 (08-12時)";
    if (hour < 15) return "午後前半 (12-15時)";
    if (hour < 18) return "午後後半 (15-18時)";
    return "夜間 (18時以降)";
  }

  for (const f of files) {
    const m = f.modified.match(/(\d+):/);
    if (m) blocks[getBlock(parseInt(m[1]))].files++;
  }
  for (const e of browserEntries) {
    blocks[getBlock(e.visitedHour)].web++;
  }

  return blocks;
}

async function main() {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // ファイルスキャン結果を読み込み
  let fileData;
  try {
    fileData = JSON.parse(await fs.readFile(path.join(outputDir, `scan-${dateStr}.json`), "utf-8"));
  } catch {
    console.error("❌ scan-*.json が見つかりません。先に scan-files.mjs を実行してください。");
    process.exit(1);
  }

  // ブラウザ履歴を読み込み（なければスキップ）
  let browserData = { entries: [], byTag: {} };
  try {
    browserData = JSON.parse(await fs.readFile(path.join(outputDir, `browser-${dateStr}.json`), "utf-8"));
  } catch {
    console.warn("⚠ browser-*.json が見つかりません。ブラウザ履歴なしで生成します。");
  }

  const fileActivities = inferActivities(fileData.byCategory, fileData.files);
  const browserActivities = inferBrowserActivities(browserData.byTag);
  const gaps = detectGaps(fileData.files, browserData.entries, 8, 17);
  const timeBlocks = groupByTimeBlock(fileData.files, browserData.entries);

  const lines = [];
  lines.push(`# 活動要約 — ${dateStr}`);
  lines.push(`\n> ファイル: ${fileData.files.length}件 / Web履歴: ${browserData.entries.length}件 | 自動生成（要レビュー）\n`);

  // ファイル操作から推定した活動
  lines.push(`## ファイル操作からの推定\n`);
  if (fileActivities.length === 0) {
    lines.push(`- ファイル操作が少なく、推定できませんでした\n`);
  } else {
    for (const a of fileActivities) lines.push(`- **${a.type}**: ${a.detail}`);
    lines.push("");
  }

  // ブラウザ活動
  lines.push(`## Web活動からの推定\n`);
  if (browserActivities.length === 0) {
    lines.push(`- Web履歴が少なく、推定できませんでした\n`);
  } else {
    for (const a of browserActivities) lines.push(`- **${a.type}**: ${a.detail}`);
    lines.push("");
  }

  // 主要サイト上位10
  lines.push(`## 主なアクセスサイト\n`);
  lines.push(`| サイト | 件数 |`);
  lines.push(`|---|---|`);
  const topSites = Object.entries(browserData.byTag).sort((a, b) => b[1].length - a[1].length).slice(0, 10);
  for (const [tag, entries] of topSites) {
    lines.push(`| ${tag} | ${entries.length} |`);
  }
  lines.push("");

  // 時間帯別
  lines.push(`## 時間帯別の動き\n`);
  lines.push(`| 時間帯 | ファイル | Web | 状況 |`);
  lines.push(`|---|---|---|---|`);
  for (const [block, data] of Object.entries(timeBlocks)) {
    const status = (data.files + data.web === 0) ? "⚠ 操作なし" : "✓";
    lines.push(`| ${block} | ${data.files}件 | ${data.web}件 | ${status} |`);
  }
  lines.push("");

  // 空白時間アラート
  if (gaps.length > 0) {
    lines.push(`## ⚠ 空白時間（2時間以上の操作なし）\n`);
    lines.push(`以下の時間帯にPC操作（ファイル・Web）が検出されませんでした。`);
    lines.push(`現場作業・研修・外出・会議等であれば、内容を追記してください。\n`);
    for (const g of gaps) {
      const hours = Math.floor(g.durationMin / 60);
      const mins = g.durationMin % 60;
      lines.push(`- **${g.from} 〜 ${g.to}**（${hours}時間${mins > 0 ? mins + "分" : ""}）→ 内容: ____________`);
    }
    lines.push("");
  }

  // LINE向け短縮版
  lines.push(`---\n`);
  lines.push(`## LINE通知用テキスト（案）\n`);
  lines.push("```");
  lines.push(`【活動ログ ${dateStr}】`);
  const allActivities = [...fileActivities, ...browserActivities].slice(0, 6);
  for (const a of allActivities) {
    const d = a.detail.length > 30 ? a.detail.substring(0, 30) + "…" : a.detail;
    lines.push(`・${a.type}: ${d}`);
  }
  if (gaps.length > 0) {
    lines.push(`\n⚠ 空白時間 ${gaps.length}件（要確認）`);
    for (const g of gaps) lines.push(`  ${g.from}〜${g.to}`);
  }
  lines.push(`（ファイル${fileData.files.length}件 / Web${browserData.entries.length}件）`);

  // 入力テンプレート生成
  const templateCats = buildInputTemplate(fileActivities, browserActivities);
  lines.push(``);
  lines.push(`▼ 返信用（コピペして時間を入力）`);
  lines.push(templateCats);
  lines.push(`場所 作業内容`);
  lines.push("```");

  lines.push(`\n---\n`);
  lines.push(`## レビューチェック`);
  lines.push(`- [ ] 活動推定は妥当か`);
  lines.push(`- [ ] 私用・機密項目を除外したか`);
  lines.push(`- [ ] 空白時間の内容を記入したか`);
  lines.push(`- [ ] LINE通知文の内容OK`);

  const summaryPath = path.join(outputDir, `summary-${dateStr}.md`);
  await fs.writeFile(summaryPath, lines.join("\n"), "utf-8");

  console.log(`✅ 活動要約を生成しました`);
  console.log(`📄 ${summaryPath}`);
  console.log(`\n--- 推定された活動 ---`);
  for (const a of [...fileActivities, ...browserActivities]) {
    console.log(`  ${a.type}: ${a.detail}`);
  }
  if (gaps.length > 0) {
    console.log(`\n⚠ 空白時間 ${gaps.length}件:`);
    for (const g of gaps) console.log(`  ${g.from} 〜 ${g.to}（${g.durationMin}分）`);
  }
}

main().catch(console.error);
