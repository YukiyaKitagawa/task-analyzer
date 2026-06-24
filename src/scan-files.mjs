import fs from "fs/promises";
import path from "path";

const SCAN_ROOT = "C:\\Users\\yukiy\\OneDrive - 永野建設(株)";

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".venv", "__pycache__", ".cache",
  "$RECYCLE.BIN", "System Volume Information", ".tmp",
]);

const SKIP_EXTENSIONS = new Set([
  ".tmp", ".log", ".lock", ".lnk", ".crdownload",
  ".kin", ".kss", ".key", ".nbc", ".nbi", ".tsv",
  ".psd", ".ai", ".fig",
  ".zip", ".rar", ".7z",
]);

const EXT_CATEGORY = {
  ".xlsx": "集計・表計算", ".xls": "集計・表計算", ".xlsm": "集計・表計算",
  ".pptx": "資料作成", ".ppt": "資料作成",
  ".docx": "文書作成", ".doc": "文書作成", ".txt": "文書作成", ".md": "文書作成",
  ".pdf": "文書", ".xdw": "文書",
  ".png": "画像", ".jpg": "画像", ".jpeg": "画像", ".gif": "画像", ".svg": "画像", ".webp": "画像",
  ".mp4": "動画", ".mov": "動画", ".avi": "動画",
  // CAD
  ".sfc": "CAD", ".ant": "CAD", ".dwg": "CAD", ".dxf": "CAD",
  // 設計
  ".step": "設計", ".stl": "設計", ".ifc": "設計", ".rvt": "設計", ".skp": "設計", ".sketch": "設計",
  ".p21": "設計", ".kstr": "設計", ".ksar": "設計", ".ksnx": "設計", ".nxpg": "設計",
  // 測量・点群
  ".las": "測量", ".csv": "測量", ".sim": "測量", ".kspg": "測量", ".kspc": "点群",
  ".js": "開発", ".ts": "開発", ".py": "開発", ".html": "開発", ".css": "開発", ".json": "開発",
  ".eml": "メール", ".msg": "メール",
};


function categorize(ext) {
  return EXT_CATEGORY[ext.toLowerCase()] || "その他";
}

async function scanDir(dir, since, results) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanDir(full, since, results);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (SKIP_EXTENSIONS.has(ext)) continue;
      try {
        const stat = await fs.stat(full);
        if (stat.mtimeMs >= since) {
          results.push({
            name: entry.name,
            path: full,
            ext,
            category: categorize(ext),
            modified: new Date(stat.mtimeMs).toLocaleString("ja-JP"),
            sizeKB: Math.round(stat.size / 1024),
          });
        }
      } catch {
        // permission denied etc.
      }
    }
  }
}

async function main() {
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0).getTime();

  console.log(`スキャン対象: ${SCAN_ROOT}`);
  console.log(`対象期間: ${new Date(since).toLocaleString("ja-JP")} 〜 現在\n`);

  const results = [];
  await scanDir(SCAN_ROOT, since, results);
  results.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  // カテゴリ別集計
  const byCategory = {};
  for (const f of results) {
    (byCategory[f.category] ??= []).push(f);
  }

  // ドラフト生成
  const lines = [];
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  lines.push(`# 日次活動ログ — ${dateStr}`);
  lines.push(`\n> スキャン: ${SCAN_ROOT}`);
  lines.push(`> 期間: 当日 08:00 〜 ${now.toLocaleTimeString("ja-JP")}`);
  lines.push(`> 検出ファイル数: ${results.length}\n`);

  lines.push(`## カテゴリ別サマリ\n`);
  lines.push(`| カテゴリ | 件数 | 主なファイル |`);
  lines.push(`|---|---|---|`);
  for (const [cat, files] of Object.entries(byCategory)) {
    const samples = files.slice(0, 3).map((f) => f.name).join(", ");
    const more = files.length > 3 ? ` 他${files.length - 3}件` : "";
    lines.push(`| ${cat} | ${files.length} | ${samples}${more} |`);
  }

  lines.push(`\n## ファイル一覧（カテゴリ別 上位5件）\n`);
  for (const [cat, files] of Object.entries(byCategory)) {
    lines.push(`### ${cat}（${files.length}件）`);
    for (const f of files.slice(0, 5)) {
      lines.push(`- ${f.name} (${f.sizeKB}KB, ${f.modified})`);
      lines.push(`  - ${f.path}`);
    }
    if (files.length > 5) {
      lines.push(`- _...他 ${files.length - 5}件（全件は scan-${dateStr}.json を参照）_`);
    }
    lines.push("");
  }

  lines.push(`---\n`);
  lines.push(`## 要確認事項`);
  lines.push(`- [ ] 私用ファイルが含まれていないか`);
  lines.push(`- [ ] 機密情報を含むファイル名がないか`);
  lines.push(`- [ ] カテゴリ分類は妥当か`);

  const outputDir = path.join(path.dirname(new URL(import.meta.url).pathname.substring(1)), "..", "output");
  const outPath = path.join(outputDir, `draft-${dateStr}.md`);
  const jsonPath = path.join(outputDir, `scan-${dateStr}.json`);
  await fs.writeFile(outPath, lines.join("\n"), "utf-8");
  await fs.writeFile(jsonPath, JSON.stringify({ date: dateStr, scanRoot: SCAN_ROOT, since: new Date(since).toISOString(), files: results, byCategory }, null, 2), "utf-8");

  console.log(`✅ ${results.length} 件のファイルを検出`);
  for (const [cat, files] of Object.entries(byCategory)) {
    console.log(`   ${cat}: ${files.length}件`);
  }
  console.log(`\n📄 ドラフト保存先: ${outPath}`);
}

main().catch(console.error);
