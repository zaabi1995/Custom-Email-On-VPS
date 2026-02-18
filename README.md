# 📧 Email Signature Manager

A self-hosted email signature management system with optional Postfix SMTP filter integration. Centrally manage professional HTML email signatures for your entire organization.

![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D18-blue)
![Version](https://img.shields.io/badge/version-2.0.0-blue)

<!-- 
## Screenshots
![Dashboard](screenshots/dashboard.png)
![Employees](screenshots/employees.png)
![Template Editor](screenshots/template-editor.png)
-->

## ✨ Features

### Core
- **Employee Management** — Add, edit, delete, enable/disable employee signatures
- **Live Signature Preview** — See how signatures will look in real email clients
- **Template Editor** — Customize signature HTML with a built-in editor and variable system
- **Logo Management** — Upload and manage company logos (PNG, GIF, SVG, JPEG)
- **Activity Log** — Track all changes with a detailed audit trail

### UI/UX
- **Modern Dashboard** — Clean, professional SaaS-quality interface
- **Sidebar Navigation** — Intuitive section-based layout
- **Dark Mode** — Toggle between light and dark themes
- **Responsive Design** — Works on desktop, tablet, and mobile
- **Search & Filter** — Quickly find employees by name, email, or title
- **Toast Notifications** — Non-intrusive feedback for all actions
- **Confirmation Dialogs** — Safe deletion with proper confirmations

### Data Management
- **CSV Import/Export** — Bulk import employees from CSV or export your data
- **Test Emails** — Send test emails with signatures to verify they look correct
- **Setup Wizard** — First-run experience to configure your organization

### Integration
- **Postfix SMTP Filter** — Automatically append signatures to outgoing emails (optional)
- **Public API** — REST endpoint for retrieving signatures by email address
- **Reverse Proxy Ready** — Works behind Nginx, Apache, or any reverse proxy

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- npm

### Installation

```bash
# Clone the repository
git clone https://github.com/zaabi1995/Custom-Email-On-VPS.git
cd email-signature-manager

# Install dependencies
npm install

# (Optional) Copy and configure environment variables
cp .env.example .env
nano .env

# Start the server
npm start
```

The app will be available at `http://localhost:3456/email-signature/`

### First Run
1. Navigate to the login page
2. Use the default password: `admin`
3. Complete the setup wizard to configure your company details
4. Change the admin password in Settings → Security

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Server port |
| `BASE_PATH` | `/email-signature` | URL base path |
| `DB_PATH` | `./data/signatures.db` | SQLite database path |
| `SESSION_SECRET` | (random) | Express session secret |
| `PUBLIC_URL` | (empty) | Public URL for logo references in signatures |
| `SMTP_HOST` | `localhost` | SMTP server for test emails |
| `SMTP_PORT` | `25` | SMTP port for test emails |
| `DEFAULT_ADMIN_PASS` | `admin` | Default admin password (first run only) |

### Reverse Proxy (Nginx)

```nginx
location /email-signature/ {
    proxy_pass http://127.0.0.1:3456/email-signature/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### systemd Service

```ini
[Unit]
Description=Email Signature Manager
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/email-signature-manager
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3456

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable email-signature-manager
sudo systemctl start email-signature-manager
```

## 📮 Postfix SMTP Filter Integration (Optional)

The included SMTP filter script (`scripts/signature-filter.py`) automatically appends email signatures to outgoing emails processed by Postfix.

### How It Works
1. Postfix routes outgoing email through a content filter on port 10024
2. The filter queries the Email Signature Manager API to get the signature for the sender
3. If found, the signature is appended to the email body (both HTML and plain text)
4. The modified email is reinjected back to Postfix on port 10025

### Setup

```bash
# Install Python dependencies
pip3 install aiosmtpd

# Copy the filter script
sudo cp scripts/signature-filter.py /usr/local/bin/signature-smtp-filter.py
sudo chmod +x /usr/local/bin/signature-smtp-filter.py

# Create a systemd service
sudo tee /etc/systemd/system/signature-filter.service << 'EOF'
[Unit]
Description=Email Signature SMTP Filter
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /usr/local/bin/signature-smtp-filter.py
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable signature-filter
sudo systemctl start signature-filter
```

### Postfix Configuration

Add to `/etc/postfix/main.cf`:
```
content_filter = smtp:[127.0.0.1]:10024
```

Add to `/etc/postfix/master.cf`:
```
# Reinjection from content filter
127.0.0.1:10025 inet  n  -  n  -  10  smtpd
    -o content_filter=
    -o receive_override_options=no_unknown_recipient_checks,no_header_body_checks,no_milters
    -o smtpd_helo_restrictions=
    -o smtpd_client_restrictions=
    -o smtpd_sender_restrictions=
    -o smtpd_recipient_restrictions=permit_mynetworks,reject
    -o mynetworks=127.0.0.0/8
```

## 🔌 API Reference

### Public Endpoints

#### Get Signature by Email
```
GET /email-signature/api/signature/:email
```

**Response (found):**
```json
{
  "found": true,
  "html": "<div style=\"...\">...</div>"
}
```

**Response (not found):**
```json
{
  "found": false
}
```

### Authenticated Endpoints

All authenticated endpoints require an active session (login first).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/employees` | List all employees |
| `POST` | `/api/employees` | Add an employee |
| `PUT` | `/api/employees/:id` | Update an employee |
| `DELETE` | `/api/employees/:id` | Delete an employee |
| `POST` | `/api/employees/:id/toggle` | Toggle signature on/off |
| `GET` | `/api/employees/:id/signature` | Preview signature HTML |
| `GET` | `/api/employees/export` | Export employees as CSV |
| `POST` | `/api/employees/import` | Import employees from CSV |
| `GET` | `/api/settings` | Get all settings |
| `POST` | `/api/settings` | Update settings |
| `POST` | `/api/upload-logo` | Upload a logo file |
| `POST` | `/api/change-password` | Change admin password |
| `GET` | `/api/templates` | List signature templates |
| `POST` | `/api/templates` | Create/update a template |
| `POST` | `/api/templates/reset` | Reset template to default |
| `GET` | `/api/activity-log` | Get activity log |
| `POST` | `/api/test-email` | Send a test email |

## 📝 Signature Template Variables

Use these variables in your signature templates:

| Variable | Description |
|----------|-------------|
| `{{name}}` | Employee full name |
| `{{title}}` | Job title |
| `{{email}}` | Email address |
| `{{phone}}` | Phone number |
| `{{company_name}}` | Company name |
| `{{company_name_ar}}` | Company name (Arabic/secondary) |
| `{{address}}` | Company address |
| `{{website}}` | Company website |
| `{{logo_url}}` | Full URL to the company logo |
| `{{default_phone}}` | Default company phone |

### Conditional Sections
```
{{#phone}} | {{phone}}{{/phone}}
```
Content between `{{#phone}}` and `{{/phone}}` only renders if the phone variable has a value.

## 🛠 Development

```bash
# Start in development mode (auto-restart on file changes)
npm run dev
```

## 📄 License

MIT — see [LICENSE](LICENSE) for details.
