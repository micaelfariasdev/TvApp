
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "codigo-completo.txt");

const IGNORE_DIRS = new Set([
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    "coverage",
    ".cache",
    ".turbo"
]);

const EXTENSIONS = new Set([
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".html",
    ".htm"
]);

const IGNORE_FILES = new Set([
    "extrair-codigo.js",
    "codigo-completo.txt"
]);

let totalFiles = 0;
let totalLines = 0;

const output = fs.createWriteStream(OUTPUT, {
    encoding: "utf8"
});

function walk(directory) {
    const entries = fs.readdirSync(directory, {
        withFileTypes: true
    });

    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);

        if (entry.isSymbolicLink()) continue;

        if (entry.isDirectory()) {
            if (IGNORE_DIRS.has(entry.name)) continue;

            walk(fullPath);
            continue;
        }

        if (!entry.isFile()) continue;

        if (IGNORE_FILES.has(entry.name)) continue;

        const extension = path.extname(entry.name).toLowerCase();

        if (!EXTENSIONS.has(extension)) continue;

        const relativePath = path.relative(ROOT, fullPath);

        try {
            const content = fs.readFileSync(fullPath, "utf8");

            const lines = content.split(/\r?\n/).length;

            output.write("\n");
            output.write("=".repeat(90) + "\n");
            output.write("ARQUIVO: " + relativePath + "\n");
            output.write("LINHAS: " + lines + "\n");
            output.write("=".repeat(90) + "\n\n");

            output.write(content);
            output.write("\n");

            totalFiles++;
            totalLines += lines;

            console.log("[OK]", relativePath);
        } catch (error) {
            console.error("[ERRO]", relativePath, error.message);
        }
    }
}

console.log("Iniciando extração...");
console.log("Pasta:", ROOT);

walk(ROOT);

output.end(() => {
    console.log("\n================================");
    console.log("EXTRAÇÃO FINALIZADA");
    console.log("================================");
    console.log("Arquivos:", totalFiles);
    console.log("Linhas:", totalLines);
    console.log("Saída:", OUTPUT);
});
