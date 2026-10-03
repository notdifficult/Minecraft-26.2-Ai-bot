const fs = require("fs");
const path = require("path");
const cfg = require("./config");

if (!fs.existsSync(cfg.MEMORY_DIR)) {
  fs.mkdirSync(cfg.MEMORY_DIR, { recursive: true });
}

function filePath(nick) {
  const safe = nick.replace(/[^a-zA-Z0-9_]/g, "_");
  return path.join(cfg.MEMORY_DIR, `${safe}.json`);
}

function load(nick) {
  const fp = filePath(nick);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return null;
  }
}

function save(nick, data) {
  fs.writeFileSync(filePath(nick), JSON.stringify(data, null, 2), "utf-8");
}

function getProfile(nick) {
  let p = load(nick);
  if (!p) {
    p = {
      nick: nick,
      vkId: null,
      history: [],
      facts: {},
      linked: false,
      createdAt: Date.now(),
      lastSeen: Date.now(),
    };
    save(nick, p);
  }
  return p;
}

function addMessage(nick, role, content, source = "vk") {
  const p = getProfile(nick);
  p.history.push({
    role: role,
    content: content,
    source: source,
    time: Date.now(),
  });

  const maxMsgs = cfg.MAX_HISTORY * 2;
  if (p.history.length > maxMsgs) {
    p.history = p.history.slice(-maxMsgs);
  }

  p.lastSeen = Date.now();
  save(nick, p);
  return p;
}

function linkVK(nick, vkId) {
  const p = getProfile(nick);
  p.vkId = vkId;
  p.linked = true;
  save(nick, p);
  return p;
}

function findByVK(vkId) {
  const files = fs.readdirSync(cfg.MEMORY_DIR);
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const p = JSON.parse(fs.readFileSync(path.join(cfg.MEMORY_DIR, f), "utf-8"));
      if (p.vkId === vkId) return p;
    } catch {}
  }
  return null;
}

function setFact(nick, key, value) {
  const p = getProfile(nick);
  p.facts[key] = value;
  save(nick, p);
}

module.exports = {
  getProfile,
  addMessage,
  linkVK,
  findByVK,
  setFact,
  save,
};
