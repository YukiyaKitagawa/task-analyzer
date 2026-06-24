import fs from "fs/promises";
import path from "path";

const outputDir = path.join(path.dirname(new URL(import.meta.url).pathname.substring(1)), "..", "output");

async function main() {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  let fileData, browserData;
  try {
    fileData = JSON.parse(await fs.readFile(path.join(outputDir, `scan-${dateStr}.json`), "utf-8"));
  } catch {
    console.error("❌ scan-*.json がありません");
    process.exit(1);
  }
  try {
    browserData = JSON.parse(await fs.readFile(path.join(outputDir, `browser-${dateStr}.json`), "utf-8"));
  } catch {
    browserData = { entries: [], total: 0 };
  }

  let summaryText = "";
  try {
    summaryText = await fs.readFile(path.join(outputDir, `summary-${dateStr}.md`), "utf-8");
  } catch {}

  // Supabase INSERT用SQLを生成
  const escapeSql = (s) => s.replace(/'/g, "''").replace(/\\/g, "\\\\");

  const lines = [];
  lines.push(`-- activity_scans`);
  lines.push(`INSERT INTO activity_scans (scan_date, file_count, browser_count, summary_text, review_status)`);
  lines.push(`VALUES ('${dateStr}', ${fileData.files.length}, ${browserData.total}, '${escapeSql(summaryText.substring(0, 10000))}', 'draft')`);
  lines.push(`ON CONFLICT (scan_date) DO UPDATE SET file_count = EXCLUDED.file_count, browser_count = EXCLUDED.browser_count, summary_text = EXCLUDED.summary_text`);
  lines.push(`RETURNING id;\n`);

  // file_logs INSERT
  if (fileData.files.length > 0) {
    lines.push(`-- file_logs`);
    lines.push(`WITH scan AS (SELECT id FROM activity_scans WHERE scan_date = '${dateStr}')`);
    lines.push(`INSERT INTO file_logs (scan_id, file_name, file_path, extension, category, size_kb, modified_at)`);
    lines.push(`SELECT scan.id,`);
    lines.push(`  v.file_name, v.file_path, v.extension, v.category, v.size_kb, v.modified_at`);
    lines.push(`FROM scan, (VALUES`);
    const fileVals = fileData.files.map(f => {
      const modIso = parseJaDate(f.modified);
      return `  ('${escapeSql(f.name)}', '${escapeSql(f.path)}', '${escapeSql(f.ext)}', '${escapeSql(f.category)}', ${f.sizeKB}, '${modIso}'::timestamptz)`;
    });
    lines.push(fileVals.join(",\n"));
    lines.push(`) AS v(file_name, file_path, extension, category, size_kb, modified_at);`);
    lines.push("");
  }

  // browser_logs INSERT (上位100件に絞る)
  const topBrowser = browserData.entries.slice(0, 100);
  if (topBrowser.length > 0) {
    lines.push(`-- browser_logs`);
    lines.push(`WITH scan AS (SELECT id FROM activity_scans WHERE scan_date = '${dateStr}')`);
    lines.push(`INSERT INTO browser_logs (scan_id, browser, url, title, site_tag, visit_count, visited_at)`);
    lines.push(`SELECT scan.id,`);
    lines.push(`  v.browser, v.url, v.title, v.site_tag, v.visit_count, v.visited_at`);
    lines.push(`FROM scan, (VALUES`);
    const bVals = topBrowser.map(e => {
      const visitIso = parseJaDate(e.visitedAt);
      return `  ('${escapeSql(e.browser)}', '${escapeSql(e.url)}', '${escapeSql(e.title)}', '${escapeSql(e.siteTag || "")}', ${e.visitCount || 1}, '${visitIso}'::timestamptz)`;
    });
    lines.push(bVals.join(",\n"));
    lines.push(`) AS v(browser, url, title, site_tag, visit_count, visited_at);`);
  }

  const sqlPath = path.join(outputDir, `db-insert-${dateStr}.sql`);
  await fs.writeFile(sqlPath, lines.join("\n"), "utf-8");
  console.log(`✅ SQL生成完了: ${sqlPath}`);
  console.log(`   ファイルログ: ${fileData.files.length}件 / ブラウザログ: ${topBrowser.length}件`);
}

function parseJaDate(jaDate) {
  // "2026/6/24 20:41:17" → ISO形式
  const m = jaDate.match(/(\d{4})\/(\d+)\/(\d+)\s+(\d+):(\d+):(\d+)/);
  if (!m) return new Date().toISOString();
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T${m[4].padStart(2, "0")}:${m[5].padStart(2, "0")}:${m[6].padStart(2, "0")}+09:00`;
}

main().catch(console.error);
