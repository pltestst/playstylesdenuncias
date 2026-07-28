(() => {
  'use strict';

  const CONFIG = window.BS_SUPABASE || {};
  if (!window.supabase || !CONFIG.url || !CONFIG.publishableKey) {
    console.error('Configuração do Supabase ausente.');
    return;
  }

  const db = window.supabase.createClient(CONFIG.url, CONFIG.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const TEN_HOURS = 10 * 60 * 60 * 1000;
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  const PLAYER_ID_KEY = 'brasil_style_player_id';
  const PLAYER_NAME_KEY = 'brasil_style_player_name';
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const exactNick = value => String(value ?? '').trim().toLocaleLowerCase('pt-BR');
  const format = date => new Date(date).toLocaleString('pt-BR');
  const age = report => Date.now() - new Date(report.created_at).getTime();
  const statusOf = report => report.status === 'Nova' && age(report) >= TEN_HOURS ? 'Urgente' : report.status;
  let selectedEvidence = [];
  let filter = 'all';
  let currentProfile = null;
  let pendingRejectId = null;
  let staffReports = [];

  function toast(message, type = 'info', title = '') {
    const element = $('#toast');
    if (!element) return;
    const isError = type === 'error';
    const heading = title || (isError ? 'Atenção' : 'Aviso');
    const icon = isError
      ? '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"/><path d="m9 9 6 6M15 9l-6 6"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"/><path d="M12 10v6M12 7h.01"/></svg>';
    element.className = `toast toast-${type}`;
    element.innerHTML = `<div class="toast-icon">${icon}</div><div class="toast-copy"><strong>${esc(heading)}</strong><span>${esc(message)}</span></div><div class="toast-progress"></div>`;
    requestAnimationFrame(() => element.classList.add('show'));
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('show'), 3800);
  }

  async function getSessionProfile() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) { currentProfile = null; return null; }
    const { data, error } = await db.from('profiles').select('*').eq('id', session.user.id).single();
    if (error || !data?.active) {
      await db.auth.signOut();
      currentProfile = null;
      return null;
    }
    currentProfile = data;
    return data;
  }

  async function nav(page) {
    if (page === 'staff-dashboard') {
      const profile = await getSessionProfile();
      if (!profile) page = 'staff-login';
    }
    $$('.page').forEach(item => item.classList.toggle('active', item.id === page));
    $('nav')?.classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (page === 'my-reports') await renderMine();
    if (page === 'against-me') await renderAgainst();
    if (page === 'staff-dashboard') await renderStaff();
  }

  $$('[data-page]').forEach(button => button.addEventListener('click', () => nav(button.dataset.page)));
  if ($('#mobileMenu')) $('#mobileMenu').onclick = () => $('nav')?.classList.toggle('open');
  const eventDate = $('input[name=eventDate]');
  if (eventDate) eventDate.value = new Date().toISOString().slice(0, 10);

  $$('.numeric-only').forEach(input => {
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, ''); });
    input.addEventListener('paste', event => {
      const pasted = (event.clipboardData || window.clipboardData).getData('text');
      if (/\D/.test(pasted)) event.preventDefault();
    });
  });

  const fileKey = file => `${file.name}-${file.size}-${file.lastModified}`;
  function pickerPreview() {
    const target = $('#selectedFiles');
    if (!target) return;
    target.innerHTML = selectedEvidence.map((file, index) => {
      const url = URL.createObjectURL(file);
      const media = file.type.startsWith('image/') ? `<img src="${url}" alt="${esc(file.name)}">`
        : file.type.startsWith('video/') ? `<video src="${url}" controls preload="metadata"></video>`
        : '<div class="file-generic">ARQUIVO</div>';
      return `<div class="picked-evidence">${media}<div class="picked-info"><b>${esc(file.name)}</b><small>${(file.size / 1048576).toFixed(1)} MB</small></div><button type="button" class="remove-picked" data-index="${index}">×</button></div>`;
    }).join('');
  }

  $('#evidenceFiles')?.addEventListener('change', event => {
    const known = new Set(selectedEvidence.map(fileKey));
    [...event.target.files].forEach(file => { if (!known.has(fileKey(file))) selectedEvidence.push(file); });
    event.target.value = '';
    pickerPreview();
    $('.upload-box')?.classList.remove('evidence-missing');
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('.remove-picked');
    if (!button) return;
    selectedEvidence.splice(Number(button.dataset.index), 1);
    pickerPreview();
  });

  function reportFieldError(form) {
    const invalid = [...form.elements].find(field => {
      if (!field.matches('input,select,textarea') || field.disabled || field.type === 'file') return false;
      if (field.required && field.type === 'checkbox') return !field.checked;
      if (field.required && !String(field.value || '').trim()) return true;
      return field.value && !field.validity.valid;
    });
    if (!invalid) return false;
    let message = 'Preencha todos os campos obrigatórios para continuar.';
    if (invalid.tagName === 'SELECT') message = 'Selecione uma categoria para continuar.';
    else if (invalid.type === 'checkbox') message = 'Confirme que as informações são verdadeiras.';
    else if (invalid.type === 'url') message = 'Digite um link de vídeo válido ou deixe o campo vazio.';
    else if (invalid.name === 'playerId' || invalid.name === 'accusedId') message = 'Os campos de ID aceitam somente números.';
    toast(message, 'error');
    invalid.focus({ preventScroll: true });
    invalid.closest('label')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }

  async function uploadEvidence(reportId, files) {
    const uploaded = [];
    for (const file of files) {
      if (file.size > 100 * 1024 * 1024) throw new Error(`O arquivo ${file.name} ultrapassa 100 MB.`);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${reportId}/${crypto.randomUUID?.() || Date.now()}-${safeName}`;
      const { error } = await db.storage.from(CONFIG.evidenceBucket).upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      uploaded.push({ path, name: file.name, type: file.type, size: file.size });
    }
    return uploaded;
  }

  $('#reportForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (reportFieldError(form)) return;
    const fd = new FormData(form);
    const playerId = String(fd.get('playerId') || '').trim();
    const accusedId = String(fd.get('accusedId') || '').trim();
    const videoLink = String(fd.get('videoLink') || '').trim();
    if (!/^\d+$/.test(playerId) || !/^\d+$/.test(accusedId)) return toast('Os campos de ID aceitam somente números.', 'error');
    if (!selectedEvidence.length && !videoLink) {
      toast('Anexe uma imagem ou vídeo, ou informe um link de vídeo como prova.', 'error');
      $('.upload-box')?.classList.add('evidence-missing');
      return;
    }
    const id = crypto.randomUUID?.() || `${Date.now()}`;
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true; submit.textContent = 'Enviando...';
    try {
      const evidence = await uploadEvidence(id, selectedEvidence);
      const payload = {
        id,
        player_name: String(fd.get('playerName')).trim(), player_id: playerId,
        accused_name: String(fd.get('accusedName')).trim(), accused_id: accusedId,
        event_date: fd.get('eventDate'), category: fd.get('category'),
        reason: String(fd.get('reason')).trim(), video_link: videoLink || null,
        evidence, status: 'Nova'
      };
      const { error } = await db.from('reports').insert(payload);
      if (error) throw error;
      localStorage.setItem(PLAYER_ID_KEY, playerId);
      localStorage.setItem(PLAYER_NAME_KEY, payload.player_name);
      form.reset(); selectedEvidence = []; pickerPreview();
      if (eventDate) eventDate.value = new Date().toISOString().slice(0, 10);
      toast('Denúncia enviada com sucesso.');
      setTimeout(() => nav('my-reports'), 500);
    } catch (error) {
      console.error(error);
      toast(error.message || 'Não foi possível enviar a denúncia.', 'error', 'Erro ao enviar');
    } finally { submit.disabled = false; submit.textContent = 'Enviar denúncia'; }
  });

  async function rpcSearch(functionName, name, id) {
    const { data, error } = await db.rpc(functionName, { search_name: name || null, search_id: id || null });
    if (error) throw error;
    return data || [];
  }

  $('#loadMyReports') && ($('#loadMyReports').onclick = async () => {
    const name = $('#myPlayerName').value.trim(), id = $('#myPlayerId').value.trim();
    if (!name && !id) return toast('Digite seu nick correto ou seu ID.', 'error');
    if (id && !/^\d+$/.test(id)) return toast('O ID aceita somente números.', 'error');
    if (name) localStorage.setItem(PLAYER_NAME_KEY, name);
    if (id) localStorage.setItem(PLAYER_ID_KEY, id);
    await renderMine();
  });

  async function renderMine() {
    const box = $('#myReportsList'); if (!box) return;
    if (!$('#myPlayerId').value) $('#myPlayerId').value = localStorage.getItem(PLAYER_ID_KEY) || '';
    if (!$('#myPlayerName').value) $('#myPlayerName').value = localStorage.getItem(PLAYER_NAME_KEY) || '';
    const id = $('#myPlayerId').value.trim(), name = $('#myPlayerName').value.trim();
    if (!id && !name) { box.innerHTML = '<div class="empty">Digite seu nick correto ou seu ID para consultar.</div>'; return; }
    box.innerHTML = '<div class="empty">Carregando...</div>';
    try {
      const rows = await rpcSearch('search_my_reports', name, id);
      if (!rows.length) { box.innerHTML = '<div class="empty">Nenhuma denúncia enviada com esse nick ou ID.</div>'; return; }
      box.innerHTML = rows.map(r => {
        const text = ['Aceita','Recusada'].includes(r.status) ? r.status : 'Aguardando análise';
        const cls = r.status === 'Aceita' ? 'accepted' : r.status === 'Recusada' ? 'rejected' : 'waiting';
        const reason = r.status === 'Recusada' && r.rejection_reason ? `<div class="rejection-player"><strong>Justificativa da recusa</strong><p>${esc(r.rejection_reason)}</p></div>` : '';
        return `<article class="report-card"><div class="report-top"><div><h3>${esc(r.accused_name)} <small>#${esc(r.accused_id)}</small></h3><p>${esc(r.reason)}</p></div><span class="status ${cls}">${text}</span></div><div class="report-meta"><span class="chip">${esc(r.category)}</span><span class="chip">Enviada em ${format(r.created_at)}</span></div>${reason}</article>`;
      }).join('');
    } catch (e) { console.error(e); box.innerHTML = '<div class="empty">Não foi possível consultar agora.</div>'; }
  }

  $('#loadAgainstReports') && ($('#loadAgainstReports').onclick = renderAgainst);
  async function renderAgainst() {
    const box = $('#againstReportsList'); if (!box) return;
    const id = $('#againstPlayerId').value.trim(), name = $('#againstPlayerName').value.trim();
    if (!id && !name) { box.innerHTML = '<div class="empty against-empty">Digite seu nick correto ou seu ID para realizar a consulta.</div>'; return; }
    if (id && !/^\d+$/.test(id)) return toast('O ID aceita somente números.', 'error');
    box.innerHTML = '<div class="empty">Carregando...</div>';
    try {
      const rows = await rpcSearch('search_against_reports', name, id);
      if (!rows.length) { box.innerHTML = '<div class="against-clear"><div><strong>Nenhuma denúncia encontrada</strong><p>Não existe nenhuma denúncia vinculada a esse nick ou ID.</p></div></div>'; return; }
      box.innerHTML = rows.map(r => {
        const text = ['Aceita','Recusada'].includes(r.status) ? r.status : 'Aguardando análise';
        const cls = r.status === 'Aceita' ? 'accepted' : r.status === 'Recusada' ? 'rejected' : 'waiting';
        return `<article class="report-card against-card"><div class="against-card-head"><div><span class="against-label">DENÚNCIA ENCONTRADA</span><h3>Existe uma denúncia vinculada ao seu ID</h3></div><span class="status ${cls}">${text}</span></div><div class="against-details"><div><span>Motivo da denúncia</span><p>${esc(r.reason)}</p></div><div><span>Data da denúncia</span><strong>${format(r.created_at)}</strong></div><div><span>Status</span><strong>${text}</strong></div></div><div class="appeal-card"><div class="appeal-copy"><div><strong>Deseja contestar?</strong><p>Para apresentar sua versão ou enviar provas, abra um ticket no Discord.</p></div></div><a class="discord-ticket-button" href="https://discord.gg/Dgz9vQf9x" target="_blank" rel="noopener"><span>Abrir Ticket no Discord</span></a></div><div class="privacy-note">A identidade e as provas do denunciante permanecem protegidas.</div></article>`;
      }).join('');
    } catch (e) { console.error(e); box.innerHTML = '<div class="empty">Não foi possível consultar agora.</div>'; }
  }

  $('#staffLoginForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, fd = new FormData(form);
    const username = String(fd.get('staffName') || '').trim().toLowerCase();
    const password = String(fd.get('password') || '');
    const button = form.querySelector('button[type=submit]'); button.disabled = true;
    try {
      const email = `${username}@${CONFIG.staffEmailDomain}`;
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const profile = await getSessionProfile();
      if (!profile) throw new Error('Conta bloqueada ou sem perfil autorizado.');
      form.reset(); await nav('staff-dashboard');
    } catch (e) {
      await db.auth.signOut();
      toast('Usuário ou senha incorretos, ou a conta está bloqueada.', 'error', 'Login inválido');
    } finally { button.disabled = false; }
  });

  $('#staffLogout') && ($('#staffLogout').onclick = async () => { await db.auth.signOut(); currentProfile = null; nav('home'); });
  $$('.filter-bar button').forEach(button => button.onclick = () => {
    $$('.filter-bar button').forEach(item => item.classList.remove('active'));
    button.classList.add('active'); filter = button.dataset.filter; renderStaffCards();
  });

  async function signedEvidenceHtml(report) {
    let html = '';
    if (Array.isArray(report.evidence) && report.evidence.length) {
      const cards = await Promise.all(report.evidence.map(async file => {
        const { data, error } = await db.storage.from(CONFIG.evidenceBucket).createSignedUrl(file.path, 3600);
        if (error) return '';
        const url = data.signedUrl, isImage = String(file.type).startsWith('image/'), isVideo = String(file.type).startsWith('video/');
        const preview = isImage ? `<a class="evidence-preview-link" href="${url}" target="_blank"><img src="${url}" alt="${esc(file.name)}"></a>` : isVideo ? `<video src="${url}" controls preload="metadata"></video>` : '<div class="file-generic">ARQUIVO</div>';
        return `<div class="evidence-item"><div class="evidence-type">${isVideo?'VÍDEO':isImage?'IMAGEM':'ARQUIVO'}</div>${preview}<div class="evidence-footer"><span class="evidence-name">${esc(file.name)}</span><a class="evidence-download" href="${url}" target="_blank">Abrir</a></div></div>`;
      }));
      html += `<h4 class="proof-title">Provas anexadas</h4><div class="evidence-grid evidence-grid-large">${cards.join('')}</div>`;
    }
    if (report.video_link) {
      const safe = esc(report.video_link);
      html += `<div class="video-link-box"><b>Link do vídeo</b><a class="video-url" href="${safe}" target="_blank" rel="noopener">${safe}</a><a class="video-open-button" href="${safe}" target="_blank" rel="noopener">Abrir vídeo</a></div>`;
    }
    return html;
  }

  async function renderStaff() {
    if (!currentProfile && !(await getSessionProfile())) return nav('staff-login');
    $('#staffWelcome').textContent = `Logado como ${currentProfile.display_name} (${currentProfile.role === 'founder' ? 'Fundador' : 'Administrador'}). Denúncias deixam o painel após 24 horas.`;
    $('#founderPanel').hidden = currentProfile.role !== 'founder';
    const cutoff = new Date(Date.now() - TWENTY_FOUR_HOURS).toISOString();
    const { data, error } = await db.from('reports').select('*').gte('created_at', cutoff).order('created_at', { ascending: false });
    if (error) { toast('Não foi possível carregar as denúncias.', 'error'); return; }
    staffReports = data || [];
    await renderStaffCards();

  }

  async function renderStaffCards() {
    const statuses = staffReports.map(statusOf);
    $('#countNew').textContent = statuses.filter(s => s === 'Nova').length;
    $('#countUrgent').textContent = statuses.filter(s => s === 'Urgente').length;
    $('#countAccepted').textContent = statuses.filter(s => s === 'Aceita').length;
    $('#countRejected').textContent = statuses.filter(s => s === 'Recusada').length;
    const items = staffReports.filter(r => filter === 'all' || statusOf(r) === filter);
    const box = $('#staffReportsList');
    if (!items.length) { box.innerHTML = '<div class="empty">Nenhuma denúncia nesta categoria.</div>'; return; }
    box.innerHTML = '<div class="empty">Carregando provas...</div>';
    const cards = await Promise.all(items.map(async report => {
      const status = statusOf(report), final = ['Aceita','Recusada'].includes(report.status);
      const cls = status === 'Urgente' ? 'urgent' : status === 'Aceita' ? 'accepted' : status === 'Recusada' ? 'rejected' : 'new';
      const proofs = await signedEvidenceHtml(report);
      const rejection = report.status === 'Recusada' && report.rejection_reason ? `<div class="admin-rejection"><b>Justificativa:</b> ${esc(report.rejection_reason)}</div>` : '';
      const resolved = final ? `<div class="resolved-note">Finalizada por <b>${esc(report.responsible_name || 'Staff')}</b> em ${format(report.resolved_at)}. Esta denúncia está bloqueada.</div>` : `<div class="admin-actions"><button class="accept-btn" data-action="accept" data-id="${report.id}">Aceitar</button><button class="reject-btn" data-action="reject" data-id="${report.id}">Recusar</button></div>`;
      return `<article class="report-card"><div class="report-top"><div><h3>${esc(report.player_name)} <small>#${esc(report.player_id)}</small> denunciou ${esc(report.accused_name)} <small>#${esc(report.accused_id)}</small></h3><p>${esc(report.reason)}</p></div><span class="status ${cls}">${status}</span></div><div class="report-meta"><span class="chip">${esc(report.category)}</span><span class="chip">Ocorrido: ${esc(report.event_date)}</span><span class="chip">Enviada: ${format(report.created_at)}</span></div>${proofs}${rejection}${resolved}</article>`;
    }));
    box.innerHTML = cards.join('');
  }

  $('#staffReportsList')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    if (button.dataset.action === 'accept') await resolveReport(button.dataset.id, 'Aceita', '');
    if (button.dataset.action === 'reject') { pendingRejectId = button.dataset.id; $('#rejectReason').value=''; $('#rejectModal').classList.add('open'); }
  });
  $('#rejectCancel') && ($('#rejectCancel').onclick = () => { pendingRejectId = null; $('#rejectModal').classList.remove('open'); });
  $('#rejectConfirm') && ($('#rejectConfirm').onclick = async () => {
    const reason = $('#rejectReason').value.trim();
    if (!reason) return toast('Informe a justificativa da recusa.', 'error');
    await resolveReport(pendingRejectId, 'Recusada', reason);
    pendingRejectId = null; $('#rejectModal').classList.remove('open');
  });

  async function resolveReport(id, status, rejectionReason) {
    const { error } = await db.from('reports').update({ status, rejection_reason: rejectionReason || null, resolved_at: new Date().toISOString(), responsible_id: currentProfile.id, responsible_name: currentProfile.display_name }).eq('id', id).eq('status', 'Nova');
    if (error) return toast(error.message || 'Não foi possível atualizar.', 'error');
    await db.from('audit_logs').insert({ actor_id: currentProfile.id, actor_name: currentProfile.display_name, action: status === 'Aceita' ? 'report_accepted' : 'report_rejected', target_id: id, details: { rejection_reason: rejectionReason || null } });
    toast(status === 'Aceita' ? 'Denúncia aceita.' : 'Denúncia recusada.');
    await renderStaff();
  }

  async function callAdminFunction(body) {
    const { data: { session } } = await db.auth.getSession();
    if (!session) throw new Error('Sessão expirada.');
    const response = await fetch(`${CONFIG.url}/functions/v1/manage-admins`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: CONFIG.publishableKey }, body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Falha ao gerenciar administradores.');
    return data;
  }

  async function loadAdmins() { return; }

  $('#refreshAdmins') && ($('#refreshAdmins').onclick = loadAdmins);
  $('#createAdminForm')?.addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, fd = new FormData(form);
    const displayName = form.querySelector('[name="displayName"]')?.value.trim() || '';
    const username = (form.querySelector('[name="username"]')?.value || '').trim().toLowerCase();
    const password = form.querySelector('[name="password"]')?.value || '';
    if (!displayName || !username || !password) {
      return toast('Informe nome, usuário e senha para criar o administrador.', 'error');
    }
    if (!/^[a-z0-9._-]+$/i.test(username)) return toast('Usuário inválido.', 'error');
    if (password.length < 8) return toast('A senha precisa ter pelo menos 8 caracteres.', 'error');
    const button = form.querySelector('button[type=submit]'); button.disabled = true;
    try { await callAdminFunction({ action:'create', displayName, username, password }); form.reset(); toast('Administrador criado com sucesso. A conta foi salva no banco de dados.'); }
    catch (e) { toast(e.message, 'error'); } finally { button.disabled = false; }
  });

  $('#adminsList')?.addEventListener('click', async event => {
    const b = event.target.closest('[data-admin-action]'); if (!b) return;
    const action = b.dataset.adminAction, userId = b.dataset.userId, username = b.dataset.username;
    try {
      if (action === 'toggle') await callAdminFunction({ action:'toggle', userId, active: b.dataset.active !== 'true' });
      if (action === 'reset') {
        const password = prompt(`Digite a nova senha para @${username} (mínimo 8 caracteres):`);
        if (!password) return;
        if (password.length < 8) return toast('A senha precisa ter pelo menos 8 caracteres.', 'error');
        await callAdminFunction({ action:'reset_password', userId, password });
      }
      if (action === 'delete') {
        if (!confirm(`Excluir definitivamente a conta @${username}?`)) return;
        await callAdminFunction({ action:'delete', userId });
      }
      toast('Conta atualizada.'); await loadAdmins();
    } catch (e) { toast(e.message, 'error'); }
  });

  db.auth.onAuthStateChange((_event, session) => { if (!session) currentProfile = null; });
  getSessionProfile().then(profile => { if (profile) nav('staff-dashboard'); });
})();
