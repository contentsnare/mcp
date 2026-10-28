// Builds build/content-snare.mcpb (Claude Desktop extension) from dist/index.js.
// Run `npm run build:mcpb`, which rebuilds dist/index.js first.
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = path.join(root, "build", "mcpb");
const out = path.join(root, "build", "content-snare.mcpb");
const server = path.join(root, "dist", "index.js");

// The tool list shown on Claude Desktop's install screen, read from the built server
function listTools() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "inherit"] });
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n").slice(0, -1)) {
        const msg = JSON.parse(line);
        if (msg.id === 2) {
          child.kill();
          resolve(msg.result.tools.map((t) => ({ name: t.name, description: t.description })));
        }
      }
      buf = buf.slice(buf.lastIndexOf("\n") + 1);
    });
    child.on("error", reject);
    const send = (id, method, params) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    send(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "build-mcpb", version: "0" } });
    send(2, "tools/list", {});
  });
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "mcpb", "manifest.base.json"), "utf8"));
manifest.version = pkg.version;
manifest.tools = await listTools();

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, "server"), { recursive: true });
fs.copyFileSync(server, path.join(stage, "server", "index.js"));
fs.copyFileSync(path.join(root, "mcpb", "icon.png"), path.join(stage, "icon.png"));
fs.copyFileSync(path.join(root, "LICENSE"), path.join(stage, "LICENSE"));
fs.writeFileSync(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const mcpb = (...args) => {
  const r = spawnSync("npx", ["--no-install", "mcpb", ...args], { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
mcpb("validate", path.join(stage, "manifest.json"));
fs.rmSync(out, { force: true });
mcpb("pack", stage, out);
console.log(`\nBuilt ${path.relative(root, out)} (v${pkg.version}, ${manifest.tools.length} tools)`);
