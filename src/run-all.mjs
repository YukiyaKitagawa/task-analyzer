import { execSync } from "child_process";
import path from "path";

const srcDir = path.dirname(new URL(import.meta.url).pathname.substring(1));

const steps = [
  { name: "ファイルスキャン", script: "scan-files.mjs" },
  { name: "ブラウザ履歴", script: "scan-browser.mjs" },
  { name: "活動要約生成", script: "generate-summary.mjs" },
  { name: "DB用SQL生成", script: "export-for-db.mjs" },
];

for (const step of steps) {
  console.log(`\n▶ ${step.name}...`);
  try {
    const out = execSync(`node "${path.join(srcDir, step.script)}"`, {
      encoding: "utf-8",
      cwd: path.join(srcDir, ".."),
      timeout: 30000,
    });
    const lastLines = out.trim().split("\n").filter(l => l.startsWith("✅") || l.startsWith("📄"));
    for (const l of lastLines) console.log(`  ${l}`);
  } catch (e) {
    console.error(`  ❌ ${step.name} 失敗: ${e.message}`);
    process.exit(1);
  }
}

console.log("\n🎉 全ステップ完了。output/ フォルダにレビュー用ファイルが生成されました。");
