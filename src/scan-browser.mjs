import Database from "better-sqlite3";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";

const BROWSERS = [
  { name: "Chrome",  dbPath: path.join(os.homedir(), "AppData/Local/Google/Chrome/User Data/Default/History") },
  { name: "Edge",    dbPath: path.join(os.homedir(), "AppData/Local/Microsoft/Edge/User Data/Default/History") },
  { name: "Brave",   dbPath: path.join(os.homedir(), "AppData/Local/BraveSoftware/Brave-Browser/User Data/Default/History") },
];

// Chromium epoch: 1601-01-01 からのマイクロ秒
const CHROMIUM_EPOCH_OFFSET = 11644473600000000n;

function chromiumTimeToDate(microseconds) {
  const ms = Number((BigInt(microseconds) - CHROMIUM_EPOCH_OFFSET) / 1000n);
  return new Date(ms);
}

function readHistory(browser, sinceDate) {
  if (!fs.existsSync(browser.dbPath)) return [];

  // ブラウザがDBをロック中の場合があるので、一時コピーして読む
  const tmpPath = path.join(os.tmpdir(), `history_${browser.name}_${Date.now()}.db`);
  try {
    fs.copyFileSync(browser.dbPath, tmpPath);
  } catch {
    console.warn(`  ⚠ ${browser.name}: 履歴DBのコピーに失敗（ブラウザ使用中の可能性）`);
    return [];
  }

  let results = [];
  try {
    const db = new Database(tmpPath, { readonly: true, fileMustExist: true });
    const sinceChromium = (BigInt(sinceDate.getTime()) * 1000n + CHROMIUM_EPOCH_OFFSET).toString();

    const rows = db.prepare(`
      SELECT url, title, visit_count, last_visit_time
      FROM urls
      WHERE last_visit_time > ?
      ORDER BY last_visit_time DESC
    `).all(sinceChromium);

    for (const row of rows) {
      const visited = chromiumTimeToDate(row.last_visit_time);
      results.push({
        browser: browser.name,
        url: row.url,
        title: row.title || "(タイトルなし)",
        visitCount: row.visit_count,
        visitedAt: visited.toLocaleString("ja-JP"),
        visitedHour: visited.getHours(),
      });
    }
    db.close();
  } catch (e) {
    console.warn(`  ⚠ ${browser.name}: 履歴の読み取りに失敗 (${e.message})`);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
  return results;
}

// 業務系サイトのタグ付け
const SITE_TAGS = [
  { pattern: /google\.com\/(spreadsheets|document|presentation|drive)/i, tag: "Google Workspace" },
  { pattern: /docs\.google\.com/i, tag: "Google Docs" },
  { pattern: /mail\.google\.com/i, tag: "Gmail" },
  { pattern: /calendar\.google\.com/i, tag: "Google Calendar" },
  { pattern: /meet\.google\.com/i, tag: "会議 (Google Meet)" },
  { pattern: /zoom\.us/i, tag: "会議 (Zoom)" },
  { pattern: /teams\.microsoft\.com|teams\.live\.com/i, tag: "会議 (Teams)" },
  { pattern: /slack\.com/i, tag: "Slack" },
  { pattern: /notion\.so/i, tag: "Notion" },
  { pattern: /github\.com/i, tag: "GitHub" },
  { pattern: /chatgpt\.com|chat\.openai\.com/i, tag: "ChatGPT" },
  { pattern: /claude\.ai/i, tag: "Claude" },
  { pattern: /office\.com|sharepoint\.com|onedrive\.live\.com/i, tag: "Microsoft 365" },
  { pattern: /youtube\.com/i, tag: "YouTube" },
  { pattern: /amazon\.co\.jp|amazon\.com/i, tag: "Amazon" },
];

function tagSite(url) {
  for (const { pattern, tag } of SITE_TAGS) {
    if (pattern.test(url)) return tag;
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "不明";
  }
}

async function main() {
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0);

  console.log(`ブラウザ履歴スキャン: 当日 08:00 〜 現在\n`);

  let allHistory = [];
  for (const browser of BROWSERS) {
    const entries = readHistory(browser, since);
    console.log(`  ${browser.name}: ${entries.length}件`);
    allHistory.push(...entries);
  }

  // URL重複排除（同じURLは最新のものを残す）
  const urlMap = new Map();
  for (const entry of allHistory) {
    const existing = urlMap.get(entry.url);
    if (!existing || entry.visitedAt > existing.visitedAt) {
      urlMap.set(entry.url, entry);
    }
  }
  const unique = [...urlMap.values()];

  // タグ付け
  for (const entry of unique) {
    entry.siteTag = tagSite(entry.url);
  }

  // chrome://, edge://, brave:// 等の内部URLを除外
  const filtered = unique.filter(e => /^https?:\/\//i.test(e.url));

  // サイトタグ別集計
  const byTag = {};
  for (const e of filtered) {
    (byTag[e.siteTag] ??= []).push(e);
  }

  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const outputDir = path.join(path.dirname(new URL(import.meta.url).pathname.substring(1)), "..", "output");
  const jsonPath = path.join(outputDir, `browser-${dateStr}.json`);
  await fsp.writeFile(jsonPath, JSON.stringify({ date: dateStr, total: filtered.length, entries: filtered, byTag }, null, 2), "utf-8");

  console.log(`\n✅ ${filtered.length}件（重複排除済み）`);
  console.log(`\n--- サイト別集計 ---`);
  const sorted = Object.entries(byTag).sort((a, b) => b[1].length - a[1].length);
  for (const [tag, entries] of sorted.slice(0, 10)) {
    console.log(`  ${tag}: ${entries.length}件`);
  }
  if (sorted.length > 10) console.log(`  ...他 ${sorted.length - 10} サイト`);
  console.log(`\n📄 ${jsonPath}`);
}

main().catch(console.error);
