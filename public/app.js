/* UAEICP Employee Intelligence Workspace — SPA */
(() => {
  const S = {
    lang: localStorage.getItem('lang') || 'en',
    token: localStorage.getItem('token') || '',
    user: null,
    view: 'dashboard', // dashboard | workspace | admin
    workspaces: [],
    showArchived: false,
    ws: null,          // current workspace bundle {workspace, files, analyses, messages, outputs, notes}
    tab: 'files',
    providers: [],
    provider: localStorage.getItem('provider') || 'demo',
    busy: {},
    logo: '/assets/logo.svg',
    pendingFiles: [],
    draft: {},
    createStep: '',
    chats: [],
    chatWs: null,
  };

  const t = k => (I18N[S.lang] && I18N[S.lang][k]) || I18N.en[k] || k;
  const $ = sel => document.querySelector(sel);
  const app = document.getElementById('app');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const attrJson = v => JSON.stringify(v).replace(/"/g, '&quot;');

  // Minimal markdown renderer (headings, bold, italics, code, lists, tables, paragraphs)
  function md(src) {
    const lines = String(src || '').split('\n');
    let html = '', inUl = false, inOl = false, inTable = false;
    const closeLists = () => { if (inUl) { html += '</ul>'; inUl = false; } if (inOl) { html += '</ol>'; inOl = false; } if (inTable) { html += '</table>'; inTable = false; } };
    const inline = s => esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    for (const raw of lines) {
      const line = raw;
      if (/^\s*\|.+\|\s*$/.test(line)) {
        if (/^\s*\|[\s\-:|]+\|\s*$/.test(line)) continue;
        if (!inTable) { closeLists(); html += '<table>'; inTable = true; }
        const cells = line.trim().replace(/^\||\|$/g, '').split('|');
        html += '<tr>' + cells.map(c => `<td>${inline(c.trim())}</td>`).join('') + '</tr>';
        continue;
      }
      if (inTable) { html += '</table>'; inTable = false; }
      const h = line.match(/^(#{1,4})\s+(.*)/);
      if (h) { closeLists(); html += `<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`; continue; }
      if (/^\s*[-*]\s+/.test(line)) { if (!inUl) { closeLists(); html += '<ul>'; inUl = true; } html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`; continue; }
      if (/^\s*\d+\.\s+/.test(line)) { if (!inOl) { closeLists(); html += '<ol>'; inOl = true; } html += `<li>${inline(line.replace(/^\s*\d+\.\s+/, ''))}</li>`; continue; }
      closeLists();
      if (line.trim() === '') continue;
      html += `<p>${inline(line)}</p>`;
    }
    closeLists();
    return html;
  }

  function toast(msg, isErr) {
    document.querySelectorAll('.toast').forEach(e => e.remove());
    const el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  async function api(path, opts = {}) {
    const headers = opts.headers || {};
    if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (S.token) headers.Authorization = 'Bearer ' + S.token;
    const res = await fetch('/api' + path, { ...opts, headers });
    if (res.status === 401 && S.token) { logout(); throw new Error('Session expired'); }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.error) || t('error'));
    return data;
  }

  function setLang(lang) {
    S.lang = lang;
    localStorage.setItem('lang', lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    render();
  }

  function logout() {
    S.token = ''; S.user = null; localStorage.removeItem('token');
    render();
  }

  // ───────────────────────── views ─────────────────────────

  function langSelect(cls) {
    return `<select class="${cls || 'input'}" onchange="A.setLang(this.value)">
      <option value="en" ${S.lang === 'en' ? 'selected' : ''}>English</option>
      <option value="ar" ${S.lang === 'ar' ? 'selected' : ''}>العربية</option>
    </select>`;
  }

  function loginView() {
    return `
    <div class="login-wrap">
      <div class="lang-float">${langSelect('input')}</div>
      <form class="login-card" onsubmit="A.login(event)">
        <div class="flagbar"></div>
        <div class="inner">
          <img class="logo-img" src="${S.logo}" alt="UAEICP" onerror="this.onerror=null;this.src='/assets/logo.svg'">
          <h1>${t('appName')}</h1>
          <div class="authority">${t('authority')}</div>
          <div class="internal">${t('internalOnly')}</div>
          <label class="f">${t('username')}</label>
          <input class="input" name="username" autocomplete="username" required>
          <label class="f">${t('password')}</label>
          <input class="input" type="password" name="password" autocomplete="current-password" required>
          <div id="login-err" class="login-err"></div>
          <button class="btn btn-primary" style="width:100%;margin-top:18px">${t('login')}</button>
          <div class="hint">${t('loginHint')}</div>
        </div>
      </form>
    </div>`;
  }

  function shell(content) {
    const u = S.user;
    return `
    <div class="shell">
      <div class="topbar">
        <img class="logo-img" src="${S.logo}" alt="UAEICP" onerror="this.onerror=null;this.src='/assets/logo.svg'">
        <div class="titles">
          <div class="title">${t('appName')}</div>
          <div class="subtitle">${t('authority')}</div>
        </div>
        <div class="grow"></div>
        <select onchange="A.setProvider(this.value)" title="${t('provider')}">
          ${S.providers.map(p => `<option value="${p.id}" ${p.id === S.provider ? 'selected' : ''}>${esc(p.label)}${p.configured ? '' : ' ⚠'}</option>`).join('')}
        </select>
        ${langSelect('')}
        <button class="btn btn-ghost btn-sm" onclick="A.nav('assistant')">💬 ${t('assistant')}</button>
        <button class="btn btn-ghost btn-sm" onclick="A.nav('dashboard')">${t('analysisTool')}</button>
        ${u.role === 'admin' ? `<button class="btn btn-ghost btn-sm" onclick="A.nav('admin')">${t('admin')}</button>` : ''}
        <span class="user">${esc(u.full_name || u.username)}</span>
        <button class="btn btn-ghost btn-sm" title="${t('changePassword')}" onclick="A.openChangePw()">🔑</button>
        <button class="btn btn-primary btn-sm" onclick="A.logout()">${t('logout')}</button>
      </div>
      <div class="main">${content}</div>
    </div>`;
  }

  function assistantView() {
    const b = S.chatWs;
    const busy = S.busy.assist;
    const outputs = b ? b.outputs : [];
    return `
      <div class="assist-grid">
        <div class="card chat-list">
          <div style="padding:12px"><button class="btn btn-primary" style="width:100%" onclick="A.newChat()">+ ${t('newChat')}</button></div>
          ${S.chats.map(c => `<div class="chat-item ${b && b.workspace.id === c.id ? 'active' : ''}" onclick="A.openChat('${c.id}')"><div class="ci-title">${esc(c.title)}</div><div class="ci-when">${new Date(c.updated_at).toLocaleDateString(S.lang === 'ar' ? 'ar-AE' : 'en-GB')}</div></div>`).join('')}
        </div>
        <div class="card assist-box">
          <div class="assist-head">
            <strong>${b ? esc(b.workspace.title) : t('assistant')}</strong>
            <div class="grow"></div>
            ${S.busy.gen ? `<span class="spinner dark"></span>` : ''}
            ${b && b.messages.length ? `<button class="btn btn-dark btn-sm" onclick="A.openGenFromChat()">✦ ${t('makeFromChat')}</button>` : ''}
          </div>
          ${outputs.length ? `<div class="assist-outs">${outputs.map(o => `<button class="btn btn-ghost btn-sm" onclick="A.downloadChatOutput('${o.id}')">⬇ ${esc(o.title)}</button>`).join('')}</div>` : ''}
          <div class="chat-log" id="assist-log">
            ${!b || b.messages.length === 0 ? `
            <div class="empty-state">
              <div class="big">💬</div>
              <strong style="color:var(--black);font-size:17px">${t('chatWelcomeTitle')}</strong>
              <div style="max-width:480px;margin:10px auto 0">${t('chatWelcomeBody')}</div>
            </div>` : ''}
            ${b ? b.messages.map(m => `
              <div class="msg ${m.role}">${m.role === 'assistant' ? md(m.content) : esc(m.content)}</div>`).join('') : ''}
            ${busy ? `<div class="msg assistant"><span class="spinner dark"></span></div>` : ''}
          </div>
          <form class="chat-input" onsubmit="A.sendAssist(event)">
            <textarea class="input" name="q" placeholder="${t('typeMessage')}" ${busy ? 'disabled' : ''}
              onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();this.form.requestSubmit();}"></textarea>
            <button class="btn btn-primary" ${busy ? 'disabled' : ''}>${t('send')}</button>
          </form>
        </div>
      </div>`;
  }

  function dashboardView() {
    const list = S.workspaces;
    return `
      <div class="page-head">
        <h2>${t('dashboard')}</h2>
        <div class="grow"></div>
        <label style="font-size:13px;color:var(--muted);display:flex;align-items:center;gap:6px">
          <input type="checkbox" ${S.showArchived ? 'checked' : ''} onchange="A.toggleArchived(this.checked)"> ${t('archived')}
        </label>
        <button class="btn btn-primary" onclick="A.openNewWs()">+ ${t('newWorkspace')}</button>
      </div>
      ${list.length === 0 ? `
      <div class="empty-state card">
        <div class="big">🗂️</div>
        <strong style="color:var(--black);font-size:16px">${t('dashEmptyTitle')}</strong>
        <div style="max-width:520px;margin:10px auto 18px">${t('dashEmptyBody')}</div>
        <button class="btn btn-primary" onclick="A.openNewWs()">+ ${t('createFirst')}</button>
      </div>` : `
      <div class="ws-grid">
        ${list.map(w => `
          <div class="card ws-card">
            <h3>${esc(w.title)} ${w.status === 'archived' ? `<span class="badge gold">${t('archive')}</span>` : ''}</h3>
            <div class="meta">
              <span class="badge mode">${t(w.mode)}</span>
              <span>${w.language === 'ar' ? 'العربية' : 'English'}</span>
              <span>${t('lastUpdated')}: ${new Date(w.updated_at).toLocaleDateString(S.lang === 'ar' ? 'ar-AE' : 'en-GB')}</span>
            </div>
            ${w.brief ? `<div class="brief">${esc(w.brief)}</div>` : `<div class="brief">${t('briefOnly')}</div>`}
            <div class="row">
              <button class="btn btn-primary btn-sm" onclick="A.openWs('${w.id}')">${t('open')}</button>
              <button class="btn btn-ghost btn-sm" onclick="A.archiveWs('${w.id}','${w.status}')">${w.status === 'archived' ? t('unarchive') : t('archive')}</button>
              <button class="btn btn-danger btn-sm" onclick="A.deleteWs('${w.id}')">${t('delete')}</button>
            </div>
          </div>`).join('')}
      </div>`}`;
  }

  function newWsModal() {
    return `
    <div class="overlay" onclick="if(event.target===this)A.closeModal()">
      <form class="modal" id="new-ws-form" onsubmit="A.createWs(event)">
        <h3>${t('newWorkspace')}</h3>
        <div class="sub">${t('dashEmptyBody')}</div>

        <label class="f">${t('wsTitle')}</label>
        <input class="input" name="title" maxlength="200" placeholder="${t('wsTitlePh')}" value="${esc(S.draft.title || '')}">
        <div class="help">${t('wsTitleHelp')}</div>

        <label class="f">${t('brief')}</label>
        <textarea class="input" name="brief" rows="4" placeholder="${t('briefPh')}">${esc(S.draft.brief || '')}</textarea>
        <div class="help">${t('briefHelp')}</div>

        <label class="f">${t('addDocs')}</label>
        <div class="dropzone" style="padding:18px" id="modal-dz"
             onclick="document.getElementById('modal-file-input').click()">
          <strong>📎 ${t('chooseFiles')}</strong>
          <div style="font-size:12px;margin-top:4px">PDF, DOCX, XLSX, TXT, MD, CSV, PNG, JPG…</div>
        </div>
        <input id="modal-file-input" type="file" multiple hidden onchange="A.pickFiles(this.files)">
        ${S.pendingFiles.length ? `
        <div class="card" style="margin-top:8px">
          ${S.pendingFiles.map((f, i) => `
          <div class="file-row" style="padding:8px 12px">
            <div class="file-ico" style="width:28px;height:28px">${esc((f.name.split('.').pop() || '?').toUpperCase().slice(0, 4))}</div>
            <div class="grow"><div class="name" style="font-size:13px">${esc(f.name)}</div></div>
            <button type="button" class="btn btn-danger btn-sm" title="${t('removeFile')}" onclick="A.removePendingFile(${i})">✕</button>
          </div>`).join('')}
        </div>` : ''}
        <div class="help">${t('addDocsHelp')}</div>

        <label class="f">${t('language')}</label>
        <div class="choices two">
          <label class="choice-card">
            <input type="radio" name="language" value="en" ${(S.draft.language || S.lang) !== 'ar' ? 'checked' : ''}>
            <span class="cc-title">English</span>
          </label>
          <label class="choice-card">
            <input type="radio" name="language" value="ar" ${(S.draft.language || S.lang) === 'ar' ? 'checked' : ''}>
            <span class="cc-title">العربية</span>
          </label>
        </div>
        <div class="help">${t('langHelpWs')}</div>

        <label class="f">${t('mode')}</label>
        <div class="help" style="margin:0 0 6px">${t('modeHelp')}</div>
        <div class="choices">
          <label class="choice-card">
            <input type="radio" name="mode" value="guarded" ${S.draft.mode !== 'unguarded' ? 'checked' : ''}>
            <span class="cc-title">${t('guardedTitle')}</span>
            <div class="cc-desc">${t('guardedDesc')}</div>
          </label>
          <label class="choice-card">
            <input type="radio" name="mode" value="unguarded" ${S.draft.mode === 'unguarded' ? 'checked' : ''}>
            <span class="cc-title">${t('unguardedTitle')}</span>
            <div class="cc-desc">${t('unguardedDesc')}</div>
          </label>
        </div>

        <label class="f">${t('provider')}</label>
        <div class="choices two">
          ${S.providers.map(p => `
          <label class="choice-card">
            <input type="radio" name="provider" value="${p.id}" ${(S.draft.provider || S.provider) === p.id ? 'checked' : ''}>
            <span class="cc-title">${esc(p.label)}</span>
            ${p.id === 'demo' ? `<div class="cc-desc">${t('demoNotice')}</div>` : (p.configured ? '' : `<div class="cc-desc">⚠ API key not configured</div>`)}
          </label>`).join('')}
        </div>

        <div class="help" style="margin-top:16px">✦ ${t('autoAnalyzeNote')}</div>
        <div class="actions">
          <button type="button" class="btn btn-ghost" onclick="A.closeModal()" ${S.busy.create ? 'disabled' : ''}>${t('cancel')}</button>
          <button class="btn btn-primary" ${S.busy.create ? 'disabled' : ''}>
            ${S.busy.create ? `<span class="spinner"></span> ${esc(S.createStep || t('creating'))}` : `✦ ${t('createAndAnalyze')}`}
          </button>
        </div>
      </form>
    </div>`;
  }

  function changePwModal() {
    return `
    <div class="overlay" onclick="if(event.target===this)A.closeModal()">
      <form class="modal" onsubmit="A.changePw(event)">
        <h3>${t('changePassword')}</h3>
        <label class="f">${t('currentPassword')}</label>
        <input class="input" type="password" name="cur" required autocomplete="current-password">
        <label class="f">${t('newPassword')}</label>
        <input class="input" type="password" name="nw" required minlength="8" autocomplete="new-password">
        <div class="actions">
          <button type="button" class="btn btn-ghost" onclick="A.closeModal()">${t('cancel')}</button>
          <button class="btn btn-primary">${t('save')}</button>
        </div>
      </form>
    </div>`;
  }

  // ---------- workspace ----------
  function wsView() {
    const b = S.ws; if (!b) return '';
    const w = b.workspace;
    const tabs = [
      ['files', `${t('files')} (${b.files.length})`],
      ['analysis', t('analysis')],
      ['chat', t('chat')],
      ['studio', t('studio')],
      ['notes', `${t('notes')} (${b.notes.length})`],
    ];
    return `
      <div class="ws-head">
        <div class="page-head" style="margin-bottom:4px">
          <h2>${esc(w.title)}</h2>
          <div class="grow"></div>
          <button class="btn btn-primary btn-sm" onclick="A.exportReport()">⬇ ${t('exportReport')}</button>
        </div>
        <div class="meta">
          <span class="badge mode">${t(w.mode)}</span>
          <select class="input" style="width:auto;padding:4px 8px;font-size:12.5px" onchange="A.setWsMode(this.value)">
            <option value="guarded" ${w.mode === 'guarded' ? 'selected' : ''}>${t('guarded')}</option>
            <option value="unguarded" ${w.mode === 'unguarded' ? 'selected' : ''}>${t('unguarded')}</option>
          </select>
          <span>${w.language === 'ar' ? 'العربية' : 'English'}</span>
          <span>${t('lastUpdated')}: ${new Date(w.updated_at).toLocaleString(S.lang === 'ar' ? 'ar-AE' : 'en-GB')}</span>
        </div>
      </div>
      <div class="tabs">
        ${tabs.map(([id, label]) => `<button class="tab ${S.tab === id ? 'active' : ''}" onclick="A.setTab('${id}')">${label}</button>`).join('')}
      </div>
      <div class="panel">${{ files: filesPanel, analysis: analysisPanel, chat: chatPanel, studio: studioPanel, notes: notesPanel }[S.tab]()}</div>`;
  }

  function filesPanel() {
    const b = S.ws;
    return `
      <div class="dropzone" id="dz" onclick="$('#file-input').click()">
        <div style="font-size:30px;margin-bottom:8px">📄</div>
        <strong>${t('uploadFiles')}</strong>
        <div style="font-size:12.5px;margin-top:6px">PDF, DOCX, XLSX, TXT, MD, CSV, PNG, JPG…</div>
        <input id="file-input" type="file" multiple hidden onchange="A.upload(this.files)">
      </div>
      <div style="height:16px"></div>
      ${b.files.length === 0 ? `<div class="empty-state card">${t('noFiles')}</div>` : `
      <div class="card">
        ${b.files.map(f => `
          <div class="file-row">
            <div class="file-ico">${esc((f.original_name.split('.').pop() || '?').toUpperCase().slice(0, 4))}</div>
            <div class="grow">
              <div class="name">${esc(f.original_name)}</div>
              <div class="sub">${Math.max(1, Math.round(f.size_bytes / 1024))} KB ${f.has_text ? '· text ✓' : ''}</div>
            </div>
            <button class="btn btn-ghost btn-sm" onclick="A.downloadFile('${f.id}')">${t('download')}</button>
            <button class="btn btn-danger btn-sm" onclick="A.deleteFile('${f.id}')">✕</button>
          </div>`).join('')}
      </div>`}`;
  }

  function analysisPanel() {
    const b = S.ws;
    const a = b.analyses[0];
    const busy = S.busy.analysis;
    const runBtn = `<button class="btn btn-primary" ${busy ? 'disabled' : ''} onclick="A.runAnalysis()">
      ${busy ? `<span class="spinner"></span> ${t('analyzing')}` : `⚡ ${t('runAnalysis')}`}</button>`;
    if (!a) return `<div class="empty-state card">${t('noAnalysis')}<div style="margin-top:16px">${runBtn}</div></div>`;
    const r = typeof a.result === 'string' ? JSON.parse(a.result) : a.result;
    const conf = c => `<span class="badge ${String(c || '').toLowerCase()}">${esc(c || '?')}</span>`;
    const list = arr => (arr && arr.length) ? `<ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : `<div style="color:var(--muted);font-size:13px">—</div>`;
    return `
      <div class="page-head" style="margin-bottom:14px">
        <span class="badge mode">${esc(a.provider)}${a.model && a.model !== 'demo' ? ' · ' + esc(a.model) : ''}</span>
        <span class="badge gold">${t(a.mode)}</span>
        <div class="grow"></div>${runBtn}
      </div>
      <div class="disclaimer-bar">⚠ ${t('disclaimer')}</div>
      ${a.provider === 'demo' ? `<div class="disclaimer-bar demo-bar">ℹ ${t('demoNotice')}</div>` : ''}
      <div class="card a-section"><h4>${t('execSummary')}</h4><div class="exec">${esc(r.executive_summary || '')}</div></div>
      <div class="card a-section"><h4>${t('keyFindings')}</h4>
        ${(r.key_findings || []).map(k => `<div class="item"><div class="grow">${k.speculative ? `<span class="badge spec">${t('speculative')}</span> ` : ''}${esc(k.finding)}</div>${conf(k.confidence)}</div>`).join('') || '—'}
      </div>
      <div class="card a-section"><h4>${t('missingInfo')}</h4>${list(r.missing_information)}</div>
      <div class="card a-section"><h4>${t('risks')}</h4>
        ${(r.risks_compliance || []).map(x => `<div class="item"><div class="grow"><strong>${esc(x.risk)}</strong>${x.note ? `<div style="font-size:13px;color:var(--muted)">${esc(x.note)}</div>` : ''}</div><span class="badge ${String(x.severity || '').toLowerCase()}">${esc(x.severity || '')}</span></div>`).join('') || '—'}
      </div>
      <div class="card a-section"><h4>${t('actions')}</h4>
        ${(r.action_priorities || []).sort((x, y) => x.priority - y.priority).map(p => `<div class="item"><span class="badge gold">${p.priority}</span><div class="grow">${esc(p.action)}</div></div>`).join('') || '—'}
      </div>
      <div class="card a-section"><h4>${t('followUps')}</h4>
        ${(r.follow_up_questions || []).map(q => `<div class="item"><div class="grow">${esc(q)}</div><button class="btn btn-ghost btn-sm" onclick="A.askFromAnalysis(${attrJson(q)})">→ ${t('chat')}</button></div>`).join('') || '—'}
      </div>
      <details class="a-more card">
        <summary>${t('moreDetails')}</summary>
        <div class="a-section"><h4>${t('reviewAngle')}</h4><div class="exec">${esc(r.review_angle || '')}</div></div>
        <div class="a-section"><h4>${t('contradictions')}</h4>${list(r.contradictions)}</div>
        <div class="a-section"><h4>${t('improvements')}</h4>${list(r.improvements)}</div>
        <div class="a-section"><h4>${t('humanVerify')}</h4>${list(r.human_verification)}</div>
      </details>
      <div class="card a-section"><h4>${t('evidence')}</h4>
        ${(r.evidence || []).map(e => `<div class="item"><div class="grow">${esc(e.point)} <span class="cite">${esc(e.citation || '')}</span></div>${conf(e.confidence)}</div>`).join('') || '—'}
      </div>`;
  }

  function chatPanel() {
    const b = S.ws;
    const busy = S.busy.chat;
    const chips = S.lang === 'ar'
      ? ['ما الذي ينقص هذه المستندات؟', 'هل هذا جاهز للاعتماد؟', 'ما مخاطر الامتثال؟', 'لخّص هذه الوثيقة.', 'ما الذي يجب التحقق منه قبل التصرف؟']
      : ['What is missing from these documents?', 'Is this ready for approval?', 'What are the compliance risks?', 'Summarize this document.', 'What should I verify before acting?'];
    return `
      <div class="card chat-box">
        <div class="chat-log" id="chat-log">
          ${b.messages.length === 0 ? `<div class="empty-state">${t('askPlaceholder')}</div>` : ''}
          ${b.messages.map(m => `
            <div class="msg ${m.role}">
              <div class="who">${m.role === 'user' ? esc(S.user.username) : esc(m.provider ? `${m.provider}${m.model && m.model !== 'demo' ? ' · ' + m.model : ''}` : 'AI')}</div>
              ${m.role === 'assistant' ? md(m.content) : esc(m.content)}
            </div>`).join('')}
          ${busy ? `<div class="msg assistant"><span class="spinner dark"></span></div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;padding:10px 14px 0;background:#fff">
          ${chips.map(c => `<button type="button" class="btn btn-ghost btn-sm" style="font-weight:500" ${busy ? 'disabled' : ''} onclick="A.askQuick(${attrJson(c)})">${esc(c)}</button>`).join('')}
        </div>
        <form class="chat-input" onsubmit="A.ask(event)">
          <textarea class="input" name="q" placeholder="${t('askPlaceholder')}" ${busy ? 'disabled' : ''}
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();this.form.requestSubmit();}"></textarea>
          <button class="btn btn-primary" ${busy ? 'disabled' : ''}>${t('send')}</button>
        </form>
      </div>`;
  }

  function studioPanel() {
    const b = S.ws;
    const busy = S.busy.studio;
    const types = [
      ['pptx', 'PowerPoint Briefing Deck'], ['memo', 'Internal Memo'], ['checklist', 'Service Checklist'],
      ['case_summary', 'Case Summary'], ['policy_comparison', 'Policy Comparison'],
      ['legal_review', 'Legal / Compliance Review'], ['revised_draft', 'Revised Document Draft'], ['report', 'Analysis Report'],
    ];
    return `
      <div class="studio-grid">
        <div>
          <form class="card" style="padding:20px" onsubmit="A.generate(event)">
            <label class="f" style="margin-top:0">${t('outputType')}</label>
            <select class="input" name="type" onchange="this.form.format.disabled=(this.value==='pptx')">
              ${types.map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}
            </select>
            <label class="f">${t('format')}</label>
            <select class="input" name="format" disabled>
              <option value="md">Markdown (.md)</option>
              <option value="txt">Text (.txt)</option>
              <option value="json">JSON (.json)</option>
            </select>
            <label class="f">${t('extraInstructions')}</label>
            <textarea class="input" name="instructions" rows="4"></textarea>
            <label class="f">${t('scopeLabel')}</label>
            <div class="choices">
              <label class="choice-card"><input type="radio" name="scope" value="general" checked><span class="cc-title">${t('scopeGeneral')}</span></label>
              <label class="choice-card"><input type="radio" name="scope" value="focused"><span class="cc-title">${t('scopeFocused')}</span></label>
            </div>
            <div style="font-size:11.5px;color:var(--muted);margin-top:10px">${t('visualStudioNote')}</div>
            <button class="btn btn-primary" style="width:100%;margin-top:16px" ${busy ? 'disabled' : ''}>
              ${busy ? `<span class="spinner"></span> ${t('generating')}` : `✦ ${t('generate')}`}</button>
          </form>
        </div>
        <div>
          <div class="card">
            <div style="padding:14px 16px;border-bottom:2px solid var(--line);font-weight:700;color:var(--black)">${t('outputs')} (${b.outputs.length})</div>
            ${b.outputs.length === 0 ? `<div class="empty-state">${t('empty')}</div>` :
              b.outputs.map(o => `
              <div class="out-row">
                <div class="file-ico">${o.format.toUpperCase()}</div>
                <div class="grow">
                  <div class="name" style="font-weight:600">${esc(o.title)}</div>
                  <div class="sub" style="font-size:12px;color:var(--muted)">${esc(o.type)} · ${esc(o.provider)} · ${new Date(o.created_at).toLocaleString(S.lang === 'ar' ? 'ar-AE' : 'en-GB')}</div>
                </div>
                ${o.format !== 'pptx' ? `<button class="btn btn-ghost btn-sm" onclick="A.viewOutput('${o.id}')">${t('view')}</button>` : ''}
                <button class="btn btn-primary btn-sm" onclick="A.downloadOutput('${o.id}')">${t('download')}</button>
              </div>`).join('')}
          </div>
        </div>
      </div>`;
  }

  function notesPanel() {
    const b = S.ws;
    return `
      <form class="card" style="padding:16px;display:flex;gap:10px" onsubmit="A.addNote(event)">
        <input class="input" name="content" placeholder="${t('notePlaceholder')}" required>
        <button class="btn btn-primary">${t('addNote')}</button>
      </form>
      <div style="height:14px"></div>
      <div class="card">
        ${b.notes.length === 0 ? `<div class="empty-state">${t('empty')}</div>` :
          b.notes.map(n => `
          <div class="note-row">
            <div style="flex:1">${esc(n.content)}<div class="when">${new Date(n.created_at).toLocaleString(S.lang === 'ar' ? 'ar-AE' : 'en-GB')}</div></div>
            <button class="btn btn-danger btn-sm" onclick="A.deleteNote('${n.id}')">✕</button>
          </div>`).join('')}
      </div>`;
  }

  // ---------- admin ----------
  function adminLogsView() {
    const logs = S.adminLogs || [];
    return `
      <div class="page-head">
        <h2>${t('activityLog')}</h2>
        <button class="btn btn-ghost btn-sm" onclick="A.adminShowUsers()">👥 ${t('usersTitle')}</button>
        <div class="grow"></div>
      </div>
      <div class="card" style="overflow-x:auto">
        <table class="admin">
          <tr><th>${t('time')}</th><th>${t('user')}</th><th>${t('action')}</th><th>${t('detail')}</th></tr>
          ${logs.map(l => `<tr><td style="white-space:nowrap">${new Date(l.created_at).toLocaleString(S.lang === 'ar' ? 'ar-AE' : 'en-GB')}</td><td><strong>${esc(l.username || '')}</strong></td><td><span class="badge mode">${esc(l.action)}</span></td><td style="max-width:420px">${esc(l.detail || '')}</td></tr>`).join('')}
        </table>
        ${logs.length === 0 ? `<div class="empty-state">${t('empty')}</div>` : ''}
      </div>`;
  }

  function adminView() {
    if ((S.adminTab || 'users') === 'logs') return adminLogsView();
    const users = S.adminUsers || [];
    return `
      <div class="page-head">
        <h2>${t('usersTitle')}</h2>
        <button class="btn btn-ghost btn-sm" onclick="A.adminShowLogs()">📋 ${t('activityLog')}</button>
        <div class="grow"></div>
        <button class="btn btn-primary" onclick="A.openNewUser()">+ ${t('addUser')}</button>
      </div>
      <div class="card" style="overflow-x:auto">
        <table class="admin">
          <tr><th>${t('username')}</th><th>${t('fullName')}</th><th>${t('department')}</th><th>${t('role')}</th><th>${t('active')}</th><th></th></tr>
          ${users.map(u => `
          <tr>
            <td><strong>${esc(u.username)}</strong><div style="font-size:12px;color:var(--muted)">${esc(u.email || '')}</div></td>
            <td>${esc(u.full_name || '')}</td>
            <td>${esc(u.department || '')}</td>
            <td><span class="badge ${u.role === 'admin' ? 'gold' : 'mode'}">${u.role === 'admin' ? t('adminRole') : t('employee')}</span></td>
            <td>${u.active ? '✓' : '✕'}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-ghost btn-sm" onclick="A.openEditUser('${u.id}')">✎</button>
              ${u.id !== S.user.id ? `<button class="btn btn-danger btn-sm" onclick="A.deleteUser('${u.id}')">${t('delete')}</button>` : ''}
            </td>
          </tr>`).join('')}
        </table>
      </div>`;
  }

  function userModal(u) {
    const isNew = !u;
    u = u || {};
    return `
    <div class="overlay" onclick="if(event.target===this)A.closeModal()">
      <form class="modal" onsubmit="A.saveUser(event,'${u.id || ''}')">
        <h3>${isNew ? t('addUser') : esc(u.username)}</h3>
        ${isNew ? `<label class="f">${t('username')}</label><input class="input" name="username" required>` : ''}
        <label class="f">${t('password')} ${isNew ? '' : '(optional)'}</label>
        <input class="input" type="password" name="password" ${isNew ? 'required' : ''} minlength="8" placeholder="min 8 chars">
        <label class="f">${t('fullName')}</label><input class="input" name="fullName" value="${esc(u.full_name || '')}">
        <label class="f">${t('email')}</label><input class="input" name="email" value="${esc(u.email || '')}">
        <label class="f">${t('department')}</label><input class="input" name="department" value="${esc(u.department || '')}">
        <label class="f">${t('role')}</label>
        <select class="input" name="role">
          <option value="employee" ${u.role !== 'admin' ? 'selected' : ''}>${t('employee')}</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>${t('adminRole')}</option>
        </select>
        ${isNew ? '' : `<label class="f"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> ${t('active')}</label>`}
        <div class="actions">
          <button type="button" class="btn btn-ghost" onclick="A.closeModal()">${t('cancel')}</button>
          <button class="btn btn-primary">${t('save')}</button>
        </div>
      </form>
    </div>`;
  }

  // ───────────────────────── render ─────────────────────────
  function render() {
    document.documentElement.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = S.lang;
    if (!S.user) { app.innerHTML = loginView(); return; }
    let content = '';
    if (S.view === 'assistant') content = assistantView();
    else if (S.view === 'dashboard') content = dashboardView();
    else if (S.view === 'workspace') content = wsView();
    else if (S.view === 'admin') content = adminView();
    app.innerHTML = shell(content) + (S.modal || '');
    const log = $('#chat-log');
    if (log) log.scrollTop = log.scrollHeight;
    const alog = $('#assist-log');
    if (alog) alog.scrollTop = alog.scrollHeight;
    bindDropzone();
  }

  function bindDropzone() {
    const dz = $('#dz'); if (!dz) return;
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => A.upload(e.dataTransfer.files));
  }

  // ───────────────────────── actions ─────────────────────────
  const A = {
    setLang,
    logout,
    setProvider(p) { S.provider = p; localStorage.setItem('provider', p); },
    // Never default to demo when a real provider is configured
    _normalizeProvider() {
      const cur = S.providers.find(p => p.id === S.provider);
      if (!cur || !cur.configured || S.provider === 'demo') {
        const first = S.providers.find(p => p.configured && p.id !== 'demo');
        if (first) { S.provider = first.id; localStorage.setItem('provider', first.id); }
      }
    },
    nav(view) { S.view = view; S.modal = ''; if (view === 'assistant') A.loadAssistant(); else if (view === 'dashboard') A.loadDashboard(); else if (view === 'admin') A.loadAdmin(); else render(); },
    closeModal() { S.modal = ''; render(); },

    async login(e) {
      e.preventDefault();
      const f = e.target;
      try {
        const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: f.username.value, password: f.password.value }) });
        S.token = data.token; S.user = data.user;
        localStorage.setItem('token', data.token);
        const prov = await api('/providers'); S.providers = prov.providers;
        A._normalizeProvider();
        A.nav('assistant');
      } catch (err) {
        const el = $('#login-err'); if (el) el.textContent = err.message;
      }
    },

    openChangePw() { S.modal = changePwModal(); render(); },
    async changePw(e) {
      e.preventDefault();
      const f = e.target;
      try {
        await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: f.cur.value, newPassword: f.nw.value }) });
        S.modal = ''; render(); toast('✓');
      } catch (err) { toast(err.message, true); }
    },

    async loadDashboard() {
      try {
        const data = await api('/workspaces' + (S.showArchived ? '?archived=1' : ''));
        S.workspaces = data.workspaces.filter(w => w.kind !== 'chat'); S.view = 'dashboard'; render();
      } catch (err) { toast(err.message, true); }
    },
    toggleArchived(v) { S.showArchived = v; A.loadDashboard(); },
    openNewWs() {
      S.pendingFiles = []; S.draft = {}; S.createStep = '';
      S.modal = newWsModal(); render();
    },
    _captureDraft() {
      const f = document.getElementById('new-ws-form'); if (!f) return;
      S.draft = { title: f.title.value, brief: f.brief.value, language: f.language.value, mode: f.mode.value, provider: f.provider ? f.provider.value : S.provider };
    },
    pickFiles(files) {
      A._captureDraft();
      for (const f of files || []) S.pendingFiles.push(f);
      S.modal = newWsModal(); render();
    },
    removePendingFile(i) {
      A._captureDraft();
      S.pendingFiles.splice(i, 1);
      S.modal = newWsModal(); render();
    },
    async createWs(e) {
      e.preventDefault();
      A._captureDraft();
      const d = S.draft;
      if (d.provider) { S.provider = d.provider; localStorage.setItem('provider', d.provider); }
      // Title optional: default to first file name or a dated placeholder
      let title = (d.title || '').trim();
      if (!title) {
        title = S.pendingFiles.length
          ? S.pendingFiles[0].name.replace(/\.[^.]+$/, '')
          : `${t('newWorkspace')} — ${new Date().toLocaleDateString(S.lang === 'ar' ? 'ar-AE' : 'en-GB')}`;
      }
      S.busy.create = true; S.createStep = t('creating'); S.modal = newWsModal(); render();
      try {
        const data = await api('/workspaces', { method: 'POST', body: JSON.stringify({ title, brief: d.brief, language: d.language, mode: d.mode }) });
        const wsId = data.workspace.id;
        if (S.pendingFiles.length) {
          S.createStep = t('uploadingFiles'); S.modal = newWsModal(); render();
          const fd = new FormData();
          for (const f of S.pendingFiles) fd.append('files', f);
          await api(`/workspaces/${wsId}/files`, { method: 'POST', body: fd });
        }
        const hasMaterial = S.pendingFiles.length > 0 || (d.brief || '').trim().length > 0;
        S.busy.create = false; S.createStep = ''; S.modal = ''; S.pendingFiles = []; S.draft = {};
        S.ws = await api('/workspaces/' + wsId);
        S.view = 'workspace';
        if (hasMaterial) {
          // instantly run the analysis so the user lands on results
          S.tab = 'analysis'; S.busy.analysis = true; render();
          try {
            const r = await api(`/workspaces/${wsId}/analysis`, { method: 'POST', body: JSON.stringify({ provider: S.provider }) });
            if (r.fallbackError) toast('Provider failed, demo fallback used: ' + r.fallbackError, true);
          } catch (err) { toast(err.message, true); }
          S.busy.analysis = false;
          S.ws = await api('/workspaces/' + wsId);
          render();
        } else {
          S.tab = 'files'; render();
        }
      } catch (err) {
        S.busy.create = false; S.createStep = '';
        S.modal = newWsModal(); render();
        toast(err.message, true);
      }
    },
    async openWs(id) {
      try {
        S.ws = await api('/workspaces/' + id);
        S.view = 'workspace'; S.tab = S.ws.files.length ? 'analysis' : 'files';
        if (!S.ws.analyses.length) S.tab = 'files';
        render();
      } catch (err) { toast(err.message, true); }
    },
    async refreshWs() { if (S.ws) S.ws = await api('/workspaces/' + S.ws.workspace.id); render(); },
    setTab(tab) { S.tab = tab; render(); },
    async setWsMode(mode) {
      try { await api('/workspaces/' + S.ws.workspace.id, { method: 'PATCH', body: JSON.stringify({ mode }) }); await A.refreshWs(); }
      catch (err) { toast(err.message, true); }
    },
    async archiveWs(id, status) {
      try {
        await api('/workspaces/' + id, { method: 'PATCH', body: JSON.stringify({ status: status === 'archived' ? 'active' : 'archived' }) });
        A.loadDashboard();
      } catch (err) { toast(err.message, true); }
    },
    async deleteWs(id) {
      if (!confirm(t('confirmDelete'))) return;
      try { await api('/workspaces/' + id, { method: 'DELETE' }); A.loadDashboard(); } catch (err) { toast(err.message, true); }
    },

    async upload(files) {
      if (!files || !files.length) return;
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      try {
        await api(`/workspaces/${S.ws.workspace.id}/files`, { method: 'POST', body: fd });
        toast('✓'); await A.refreshWs();
      } catch (err) { toast(err.message, true); }
    },
    async deleteFile(fileId) {
      try { await api(`/workspaces/${S.ws.workspace.id}/files/${fileId}`, { method: 'DELETE' }); await A.refreshWs(); }
      catch (err) { toast(err.message, true); }
    },
    downloadFile(fileId) { A._download(`/api/workspaces/${S.ws.workspace.id}/files/${fileId}/download`); },

    async runAnalysis() {
      S.busy.analysis = true; render();
      try {
        const r = await api(`/workspaces/${S.ws.workspace.id}/analysis`, { method: 'POST', body: JSON.stringify({ provider: S.provider }) });
        if (r.fallbackError) toast('Provider failed, demo fallback used: ' + r.fallbackError, true);
        await A.refreshWs();
      } catch (err) { toast(err.message, true); }
      S.busy.analysis = false; render();
    },

    askFromAnalysis(q) { S.tab = 'chat'; render(); const ta = document.querySelector('.chat-input textarea'); if (ta) { ta.value = q; ta.focus(); } },
    askQuick(q) {
      const ta = document.querySelector('.chat-input textarea');
      if (ta) { ta.value = q; ta.form.requestSubmit(); }
    },
    async ask(e) {
      e.preventDefault();
      const ta = e.target.q; const q = ta.value.trim(); if (!q) return;
      S.ws.messages.push({ id: 'tmp', role: 'user', content: q, created_at: new Date().toISOString() });
      S.busy.chat = true; render();
      try {
        const r = await api(`/workspaces/${S.ws.workspace.id}/chat`, { method: 'POST', body: JSON.stringify({ question: q, provider: S.provider }) });
        if (r.fallbackError) toast('Provider failed, demo fallback used', true);
      } catch (err) { toast(err.message, true); }
      S.busy.chat = false;
      await A.refreshWs();
    },

    async generate(e) {
      e.preventDefault();
      const f = e.target;
      S.busy.studio = true; render();
      try {
        const r = await api(`/workspaces/${S.ws.workspace.id}/studio`, {
          method: 'POST',
          body: JSON.stringify({ type: f.type.value, format: f.format.disabled ? 'pptx' : f.format.value, instructions: f.instructions.value, scope: f.scope.value, provider: S.provider }),
        });
        if (r.fallbackError) toast('Provider failed, demo fallback used', true);
        else toast('✓');
      } catch (err) { toast(err.message, true); }
      S.busy.studio = false;
      await A.refreshWs();
    },
    viewOutput(id) {
      const o = S.ws.outputs.find(x => x.id === id); if (!o) return;
      S.modal = `
      <div class="overlay" onclick="if(event.target===this)A.closeModal()">
        <div class="modal" style="width:760px">
          <h3>${esc(o.title)}</h3>
          <div class="output-view">${o.format === 'json' ? `<pre style="white-space:pre-wrap">${esc(o.content)}</pre>` : md(o.content)}</div>
          <div class="actions">
            <button class="btn btn-ghost" onclick="A.closeModal()">${t('cancel')}</button>
            <button class="btn btn-ghost" onclick="A.copyOutput('${o.id}')">⧉</button>
            <button class="btn btn-primary" onclick="A.downloadOutput('${o.id}')">${t('download')}</button>
          </div>
        </div>
      </div>`;
      render();
    },
    async copyOutput(id) {
      const o = S.ws.outputs.find(x => x.id === id); if (!o) return;
      try { await navigator.clipboard.writeText(o.content); toast('✓'); }
      catch { toast(t('error'), true); }
    },
    downloadOutput(id) { A._download(`/api/workspaces/${S.ws.workspace.id}/studio/${id}/download`); },
    exportReport() {
      S.modal = `
      <div class="overlay" onclick="if(event.target===this)A.closeModal()">
        <form class="modal" onsubmit="A.doExport(event)">
          <h3>${t('exportReport')}</h3>
          <div class="sub">${t('exportOptions')}</div>
          <label class="f"><input type="checkbox" name="analysis" checked> ${t('analysis')}</label>
          <label class="f"><input type="checkbox" name="chat" checked> ${t('chat')}</label>
          <label class="f"><input type="checkbox" name="outputs" checked> ${t('outputs')}</label>
          <label class="f"><input type="checkbox" name="notes" checked> ${t('notes')}</label>
          <div class="actions">
            <button type="button" class="btn btn-ghost" onclick="A.closeModal()">${t('cancel')}</button>
            <button class="btn btn-primary">${t('download')}</button>
          </div>
        </form>
      </div>`;
      render();
    },
    doExport(e) {
      e.preventDefault();
      const f = e.target;
      const inc = ['analysis', 'chat', 'outputs', 'notes'].filter(k => f[k].checked).join(',');
      S.modal = ''; render();
      A._download(`/api/workspaces/${S.ws.workspace.id}/export?include=${inc}`);
    },
    async _download(url) {
      try {
        const res = await fetch(url, { headers: { Authorization: 'Bearer ' + S.token } });
        if (!res.ok) throw new Error(t('error'));
        const blob = await res.blob();
        const cd = res.headers.get('content-disposition') || '';
        const m = cd.match(/filename="?([^";]+)"?/);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = m ? m[1] : 'download';
        a.click(); URL.revokeObjectURL(a.href);
      } catch (err) { toast(err.message, true); }
    },

    async addNote(e) {
      e.preventDefault();
      try {
        await api(`/workspaces/${S.ws.workspace.id}/notes`, { method: 'POST', body: JSON.stringify({ content: e.target.content.value }) });
        await A.refreshWs();
      } catch (err) { toast(err.message, true); }
    },
    async deleteNote(id) {
      try { await api(`/workspaces/${S.ws.workspace.id}/notes/${id}`, { method: 'DELETE' }); await A.refreshWs(); }
      catch (err) { toast(err.message, true); }
    },

    // assistant (general chat)
    async loadAssistant() {
      try {
        const data = await api('/workspaces');
        S.chats = data.workspaces.filter(w => w.kind === 'chat');
        if (S.chatWs && !S.chats.find(c => c.id === S.chatWs.workspace.id)) S.chatWs = null;
        S.view = 'assistant'; render();
      } catch (err) { toast(err.message, true); }
    },
    newChat() { S.chatWs = null; render(); },
    async openChat(id) {
      try { S.chatWs = await api('/workspaces/' + id); render(); }
      catch (err) { toast(err.message, true); }
    },
    async sendAssist(e) {
      e.preventDefault();
      const ta = e.target.q; const q = ta.value.trim(); if (!q) return;
      S.busy.assist = true;
      try {
        if (!S.chatWs) {
          const data = await api('/workspaces', { method: 'POST', body: JSON.stringify({ title: q.slice(0, 60), kind: 'chat', language: S.lang, mode: 'unguarded' }) });
          S.chats.unshift(data.workspace);
          S.chatWs = await api('/workspaces/' + data.workspace.id);
        }
        S.chatWs.messages.push({ id: 'tmp', role: 'user', content: q, created_at: new Date().toISOString() });
        render();
        const r = await api(`/workspaces/${S.chatWs.workspace.id}/chat`, { method: 'POST', body: JSON.stringify({ question: q, provider: S.provider }) });
        if (r.fallbackError) toast('Provider failed, demo fallback used', true);
      } catch (err) { toast(err.message, true); }
      S.busy.assist = false;
      if (S.chatWs) S.chatWs = await api('/workspaces/' + S.chatWs.workspace.id);
      render();
    },
    openGenFromChat() {
      S.modal = `
      <div class="overlay" onclick="if(event.target===this)A.closeModal()">
        <form class="modal" onsubmit="A.genFromChat(event)">
          <h3>${t('fromChatTitle')}</h3>
          <div class="sub">${t('fromChatHint')}</div>
          <label class="f">${t('outputType')}</label>
          <select class="input" name="type">
            <option value="pptx">PowerPoint</option>
            <option value="report">Report</option>
            <option value="memo">Memo</option>
            <option value="case_summary">Case Summary</option>
          </select>
          <div class="help">${t('claudeHint')}</div>
          <label class="f">${t('extraInstructions')}</label>
          <textarea class="input" name="instructions" rows="3"></textarea>
          <div class="actions">
            <button type="button" class="btn btn-ghost" onclick="A.closeModal()">${t('cancel')}</button>
            <button class="btn btn-primary">✦ ${t('generate')}</button>
          </div>
        </form>
      </div>`;
      render();
    },
    async genFromChat(e) {
      e.preventDefault();
      const f = e.target;
      const type = f.type.value, instructions = f.instructions.value;
      S.modal = ''; S.busy.gen = true; render();
      try {
        const r = await api(`/workspaces/${S.chatWs.workspace.id}/studio`, {
          method: 'POST',
          body: JSON.stringify({ type, format: type === 'pptx' ? 'pptx' : 'md', instructions, scope: 'general', provider: S.provider, preferClaude: true }),
        });
        if (r.fallbackError) toast('Provider failed, demo fallback used', true); else toast('✓');
        S.chatWs = await api('/workspaces/' + S.chatWs.workspace.id);
        A.downloadChatOutput(r.output.id);
      } catch (err) { toast(err.message, true); }
      S.busy.gen = false; render();
    },
    downloadChatOutput(id) { A._download(`/api/workspaces/${S.chatWs.workspace.id}/studio/${id}/download`); },

    // admin
    async loadAdmin() {
      try { S.adminUsers = (await api('/users')).users; S.adminTab = 'users'; S.view = 'admin'; render(); }
      catch (err) { toast(err.message, true); }
    },
    async adminShowLogs() {
      try { S.adminLogs = (await api('/users/logs')).logs; S.adminTab = 'logs'; render(); }
      catch (err) { toast(err.message, true); }
    },
    adminShowUsers() { A.loadAdmin(); },
    openNewUser() { S.modal = userModal(null); render(); },
    openEditUser(id) { S.modal = userModal(S.adminUsers.find(u => u.id === id)); render(); },
    async saveUser(e, id) {
      e.preventDefault();
      const f = e.target;
      const body = {
        fullName: f.fullName.value, email: f.email.value, department: f.department.value, role: f.role.value,
      };
      if (f.password.value) body.password = f.password.value;
      try {
        if (id) {
          body.active = f.active ? f.active.checked : true;
          await api('/users/' + id, { method: 'PATCH', body: JSON.stringify(body) });
        } else {
          body.username = f.username.value;
          await api('/users', { method: 'POST', body: JSON.stringify(body) });
        }
        S.modal = ''; A.loadAdmin();
      } catch (err) { toast(err.message, true); }
    },
    async deleteUser(id) {
      if (!confirm(t('confirmDelete'))) return;
      try { await api('/users/' + id, { method: 'DELETE' }); A.loadAdmin(); } catch (err) { toast(err.message, true); }
    },
  };
  window.A = A;
  window.$ = $;

  // boot: prefer official logo if present, then restore session
  (async () => {
    try {
      const r = await fetch('/assets/logo.png', { method: 'HEAD' });
      if (r.ok) S.logo = '/assets/logo.png';
    } catch {}
    if (S.token) {
      try {
        const data = await api('/auth/me');
        S.user = data.user;
        const prov = await api('/providers'); S.providers = prov.providers;
        A._normalizeProvider();
        A.loadAssistant();
        return;
      } catch { /* fall through to login */ }
    }
    render();
  })();
})();
