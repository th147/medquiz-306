const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin306';

// ── Security ──────────────────────────────────────────────
app.set('trust proxy', 1);

// Force HTTPS
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self' blob:");
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Database Setup ──────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'data.db');
const GITHUB_TOKEN = process.env.GH_TOKEN || '';
const GITHUB_REPO = 'th147/medquiz-306';
const BACKUP_PATH = 'backup/data.db';
const BACKUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

// ── GitHub Backup Sync ──────────────────────────────────────
function githubApi(method, apiPath, body) {
  return new Promise((resolve) => {
    try {
      const url = 'https://api.github.com/repos/' + GITHUB_REPO + '/contents/' + apiPath;
      let cmd = `curl -s -X ${method} -H "Authorization: token ${GITHUB_TOKEN}" -H "Accept: application/vnd.github.v3+json" -H "User-Agent: medquiz-backup" --max-time 30`;
      if (body) {
        const bodyStr = JSON.stringify(body);
        cmd += ` -H "Content-Type: application/json" -d '${bodyStr.replace(/'/g, "'\\''")}'`;
      }
      cmd += ` "${url}"`;
      const result = execSync(cmd, { timeout: 35000, encoding: 'utf-8' });
      const data = JSON.parse(result);
      resolve({ status: 200, data });
    } catch(e) {
      try {
        const data = JSON.parse(e.stdout || '{}');
        resolve({ status: e.status || 0, data });
      } catch(e2) {
        resolve({ status: 0, data: null });
      }
    }
  });
}

async function downloadDb() {
  if (!GITHUB_TOKEN) { console.log('[备份] 未配置 GH_TOKEN，跳过'); return false; }
  try {
    console.log('[备份] 正在从 GitHub 下载数据库...');
    const getRes = await githubApi('GET', BACKUP_PATH);
    if (getRes.status !== 200 || !getRes.data || !getRes.data.content) {
      console.log('[备份] GitHub 无备份，将使用本地数据库');
      return false;
    }
    const buf = Buffer.from(getRes.data.content, 'base64');
    const sha = getRes.data.sha;
    fs.writeFileSync(DB_PATH, buf);
    console.log('[备份] 数据库下载成功 (' + (buf.length / 1024).toFixed(1) + ' KB), sha=' + sha);
    return sha;
  } catch(e) {
    console.log('[备份] 下载失败: ' + e.message);
    return false;
  }
}

async function uploadDb(sha) {
  if (!GITHUB_TOKEN) return sha;
  try {
    const buf = fs.readFileSync(DB_PATH);
    const content = buf.toString('base64');
    const body = { message: 'auto backup ' + new Date().toISOString(), content: content };
    if (sha) body.sha = sha;
    const res = await githubApi('PUT', BACKUP_PATH, body);
    if (res.status === 200 || res.status === 201) {
      console.log('[备份] 数据库备份成功 (' + (buf.length / 1024).toFixed(1) + ' KB)');
      return res.data.sha;
    }
    console.log('[备份] 备份失败 HTTP ' + res.status);
    return sha;
  } catch(e) {
    console.log('[备份] 备份异常: ' + e.message);
    return sha;
  }
}

let backupSha = null;

async function syncStartup() {
  backupSha = await downloadDb();
}

setInterval(() => {
  uploadDb(backupSha).then(newSha => { if (newSha) backupSha = newSha; });
}, BACKUP_INTERVAL);

// Also backup on graceful shutdown
process.on('SIGTERM', () => { uploadDb(backupSha); process.exit(0); });
process.on('SIGINT', () => { uploadDb(backupSha); process.exit(0); });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    activation_code TEXT UNIQUE,
    nickname TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS activation_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    is_used INTEGER DEFAULT 0,
    used_by TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    chapter TEXT DEFAULT '',
    type TEXT DEFAULT 'A1',
    question TEXT NOT NULL,
    options TEXT NOT NULL,
    answer TEXT NOT NULL,
    explanation TEXT DEFAULT '',
    video_url TEXT DEFAULT '',
    year TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    question_id TEXT NOT NULL,
    selected_answer TEXT NOT NULL,
    is_correct INTEGER NOT NULL,
    self_assessment TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (question_id) REFERENCES questions(id)
  );
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_size INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    question_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (question_id) REFERENCES questions(id)
  );
  CREATE TABLE IF NOT EXISTS comment_likes (
    user_id INTEGER NOT NULL,
    comment_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, comment_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS comment_favorites (
    user_id INTEGER NOT NULL,
    comment_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, comment_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
  );
`);

// ── Migration: add year column if missing ──
try { db.exec('ALTER TABLE questions ADD COLUMN year TEXT DEFAULT \'\''); } catch(e) { /* already exists */ }
// ── Migration: add avatar column if missing ──
try { db.exec('ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT \'\''); } catch(e) { /* already exists */ }
// ── Migration: add pages column to notes if missing ──
try { db.exec('ALTER TABLE notes ADD COLUMN pages INTEGER DEFAULT 0'); } catch(e) { /* already exists */ }

// ── PDF pre-conversion cache ─────────────────────────────────
const pdfCacheDir = path.join(__dirname, 'public', 'uploads', 'pdf_cache');
if (!fs.existsSync(pdfCacheDir)) fs.mkdirSync(pdfCacheDir, { recursive: true });

function convertPdfPages(noteId, pdfPath) {
  const cacheDir = path.join(pdfCacheDir, 'note_' + noteId);
  if (fs.existsSync(cacheDir)) {
    const existing = fs.readdirSync(cacheDir).filter(f => f.endsWith('.png')).length;
    if (existing > 0) return existing; // already cached
  }
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  // Convert all pages at once with -png flag
  try {
    execSync(`pdftoppm -png -r 150 "${pdfPath}" "${cacheDir}/page"`, { timeout: 120000 });
    const count = fs.readdirSync(cacheDir).filter(f => f.endsWith('.png')).length;
    return count;
  } catch(e) {
    console.error('PDF conversion failed:', e.message);
    return 0;
  }
}

// Seed default admin & activation codes
const seedAdmin = db.prepare('INSERT OR IGNORE INTO users (username, password_hash, is_admin, activation_code, nickname) VALUES (?,?,1,?,?)');
const hash = bcrypt.hashSync('admin306', 10);
seedAdmin.run('admin', hash, 'ADMIN-ROOT', '管理员');

const seedCodes = db.prepare('INSERT OR IGNORE INTO activation_codes (code) VALUES (?)');
const defaultCodes = ['MED306START','XIZONG306OK','306PASS2026','WESTMED001','DOCTOR306','MEDICAL25'];
defaultCodes.forEach(c => seedCodes.run(c));

// Auto-seed 2000年真题 if database is empty (skip if cleared by admin)
const questionCount = db.prepare('SELECT COUNT(*) as cnt FROM questions').get();
const noAutoseed = fs.existsSync(path.join(__dirname, '.no_autoseed'));
if (questionCount.cnt === 0 && !noAutoseed) {
  try {
    const examPath = path.join(__dirname, 'public', '2000年真题.json');
    if (fs.existsSync(examPath)) {
      const examData = JSON.parse(fs.readFileSync(examPath, 'utf-8'));
      const insertQ = db.prepare('INSERT OR IGNORE INTO questions (id,chapter,type,question,options,answer,explanation,video_url,year) VALUES (?,?,?,?,?,?,?,?,?)');
      const insertMany = db.transaction(() => {
        examData.forEach((item, i) => {
          insertQ.run(
            'q2000_' + (i + 1),
            item.chapter || '西医综合',
            item.type || 'A1',
            item.question,
            JSON.stringify(item.options),
            item.answer,
            item.explanation || '',
            item.videoUrl || item.video_url || '',
            item.year || '2000'
          );
        });
      });
      insertMany();
      console.log(`  📝 自动导入2000年真题 ${examData.length} 道题`);
    }
  } catch(e) {
    console.log('  ⚠️ 2000年真题自动导入失败:', e.message);
  }
}

// ── Auth Middleware ──────────────────────────────────────────
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({error:'未登录'});
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    req.user = decoded;
    next();
  } catch(e) {
    return res.status(401).json({error:'登录已过期'});
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user.is_admin) return res.status(403).json({error:'需要管理员权限'});
  next();
}

// ── Auth Routes ──────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({error:'请输入用户名和密码'});
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({error:'用户名或密码错误'});
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({error:'用户名或密码错误'});
  const token = jwt.sign({ id:user.id, username:user.username, is_admin:!!user.is_admin, nickname:user.nickname, avatar:user.avatar||'' }, JWT_SECRET, { expiresIn:'30d' });
  res.json({ token, user:{ id:user.id, username:user.username, is_admin:!!user.is_admin, nickname:user.nickname, avatar:user.avatar||'' } });
});

app.post('/api/auth/register', (req, res) => {
  const { username, password, activationCode, nickname } = req.body;
  if (!username || !password || !activationCode) return res.status(400).json({error:'请填写完整信息'});
  if (username.length < 2 || username.length > 20) return res.status(400).json({error:'用户名需要2-20个字符'});
  if (password.length < 6) return res.status(400).json({error:'密码至少6位'});

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(400).json({error:'用户名已被占用'});

  const code = db.prepare('SELECT * FROM activation_codes WHERE code = ?').get(activationCode.toUpperCase());
  if (!code) return res.status(400).json({error:'激活码无效'});
  if (code.is_used) return res.status(400).json({error:'该激活码已被使用'});

  const hash = bcrypt.hashSync(password, 10);
  const insertUser = db.prepare('INSERT INTO users (username, password_hash, activation_code, nickname) VALUES (?,?,?,?)');
  const result = insertUser.run(username, hash, activationCode.toUpperCase(), nickname || username);

  db.prepare('UPDATE activation_codes SET is_used=1, used_by=? WHERE code=?').run(username, activationCode.toUpperCase());

  const token = jwt.sign({ id:result.lastInsertRowid, username, is_admin:false, nickname:nickname||username, avatar:'' }, JWT_SECRET, { expiresIn:'30d' });
  res.json({ token, user:{ id:result.lastInsertRowid, username, is_admin:false, nickname:nickname||username, avatar:'' } });
});

// ── Question Routes ──────────────────────────────────────────
app.get('/api/questions', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM questions ORDER BY created_at DESC').all();
  const questions = rows.map(r => ({ ...r, options: JSON.parse(r.options) }));
  res.json(questions);
});

app.post('/api/questions', authMiddleware, adminMiddleware, (req, res) => {
  const { chapter, type, question, options, answer, explanation, videoUrl, year } = req.body;
  if (!question || !options || !answer) return res.status(400).json({error:'缺少必要字段'});
  const id = 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
  db.prepare('INSERT INTO questions (id,chapter,type,question,options,answer,explanation,video_url,year) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, chapter||'', type||'A1', question, JSON.stringify(options), answer.toUpperCase(), explanation||'', videoUrl||'', year||'');
  res.json({ id, message:'题目已添加' });
});

app.put('/api/questions/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { chapter, type, question, options, answer, explanation, videoUrl, year } = req.body;
  db.prepare('UPDATE questions SET chapter=?,type=?,question=?,options=?,answer=?,explanation=?,video_url=?,year=? WHERE id=?')
    .run(chapter||'', type||'A1', question, JSON.stringify(options), answer.toUpperCase(), explanation||'', videoUrl||'', year||'', req.params.id);
  res.json({ message:'题目已更新' });
});

app.delete('/api/questions/:id', authMiddleware, adminMiddleware, (req, res) => {
  db.prepare('DELETE FROM questions WHERE id=?').run(req.params.id);
  res.json({ message:'题目已删除' });
});

// ── Exam Paper Routes ─────────────────────────────────────────
app.get('/api/exam-papers', authMiddleware, (req, res) => {
  const years = db.prepare("SELECT DISTINCT year FROM questions WHERE year != '' ORDER BY year DESC").all();
  const papers = years.map(y => {
    const total = db.prepare('SELECT COUNT(*) as cnt FROM questions WHERE year=?').get(y.year).cnt;
    const done = db.prepare('SELECT COUNT(DISTINCT question_id) as cnt FROM records WHERE user_id=? AND question_id IN (SELECT id FROM questions WHERE year=?)').get(req.user.id, y.year).cnt;
    return { year: y.year, total, done };
  });
  res.json(papers);
});

app.get('/api/exam-papers/:year', authMiddleware, (req, res) => {
  const year = req.params.year;
  const rows = db.prepare('SELECT * FROM questions WHERE year=? ORDER BY id ASC').all(year);
  const questions = rows.map(r => ({ ...r, options: JSON.parse(r.options) }));
  res.json(questions);
});

// ── Record Routes ────────────────────────────────────────────
app.get('/api/records', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM records WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows);
});

app.post('/api/records', authMiddleware, (req, res) => {
  const { questionId, selectedAnswer, isCorrect, selfAssessment } = req.body;
  const result = db.prepare('INSERT INTO records (user_id,question_id,selected_answer,is_correct,self_assessment) VALUES (?,?,?,?,?)')
    .run(req.user.id, questionId, selectedAnswer, isCorrect?1:0, selfAssessment||'');
  res.json({ id: result.lastInsertRowid });
});

// ── Admin Routes ─────────────────────────────────────────────
app.get('/api/admin/codes', authMiddleware, adminMiddleware, (req, res) => {
  const codes = db.prepare('SELECT * FROM activation_codes ORDER BY created_at DESC').all();
  res.json(codes);
});

app.post('/api/admin/codes', authMiddleware, adminMiddleware, (req, res) => {
  const { count, prefix } = req.body;
  const n = Math.min(count || 5, 100);
  const pfx = (prefix || 'MED').toUpperCase();
  const generated = [];
  const insert = db.prepare('INSERT OR IGNORE INTO activation_codes (code) VALUES (?)');
  const insertMany = db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const code = pfx + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0,8);
      const r = insert.run(code);
      if (r.changes > 0) generated.push(code);
    }
  });
  insertMany();
  res.json({ codes: generated });
});

app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  const users = db.prepare('SELECT id,username,nickname,is_admin,activation_code,created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

app.delete('/api/admin/questions', authMiddleware, adminMiddleware, (req, res) => {
  db.prepare('DELETE FROM records').run();
  db.prepare('DELETE FROM comments').run();
  db.prepare('DELETE FROM comment_likes').run();
  db.prepare('DELETE FROM comment_favorites').run();
  db.prepare('DELETE FROM questions').run();
  // Prevent auto-seed on next restart
  fs.writeFileSync(path.join(__dirname, '.no_autoseed'), '1');
  res.json({ message: '题库已清空，下次启动不会自动导入' });
});

// ── Stats ────────────────────────────────────────────────────
app.get('/api/stats', authMiddleware, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as cnt FROM questions').get().cnt;
  const done = db.prepare('SELECT COUNT(DISTINCT question_id) as cnt FROM records WHERE user_id=?').get(req.user.id).cnt;

  const chapters = db.prepare('SELECT DISTINCT chapter FROM questions').all();
  const chapterStats = chapters.map(ch => {
    const qs = db.prepare('SELECT id FROM questions WHERE chapter=?').all(ch.chapter);
    const qDone = db.prepare('SELECT COUNT(DISTINCT question_id) as cnt FROM records WHERE user_id=? AND question_id IN (SELECT id FROM questions WHERE chapter=?)').get(req.user.id, ch.chapter).cnt;
    const weak = db.prepare(`
      SELECT COUNT(DISTINCT r.question_id) as cnt FROM records r
      INNER JOIN (SELECT question_id, MAX(id) as max_id FROM records WHERE user_id=? GROUP BY question_id) latest
      ON r.id = latest.max_id
      WHERE r.user_id=? AND (r.is_correct=0 OR r.self_assessment IN ('uncertain','not-know'))
      AND r.question_id IN (SELECT id FROM questions WHERE chapter=?)
    `).get(req.user.id, req.user.id, ch.chapter).cnt;
    return { chapter: ch.chapter, total: qs.length, done: qDone, weak };
  });

  res.json({ total, done, chapterStats });
});

// ── Notes ────────────────────────────────────────────────────
const notesDir = path.join(__dirname, 'public', 'uploads', 'notes');
if (!fs.existsSync(notesDir)) fs.mkdirSync(notesDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, notesDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    // Decode the original filename properly for Chinese characters
    const origName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, unique + '_' + origName);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.get('/api/notes', authMiddleware, (req, res) => {
  const notes = db.prepare('SELECT * FROM notes ORDER BY created_at DESC').all();
  res.json(notes);
});

app.post('/api/notes', authMiddleware, adminMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择文件' });
  const origName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const result = db.prepare('INSERT INTO notes (user_id,filename,original_name,file_size) VALUES (?,?,?,?)')
    .run(req.user.id, req.file.filename, origName, req.file.size);
  const noteId = result.lastInsertRowid;
  // Pre-convert PDF pages on upload
  const ext = path.extname(origName).toLowerCase();
  if (ext === '.pdf') {
    const pdfPath = path.join(notesDir, req.file.filename);
    const pages = convertPdfPages(noteId, pdfPath);
    db.prepare('UPDATE notes SET pages=? WHERE id=?').run(pages, noteId);
    res.json({ id: noteId, pages, message: `笔记上传成功，已预转换 ${pages} 页` });
  } else {
    res.json({ id: noteId, message: '笔记上传成功' });
  }
});

// Inline view (any logged-in user, supports token in query param)
// PDF: served raw for frontend PDF.js; Word: redirect to Google Docs Viewer
app.get('/api/notes/:id/view', (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(401).json({ error: '未登录' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const note = db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id);
    if (!note) return res.status(404).json({ error: '笔记不存在' });
    const filePath = path.join(notesDir, note.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
    const ext = path.extname(note.original_name).toLowerCase();

    // Word docs: redirect to Google Docs Viewer
    if (ext === '.docx' || ext === '.doc') {
      const pubToken = jwt.sign({ noteId: note.id }, JWT_SECRET, { expiresIn: '30m' });
      const pubUrl = `https://${req.get('host')}/api/pub/notes/${note.id}?token=${pubToken}`;
      const gdvUrl = 'https://docs.google.com/viewer?url=' + encodeURIComponent(pubUrl) + '&embedded=true';
      return res.redirect(gdvUrl);
    }

    // PDF, images, text: serve raw for frontend rendering
    const mimeMap = {
      '.pdf': 'application/pdf',
      '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp'
    };
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(filePath).pipe(res);
  } catch(e) {
    return res.status(401).json({ error: '登录已过期' });
  }
});

// Public access for Office Online Viewer (temporary signed token)
app.get('/api/pub/notes/:id', (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(401).json({ error: '无效链接' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const note = db.prepare('SELECT * FROM notes WHERE id=?').get(decoded.noteId);
    if (!note) return res.status(404).json({ error: '笔记不存在' });
    const filePath = path.join(notesDir, note.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
    const ext = path.extname(note.original_name).toLowerCase();
    const mimeMap = {
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword'
    };
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    fs.createReadStream(filePath).pipe(res);
  } catch(e) {
    return res.status(401).json({ error: '链接已过期，请重新打开' });
  }
});

// Download (admin only, supports token in query param)
app.get('/api/notes/:id/download', (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(401).json({ error: '未登录' });
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.is_admin) return res.status(403).json({ error: '仅管理员可下载，请联系管理员申请权限' });
    const note = db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id);
    if (!note) return res.status(404).json({ error: '笔记不存在' });
    const filePath = path.join(notesDir, note.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
    res.download(filePath, note.original_name);
  } catch(e) {
    return res.status(401).json({ error: '登录已过期' });
  }
});

app.delete('/api/notes/:id', authMiddleware, (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!note) return res.status(404).json({ error: '笔记不存在' });
  const filePath = path.join(notesDir, note.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM notes WHERE id=?').run(req.params.id);
  res.json({ message: '笔记已删除' });
});

// ── User Profile & Avatar ────────────────────────────────────
const avatarDir = path.join(__dirname, 'public', 'uploads', 'avatars');
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarDir),
  filename: (req, file, cb) => {
    const ext = path.extname(Buffer.from(file.originalname, 'latin1').toString('utf8')) || '.png';
    cb(null, 'avatar_' + req.user.id + '_' + Date.now() + ext);
  }
});
const avatarUpload = multer({ storage: avatarStorage, limits: { fileSize: 5 * 1024 * 1024 } });

app.post('/api/user/avatar', authMiddleware, avatarUpload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择图片' });
  const avatarUrl = '/uploads/avatars/' + req.file.filename;
  db.prepare('UPDATE users SET avatar=? WHERE id=?').run(avatarUrl, req.user.id);
  res.json({ avatar: avatarUrl, message: '头像已更新' });
});

app.put('/api/user/profile', authMiddleware, (req, res) => {
  const { nickname } = req.body;
  if (nickname) {
    db.prepare('UPDATE users SET nickname=? WHERE id=?').run(nickname, req.user.id);
  }
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const token = jwt.sign({ id:user.id, username:user.username, is_admin:!!user.is_admin, nickname:user.nickname, avatar:user.avatar||'' }, JWT_SECRET, { expiresIn:'30d' });
  res.json({ token, user:{ id:user.id, username:user.username, is_admin:!!user.is_admin, nickname:user.nickname, avatar:user.avatar||'' } });
});

// ── Comments ─────────────────────────────────────────────────
app.get('/api/questions/:id/comments', authMiddleware, (req, res) => {
  const comments = db.prepare(`
    SELECT c.*, u.nickname, u.avatar,
      (SELECT COUNT(*) FROM comment_likes WHERE comment_id=c.id) as like_count,
      (SELECT COUNT(*) FROM comment_favorites WHERE comment_id=c.id) as fav_count,
      (SELECT COUNT(*) FROM comment_likes WHERE comment_id=c.id AND user_id=?) as liked,
      (SELECT COUNT(*) FROM comment_favorites WHERE comment_id=c.id AND user_id=?) as favorited
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.question_id = ?
    ORDER BY c.created_at DESC
  `).all(req.user.id, req.user.id, req.params.id);
  res.json(comments);
});

app.post('/api/questions/:id/comments', authMiddleware, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: '评论内容不能为空' });
  if (content.length > 2000) return res.status(400).json({ error: '评论不能超过2000字' });
  const result = db.prepare('INSERT INTO comments (user_id,question_id,content) VALUES (?,?,?)')
    .run(req.user.id, req.params.id, content.trim());
  const comment = db.prepare('SELECT c.*, u.nickname, u.avatar FROM comments c JOIN users u ON c.user_id=u.id WHERE c.id=?').get(result.lastInsertRowid);
  res.json({ ...comment, like_count: 0, fav_count: 0, liked: 0, favorited: 0 });
});

app.delete('/api/comments/:id', authMiddleware, (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id=?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: '评论不存在' });
  if (comment.user_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: '无权删除' });
  db.prepare('DELETE FROM comments WHERE id=?').run(req.params.id);
  res.json({ message: '评论已删除' });
});

app.post('/api/comments/:id/like', authMiddleware, (req, res) => {
  const existing = db.prepare('SELECT * FROM comment_likes WHERE user_id=? AND comment_id=?').get(req.user.id, req.params.id);
  if (existing) {
    db.prepare('DELETE FROM comment_likes WHERE user_id=? AND comment_id=?').run(req.user.id, req.params.id);
    res.json({ liked: false, message: '已取消点赞' });
  } else {
    db.prepare('INSERT INTO comment_likes (user_id,comment_id) VALUES (?,?)').run(req.user.id, req.params.id);
    res.json({ liked: true, message: '已点赞' });
  }
});

app.post('/api/comments/:id/favorite', authMiddleware, (req, res) => {
  const existing = db.prepare('SELECT * FROM comment_favorites WHERE user_id=? AND comment_id=?').get(req.user.id, req.params.id);
  if (existing) {
    db.prepare('DELETE FROM comment_favorites WHERE user_id=? AND comment_id=?').run(req.user.id, req.params.id);
    res.json({ favorited: false, message: '已取消收藏' });
  } else {
    db.prepare('INSERT INTO comment_favorites (user_id,comment_id) VALUES (?,?)').run(req.user.id, req.params.id);
    res.json({ favorited: true, message: '已收藏' });
  }
});

// ── PDF Page Images (pre-converted on upload, served instantly) ──
app.get('/api/notes/:id/pages/count', (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(401).json({ error: '未登录' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const note = db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id);
    if (!note) return res.status(404).json({ error: '笔记不存在' });
    const ext = path.extname(note.original_name).toLowerCase();
    if (ext !== '.pdf') return res.json({ pages: 0 });
    // Check cache dir first (fast path)
    const cacheDir = path.join(pdfCacheDir, 'note_' + note.id);
    if (fs.existsSync(cacheDir)) {
      const count = fs.readdirSync(cacheDir).filter(f => f.endsWith('.png')).length;
      if (count > 0) return res.json({ pages: count });
    }
    // Fallback: use stored pages or convert now
    if (note.pages > 0) return res.json({ pages: note.pages });
    const filePath = path.join(notesDir, note.filename);
    if (!fs.existsSync(filePath)) return res.json({ pages: 0 });
    const pages = convertPdfPages(note.id, filePath);
    db.prepare('UPDATE notes SET pages=? WHERE id=?').run(pages, note.id);
    res.json({ pages });
  } catch(e) {
    res.json({ pages: 1 });
  }
});

app.get('/api/notes/:id/pages/:pageNum', (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(401).json({ error: '未登录' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const note = db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id);
    if (!note) return res.status(404).json({ error: '笔记不存在' });
    const ext = path.extname(note.original_name).toLowerCase();
    if (ext !== '.pdf') return res.status(400).json({ error: '仅支持PDF' });

    const pageNum = parseInt(req.params.pageNum);
    if (isNaN(pageNum) || pageNum < 1) return res.status(400).json({ error: '页码无效' });

    // Serve from cache (instant)
    const cacheDir = path.join(pdfCacheDir, 'note_' + note.id);
    if (!fs.existsSync(cacheDir)) {
      // Fallback: convert on the fly
      const filePath = path.join(notesDir, note.filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
      convertPdfPages(note.id, filePath);
    }
    // pdftoppm names files as page-01.png, page-02.png, etc.
    const padded = String(pageNum).padStart(2, '0');
    let imgFile = path.join(cacheDir, `page-${padded}.png`);
    if (!fs.existsSync(imgFile)) {
      // Try without padding
      const alt = path.join(cacheDir, `page-${pageNum}.png`);
      if (fs.existsSync(alt)) imgFile = alt;
      else return res.status(404).json({ error: '页面不存在' });
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    fs.createReadStream(imgFile).pipe(res);
  } catch(e) {
    return res.status(500).json({ error: 'PDF处理失败: ' + e.message });
  }
});

// ── Fallback to SPA ──────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server immediately, sync database in background
syncStartup();
app.listen(PORT, () => {
  console.log(`\n  一研为定 · 智能刷题平台已启动`);
  console.log(`  📍 http://localhost:${PORT}`);
  console.log(`  👤 管理员账号: admin / admin306`);
  console.log(`  🔑 默认激活码: ${defaultCodes.join(', ')}\n`);
  // Initial backup after startup
  setTimeout(() => uploadDb(backupSha).then(newSha => { if (newSha) backupSha = newSha; }), 10000);
});