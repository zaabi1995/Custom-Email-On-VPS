// ============================================================
// Email Signature Manager - Server
// A self-hosted email signature management system
// ============================================================

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

// ============ CONFIGURATION ============
const PORT = process.env.PORT || 3456;
const BASE_PATH = process.env.BASE_PATH || '/email-signature';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'signatures.db');
const CACHE_BUST = Date.now(); // busts browser cache on restart
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const SESSION_SECRET = process.env.SESSION_SECRET || 'esm-secret-' + Math.random().toString(36).slice(2);
const PUBLIC_URL = process.env.PUBLIC_URL || ''; // e.g. https://yourdomain.com
const SMTP_HOST = process.env.SMTP_HOST || 'localhost';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '25');
const DEFAULT_ADMIN_PASS = process.env.DEFAULT_ADMIN_PASS || 'admin';

const app = express();

// Ensure directories exist
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ============ DATABASE SETUP ============
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY,
    password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id INTEGER,
    target_name TEXT,
    description TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS signature_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'Default',
    html_template TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// Prepared statements
const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
const logActivity = db.prepare('INSERT INTO activity_log (action, target_type, target_id, target_name, description) VALUES (?, ?, ?, ?, ?)');

// Default admin password (only if no admin exists)
const adminRow = db.prepare('SELECT * FROM admin WHERE id = 1').get();
if (!adminRow) {
  const hash = bcrypt.hashSync(DEFAULT_ADMIN_PASS, 10);
  db.prepare('INSERT INTO admin (id, password_hash) VALUES (1, ?)').run(hash);
}

// Check if setup is complete
function isSetupComplete() {
  const row = getSetting.get('setup_complete');
  return row && row.value === 'true';
}

// ============ DEFAULT SIGNATURE TEMPLATE ============
const DEFAULT_TEMPLATE = `<div style="font-family: Arial, sans-serif; font-size: 13px; color: #333;">
<hr style="border: none; border-top: 2px solid #2d6a4f; margin: 20px 0; width: 300px;">
<table cellpadding="0" cellspacing="0" border="0">
<tr>
<td style="padding-right: 25px; vertical-align: middle; border-right: 2px solid #2d6a4f;">
<img src="{{logo_url}}" alt="{{company_name}}" style="width: 90px; height: auto;">
</td>
<td style="padding-left: 25px; vertical-align: top;">
<p style="margin: 0 0 4px 0; font-weight: bold; font-size: 15px; color: #034D57;">{{name}}</p>
<p style="margin: 0 0 4px 0; font-size: 12px; color: #555;">{{title}}</p>
<p style="margin: 0 0 4px 0; font-size: 12px; font-weight: bold; color: #2d6a4f;">{{company_name}}</p>
<p style="margin: 0 0 4px 0; font-size: 12px;"><a href="mailto:{{email}}" style="color: #034D57; text-decoration: none;">{{email}}</a>{{#phone}} | {{phone}}{{/phone}}</p>
<p style="margin: 0 0 4px 0; font-size: 12px;"><a href="https://{{website}}" style="color: #2d6a4f; text-decoration: none;">{{website}}</a></p>
<p style="margin: 0; font-size: 12px; color: #666;">{{address}}</p>
</td>
</tr>
</table>
</div>`;

// Ensure default template exists
const tplCount = db.prepare('SELECT COUNT(*) as cnt FROM signature_templates').get();
if (tplCount.cnt === 0) {
  db.prepare('INSERT INTO signature_templates (name, html_template, is_default) VALUES (?, ?, 1)').run('Default', DEFAULT_TEMPLATE);
}

// ============ MIDDLEWARE ============
app.use(BASE_PATH, express.json({ limit: '5mb' }));
app.use(BASE_PATH, express.urlencoded({ extended: true, limit: '5mb' }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Serve static files
app.use(BASE_PATH + '/static', express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));
app.use(BASE_PATH + '/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

// Logo upload config
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = 'logo-' + Date.now() + ext;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.gif', '.jpg', '.jpeg', '.svg', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

// CSV upload
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.redirect(BASE_PATH + '/login');
}
function requireAuthAPI(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ============ HELPERS ============
function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const row of rows) s[row.key] = row.value;
  return s;
}

function getLogoUrl(settings) {
  const logoType = settings.logo_type || 'gif';
  const logoFile = logoType === 'gif'
    ? (settings.logo_gif || 'alali-logo.gif')
    : (settings.logo_png || 'alali-logo-official.png');
  const base = PUBLIC_URL || settings.public_url || '';
  return `${base}${BASE_PATH}/uploads/${logoFile}`;
}

function getActiveTemplate() {
  const tpl = db.prepare('SELECT * FROM signature_templates WHERE is_default = 1 ORDER BY id DESC LIMIT 1').get();
  return tpl ? tpl.html_template : DEFAULT_TEMPLATE;
}

function generateSignatureHtml(employee, settings) {
  const logoUrl = getLogoUrl(settings);
  const template = getActiveTemplate();

  let html = template
    .replace(/\{\{name\}\}/g, employee.name || '')
    .replace(/\{\{name_ar\}\}/g, employee.name_ar || '')
    .replace(/\{\{title\}\}/g, employee.title || '')
    .replace(/\{\{title_ar\}\}/g, employee.title_ar || '')
    .replace(/\{\{email\}\}/g, employee.email || '')
    .replace(/\{\{phone\}\}/g, employee.phone || settings.default_phone || '')
    .replace(/\{\{company_name\}\}/g, settings.company_name || '')
    .replace(/\{\{company_name_ar\}\}/g, settings.company_name_ar || '')
    .replace(/\{\{address\}\}/g, settings.address || '')
    .replace(/\{\{website\}\}/g, settings.website || '')
    .replace(/\{\{logo_url\}\}/g, logoUrl)
    .replace(/\{\{default_phone\}\}/g, settings.default_phone || '');

  // Handle conditional phone: {{#phone}} ... {{/phone}}
  const phone = employee.phone || settings.default_phone || '';
  if (phone) {
    html = html.replace(/\{\{#phone\}\}(.*?)\{\{\/phone\}\}/gs, '$1');
  } else {
    html = html.replace(/\{\{#phone\}\}(.*?)\{\{\/phone\}\}/gs, '');
  }

  // Clean up empty Arabic/bilingual separators: remove " — " + empty spans
  // If name_ar, title_ar are empty, strip the dash and empty span
  html = html.replace(/<span[^>]*>\s*&mdash;\s*<\/span>\s*<span[^>]*dir="rtl"[^>]*>\s*<\/span>/g, '');

  return html;
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============ AUTH ROUTES ============
app.get(BASE_PATH + '/login', (req, res) => {
  const error = req.query.error ? 'Invalid password' : '';
  const settings = getAllSettings();
  res.send(renderLoginPage(settings, error));
});

app.post(BASE_PATH + '/login', (req, res) => {
  const { password } = req.body;
  const admin = db.prepare('SELECT password_hash FROM admin WHERE id = 1').get();
  if (admin && bcrypt.compareSync(password, admin.password_hash)) {
    req.session.authenticated = true;
    // If setup not complete, redirect to setup
    if (!isSetupComplete()) return res.redirect(BASE_PATH + '/setup');
    return res.redirect(BASE_PATH + '/dashboard');
  }
  res.redirect(BASE_PATH + '/login?error=1');
});

app.get(BASE_PATH + '/logout', (req, res) => {
  req.session.destroy();
  res.redirect(BASE_PATH + '/login');
});

// ============ SETUP WIZARD ============
app.get(BASE_PATH + '/setup', requireAuth, (req, res) => {
  if (isSetupComplete()) return res.redirect(BASE_PATH + '/dashboard');
  res.send(renderSetupPage());
});

app.post(BASE_PATH + '/api/setup', requireAuthAPI, (req, res) => {
  const { company_name, company_name_ar, address, website, default_phone, admin_password } = req.body;
  if (!company_name) return res.status(400).json({ success: false, error: 'Company name is required' });

  const fields = { company_name, company_name_ar, address, website, default_phone };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== '') setSetting.run(key, value);
  }
  if (admin_password && admin_password.length >= 6) {
    const hash = bcrypt.hashSync(admin_password, 10);
    db.prepare('UPDATE admin SET password_hash = ? WHERE id = 1').run(hash);
  }
  setSetting.run('setup_complete', 'true');
  logActivity.run('settings', null, null, null, 'Initial setup completed');
  res.json({ success: true });
});

// ============ DASHBOARD ============
app.get(BASE_PATH + '/', requireAuth, (req, res) => {
  if (!isSetupComplete()) return res.redirect(BASE_PATH + '/setup');
  res.redirect(BASE_PATH + '/dashboard');
});

app.get(BASE_PATH + '/dashboard', requireAuth, (req, res) => {
  if (!isSetupComplete()) return res.redirect(BASE_PATH + '/setup');
  const settings = getAllSettings();
  res.send(renderDashboardPage(settings));
});

// ============ API: EMPLOYEES ============
app.get(BASE_PATH + '/api/employees', requireAuthAPI, (req, res) => {
  const employees = db.prepare('SELECT * FROM employees ORDER BY name').all();
  res.json(employees);
});

app.post(BASE_PATH + '/api/employees', requireAuthAPI, (req, res) => {
  const { name, title, email, phone, enabled, name_ar, title_ar } = req.body;
  try {
    const stmt = db.prepare('INSERT INTO employees (name, title, email, phone, enabled, name_ar, title_ar) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const result = stmt.run(name, title || '', email, phone || '', enabled !== undefined ? (enabled ? 1 : 0) : 1, name_ar || '', title_ar || '');
    const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(result.lastInsertRowid);
    logActivity.run('create', 'employee', employee.id, employee.name, `Added employee: ${name} (${email})`);
    res.json({ success: true, employee });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

app.put(BASE_PATH + '/api/employees/:id', requireAuthAPI, (req, res) => {
  const { name, title, email, phone, enabled, name_ar, title_ar } = req.body;
  try {
    db.prepare(`UPDATE employees SET name=?, title=?, email=?, phone=?, enabled=?, name_ar=?, title_ar=?, updated_at=datetime('now') WHERE id=?`)
      .run(name, title || '', email, phone || '', enabled ? 1 : 0, name_ar || '', title_ar || '', req.params.id);
    const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
    logActivity.run('update', 'employee', employee.id, employee.name, `Updated employee: ${name}`);
    res.json({ success: true, employee });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

app.delete(BASE_PATH + '/api/employees/:id', requireAuthAPI, (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
  if (emp) logActivity.run('delete', 'employee', emp.id, emp.name, `Deleted employee: ${emp.name} (${emp.email})`);
  res.json({ success: true });
});

app.post(BASE_PATH + '/api/employees/:id/toggle', requireAuthAPI, (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ success: false });
  const newState = emp.enabled ? 0 : 1;
  db.prepare("UPDATE employees SET enabled = ?, updated_at = datetime('now') WHERE id = ?").run(newState, req.params.id);
  logActivity.run('toggle', 'employee', emp.id, emp.name, `${newState ? 'Enabled' : 'Disabled'} signature for: ${emp.name}`);
  res.json({ success: true, enabled: !!newState });
});

app.get(BASE_PATH + '/api/employees/:id/signature', requireAuthAPI, (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ success: false });
  const settings = getAllSettings();
  const html = generateSignatureHtml(emp, settings);
  res.json({ success: true, html });
});

// ============ API: CSV IMPORT/EXPORT ============
app.get(BASE_PATH + '/api/employees/export', requireAuthAPI, (req, res) => {
  const employees = db.prepare('SELECT * FROM employees ORDER BY name').all();
  const header = 'name,title,email,phone,enabled\n';
  const rows = employees.map(e =>
    `"${(e.name || '').replace(/"/g, '""')}","${(e.title || '').replace(/"/g, '""')}","${e.email}","${(e.phone || '').replace(/"/g, '""')}",${e.enabled ? 'yes' : 'no'}`
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="employees.csv"');
  res.send(header + rows);
});

app.post(BASE_PATH + '/api/employees/import', requireAuthAPI, csvUpload.single('csv'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
  try {
    const content = req.file.buffer.toString('utf8');
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ success: false, error: 'CSV must have a header and at least one row' });

    const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
    const nameIdx = header.indexOf('name');
    const emailIdx = header.indexOf('email');
    if (nameIdx === -1 || emailIdx === -1) {
      return res.status(400).json({ success: false, error: 'CSV must have "name" and "email" columns' });
    }
    const titleIdx = header.indexOf('title');
    const phoneIdx = header.indexOf('phone');
    const enabledIdx = header.indexOf('enabled');

    let imported = 0, skipped = 0;
    const insertStmt = db.prepare('INSERT OR IGNORE INTO employees (name, title, email, phone, enabled) VALUES (?, ?, ?, ?, ?)');
    const transaction = db.transaction(() => {
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        const name = cols[nameIdx]?.trim();
        const email = cols[emailIdx]?.trim();
        if (!name || !email) { skipped++; continue; }
        const title = titleIdx >= 0 ? (cols[titleIdx]?.trim() || '') : '';
        const phone = phoneIdx >= 0 ? (cols[phoneIdx]?.trim() || '') : '';
        const enabled = enabledIdx >= 0 ? (cols[enabledIdx]?.trim().toLowerCase() !== 'no' ? 1 : 0) : 1;
        const result = insertStmt.run(name, title, email, phone, enabled);
        if (result.changes > 0) imported++; else skipped++;
      }
    });
    transaction();
    logActivity.run('create', 'employee', null, null, `Bulk imported ${imported} employees from CSV`);
    res.json({ success: true, imported, skipped });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        current += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        result.push(current);
        current = '';
      } else {
        current += c;
      }
    }
  }
  result.push(current);
  return result;
}

// ============ API: SETTINGS ============
app.get(BASE_PATH + '/api/settings', requireAuthAPI, (req, res) => {
  const s = getAllSettings();
  s._logo_url = getLogoUrl(s);
  res.json(s);
});

app.post(BASE_PATH + '/api/settings', requireAuthAPI, (req, res) => {
  const allowed = ['company_name', 'company_name_ar', 'address', 'website', 'default_phone', 'logo_type',
    'primary_color', 'accent_color'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      setSetting.run(key, req.body[key]);
    }
  }
  logActivity.run('settings', null, null, null, 'Updated company settings');
  const s = getAllSettings();
  s._logo_url = getLogoUrl(s);
  res.json({ success: true, settings: s });
});

app.post(BASE_PATH + '/api/upload-logo', requireAuthAPI, upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
  const ext = path.extname(req.file.filename).toLowerCase();
  let type = 'png';
  if (ext === '.gif') type = 'gif';
  else if (ext === '.svg') type = 'svg';
  const settingKey = type === 'gif' ? 'logo_gif' : 'logo_png';
  setSetting.run(settingKey, req.file.filename);
  logActivity.run('settings', null, null, null, `Uploaded new ${type.toUpperCase()} logo`);
  res.json({ success: true, filename: req.file.filename, type });
});

app.post(BASE_PATH + '/api/change-password', requireAuthAPI, (req, res) => {
  const { current, newPassword } = req.body;
  const admin = db.prepare('SELECT password_hash FROM admin WHERE id = 1').get();
  if (!bcrypt.compareSync(current, admin.password_hash)) {
    return res.status(400).json({ success: false, error: 'Current password is incorrect' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE admin SET password_hash = ? WHERE id = 1').run(hash);
  logActivity.run('settings', null, null, null, 'Admin password changed');
  res.json({ success: true });
});

// ============ API: ACTIVITY LOG ============
app.get(BASE_PATH + '/api/activity-log', requireAuthAPI, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const logs = db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').all(limit);
  res.json(logs);
});

// ============ API: TEMPLATES ============
app.get(BASE_PATH + '/api/templates', requireAuthAPI, (req, res) => {
  const templates = db.prepare('SELECT * FROM signature_templates ORDER BY is_default DESC, id ASC').all();
  res.json(templates);
});

app.post(BASE_PATH + '/api/templates', requireAuthAPI, (req, res) => {
  const { id, name, html_template, is_default } = req.body;
  try {
    if (id) {
      if (is_default) db.prepare('UPDATE signature_templates SET is_default = 0').run();
      db.prepare("UPDATE signature_templates SET name=?, html_template=?, is_default=?, updated_at=datetime('now') WHERE id=?")
        .run(name || 'Default', html_template, is_default ? 1 : 0, id);
    } else {
      if (is_default) db.prepare('UPDATE signature_templates SET is_default = 0').run();
      db.prepare('INSERT INTO signature_templates (name, html_template, is_default) VALUES (?, ?, ?)')
        .run(name || 'Untitled', html_template, is_default ? 1 : 0);
    }
    const templates = db.prepare('SELECT * FROM signature_templates ORDER BY is_default DESC, id ASC').all();
    logActivity.run('update', 'template', null, name, `${id ? 'Updated' : 'Created'} signature template: ${name || 'Default'}`);
    res.json({ success: true, templates });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

app.delete(BASE_PATH + '/api/templates/:id', requireAuthAPI, (req, res) => {
  const tpl = db.prepare('SELECT * FROM signature_templates WHERE id = ?').get(req.params.id);
  if (!tpl) return res.status(404).json({ success: false, error: 'Template not found' });
  if (tpl.is_default) return res.status(400).json({ success: false, error: 'Cannot delete the active default template' });
  db.prepare('DELETE FROM signature_templates WHERE id = ?').run(req.params.id);
  logActivity.run('delete', 'template', tpl.id, tpl.name, `Deleted template: ${tpl.name}`);
  res.json({ success: true });
});

app.post(BASE_PATH + '/api/templates/reset', requireAuthAPI, (req, res) => {
  db.prepare('UPDATE signature_templates SET html_template = ?, updated_at = datetime(\'now\') WHERE is_default = 1')
    .run(DEFAULT_TEMPLATE);
  logActivity.run('update', 'template', null, null, 'Reset signature template to default');
  res.json({ success: true });
});

// ============ API: TEST EMAIL ============
app.post(BASE_PATH + '/api/test-email', requireAuthAPI, async (req, res) => {
  const { employeeId, to } = req.body;
  if (!to) return res.status(400).json({ success: false, error: 'Recipient email required' });

  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  const settings = getAllSettings();
  const sigHtml = generateSignatureHtml(emp, settings);
  const companyName = settings.company_name || 'Email Signature Manager';

  const htmlBody = `<html><body>
<p>This is a test email from <strong>${escHtml(companyName)}</strong> Email Signature Manager.</p>
<p>Below is the signature for <strong>${escHtml(emp.name)}</strong>:</p>
<br>
${sigHtml}
</body></html>`;

  try {
    // Use swaks if available, otherwise try nodemailer
    const { execSync } = require('child_process');
    const tmpFile = '/tmp/esm-test-' + Date.now() + '.html';
    fs.writeFileSync(tmpFile, htmlBody);
    execSync(`swaks --to "${to}" --from "${emp.email}" --header "Subject: [Test] Email Signature - ${emp.name}" --header "Content-Type: text/html" --body @${tmpFile} --server ${SMTP_HOST} --port ${SMTP_PORT} 2>&1`, { timeout: 15000 });
    fs.unlinkSync(tmpFile);
    logActivity.run('settings', 'employee', emp.id, emp.name, `Sent test email for ${emp.name} to ${to}`);
    res.json({ success: true });
  } catch (e) {
    console.error('Test email error:', e.message);
    res.status(500).json({ success: false, error: 'Failed to send test email. Make sure SMTP is configured.' });
  }
});

// ============ API: MAILBOXES FROM MAIL SERVER ============
app.get(BASE_PATH + '/api/mailboxes', requireAuthAPI, (req, res) => {
  try {
    const postfixDb = new Database('/www/vmail/postfixadmin.db', { readonly: true });
    const mailboxes = postfixDb.prepare(
      "SELECT username AS email, full_name FROM mailbox WHERE domain='alali.om' AND active=1 ORDER BY full_name"
    ).all();
    postfixDb.close();

    // Exclude emails already in employees table (case-insensitive)
    const existing = new Set(
      db.prepare('SELECT LOWER(email) AS email FROM employees').all().map(r => r.email)
    );
    const available = mailboxes.filter(m => !existing.has(m.email.toLowerCase()));
    res.json({ mailboxes: available });
  } catch (e) {
    console.error('Mailbox fetch error:', e.message);
    res.status(500).json({ error: 'Failed to read mail server database' });
  }
});

// ============ PUBLIC API: Signature by Email (for Postfix filter) ============
app.get(BASE_PATH + '/api/signature/:email', (req, res) => {
  const email = req.params.email.toLowerCase();
  const emp = db.prepare('SELECT * FROM employees WHERE LOWER(email) = ? AND enabled = 1').get(email);
  if (!emp) return res.json({ found: false });
  const settings = getAllSettings();
  const html = generateSignatureHtml(emp, settings);
  res.json({ found: true, html });
});

// ============ SVG ICONS ============
const ICONS = {
  dashboard: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
  employees: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  templates: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
  activity: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  settings: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  logout: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  moon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  menu: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
};

// ============ PAGE RENDERERS ============
function renderLoginPage(settings, error) {
  const companyName = settings.company_name || 'Email Signature Manager';
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sign In - ${escHtml(companyName)}</title>
<link rel="stylesheet" href="${BASE_PATH}/static/css/app.css?v=${CACHE_BUST}">
</head><body>
<div class="login-page">
  <div class="login-card">
    <div class="login-logo">
      <img src="${BASE_PATH}/uploads/alali-logo.svg" alt="Logo" onerror="this.style.display='none'">
    </div>
    <h1 class="login-title">Email Signature Manager</h1>
    <p class="login-subtitle">${escHtml(companyName)}</p>
    ${error ? `<div class="login-error">${escHtml(error)}</div>` : ''}
    <form method="POST" action="${BASE_PATH}/login">
      <div class="form-group">
        <label for="password">Admin Password</label>
        <input class="form-control" type="password" id="password" name="password" placeholder="Enter admin password" required autofocus>
      </div>
      <button type="submit" class="btn btn-primary w-full" style="width:100%;margin-top:8px;">Sign In</button>
    </form>
  </div>
</div>
<div class="toast-container" id="toastContainer"></div>
</body></html>`;
}

function renderSetupPage() {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Setup - Email Signature Manager</title>
<link rel="stylesheet" href="${BASE_PATH}/static/css/app.css?v=${CACHE_BUST}">
</head><body>
<div class="setup-page">
  <div class="setup-card">
    <div class="setup-step-indicator">
      <div class="setup-dot active"></div>
      <div class="setup-dot"></div>
      <div class="setup-dot"></div>
    </div>

    <!-- Step 1: Welcome -->
    <div class="setup-step active">
      <div class="setup-emoji">🚀</div>
      <h2>Welcome!</h2>
      <p>Let's set up your Email Signature Manager. This will only take a minute.</p>
      <div class="setup-actions" style="justify-content:center;">
        <button class="btn btn-primary" onclick="ESM.setupNext()">Get Started →</button>
      </div>
    </div>

    <!-- Step 2: Company Info -->
    <div class="setup-step">
      <div class="setup-emoji">🏢</div>
      <h2>Company Details</h2>
      <p>Tell us about your organization</p>
      <div class="form-group">
        <label>Company Name <span class="required">*</span></label>
        <input class="form-control" type="text" id="setup_company_name" placeholder="Acme Corporation" required>
      </div>
      <div class="form-group">
        <label>Company Name (Arabic/Secondary)</label>
        <input class="form-control" type="text" id="setup_company_name_ar" placeholder="Optional" dir="rtl">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Website</label>
          <input class="form-control" type="text" id="setup_website" placeholder="example.com">
        </div>
        <div class="form-group">
          <label>Phone</label>
          <input class="form-control" type="text" id="setup_phone" placeholder="+1 555-0100">
        </div>
      </div>
      <div class="form-group">
        <label>Address</label>
        <input class="form-control" type="text" id="setup_address" placeholder="123 Business St, City, Country">
      </div>
      <div class="setup-actions">
        <button class="btn btn-ghost" onclick="ESM.setupPrev()">← Back</button>
        <button class="btn btn-primary" onclick="ESM.setupNext()">Continue →</button>
      </div>
    </div>

    <!-- Step 3: Security -->
    <div class="setup-step">
      <div class="setup-emoji">🔐</div>
      <h2>Set Admin Password</h2>
      <p>Choose a secure password for the admin dashboard</p>
      <div class="form-group">
        <label>New Admin Password</label>
        <input class="form-control" type="password" id="setup_password" placeholder="At least 6 characters" minlength="6">
      </div>
      <p class="form-help">Leave blank to keep the current password.</p>
      <div class="setup-actions">
        <button class="btn btn-ghost" onclick="ESM.setupPrev()">← Back</button>
        <button class="btn btn-primary" onclick="ESM.completeSetup()">Complete Setup ✓</button>
      </div>
    </div>
  </div>
</div>
<div class="toast-container" id="toastContainer"></div>
<script>window.__BASE_PATH = '${BASE_PATH}';</script>
<script src="${BASE_PATH}/static/js/app.js?v=${CACHE_BUST}"></script>
</body></html>`;
}

function renderDashboardPage(settings) {
  const companyName = settings.company_name || 'Email Signature Manager';

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(companyName)} - Email Signature Manager</title>
<link rel="stylesheet" href="${BASE_PATH}/static/css/app.css?v=${CACHE_BUST}">
</head><body>

<!-- Mobile Toggle -->
<button class="mobile-toggle" id="mobileToggle">${ICONS.menu}</button>

<div class="app-layout">
  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-brand">
      <img src="${BASE_PATH}/uploads/alali-logo.svg" alt="Logo" onerror="this.src='${BASE_PATH}/uploads/alali-logo-official.png'">
      <div class="sidebar-brand-text">
        <h2>${escHtml(companyName)}</h2>
        <span>Signature Manager</span>
      </div>
    </div>

    <nav class="sidebar-nav">
      <div class="sidebar-section">
        <div class="sidebar-section-label">Menu</div>
        <button class="sidebar-link active" data-section="dashboard">
          ${ICONS.dashboard}
          <span>Dashboard</span>
        </button>
        <button class="sidebar-link" data-section="employees">
          ${ICONS.employees}
          <span>Employees</span>
          <span class="badge-count" id="empBadge">0</span>
        </button>
        <button class="sidebar-link" data-section="templates">
          ${ICONS.templates}
          <span>Templates</span>
        </button>
        <button class="sidebar-link" data-section="activity">
          ${ICONS.activity}
          <span>Activity Log</span>
        </button>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-label">Admin</div>
        <button class="sidebar-link" data-section="settings">
          ${ICONS.settings}
          <span>Settings</span>
        </button>
      </div>
    </nav>

    <div class="sidebar-footer">
      <button class="theme-toggle" id="themeToggle" onclick="ESM.toggleTheme()">
        <svg class="theme-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        <span class="theme-label">Dark Mode</span>
      </button>
      <a href="${BASE_PATH}/logout" class="sidebar-logout">
        ${ICONS.logout}
        <span>Sign Out</span>
      </a>
    </div>
  </aside>

  <!-- Main Content -->
  <main class="main-content">
    <div class="page-header">
      <div class="page-header-left">
        <h1 id="pageTitle">Dashboard</h1>
        <p id="pageDesc">Overview of your email signature system</p>
      </div>
      <div class="page-header-actions" id="pageActions"></div>
    </div>

    <div class="page-body">

      <!-- ========== DASHBOARD SECTION ========== -->
      <div class="section active" id="section-dashboard">
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon primary">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            </div>
            <div class="stat-info">
              <div class="stat-number" id="statTotal">0</div>
              <div class="stat-label">Total Employees</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon accent">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div class="stat-info">
              <div class="stat-number" id="statActive">0</div>
              <div class="stat-label">Active Signatures</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon danger">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            </div>
            <div class="stat-info">
              <div class="stat-number" id="statDisabled">0</div>
              <div class="stat-label">Disabled</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon warning">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
            </div>
            <div class="stat-info">
              <div class="stat-number" id="statTemplates">1</div>
              <div class="stat-label">Templates</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h3>Recent Activity</h3>
              <p>Latest changes across your signature system</p>
            </div>
            <button class="btn btn-sm btn-ghost" onclick="ESM.navigateTo('activity')">View All</button>
          </div>
          <div id="recentActivity">
            <p class="text-muted text-sm" style="padding:20px;text-align:center;">Loading...</p>
          </div>
        </div>
      </div>

      <!-- ========== EMPLOYEES SECTION ========== -->
      <div class="section" id="section-employees">
        <div class="filter-bar">
          <div class="search-bar">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" placeholder="Search employees..." oninput="ESM.handleSearch(this.value)">
          </div>
          <div style="display:flex;gap:6px;">
            <button class="filter-chip active" data-filter="all" onclick="ESM.setFilter('all')">All</button>
            <button class="filter-chip" data-filter="active" onclick="ESM.setFilter('active')">Active</button>
            <button class="filter-chip" data-filter="disabled" onclick="ESM.setFilter('disabled')">Disabled</button>
          </div>
        </div>
        <div class="employee-grid" id="employeeGrid"></div>
      </div>

      <!-- ========== TEMPLATES SECTION ========== -->
      <div class="section" id="section-templates">
        <!-- Template List -->
        <div class="card" style="margin-bottom:20px;">
          <div class="card-header">
            <div>
              <h3>Signature Templates</h3>
              <p>Manage multiple templates — the default is used for all signatures</p>
            </div>
            <button class="btn btn-sm btn-primary" onclick="ESM.newTemplate()">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              New Template
            </button>
          </div>
          <div id="templateList"></div>
        </div>

        <!-- Template Editor -->
        <div class="card" id="templateEditorCard" style="display:none;">
          <div class="card-header">
            <div>
              <h3 id="templateEditorTitle">Edit Template</h3>
              <p>Editing signature template</p>
            </div>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-sm btn-ghost" onclick="ESM.cancelEditTemplate()">Cancel</button>
              <button class="btn btn-sm btn-primary" onclick="ESM.saveTemplate()">Save Template</button>
            </div>
          </div>

          <div style="padding:0 24px;">
            <div class="form-row" style="margin-bottom:12px;">
              <div class="form-group">
                <label>Template Name</label>
                <input class="form-control" type="text" id="templateNameInput" placeholder="e.g. Default, Arabic, Bilingual">
              </div>
              <div class="form-group" style="display:flex;align-items:flex-end;gap:12px;padding-bottom:4px;">
                <label class="toggle-switch">
                  <input type="checkbox" id="templateIsDefault">
                  <span class="toggle-slider"></span>
                </label>
                <span style="font-size:13px;">Set as Default</span>
              </div>
            </div>

            <div style="margin-bottom:12px;">
              <label style="font-size:12px;color:var(--text-muted);font-weight:600;margin-bottom:8px;display:block;">Available Variables (click to insert)</label>
              <div class="template-vars">
                <span class="template-var" onclick="ESM.insertTemplateVar('name')">{{name}}</span>
                <span class="template-var" onclick="ESM.insertTemplateVar('name_ar')">{{name_ar}}</span>
                <span class="template-var" onclick="ESM.insertTemplateVar('title')">{{title}}</span>
                <span class="template-var" onclick="ESM.insertTemplateVar('title_ar')">{{title_ar}}</span>
                <span class="template-var" onclick="ESM.insertTemplateVar('email')">{{email}}</span>
                <span class="template-var" onclick="ESM.insertTemplateVar('phone')">{{phone}}</span>
                <span class="template-var" onclick="ESM.insertTemplateVar('company_name')">{{company_name}}</span>
                <span class="template-var" onclick="ESM.insertTemplateVar('company_name_ar')">{{company_name_ar}}</span>
                <span class="template-var" onclick="ESM.insertTemplateVar('address')">{{address}}</span>
                <span class="template-var" onclick="ESM.insertTemplateVar('website')">{{website}}</span>
                <span class="template-var" onclick="ESM.insertTemplateVar('logo_url')">{{logo_url}}</span>
                <span class="template-var" onclick="ESM.insertTemplateVar('default_phone')">{{default_phone}}</span>
              </div>
            </div>

            <input type="hidden" id="templateId" value="">
            <div class="template-editor-wrapper">
              <div>
                <label style="font-size:12px;color:var(--text-muted);font-weight:600;margin-bottom:8px;display:block;">HTML Template</label>
                <textarea class="form-control code" id="templateEditor" placeholder="Enter your HTML signature template..." oninput="ESM.livePreviewTemplate()"></textarea>
              </div>
              <div>
                <label style="font-size:12px;color:var(--text-muted);font-weight:600;margin-bottom:8px;display:block;">Live Preview</label>
                <div id="templatePreviewContent" style="border:1px solid var(--border);border-radius:var(--radius);padding:24px;min-height:400px;background:#fff;">
                  <p class="text-muted text-sm text-center" style="padding:40px;">Start typing to see live preview</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ========== ACTIVITY LOG SECTION ========== -->
      <div class="section" id="section-activity">
        <div class="card">
          <div class="card-header">
            <div>
              <h3>Activity Log</h3>
              <p>Track all changes made to employees, settings, and templates</p>
            </div>
          </div>
          <div id="activityList">
            <p class="text-muted text-sm" style="padding:20px;text-align:center;">Loading...</p>
          </div>
          <div class="pagination" id="activityPagination"></div>
        </div>
      </div>

      <!-- ========== SETTINGS SECTION ========== -->
      <div class="section" id="section-settings">
        <!-- Company Info -->
        <div class="settings-section">
          <h3>Company Information</h3>
          <p>These details are used in email signatures for all employees</p>
          <div class="card">
            <form id="settingsForm" onsubmit="ESM.saveSettings(event)">
              <div class="settings-grid">
                <div class="form-group">
                  <label>Company Name</label>
                  <input class="form-control" type="text" id="setting_company_name">
                </div>
                <div class="form-group">
                  <label>Company Name (Arabic/Secondary)</label>
                  <input class="form-control" type="text" id="setting_company_name_ar" dir="rtl">
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Website</label>
                    <input class="form-control" type="text" id="setting_website">
                  </div>
                  <div class="form-group">
                    <label>Default Phone</label>
                    <input class="form-control" type="text" id="setting_default_phone">
                  </div>
                </div>
                <div class="form-group">
                  <label>Address</label>
                  <input class="form-control" type="text" id="setting_address">
                </div>
                <button type="submit" class="btn btn-primary">Save Settings</button>
              </div>
            </form>
          </div>
        </div>

        <!-- Logo Management -->
        <div class="settings-section">
          <h3>Logo Management</h3>
          <p>Manage your company logo used in email signatures</p>
          <div class="card">
            <div class="settings-grid">
              <div class="form-group">
                <label>Logo Type for Signatures</label>
                <select class="form-control" id="setting_logo_type">
                  <option value="gif">Animated GIF</option>
                  <option value="png">Static PNG</option>
                </select>
              </div>
              <div class="form-group">
                <label>Current GIF Logo</label>
                <div class="logo-preview-box">
                  <img id="logoPreviewGif" src="" alt="GIF Logo" onerror="this.style.display='none'">
                  <span class="text-muted text-sm">Used when logo type is set to GIF</span>
                </div>
              </div>
              <div class="form-group">
                <label>Current PNG Logo</label>
                <div class="logo-preview-box">
                  <img id="logoPreviewPng" src="" alt="PNG Logo" onerror="this.style.display='none'">
                  <span class="text-muted text-sm">Used when logo type is set to PNG</span>
                </div>
              </div>
              <form onsubmit="ESM.uploadLogo(event)">
                <div class="form-group">
                  <label>Upload New Logo</label>
                  <input class="form-control" type="file" id="logoFile" accept=".png,.gif,.jpg,.jpeg,.svg,.webp">
                  <p class="form-help">PNG, GIF, SVG or JPEG (max 10MB)</p>
                </div>
                <button type="submit" class="btn btn-accent">Upload Logo</button>
              </form>
            </div>
          </div>
        </div>

        <!-- Security -->
        <div class="settings-section">
          <h3>Security</h3>
          <p>Change the admin dashboard password</p>
          <div class="card">
            <form class="settings-grid" id="passwordForm" onsubmit="ESM.changePassword(event)">
              <input type="hidden" name="username" autocomplete="username" value="admin">
              <div class="form-group">
                <label>Current Password</label>
                <input class="form-control" type="password" id="currentPassword" required autocomplete="current-password">
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>New Password</label>
                  <input class="form-control" type="password" id="newPassword" required minlength="6" autocomplete="new-password">
                </div>
                <div class="form-group">
                  <label>Confirm Password</label>
                  <input class="form-control" type="password" id="confirmPassword" required minlength="6" autocomplete="new-password">
                </div>
              </div>
              <button type="submit" class="btn btn-primary">Change Password</button>
            </form>
          </div>
        </div>
      </div>

    </div><!-- end page-body -->
  </main>
</div><!-- end app-layout -->

<!-- ========== MODALS ========== -->

<!-- Employee Add/Edit Modal -->
<div class="modal-overlay" id="employeeModal">
  <div class="modal modal-md">
    <div class="modal-header">
      <h2 id="modalTitle">Add Employee</h2>
      <button class="modal-close" onclick="ESM.closeModal('employeeModal')">&times;</button>
    </div>
    <form onsubmit="ESM.saveEmployee(event)">
      <div class="modal-body">
        <input type="hidden" id="empId" value="">
        <div class="form-row">
          <div class="form-group">
            <label>Full Name (English) <span class="required">*</span></label>
            <input class="form-control" type="text" id="empName" required placeholder="e.g. Jane Doe">
          </div>
          <div class="form-group">
            <label>الاسم (عربي)</label>
            <input class="form-control" type="text" id="empNameAr" placeholder="مثال: جين دو" dir="rtl">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Job Title (English)</label>
            <input class="form-control" type="text" id="empTitle" placeholder="e.g. Marketing Manager">
          </div>
          <div class="form-group">
            <label>المنصب (عربي)</label>
            <input class="form-control" type="text" id="empTitleAr" placeholder="مثال: مدير التسويق" dir="rtl">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Email Address <span class="required">*</span></label>
            <input class="form-control" type="email" id="empEmail" required placeholder="e.g. jane@example.com">
          </div>
          <div class="form-group">
            <label>Phone</label>
            <input class="form-control" type="text" id="empPhone" placeholder="e.g. +1 555-0123">
          </div>
        </div>
        <div class="form-group" style="display:flex;align-items:center;gap:12px;">
          <label style="margin:0;">Signature Enabled</label>
          <label class="toggle-switch">
            <input type="checkbox" id="empEnabled" checked>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-ghost" onclick="ESM.closeModal('employeeModal')">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Employee</button>
      </div>
    </form>
  </div>
</div>

<!-- Preview Modal -->
<div class="modal-overlay" id="previewModal">
  <div class="modal modal-lg">
    <div class="modal-header">
      <h2>Signature Preview</h2>
      <button class="modal-close" onclick="ESM.closeModal('previewModal')">&times;</button>
    </div>
    <div class="modal-body" id="previewContent">
      <p class="text-muted">Loading...</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="ESM.sendTestEmail()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        Send Test Email
      </button>
      <button class="btn btn-primary" onclick="ESM.copySignatureHtml()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Copy HTML
      </button>
    </div>
  </div>
</div>

<!-- Delete Confirmation Modal -->
<div class="modal-overlay" id="deleteModal">
  <div class="modal modal-sm">
    <div class="modal-body" style="padding:32px;">
      <div class="confirm-icon danger">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </div>
      <div class="confirm-text">
        <h3>Delete Employee</h3>
        <p>Are you sure you want to delete <strong id="confirmDeleteName"></strong>? This action cannot be undone.</p>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="ESM.closeModal('deleteModal')">Cancel</button>
      <button class="btn btn-danger" id="confirmDeleteBtn">Delete</button>
    </div>
  </div>
</div>

<!-- CSV Import Modal -->
<div class="modal-overlay" id="importModal">
  <div class="modal modal-md">
    <div class="modal-header">
      <h2>Import Employees from CSV</h2>
      <button class="modal-close" onclick="ESM.closeModal('importModal')">&times;</button>
    </div>
    <div class="modal-body">
      <p class="text-sm text-muted mb-4">Upload a CSV file with columns: <strong>name</strong>, <strong>email</strong> (required), title, phone, enabled</p>
      <div class="form-group">
        <input class="form-control" type="file" id="csvFileInput" accept=".csv">
      </div>
      <div id="importPreview"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="ESM.closeModal('importModal')">Cancel</button>
      <button class="btn btn-primary" onclick="ESM.handleCSVImport()">Import</button>
    </div>
  </div>
</div>

<!-- Toast Container -->
<div class="toast-container" id="toastContainer"></div>

<script>window.__BASE_PATH = '${BASE_PATH}';</script>
<script src="${BASE_PATH}/static/js/app.js?v=${CACHE_BUST}"></script>
</body></html>`;
}

// ============ START SERVER ============
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Email Signature Manager running on http://127.0.0.1:${PORT}${BASE_PATH}`);
  console.log(`Setup complete: ${isSetupComplete()}`);
});
