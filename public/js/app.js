/* ============================================================
   Email Signature Manager - Frontend Application
   ============================================================ */

(function() {
  'use strict';

  const BASE = window.__BASE_PATH || '/email-signature';
  let employees = [];
  let settings = {};
  let activityLog = [];
  let templates = [];
  let currentFilter = 'all';
  let searchQuery = '';

  // ============ INITIALIZATION ============
  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initNavigation();
    initMobileMenu();
    loadData();
  });

  async function loadData() {
    try {
      const [empRes, setRes, logRes, tplRes] = await Promise.all([
        api('GET', '/api/employees'),
        api('GET', '/api/settings'),
        api('GET', '/api/activity-log'),
        api('GET', '/api/templates'),
      ]);
      employees = empRes || [];
      settings = setRes || {};
      activityLog = logRes || [];
      templates = tplRes || [];
      renderDashboard();
      renderEmployees();
      renderActivityLog();
      renderTemplates();
      renderSettings();
    } catch (err) {
      console.error('Failed to load data:', err);
      showToast('Failed to load data', 'error');
    }
  }

  // ============ API HELPER ============
  async function api(method, path, body, isFormData) {
    const opts = { method, credentials: 'same-origin' };
    if (body) {
      if (isFormData) {
        opts.body = body;
      } else {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
      }
    }
    const res = await fetch(BASE + path, opts);
    if (!res.ok && res.status === 401) {
      window.location.href = BASE + '/login';
      throw new Error('Unauthorized');
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/csv') || ct.includes('application/octet-stream')) return res;
    return res.json();
  }

  // ============ THEME ============
  function initTheme() {
    const saved = localStorage.getItem('esm-theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('esm-theme', next);
    updateThemeIcon(next);
  }

  function updateThemeIcon(theme) {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const label = btn.querySelector('.theme-label');
    const icon = btn.querySelector('.theme-icon');
    if (label) label.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
    if (icon) icon.innerHTML = theme === 'dark'
      ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
      : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  }

  // ============ NAVIGATION ============
  function initNavigation() {
    document.querySelectorAll('.sidebar-link[data-section]').forEach(link => {
      link.addEventListener('click', () => {
        navigateTo(link.dataset.section);
      });
    });
    // Handle hash navigation
    const hash = window.location.hash.slice(1);
    if (hash) navigateTo(hash);
  }

  function navigateTo(section) {
    // Update sidebar active state
    document.querySelectorAll('.sidebar-link[data-section]').forEach(l => l.classList.remove('active'));
    const activeLink = document.querySelector(`.sidebar-link[data-section="${section}"]`);
    if (activeLink) activeLink.classList.add('active');

    // Update sections
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const activeSection = document.getElementById('section-' + section);
    if (activeSection) activeSection.classList.add('active');

    // Update page header
    const headers = {
      dashboard: { title: 'Dashboard', desc: 'Overview of your email signature system' },
      employees: { title: 'Employees', desc: 'Manage employee email signatures' },
      templates: { title: 'Templates', desc: 'Customize signature HTML templates' },
      activity: { title: 'Activity Log', desc: 'Track all changes and actions' },
      settings: { title: 'Settings', desc: 'Configure company info, logos, and security' },
    };
    const h = headers[section] || { title: section, desc: '' };
    const titleEl = document.getElementById('pageTitle');
    const descEl = document.getElementById('pageDesc');
    if (titleEl) titleEl.textContent = h.title;
    if (descEl) descEl.textContent = h.desc;

    // Update header actions
    const actionsEl = document.getElementById('pageActions');
    if (actionsEl) {
      if (section === 'employees') {
        actionsEl.innerHTML = `
          <button class="btn btn-accent btn-sm" onclick="ESM.openMailServerImport()">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            Import from Mail Server
          </button>
          <button class="btn btn-ghost btn-sm" onclick="ESM.openImportModal()">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Import CSV
          </button>
          <button class="btn btn-ghost btn-sm" onclick="ESM.exportCSV()">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export CSV
          </button>
          <button class="btn btn-primary btn-sm" onclick="ESM.openAddModal()">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Employee
          </button>`;
      } else {
        actionsEl.innerHTML = '';
      }
    }

    window.location.hash = section;
    // Close mobile menu
    document.querySelector('.sidebar')?.classList.remove('open');
  }

  function initMobileMenu() {
    const toggle = document.getElementById('mobileToggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        document.querySelector('.sidebar')?.classList.toggle('open');
      });
    }
    // Close sidebar on overlay click for mobile
    document.addEventListener('click', (e) => {
      const sidebar = document.querySelector('.sidebar');
      const toggle = document.getElementById('mobileToggle');
      if (sidebar && sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== toggle && !toggle.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }

  // ============ DASHBOARD ============
  function renderDashboard() {
    const total = employees.length;
    const active = employees.filter(e => e.enabled).length;
    const disabled = total - active;

    setHTML('statTotal', total);
    setHTML('statActive', active);
    setHTML('statDisabled', disabled);
    setHTML('statTemplates', templates.length || 1);

    // Update sidebar badge
    const empBadge = document.getElementById('empBadge');
    if (empBadge) empBadge.textContent = total;

    // Recent activity on dashboard
    const recentEl = document.getElementById('recentActivity');
    if (recentEl) {
      if (activityLog.length === 0) {
        recentEl.innerHTML = '<p class="text-muted text-sm" style="padding:20px;text-align:center;">No activity recorded yet</p>';
      } else {
        recentEl.innerHTML = activityLog.slice(0, 8).map(renderActivityItem).join('');
      }
    }
  }

  // ============ EMPLOYEES ============
  function renderEmployees() {
    const grid = document.getElementById('employeeGrid');
    if (!grid) return;

    let filtered = [...employees];

    // Apply filter
    if (currentFilter === 'active') filtered = filtered.filter(e => e.enabled);
    else if (currentFilter === 'disabled') filtered = filtered.filter(e => !e.enabled);

    // Apply search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        (e.title && e.title.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <h3>${searchQuery ? 'No results found' : 'No employees yet'}</h3>
          <p>${searchQuery ? 'Try adjusting your search terms' : 'Click "Add Employee" to create your first email signature'}</p>
        </div>`;
      return;
    }

    grid.innerHTML = filtered.map(emp => {
      const initials = emp.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
      return `
        <div class="employee-card ${emp.enabled ? '' : 'disabled'}">
          <div class="emp-top">
            <div style="display:flex;align-items:center;">
              <div class="emp-avatar">${initials}</div>
              <div class="emp-info">
                <div class="emp-name">${esc(emp.name)}${emp.name_ar ? ' <span style="font-weight:400;color:var(--text-muted);font-size:13px;" dir="rtl">' + esc(emp.name_ar) + '</span>' : ''}</div>
                <div class="emp-title-text">${esc(emp.title || 'No title')}${emp.title_ar ? ' — <span dir="rtl">' + esc(emp.title_ar) + '</span>' : ''}</div>
              </div>
            </div>
            <span class="badge ${emp.enabled ? 'badge-active' : 'badge-inactive'}">${emp.enabled ? 'Active' : 'Disabled'}</span>
          </div>
          <div class="emp-details">
            <div class="emp-detail">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              <span>${esc(emp.email)}</span>
            </div>
            ${emp.phone ? `<div class="emp-detail">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              <span>${esc(emp.phone)}</span>
            </div>` : ''}
          </div>
          <div class="emp-actions-bar">
            <button class="btn btn-sm btn-primary" onclick="ESM.previewSignature(${emp.id})">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              Preview
            </button>
            <button class="btn btn-sm btn-ghost" onclick='ESM.openEditModal(${JSON.stringify(emp).replace(/'/g, "&#39;").replace(/"/g, "&quot;")})'>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>
            <button class="btn btn-sm btn-ghost" onclick="ESM.toggleEmployee(${emp.id})">
              ${emp.enabled
                ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>'
                : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'}
              ${emp.enabled ? 'Disable' : 'Enable'}
            </button>
            <button class="btn btn-sm btn-icon danger" onclick="ESM.confirmDelete(${emp.id}, '${esc(emp.name)}')">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>`;
    }).join('');
  }

  // ============ EMPLOYEE CRUD ============
  function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
  function setChecked(id, val) { const el = document.getElementById(id); if (el) el.checked = val; }
  function getVal(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function getChecked(id) { const el = document.getElementById(id); return el ? el.checked : false; }

  function openAddModal() {
    const t = document.getElementById('modalTitle'); if (t) t.textContent = 'Add Employee';
    setVal('empId', ''); setVal('empName', ''); setVal('empNameAr', '');
    setVal('empTitle', ''); setVal('empTitleAr', '');
    setVal('empEmail', ''); setVal('empPhone', '');
    setChecked('empEnabled', true);
    openModal('employeeModal');
  }

  function openEditModal(empStr) {
    let emp;
    if (typeof empStr === 'string') {
      try { emp = JSON.parse(empStr); } catch { return; }
    } else {
      emp = empStr;
    }
    const t = document.getElementById('modalTitle'); if (t) t.textContent = 'Edit Employee';
    setVal('empId', emp.id);
    setVal('empName', emp.name);
    setVal('empNameAr', emp.name_ar || '');
    setVal('empTitle', emp.title || '');
    setVal('empTitleAr', emp.title_ar || '');
    setVal('empEmail', emp.email);
    setVal('empPhone', emp.phone || '');
    setChecked('empEnabled', !!emp.enabled);
    openModal('employeeModal');
  }

  async function saveEmployee(e) {
    e.preventDefault();
    const id = getVal('empId');
    const data = {
      name: getVal('empName'),
      name_ar: getVal('empNameAr'),
      title: getVal('empTitle'),
      title_ar: getVal('empTitleAr'),
      email: getVal('empEmail'),
      phone: getVal('empPhone'),
      enabled: getChecked('empEnabled'),
    };
    if (!data.name || !data.email) {
      showToast('Name and email are required', 'error');
      return;
    }
    try {
      const url = id ? '/api/employees/' + id : '/api/employees';
      const method = id ? 'PUT' : 'POST';
      const result = await api(method, url, data);
      if (result.success) {
        showToast(id ? 'Employee updated!' : 'Employee added!', 'success');
        closeModal('employeeModal');
        await loadData();
      } else {
        showToast(result.error || 'Error saving', 'error');
      }
    } catch (err) {
      showToast('Network error', 'error');
    }
  }

  async function toggleEmployee(id) {
    try {
      const result = await api('POST', '/api/employees/' + id + '/toggle');
      if (result.success) {
        showToast(result.enabled ? 'Signature enabled' : 'Signature disabled', 'success');
        await loadData();
      }
    } catch (err) {
      showToast('Error toggling', 'error');
    }
  }

  function confirmDelete(id, name) {
    document.getElementById('confirmDeleteName').textContent = name;
    document.getElementById('confirmDeleteBtn').onclick = () => deleteEmployee(id);
    openModal('deleteModal');
  }

  async function deleteEmployee(id) {
    try {
      const result = await api('DELETE', '/api/employees/' + id);
      if (result.success) {
        showToast('Employee deleted', 'success');
        closeModal('deleteModal');
        await loadData();
      }
    } catch (err) {
      showToast('Error deleting', 'error');
    }
  }

  // ============ SIGNATURE PREVIEW ============
  async function previewSignature(id) {
    openModal('previewModal');
    const container = document.getElementById('previewContent');
    container.innerHTML = '<p class="text-muted text-center" style="padding:40px;">Loading preview...</p>';
    try {
      const result = await api('GET', '/api/employees/' + id + '/signature');
      if (result.success) {
        container.innerHTML = '<div class="preview-container">' + result.html + '</div>';
        container.dataset.html = result.html;
        container.dataset.empId = id;
      } else {
        container.innerHTML = '<p class="text-muted">Failed to load preview</p>';
      }
    } catch (err) {
      container.innerHTML = '<p class="text-muted">Error loading preview</p>';
    }
  }

  function copySignatureHtml() {
    const html = document.getElementById('previewContent').dataset.html;
    if (html) {
      navigator.clipboard.writeText(html).then(() => showToast('HTML copied to clipboard!', 'success'));
    }
  }

  async function sendTestEmail() {
    const empId = document.getElementById('previewContent').dataset.empId;
    const email = prompt('Send test email to:');
    if (!email) return;
    try {
      const result = await api('POST', '/api/test-email', { employeeId: parseInt(empId), to: email });
      if (result.success) {
        showToast('Test email sent to ' + email, 'success');
      } else {
        showToast(result.error || 'Failed to send test email', 'error');
      }
    } catch (err) {
      showToast('Error sending test email', 'error');
    }
  }

  // ============ SEARCH & FILTER ============
  function handleSearch(value) {
    searchQuery = value;
    renderEmployees();
  }

  function setFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    document.querySelector(`.filter-chip[data-filter="${filter}"]`)?.classList.add('active');
    renderEmployees();
  }

  // ============ CSV IMPORT/EXPORT ============
  async function exportCSV() {
    try {
      const res = await api('GET', '/api/employees/export');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'employees.csv';
      a.click();
      URL.revokeObjectURL(url);
      showToast('CSV exported!', 'success');
    } catch (err) {
      showToast('Export failed', 'error');
    }
  }

  function openImportModal() {
    document.getElementById('csvFileInput').value = '';
    document.getElementById('importPreview').innerHTML = '';
    openModal('importModal');
  }

  async function handleCSVImport() {
    const fileInput = document.getElementById('csvFileInput');
    if (!fileInput.files.length) {
      showToast('Please select a CSV file', 'error');
      return;
    }
    const formData = new FormData();
    formData.append('csv', fileInput.files[0]);
    try {
      const result = await api('POST', '/api/employees/import', formData, true);
      if (result.success) {
        showToast(`Imported ${result.imported} employees (${result.skipped} skipped)`, 'success');
        closeModal('importModal');
        await loadData();
      } else {
        showToast(result.error || 'Import failed', 'error');
      }
    } catch (err) {
      showToast('Import error', 'error');
    }
  }

  // ============ ACTIVITY LOG ============
  let activityPage = 0;
  const ACTIVITY_PER_PAGE = 20;

  function renderActivityLog() {
    const container = document.getElementById('activityList');
    if (!container) return;

    if (activityLog.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </div>
          <h3>No activity yet</h3>
          <p>Actions will be logged here as you manage employees and settings</p>
        </div>`;
      return;
    }

    const start = activityPage * ACTIVITY_PER_PAGE;
    const page = activityLog.slice(start, start + ACTIVITY_PER_PAGE);
    container.innerHTML = page.map(renderActivityItem).join('');

    // Pagination
    const totalPages = Math.ceil(activityLog.length / ACTIVITY_PER_PAGE);
    const pagEl = document.getElementById('activityPagination');
    if (pagEl && totalPages > 1) {
      let html = `<button ${activityPage === 0 ? 'disabled' : ''} onclick="ESM.activityPageNav(-1)">&laquo; Prev</button>`;
      html += `<span class="text-muted text-sm">Page ${activityPage + 1} of ${totalPages}</span>`;
      html += `<button ${activityPage >= totalPages - 1 ? 'disabled' : ''} onclick="ESM.activityPageNav(1)">Next &raquo;</button>`;
      pagEl.innerHTML = html;
    } else if (pagEl) {
      pagEl.innerHTML = '';
    }
  }

  function renderActivityItem(item) {
    const actionMap = {
      create: 'create', add: 'create',
      update: 'update', edit: 'update',
      delete: 'delete', remove: 'delete',
      toggle: 'toggle',
      settings: 'settings',
    };
    const dotClass = actionMap[item.action] || 'update';
    const timeAgo = formatTimeAgo(item.created_at);
    return `
      <div class="activity-item">
        <div class="activity-dot ${dotClass}"></div>
        <div class="activity-content">
          <div class="activity-text">${esc(item.description)}</div>
          <div class="activity-time">${timeAgo}</div>
        </div>
      </div>`;
  }

  function activityPageNav(delta) {
    activityPage += delta;
    renderActivityLog();
  }

  // ============ TEMPLATES ============
  function renderTemplates() {
    const listEl = document.getElementById('templateList');
    if (!listEl) return;

    if (templates.length === 0) {
      listEl.innerHTML = '<p class="text-muted text-sm text-center" style="padding:20px;">No templates yet</p>';
      return;
    }

    listEl.innerHTML = templates.map(tpl => `
      <div class="activity-item" style="cursor:pointer;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;" onclick="ESM.editTemplate(${tpl.id})">
        <div style="display:flex;align-items:center;gap:12px;">
          <div>
            <div style="font-weight:600;font-size:14px;">${esc(tpl.name)}</div>
            <div style="font-size:12px;color:var(--text-muted);">Last updated: ${formatTimeAgo(tpl.updated_at)}</div>
          </div>
          ${tpl.is_default ? '<span class="badge badge-active">Default</span>' : ''}
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();ESM.editTemplate(${tpl.id})">Edit</button>
          ${!tpl.is_default ? `<button class="btn btn-sm btn-ghost" style="color:var(--danger);" onclick="event.stopPropagation();ESM.deleteTemplate(${tpl.id},'${esc(tpl.name)}')">Delete</button>` : ''}
        </div>
      </div>`).join('');
  }

  function editTemplate(id) {
    const tpl = templates.find(t => t.id === id);
    if (!tpl) return;
    setVal('templateId', tpl.id);
    setVal('templateNameInput', tpl.name);
    setChecked('templateIsDefault', !!tpl.is_default);
    setVal('templateEditor', tpl.html_template);
    const title = document.getElementById('templateEditorTitle');
    if (title) title.textContent = 'Edit: ' + tpl.name;
    const card = document.getElementById('templateEditorCard');
    if (card) { card.style.display = ''; card.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    livePreviewTemplate();
  }

  function newTemplate() {
    setVal('templateId', '');
    setVal('templateNameInput', '');
    setChecked('templateIsDefault', false);
    setVal('templateEditor', '');
    const title = document.getElementById('templateEditorTitle');
    if (title) title.textContent = 'New Template';
    const card = document.getElementById('templateEditorCard');
    if (card) { card.style.display = ''; card.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    const preview = document.getElementById('templatePreviewContent');
    if (preview) preview.innerHTML = '<p class="text-muted text-sm text-center" style="padding:40px;">Start typing to see live preview</p>';
  }

  function cancelEditTemplate() {
    const card = document.getElementById('templateEditorCard');
    if (card) card.style.display = 'none';
  }

  async function saveTemplate() {
    const id = getVal('templateId');
    const name = getVal('templateNameInput') || 'Untitled';
    const html = getVal('templateEditor');
    const is_default = getChecked('templateIsDefault');
    try {
      const result = await api('POST', '/api/templates', { id: id || undefined, name, html_template: html, is_default });
      if (result.success) {
        showToast('Template saved!', 'success');
        if (result.templates) templates = result.templates;
        document.getElementById('templateEditorCard').style.display = 'none';
        await loadData();
      } else {
        showToast(result.error || 'Error saving template', 'error');
      }
    } catch (err) {
      showToast('Error saving template', 'error');
    }
  }

  async function deleteTemplate(id, name) {
    if (!confirm('Delete template "' + name + '"?')) return;
    try {
      const result = await api('DELETE', '/api/templates/' + id);
      if (result.success) {
        showToast('Template deleted', 'success');
        document.getElementById('templateEditorCard').style.display = 'none';
        await loadData();
      } else {
        showToast(result.error || 'Cannot delete', 'error');
      }
    } catch (err) {
      showToast('Error deleting template', 'error');
    }
  }

  async function resetTemplate() {
    if (!confirm('Reset to the default template? Your customizations will be lost.')) return;
    try {
      const result = await api('POST', '/api/templates/reset');
      if (result.success) {
        showToast('Template reset to default', 'success');
        await loadData();
      }
    } catch (err) {
      showToast('Error resetting template', 'error');
    }
  }

  function livePreviewTemplate() {
    const html = document.getElementById('templateEditor').value;
    const container = document.getElementById('templatePreviewContent');
    if (!container || !html.trim()) {
      if (container) container.innerHTML = '<p class="text-muted text-sm text-center" style="padding:40px;">Start typing to see live preview</p>';
      return;
    }

    let preview = html
      .replace(/\{\{name\}\}/g, 'Jane Doe')
      .replace(/\{\{name_ar\}\}/g, 'جين دو')
      .replace(/\{\{title\}\}/g, 'Marketing Manager')
      .replace(/\{\{title_ar\}\}/g, 'مدير التسويق')
      .replace(/\{\{email\}\}/g, 'jane@example.com')
      .replace(/\{\{phone\}\}/g, '+1 555-0123')
      .replace(/\{\{company_name\}\}/g, settings.company_name || 'Your Company')
      .replace(/\{\{company_name_ar\}\}/g, settings.company_name_ar || '')
      .replace(/\{\{address\}\}/g, settings.address || '123 Business Street')
      .replace(/\{\{website\}\}/g, settings.website || 'example.com')
      .replace(/\{\{logo_url\}\}/g, settings._logo_url || '')
      .replace(/\{\{default_phone\}\}/g, settings.default_phone || '')
      .replace(/\{\{en_font\}\}/g, settings.en_font || 'Arial, sans-serif')
      .replace(/\{\{ar_font\}\}/g, settings.ar_font || "'Sakkal Majalla', Tahoma, sans-serif")
      .replace(/\{\{en_name_size\}\}/g, settings.en_name_size || '15')
      .replace(/\{\{ar_name_size\}\}/g, settings.ar_name_size || '17')
      .replace(/\{\{en_title_size\}\}/g, settings.en_title_size || '12')
      .replace(/\{\{ar_title_size\}\}/g, settings.ar_title_size || '14')
      .replace(/\{\{en_company_size\}\}/g, settings.en_company_size || '12')
      .replace(/\{\{ar_company_size\}\}/g, settings.ar_company_size || '14');
    // Handle conditional phone
    preview = preview.replace(/\{\{#phone\}\}(.*?)\{\{\/phone\}\}/gs, '$1');
    container.innerHTML = '<div class="preview-container">' + preview + '</div>';
  }

  // Keep old name for compatibility
  function previewTemplate() { livePreviewTemplate(); }

  function insertTemplateVar(v) {
    const editor = document.getElementById('templateEditor');
    if (!editor) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = editor.value;
    editor.value = text.substring(0, start) + '{{' + v + '}}' + text.substring(end);
    editor.focus();
    editor.selectionStart = editor.selectionEnd = start + v.length + 4;
    livePreviewTemplate();
  }

  // ============ SETTINGS ============
  function renderSettings() {
    ['company_name', 'company_name_ar', 'address', 'website', 'default_phone'].forEach(f => {
      setVal('setting_' + f, settings[f] || '');
    });
    setVal('setting_logo_type', settings.logo_type || 'gif');
    // Font settings
    setVal('setting_en_font', settings.en_font || 'Arial, sans-serif');
    setVal('setting_ar_font', settings.ar_font || "'Sakkal Majalla', 'Traditional Arabic', 'Simplified Arabic', 'Geeza Pro', Tahoma, Arial, sans-serif");
    const fontSizes = { en_name_size: '15', ar_name_size: '17', en_title_size: '12', ar_title_size: '14', en_company_size: '12', ar_company_size: '14' };
    Object.entries(fontSizes).forEach(([key, def]) => {
      const val = settings[key] || def;
      const el = document.getElementById('setting_' + key);
      if (el) el.value = val;
      const label = document.getElementById(key + '_val');
      if (label) label.textContent = val + 'px';
    });
    renderLogoPreview();
    previewFontSettings();
  }

  function renderLogoPreview() {
    const gif = document.getElementById('logoPreviewGif');
    const png = document.getElementById('logoPreviewPng');
    if (gif) gif.src = BASE + '/uploads/' + (settings.logo_gif || 'alali-logo.gif');
    if (png) png.src = BASE + '/uploads/' + (settings.logo_png || 'alali-logo-official.png');
  }

  async function saveSettings(e) {
    e.preventDefault();
    const data = {};
    ['company_name', 'company_name_ar', 'address', 'website', 'default_phone', 'logo_type'].forEach(f => {
      data[f] = getVal('setting_' + f);
    });
    try {
      const result = await api('POST', '/api/settings', data);
      if (result.success) {
        settings = result.settings;
        showToast('Settings saved!', 'success');
      }
    } catch (err) {
      showToast('Error saving settings', 'error');
    }
  }

  async function uploadLogo(e) {
    e.preventDefault();
    const input = document.getElementById('logoFile');
    if (!input.files.length) {
      showToast('Please select a file', 'error');
      return;
    }
    const formData = new FormData();
    formData.append('logo', input.files[0]);
    try {
      const result = await api('POST', '/api/upload-logo', formData, true);
      if (result.success) {
        showToast('Logo uploaded! (' + result.type + ')', 'success');
        await loadData();
      } else {
        showToast(result.error || 'Upload failed', 'error');
      }
    } catch (err) {
      showToast('Upload error', 'error');
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    const current = getVal('currentPassword');
    const newPass = getVal('newPassword');
    const confirm = getVal('confirmPassword');
    if (newPass !== confirm) {
      showToast('Passwords do not match', 'error');
      return;
    }
    if (newPass.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }
    try {
      const result = await api('POST', '/api/change-password', { current, newPassword: newPass });
      if (result.success) {
        showToast('Password changed!', 'success');
        document.getElementById('passwordForm').reset();
      } else {
        showToast(result.error || 'Error changing password', 'error');
      }
    } catch (err) {
      showToast('Error', 'error');
    }
  }

  // ============ MODAL HELPERS ============
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  }

  // Close on overlay click
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay') && e.target.classList.contains('active')) {
      e.target.classList.remove('active');
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    }
  });

  // ============ TOAST ============
  function showToast(msg, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const icons = {
      success: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
      error: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
      warning: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    };

    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.innerHTML = (icons[type] || '') + '<span>' + esc(msg) + '</span>';
    container.appendChild(toast);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.add('show'));
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ============ UTILITIES ============
  function esc(str) {
    if (!str) return '';
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  function setHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z'));
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return date.toLocaleDateString();
  }

  // ============ SETUP WIZARD ============
  let setupStep = 0;
  function setupNext() {
    const steps = document.querySelectorAll('.setup-step');
    const dots = document.querySelectorAll('.setup-dot');
    if (setupStep < steps.length - 1) {
      steps[setupStep].classList.remove('active');
      dots[setupStep].classList.remove('active');
      dots[setupStep].classList.add('done');
      setupStep++;
      steps[setupStep].classList.add('active');
      dots[setupStep].classList.add('active');
    }
  }
  function setupPrev() {
    const steps = document.querySelectorAll('.setup-step');
    const dots = document.querySelectorAll('.setup-dot');
    if (setupStep > 0) {
      steps[setupStep].classList.remove('active');
      dots[setupStep].classList.remove('active');
      setupStep--;
      steps[setupStep].classList.add('active');
      dots[setupStep].classList.add('active');
      dots[setupStep].classList.remove('done');
    }
  }
  async function completeSetup() {
    const data = {
      company_name: document.getElementById('setup_company_name')?.value || '',
      company_name_ar: document.getElementById('setup_company_name_ar')?.value || '',
      address: document.getElementById('setup_address')?.value || '',
      website: document.getElementById('setup_website')?.value || '',
      default_phone: document.getElementById('setup_phone')?.value || '',
      admin_password: document.getElementById('setup_password')?.value || '',
    };
    if (!data.company_name) {
      showToast('Company name is required', 'error');
      return;
    }
    try {
      const result = await api('POST', '/api/setup', data);
      if (result.success) {
        showToast('Setup complete! Redirecting...', 'success');
        setTimeout(() => window.location.href = BASE + '/dashboard', 1000);
      } else {
        showToast(result.error || 'Setup failed', 'error');
      }
    } catch (err) {
      showToast('Error during setup', 'error');
    }
  }

  // ============ FONT SETTINGS ============
  function previewFontSettings() {
    const box = document.getElementById('fontPreviewBox');
    if (!box) return;
    const enFont = getVal('setting_en_font') || 'Arial, sans-serif';
    const arFont = getVal('setting_ar_font') || 'Tahoma, sans-serif';
    const enNameSize = getVal('setting_en_name_size') || '15';
    const arNameSize = getVal('setting_ar_name_size') || '17';
    const enTitleSize = getVal('setting_en_title_size') || '12';
    const arTitleSize = getVal('setting_ar_title_size') || '14';
    const enCompanySize = getVal('setting_en_company_size') || '12';
    const arCompanySize = getVal('setting_ar_company_size') || '14';
    const logoUrl = settings._logo_url || '';

    box.innerHTML = '<div style="font-family: ' + enFont + '; font-size: 13px; color: #333;">' +
      '<hr style="border: none; border-top: 2px solid #2d6a4f; margin: 12px 0; width: 200px;">' +
      '<table cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td style="padding-right: 15px; vertical-align: middle; border-right: 2px solid #2d6a4f;">' +
      (logoUrl ? '<img src="' + logoUrl + '" style="width: 70px; height: auto;">' : '') +
      '</td><td style="padding-left: 15px; vertical-align: top;">' +
      '<p style="margin:0 0 4px 0;font-weight:bold;font-size:' + enNameSize + 'px;color:#034D57;">Ali Adnan Haider Darwish <span style="font-weight:normal;color:#bbb;margin:0 8px;">|</span><span dir="rtl" style="font-family:' + arFont + ';font-size:' + arNameSize + 'px;color:#034D57;">علي عدنان حيدر درويش</span></p>' +
      '<p style="margin:0 0 4px 0;font-size:' + enTitleSize + 'px;color:#555;">Co-Founder <span style="color:#bbb;margin:0 8px;">|</span><span dir="rtl" style="font-family:' + arFont + ';font-size:' + arTitleSize + 'px;color:#555;">شريك مؤسس</span></p>' +
      '<p style="margin:0 0 4px 0;font-size:' + enCompanySize + 'px;font-weight:bold;color:#2d6a4f;">' + esc(settings.company_name || 'Alali Investment SPC') + ' <span style="font-weight:normal;color:#bbb;margin:0 8px;">|</span><span dir="rtl" style="font-family:' + arFont + ';font-size:' + arCompanySize + 'px;font-weight:bold;color:#2d6a4f;">' + esc(settings.company_name_ar || 'العلالي للإستثمار') + '</span></p>' +
      '<p style="margin:0 0 3px 0;font-size:12px;"><a href="#" style="color:#034D57;text-decoration:none;">ali.alzaabi@alali.om</a> | +968 98899100</p>' +
      '<p style="margin:0 0 3px 0;font-size:12px;"><a href="#" style="color:#2d6a4f;text-decoration:none;">' + esc(settings.website || 'www.alali.om') + '</a></p>' +
      '<p style="margin:0;font-size:12px;color:#666;">' + esc(settings.address || 'P.O. Box 2, Muscat') + '</p>' +
      '</td></tr></table></div>';
  }

  async function saveFontSettings() {
    const data = {};
    ['en_font', 'ar_font', 'en_name_size', 'ar_name_size', 'en_title_size', 'ar_title_size', 'en_company_size', 'ar_company_size'].forEach(f => {
      data[f] = getVal('setting_' + f);
    });
    try {
      const result = await api('POST', '/api/settings', data);
      if (result.success) {
        settings = result.settings;
        showToast('Font settings saved!', 'success');
      } else {
        showToast(result.error || 'Error saving', 'error');
      }
    } catch (err) {
      showToast('Error saving font settings', 'error');
    }
  }

  // ============ MAIL SERVER IMPORT ============
  async function openMailServerImport() {
    // Create modal dynamically if not exists
    let modal = document.getElementById('mailServerModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.id = 'mailServerModal';
      modal.innerHTML = `
        <div class="modal modal-md">
          <div class="modal-header">
            <h2>Import from Mail Server</h2>
            <button class="modal-close" onclick="ESM.closeModal('mailServerModal')">&times;</button>
          </div>
          <div class="modal-body" id="mailServerBody">
            <p class="text-muted text-sm text-center" style="padding:40px;">Loading mailboxes...</p>
          </div>
          <div class="modal-footer" id="mailServerFooter" style="display:none;">
            <button class="btn btn-ghost" onclick="ESM.closeModal('mailServerModal')">Cancel</button>
            <button class="btn btn-primary" onclick="ESM.importSelectedMailboxes()">Import Selected</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }
    openModal('mailServerModal');

    const body = document.getElementById('mailServerBody');
    const footer = document.getElementById('mailServerFooter');
    body.innerHTML = '<p class="text-muted text-sm text-center" style="padding:40px;">Loading mailboxes...</p>';
    footer.style.display = 'none';

    try {
      const result = await api('GET', '/api/mailboxes');
      const mailboxes = result.mailboxes || [];
      if (mailboxes.length === 0) {
        body.innerHTML = '<div class="empty-state"><h3>All synced!</h3><p>All mail server accounts are already imported.</p></div>';
        return;
      }
      let html = '<p class="text-sm text-muted" style="margin-bottom:12px;">Select accounts to import (' + mailboxes.length + ' available)</p>';
      html += '<div style="margin-bottom:12px;padding:8px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;">';
      html += '<input type="checkbox" id="msSelectAll" onchange="ESM.toggleSelectAllMailboxes(this.checked)" style="width:18px;height:18px;">';
      html += '<label for="msSelectAll" style="font-weight:600;font-size:13px;cursor:pointer;">Select All</label></div>';
      html += '<div style="max-height:400px;overflow-y:auto;">';
      mailboxes.forEach((m, i) => {
        html += `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);">
          <input type="checkbox" class="ms-checkbox" data-email="${esc(m.email)}" data-name="${esc(m.full_name)}" style="width:18px;height:18px;">
          <div>
            <div style="font-weight:500;font-size:14px;">${esc(m.full_name)}</div>
            <div style="font-size:12px;color:var(--text-muted);">${esc(m.email)}</div>
          </div>
        </div>`;
      });
      html += '</div>';
      body.innerHTML = html;
      footer.style.display = '';
    } catch (err) {
      body.innerHTML = '<p class="text-muted text-center" style="padding:20px;">Failed to load mailboxes</p>';
    }
  }

  function toggleSelectAllMailboxes(checked) {
    document.querySelectorAll('.ms-checkbox').forEach(cb => cb.checked = checked);
  }

  async function importSelectedMailboxes() {
    const checkboxes = document.querySelectorAll('.ms-checkbox:checked');
    if (checkboxes.length === 0) {
      showToast('No accounts selected', 'error');
      return;
    }
    // Disable button during import
    const btn = document.querySelector('#mailServerFooter .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Importing...'; }
    let imported = 0, errors = 0;
    for (const cb of checkboxes) {
      try {
        const result = await api('POST', '/api/employees', {
          name: cb.dataset.name,
          email: cb.dataset.email,
          title: '',
          phone: '',
          enabled: true,
        });
        if (result.success) imported++;
        else errors++;
      } catch { errors++; }
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Import Selected'; }
    showToast(`Imported ${imported} account${imported !== 1 ? 's' : ''}${errors ? ` (${errors} failed)` : ''}`, imported ? 'success' : 'error');
    closeModal('mailServerModal');
    await loadData();
  }

  // ============ EXPOSE PUBLIC API ============
  window.ESM = {
    openAddModal,
    openEditModal,
    saveEmployee,
    toggleEmployee,
    confirmDelete,
    previewSignature,
    copySignatureHtml,
    sendTestEmail,
    handleSearch,
    setFilter,
    exportCSV,
    openImportModal,
    handleCSVImport,
    saveTemplate,
    resetTemplate,
    previewTemplate,
    livePreviewTemplate,
    insertTemplateVar,
    editTemplate,
    newTemplate,
    cancelEditTemplate,
    deleteTemplate,
    saveSettings,
    uploadLogo,
    changePassword,
    toggleTheme,
    navigateTo,
    closeModal,
    activityPageNav,
    setupNext,
    setupPrev,
    completeSetup,
    previewFontSettings,
    saveFontSettings,
    openMailServerImport,
    toggleSelectAllMailboxes,
    importSelectedMailboxes,
  };

})();
