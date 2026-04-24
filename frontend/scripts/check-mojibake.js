/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "src");
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".md"]);
const SUSPICIOUS_TOKENS = [
  "Ã§",
  "Ã£",
  "Ã¡",
  "Ã©",
  "Ãª",
  "Ã­",
  "Ã³",
  "Ãº",
  "Ãµ",
  "Ã¢",
  "Ã‰",
  "Ã“",
  "Â·",
  "ÃƒÂ",
  "â€¢",
  "â€“",
  "â€”",
  "â€œ",
  "â€",
  "â€˜",
  "â€™",
  "�",
];

function walk(dir, acc) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, acc);
      continue;
    }
    if (!EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    acc.push(fullPath);
  }
}

const files = [];
walk(ROOT, files);

let hasError = false;
for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (SUSPICIOUS_TOKENS.some((token) => line.includes(token))) {
      hasError = true;
      console.error(`${path.relative(path.resolve(__dirname, ".."), file)}:${idx + 1}: possível mojibake -> ${line.trim()}`);
    }
  });
}

if (hasError) {
  console.error("\nFalha: texto com encoding corrompido detectado.");
  process.exit(1);
}

console.log("OK: nenhum padrão de mojibake detectado em frontend/src.");
