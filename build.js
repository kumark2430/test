const fs = require("fs");
const path = require("path");

const root = __dirname;
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const config = fs.readFileSync(path.join(root, "config.js"), "utf8").trim();
const app = fs.readFileSync(path.join(root, "app.js"), "utf8").trim();

html = html.replace(/<script type="application\/x-rts-legacy">[\s\S]*?<\/script>\s*/, "");
html = html.replace('<script src="./config.js"></script>', `<script>\n${config}\n</script>`);
html = html.replace('<script src="./app.js"></script>', `<script>\n${app}\n</script>`);

const output = path.join(root, "dist");
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "index.html"), html);
fs.copyFileSync(path.join(root, "vercel.json"), path.join(output, "vercel.json"));
fs.copyFileSync(path.join(root, "employee-import-template.csv"), path.join(output, "employee-import-template.csv"));
fs.cpSync(path.join(root, "api"), path.join(output, "api"), { recursive: true });
console.log("Built dist/index.html");
