#!/bin/sh
# 将 chuanban-dsh-writingset 注册到 DSH 桌面版 profile（带备份，可重复执行）
set -e
P="${DSH_PROFILE:-$HOME/.dsh/profiles/desktop}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$P/package.json.bak-d147" ] || cp "$P/package.json" "$P/package.json.bak-d147"
mkdir -p "$P/node_modules"
ln -sfn "$SRC" "$P/node_modules/chuanban-dsh-writingset"
node -e '
const fs=require("fs");const [dir,src]=process.argv.slice(1);const f=dir+"/package.json";
const j=JSON.parse(fs.readFileSync(f,"utf8"));
j.dependencies=j.dependencies||{};j.dependencies["chuanban-dsh-writingset"]="file:"+src;
j.dsh=j.dsh||{};j.dsh.profile=j.dsh.profile||{};const b=j.dsh.profile.bundles=j.dsh.profile.bundles||[];
if(!b.includes("chuanban-dsh-writingset"))b.push("chuanban-dsh-writingset");
fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");' "$P" "$SRC"
echo "registered into $P"; cat "$P/package.json"
