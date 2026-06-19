const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin306';

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Database Setup ──────────────────────────────────────────
const db = new Database(path.join(__dirname, 'data.db'));
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
`);

// Seed default admin & activation codes
const seedAdmin = db.prepare('INSERT OR IGNORE INTO users (username, password_hash, is_admin, activation_code, nickname) VALUES (?,?,1,?,?)');
const hash = bcrypt.hashSync('admin306', 10);
seedAdmin.run('admin', hash, 'ADMIN-ROOT', '管理员');

const seedCodes = db.prepare('INSERT OR IGNORE INTO activation_codes (code) VALUES (?)');
const defaultCodes = ['MED306START','XIZONG306OK','306PASS2026','WESTMED001','DOCTOR306','MEDICAL25'];
defaultCodes.forEach(c => seedCodes.run(c));

// Seed sample questions
const sampleCount = db.prepare('SELECT COUNT(*) as cnt FROM questions').get();
if (sampleCount.cnt === 0) {
  const insertQ = db.prepare('INSERT OR IGNORE INTO questions (id,chapter,type,question,options,answer,explanation,video_url) VALUES (?,?,?,?,?,?,?,?)');
  const samples = [
    {id:'q001',chapter:'呼吸系统',type:'A1',question:'关于肺循环特点的描述，错误的是',options:JSON.stringify(["A. 低压","B. 低阻","C. 高容","D. 高压"]),answer:'D',explanation:'肺循环特点：低压（压力仅为体循环的1/10）、低阻（血管短而宽）、高容（血容量大）。选项D「高压」与肺循环的低压特点矛盾，故错误。',video_url:''},
    {id:'q002',chapter:'呼吸系统',type:'A1',question:'慢阻肺患者肺功能检查的特征性改变是',options:JSON.stringify(["A. FEV₁/FVC ↓","B. FEV₁/FVC ↑","C. TLC ↓","D. DLCO ↑"]),answer:'A',explanation:'慢阻肺属于阻塞性通气障碍，核心指标是FEV₁/FVC下降。TLC在限制性障碍中下降，DLCO在间质性肺病和肺血管病中下降。',video_url:''},
    {id:'q003',chapter:'呼吸系统',type:'A1',question:'右主支气管的特点不包括',options:JSON.stringify(["A. 短","B. 粗","C. 陡直","D. 细长"]),answer:'D',explanation:'右主支气管特点：短、粗、陡、直，因此异物、插管过深更易进入右侧。「细长」是左主支气管的特点。',video_url:''},
    {id:'q004',chapter:'呼吸系统',type:'A1',question:'关于黏液-纤毛运输系统的描述，正确的是',options:JSON.stringify(["A. 纤毛向肺泡方向摆动","B. 纤毛向咽部方向摆动","C. 属于化学防御","D. 属于免疫防御"]),answer:'B',explanation:'黏液-纤毛运输系统是物理防御中最关键的机制，纤毛像「自动传送带」朝咽部方向不停摆动，将粘了异物的黏液送到咽部。',video_url:''},
    {id:'q005',chapter:'呼吸系统',type:'A1',question:'咳嗽按病程分类，急性咳嗽的病程是',options:JSON.stringify(["A. ≤ 1周","B. ≤ 3周","C. 3~8周","D. > 8周"]),answer:'B',explanation:'咳嗽按病程分为：急性咳嗽（≤3周）、亚急性咳嗽（3~8周）、慢性咳嗽（>8周）。',video_url:''},
    {id:'q006',chapter:'呼吸系统',type:'A1',question:'铁锈色痰最常见于',options:JSON.stringify(["A. 肺炎链球菌肺炎","B. 肺炎克雷伯菌肺炎","C. 金黄色葡萄球菌肺炎","D. 支原体肺炎"]),answer:'A',explanation:'铁锈色痰是肺炎链球菌肺炎（大叶性肺炎）的经典标志。红棕色胶冻样痰见于肺炎克雷伯菌，巧克力色腥味痰见于肺阿米巴病。',video_url:''},
    {id:'q007',chapter:'呼吸系统',type:'A1',question:'患者长期服用卡托普利后出现慢性咳嗽，最可能的原因是',options:JSON.stringify(["A. 上气道咳嗽综合征","B. 咳嗽变异性哮喘","C. ACEI药物性咳嗽","D. 胃食管反流病"]),answer:'C',explanation:'ACEI类药物（普利类，如卡托普利、依那普利）可引起药物性咳嗽，是慢性咳嗽五大病因之一，高频考点。',video_url:''},
    {id:'q008',chapter:'呼吸系统',type:'A1',question:'大量咯血的诊断标准是 24h 咯血量超过',options:JSON.stringify(["A. 100ml","B. 300ml","C. 500ml","D. 1000ml"]),answer:'C',explanation:'小量咯血：24h<100ml；中量咯血：100~500ml/24h；大量咯血：24h>500ml或单次>100ml。大量咯血是急症，可堵塞气道导致窒息。',video_url:''},
    {id:'q009',chapter:'呼吸系统',type:'A1',question:'三凹征见于',options:JSON.stringify(["A. 呼气性呼吸困难","B. 吸气性呼吸困难","C. 混合性呼吸困难","D. 心源性呼吸困难"]),answer:'B',explanation:'三凹征（胸骨上窝、锁骨上窝、肋间隙凹陷）是吸气性呼吸困难的特征性体征，提示大气道阻塞。',video_url:''},
    {id:'q010',chapter:'呼吸系统',type:'A1',question:'肺栓塞诊断的金标准是',options:JSON.stringify(["A. 胸部X线","B. 胸部CT","C. CTPA","D. HRCT"]),answer:'C',explanation:'CTPA（CT肺血管造影）是肺栓塞诊断的金标准。HRCT是间质性肺病和支气管扩张症的金标准。',video_url:''},
    {id:'q011',chapter:'呼吸系统',type:'A1',question:'长期口服糖皮质激素超过3个月，必须预防',options:JSON.stringify(["A. 糖尿病","B. 骨质疏松症","C. 高血压","D. 肾功能损害"]),answer:'B',explanation:'长期口服激素>3个月→必须用二膦酸盐预防骨质疏松症！每年都考！',video_url:''},
    {id:'q012',chapter:'呼吸系统',type:'A1',question:'关于茶碱类药物的描述，错误的是',options:JSON.stringify(["A. 可舒张气道","B. 治疗窗窄","C. 安全性高","D. 易中毒"]),answer:'C',explanation:'茶碱类药是支气管扩张剂之一，但治疗窗窄，易中毒，安全性不高，需要监测血药浓度。考点！',video_url:''},
    {id:'q013',chapter:'呼吸系统',type:'A1',question:'肺部听诊闻及Velcro啰音（撕魔术贴声），最常见于',options:JSON.stringify(["A. 慢阻肺","B. 支气管哮喘","C. 间质性肺病","D. 支气管扩张症"]),answer:'C',explanation:'Velcro啰音即细爆裂音，像捻搓头发或撕魔术贴声，吸气晚期出现，是间质性肺病、肺纤维化、早期心衰的特征性体征。',video_url:''},
    {id:'q014',chapter:'呼吸系统',type:'A1',question:'关于肺功能检查，限制性通气障碍的特征是',options:JSON.stringify(["A. FEV₁/FVC ↓","B. FEV₁/FVC 正常或↑，TLC ↓","C. FEV₁/FVC ↓，TLC ↑","D. DLCO ↑"]),answer:'B',explanation:'限制性通气障碍：FEV₁和FVC成比例下降，比值正常或↑，但TLC（肺总量）↓。阻塞性：FEV₁/FVC ↓。',video_url:''},
    {id:'q015',chapter:'呼吸系统',type:'A1',question:'混浊性呼吸音消失最常见于',options:JSON.stringify(["A. 支气管炎","B. 胸腔积液","C. 哮喘","D. 心衰"]),answer:'B',explanation:'呼吸音消失见于：气道完全堵死，或有大量胸腔积液/气胸把肺压没了。胸腔积液是常见原因。',video_url:''}
  ];
  const insertMany = db.transaction(() => {
    samples.forEach(s => insertQ.run(s.id,s.chapter,s.type,s.question,s.options,s.answer,s.explanation,s.video_url));
  });
  insertMany();
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
  const token = jwt.sign({ id:user.id, username:user.username, is_admin:!!user.is_admin, nickname:user.nickname }, JWT_SECRET, { expiresIn:'30d' });
  res.json({ token, user:{ id:user.id, username:user.username, is_admin:!!user.is_admin, nickname:user.nickname } });
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

  const token = jwt.sign({ id:result.lastInsertRowid, username, is_admin:false, nickname:nickname||username }, JWT_SECRET, { expiresIn:'30d' });
  res.json({ token, user:{ id:result.lastInsertRowid, username, is_admin:false, nickname:nickname||username } });
});

// ── Question Routes ──────────────────────────────────────────
app.get('/api/questions', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM questions ORDER BY created_at DESC').all();
  const questions = rows.map(r => ({ ...r, options: JSON.parse(r.options) }));
  res.json(questions);
});

app.post('/api/questions', authMiddleware, adminMiddleware, (req, res) => {
  const { chapter, type, question, options, answer, explanation, videoUrl } = req.body;
  if (!question || !options || !answer) return res.status(400).json({error:'缺少必要字段'});
  const id = 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
  db.prepare('INSERT INTO questions (id,chapter,type,question,options,answer,explanation,video_url) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, chapter||'', type||'A1', question, JSON.stringify(options), answer.toUpperCase(), explanation||'', videoUrl||'');
  res.json({ id, message:'题目已添加' });
});

app.put('/api/questions/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { chapter, type, question, options, answer, explanation, videoUrl } = req.body;
  db.prepare('UPDATE questions SET chapter=?,type=?,question=?,options=?,answer=?,explanation=?,video_url=? WHERE id=?')
    .run(chapter||'', type||'A1', question, JSON.stringify(options), answer.toUpperCase(), explanation||'', videoUrl||'', req.params.id);
  res.json({ message:'题目已更新' });
});

app.delete('/api/questions/:id', authMiddleware, adminMiddleware, (req, res) => {
  db.prepare('DELETE FROM questions WHERE id=?').run(req.params.id);
  res.json({ message:'题目已删除' });
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

// ── Fallback to SPA ──────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  🩺 西医综合306 刷题平台已启动`);
  console.log(`  📍 http://localhost:${PORT}`);
  console.log(`  👤 管理员账号: admin / admin306`);
  console.log(`  🔑 默认激活码: ${defaultCodes.join(', ')}\n`);
});