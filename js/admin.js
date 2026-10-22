/* ============================================================
   BarberNet — Lógica do painel do dono
   Observação: a senha só é enviada no login e descartada em
   seguida. As demais chamadas usam um token de sessão (6 h) que
   fica apenas em memória (some ao fechar/recarregar a aba).
   ============================================================ */

const adminState = {
  baseUrl: '',
  token: '',
  data: null,
};

/* Sempre POST: token e dados vão no corpo, nunca na URL */
async function adminApi(action, data = {}){
  const res = await fetch(`${adminState.baseUrl}?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...data, token: adminState.token }),
  });
  if(!res.ok) throw new Error('REQUEST_FAILED');
  const json = await res.json();
  if(json.error === 'SESSAO_EXPIRADA') showLogin('Sua sessão expirou. Entre novamente.');
  if(json.error) throw new Error(json.error);
  return json;
}

/* Erros de sessão já levaram de volta ao login; não mostra outro alerta */
function isSessionError(err){
  return err && err.message === 'SESSAO_EXPIRADA';
}

function showLogin(message){
  adminState.token = '';
  adminState.data = null;
  ['dadosMsg','hoursMsg'].forEach(id => document.getElementById(id).innerHTML = '');
  document.getElementById('adminShell').style.display = 'none';
  document.getElementById('loginWrap').style.display = '';
  document.getElementById('loginMsg').innerHTML = message ? `<div class="alert alert-error">${esc(message)}</div>` : '';
}

/* ---------- Login ---------- */
document.getElementById('loginBtn').addEventListener('click', async () => {
  const url = document.getElementById('loginUrl').value.trim();
  const pass = document.getElementById('loginPass').value;
  const msg = document.getElementById('loginMsg');
  if(!url || !pass){
    msg.innerHTML = `<div class="alert alert-error">Preencha a URL e a senha.</div>`;
    return;
  }
  adminState.baseUrl = url;
  msg.innerHTML = `<div class="alert alert-info">Conectando…</div>`;
  try{
    const { token } = await adminApi('login', { pass });
    adminState.token = token;
    document.getElementById('loginPass').value = '';
    const data = await adminApi('getAdminData');
    adminState.data = data;
    document.getElementById('loginWrap').style.display = 'none';
    document.getElementById('adminShell').style.display = 'grid';
    hydrateAll(data);
  }catch(err){
    console.error(err);
    if(err.message === 'LOGIN_BLOQUEADO'){
      msg.innerHTML = `<div class="alert alert-error">Muitas tentativas. Aguarde 10 minutos.</div>`;
    }else if(!isSessionError(err)){
      msg.innerHTML = `<div class="alert alert-error">Não foi possível entrar. Confira a URL e a senha.</div>`;
    }
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try{ await adminApi('logout'); }catch(err){ console.error(err); }
  location.reload();
});

/* ---------- Navegação entre painéis ---------- */
function showPanel(name){
  document.querySelectorAll('.admin-nav button').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
  if(name === 'agendamentos') loadBookings();
}
document.querySelectorAll('.admin-nav button').forEach(btn => {
  btn.addEventListener('click', () => showPanel(btn.dataset.panel));
});

/* ---------- Hidratação inicial ---------- */
function hydrateAll(data){
  document.getElementById('fName').value = data.name || '';
  document.getElementById('fTagline').value = data.tagline || '';
  document.getElementById('fLede').value = data.lede || '';
  document.getElementById('fWhats').value = data.whatsapp || '';
  document.getElementById('fPhone').value = data.phone || '';
  document.getElementById('fInsta').value = data.instagram || '';
  document.getElementById('fMap').value = data.mapLink || '';
  document.getElementById('fAddress').value = data.address || '';

  renderServicesList(data.services || []);
  renderHoursForm(data.hours || []);
  renderExceptionsList(data.exceptions || []);

  document.getElementById('urlInUse').textContent = adminState.baseUrl;
  renderCounts(data.counts);
  setBadge('badgeSheets', data.sheetsOk !== false);
  setBadge('badgeCalendar', data.calendarOk !== false);
}
function setBadge(id, ok){
  const el = document.getElementById(id);
  el.textContent = ok ? 'conectado' : 'com problema';
  el.className = 'badge ' + (ok ? 'badge-ok' : 'badge-off');
}

/* ---------- Dados da barbearia ---------- */
document.getElementById('saveDados').addEventListener('click', async () => {
  const msg = document.getElementById('dadosMsg');
  const payload = {
    name: document.getElementById('fName').value.trim(),
    tagline: document.getElementById('fTagline').value.trim(),
    lede: document.getElementById('fLede').value.trim(),
    whatsapp: document.getElementById('fWhats').value.trim(),
    phone: document.getElementById('fPhone').value.trim(),
    instagram: document.getElementById('fInsta').value.trim(),
    mapLink: document.getElementById('fMap').value.trim(),
    address: document.getElementById('fAddress').value.trim(),
  };
  msg.innerHTML = `<div class="alert alert-info">Salvando…</div>`;
  try{
    await adminApi('saveInfo', payload);
    msg.innerHTML = `<div class="alert alert-success">Dados salvos.</div>`;
  }catch(err){
    if(isSessionError(err)) return;
    console.error(err);
    msg.innerHTML = `<div class="alert alert-error">Erro ao salvar. Tente novamente.</div>`;
  }
});

/* ---------- Serviços ---------- */
function renderServicesList(services){
  const wrap = document.getElementById('servicesList');
  if(!services.length){
    wrap.innerHTML = `<div class="empty-state">Nenhum serviço cadastrado.</div>`;
    return;
  }
  wrap.innerHTML = services.map(s => `
    <div class="list-item">
      <div class="grow">
        <div>${esc(s.name)}</div>
        <div class="muted">${esc(money(s.price))} · ${esc(s.duration)} min</div>
      </div>
      <button class="icon-btn" data-remove-service="${esc(s.id)}" title="Remover">✕</button>
    </div>
  `).join('');
  wrap.querySelectorAll('[data-remove-service]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm('Remover este serviço?')) return;
      try{
        await adminApi('removeService', { id: btn.dataset.removeService });
        const data = await adminApi('getAdminData');
        adminState.data = data;
        renderServicesList(data.services || []);
      }catch(err){ if(isSessionError(err)) return; console.error(err); alert('Erro ao remover.'); }
    });
  });
}

document.getElementById('addService').addEventListener('click', async () => {
  const name = document.getElementById('svName').value.trim();
  const price = document.getElementById('svPrice').value;
  const duration = document.getElementById('svDuration').value;
  if(!name || !price || !duration){
    alert('Preencha nome, preço e duração.');
    return;
  }
  try{
    await adminApi('addService', { name, price, duration });
    const data = await adminApi('getAdminData');
    adminState.data = data;
    renderServicesList(data.services || []);
    document.getElementById('svName').value = '';
    document.getElementById('svPrice').value = '';
    document.getElementById('svDuration').value = '';
  }catch(err){ if(isSessionError(err)) return; console.error(err); alert('Erro ao adicionar serviço.'); }
});

/* ---------- Horários ---------- */
function renderHoursForm(hours){
  const wrap = document.getElementById('hoursForm');
  const byDay = {};
  hours.forEach(h => byDay[h.weekday] = h);

  wrap.innerHTML = WEEKDAYS.map((label, idx) => {
    const h = byDay[idx] || { active:false, open:'09:00', close:'19:00' };
    return `
      <div class="day-row" data-day="${idx}">
        <span>${esc(label)}</span>
        <label class="switch">
          <input type="checkbox" ${h.active ? 'checked' : ''} data-field="active">
          <span class="track"></span>
        </label>
        <input type="time" value="${esc(h.open)}" data-field="open" ${h.active ? '' : 'disabled'}>
        <input type="time" value="${esc(h.close)}" data-field="close" ${h.active ? '' : 'disabled'}>
      </div>
    `;
  }).join('');

  wrap.querySelectorAll('[data-field="active"]').forEach(chk => {
    chk.addEventListener('change', () => {
      const row = chk.closest('.day-row');
      row.querySelectorAll('input[type=time]').forEach(t => t.disabled = !chk.checked);
    });
  });
}

document.getElementById('saveHours').addEventListener('click', async () => {
  const msg = document.getElementById('hoursMsg');
  const rows = document.querySelectorAll('#hoursForm .day-row');
  const hours = Array.from(rows).map(row => ({
    weekday: Number(row.dataset.day),
    active: row.querySelector('[data-field="active"]').checked,
    open: row.querySelector('[data-field="open"]').value,
    close: row.querySelector('[data-field="close"]').value,
  }));
  msg.innerHTML = `<div class="alert alert-info">Salvando…</div>`;
  try{
    await adminApi('saveHours', { hours });
    msg.innerHTML = `<div class="alert alert-success">Horários atualizados.</div>`;
  }catch(err){
    if(isSessionError(err)) return;
    console.error(err);
    msg.innerHTML = `<div class="alert alert-error">Erro ao salvar horários.</div>`;
  }
});

/* ---------- Exceções / feriados ---------- */
document.getElementById('exType').addEventListener('change', (e) => {
  document.getElementById('exCustomHours').style.display = e.target.value === 'custom' ? 'grid' : 'none';
});

function renderExceptionsList(exceptions){
  const wrap = document.getElementById('exceptionsList');
  if(!exceptions.length){
    wrap.innerHTML = `<div class="empty-state">Nenhuma exceção cadastrada.</div>`;
    return;
  }
  wrap.innerHTML = exceptions.map(e => `
    <div class="list-item">
      <div class="grow">
        <div>${esc(e.dateLabel || e.date)}${e.note ? ` — ${esc(e.note)}` : ''}</div>
        <div class="muted">${e.type === 'closed' ? 'Fechado o dia todo' : `Horário especial ${esc(e.open)}–${esc(e.close)}`}</div>
      </div>
      <button class="icon-btn" data-remove-exception="${esc(e.id)}" title="Remover">✕</button>
    </div>
  `).join('');
  wrap.querySelectorAll('[data-remove-exception]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try{
        await adminApi('removeException', { id: btn.dataset.removeException });
        const data = await adminApi('getAdminData');
        adminState.data = data;
        renderExceptionsList(data.exceptions || []);
      }catch(err){ if(isSessionError(err)) return; console.error(err); alert('Erro ao remover.'); }
    });
  });
}

document.getElementById('addException').addEventListener('click', async () => {
  const date = document.getElementById('exDate').value;
  const type = document.getElementById('exType').value;
  const open = document.getElementById('exOpen').value;
  const close = document.getElementById('exClose').value;
  const note = document.getElementById('exNote').value.trim();
  if(!date){ alert('Escolha uma data.'); return; }
  if(type === 'custom' && (!open || !close)){ alert('Informe abertura e fechamento.'); return; }
  try{
    await adminApi('addException', { date, type, open, close, note });
    const data = await adminApi('getAdminData');
    adminState.data = data;
    renderExceptionsList(data.exceptions || []);
    document.getElementById('exDate').value = '';
    document.getElementById('exNote').value = '';
  }catch(err){ if(isSessionError(err)) return; console.error(err); alert('Erro ao adicionar exceção.'); }
});

/* ---------- Agendamentos ---------- */
const BOOKING_EMPTY = {
  hoje: 'Nenhum agendamento para hoje.',
  proximos: 'Nenhum agendamento nos próximos 14 dias.',
  pendentes: 'Nenhum atendimento aguardando baixa.',
  historico: 'Nenhum atendimento nos últimos 30 dias.',
};
const PAYMENT_LABELS = { dinheiro:'Dinheiro', pix:'Pix', debito:'Cartão de débito', credito:'Cartão de crédito', outro:'Outro' };
const BOOKING_ACTION_ERRORS = {
  AGENDAMENTO_NAO_ENCONTRADO: 'Agendamento não encontrado. A lista foi atualizada.',
  ACAO_INVALIDA_PARA_STATUS: 'Essa ação não vale para a situação atual do agendamento. A lista foi atualizada.',
  DADOS_INVALIDOS: 'Confira o valor (de R$ 0 a R$ 10.000) e a forma de pagamento.',
  SISTEMA_OCUPADO: 'O sistema está ocupado no momento. Tente novamente em alguns segundos.',
  PLANILHA_DESATUALIZADA: 'A planilha precisa ser atualizada: rode migrarAgendamentosV2 no editor do Apps Script.',
};

adminState.view = 'hoje';
let bookingsRequest = 0; // descarta respostas de uma sub-aba que já foi trocada

function localISO(d){
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function bookingStart(b){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !/^\d{2}:\d{2}$/.test(b.time)) return null;
  const [y, m, d] = b.date.split('-').map(Number);
  const [hh, mm] = b.time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

function renderCounts(counts){
  if(!counts) return;
  const setCount = (id, n) => {
    const el = document.getElementById(id);
    el.textContent = n > 0 ? String(n) : '';
    el.hidden = !(n > 0);
  };
  setCount('countPendentes', counts.pendentes);
  setCount('countHoje', counts.naoConfirmadosHoje);
  const alertBtn = document.getElementById('pendingAlert');
  alertBtn.hidden = !(counts.pendentes > 0);
  alertBtn.textContent = `Você tem ${counts.pendentes} atendimento(s) aguardando baixa`;
}

document.getElementById('pendingAlert').addEventListener('click', () => {
  selectBookingView('pendentes', false);
  showPanel('agendamentos');
});

function selectBookingView(view, load = true){
  adminState.view = view;
  document.querySelectorAll('.subtab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  document.getElementById('bookingsMsg').innerHTML = '';
  if(load) loadBookings();
}
document.querySelectorAll('.subtab').forEach(tab => {
  tab.addEventListener('click', () => selectBookingView(tab.dataset.view));
});

function phoneLink(phone){
  let digits = String(phone || '').replace(/\D/g, '');
  if(!digits) return esc(phone);
  if(digits.length === 10 || digits.length === 11) digits = '55' + digits;
  return `<a href="https://wa.me/${esc(digits)}" target="_blank" rel="noopener">${esc(phone)}</a>`;
}

function bookingSeals(b, start, now){
  const seals = [];
  if(b.presencaConfirmada) seals.push(`<span class="pill pill-ok">Presença confirmada</span>`);
  else if(b.status === 'confirmado' && start && start > now && start - now <= 86400000){
    seals.push(`<span class="pill pill-warn">Não confirmou</span>`);
  }
  if(b.status === 'concluido') seals.push(`<span class="pill pill-ok">Concluído</span>`);
  if(b.status === 'faltou') seals.push(`<span class="pill pill-danger">Faltou</span>`);
  if(b.status === 'cancelado'){
    const by = b.canceladoPor === 'cliente' ? ' pelo cliente' : (b.canceladoPor === 'dono' ? ' pelo dono' : '');
    seals.push(`<span class="pill pill-muted">Cancelado${esc(by)}</span>`);
  }
  return seals.join('');
}

function priceLine(b){
  if(b.status === 'concluido' && b.valorCobrado !== ''){
    const forma = PAYMENT_LABELS[b.formaPagamento] || b.formaPagamento;
    return `Cobrado ${esc(money(b.valorCobrado))}${forma ? ` · ${esc(forma)}` : ''}`;
  }
  return b.preco !== '' ? `Preço ${esc(money(b.preco))}` : '';
}

function bookingActions(b, start, now){
  const today = localISO(now);
  const btns = [];
  if(b.status === 'confirmado'){
    if(b.date && b.date <= today){
      btns.push(`<button type="button" class="btn btn-primary" data-act="open-complete">Concluir</button>`);
      if(start && start <= now) btns.push(`<button type="button" class="btn btn-ghost" data-act="noshow">Faltou</button>`);
    }
    if(start && start > now) btns.push(`<button type="button" class="btn btn-ghost" data-act="cancel">Cancelar</button>`);
  }
  if(b.status === 'concluido' || b.status === 'faltou'){
    btns.push(`<button type="button" class="btn btn-ghost" data-act="reopen">Desfazer</button>`);
  }
  return btns.join('');
}

function completeForm(b){
  const options = Object.entries(PAYMENT_LABELS).map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
  return `
    <div class="complete-form" hidden>
      <div class="form-row">
        <div class="form-group">
          <label class="field-label">Valor cobrado (R$)</label>
          <input type="number" min="0" max="10000" step="0.01" inputmode="decimal" data-field="valor" value="${esc(b.preco)}">
        </div>
        <div class="form-group">
          <label class="field-label">Forma de pagamento</label>
          <select data-field="forma"><option value="">Selecione…</option>${options}</select>
        </div>
      </div>
      <div class="booking-actions">
        <button type="button" class="btn btn-primary" data-act="save-complete">Salvar</button>
        <button type="button" class="btn btn-ghost" data-act="close-complete">Cancelar</button>
      </div>
    </div>`;
}

function bookingItem(b, now){
  const start = bookingStart(b);
  const when = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? formatDateLong(b.date) : b.date;
  const price = priceLine(b);
  const actions = bookingActions(b, start, now);
  return `
    <div class="booking-item" data-id="${esc(b.id)}">
      <div class="booking-item-head">
        <strong>${esc(when)} · ${esc(b.time)}</strong>
        <span class="booking-seals">${bookingSeals(b, start, now)}</span>
      </div>
      <div>${esc(b.serviceName)}</div>
      <div class="booking-client">${esc(b.name)} · ${phoneLink(b.phone)}</div>
      ${b.note ? `<div class="booking-note">${esc(b.note)}</div>` : ''}
      ${price ? `<div class="booking-price">${price}</div>` : ''}
      ${actions ? `<div class="booking-actions">${actions}</div>` : ''}
      ${actions.includes('open-complete') ? completeForm(b) : ''}
    </div>`;
}

async function loadBookings(){
  const wrap = document.getElementById('bookingsList');
  const view = adminState.view;
  const req = ++bookingsRequest;
  wrap.innerHTML = `<div class="skeleton" style="height:60px"></div>`;
  try{
    const res = await adminApi('getBookings', { view });
    if(req !== bookingsRequest) return;
    renderCounts(res.counts);
    const bookings = res.bookings || [];
    if(!bookings.length){
      wrap.innerHTML = `<div class="empty-state">${esc(BOOKING_EMPTY[view])}</div>`;
      return;
    }
    const now = new Date();
    wrap.innerHTML = bookings.map(b => bookingItem(b, now)).join('');
  }catch(err){
    if(req !== bookingsRequest || isSessionError(err)) return;
    console.error(err);
    const msg = BOOKING_ACTION_ERRORS[err.message] || 'Erro ao carregar agendamentos.';
    wrap.innerHTML = `<div class="alert alert-error">${esc(msg)}</div>`;
  }
}

async function runBookingAction(item, action, payload){
  const msg = document.getElementById('bookingsMsg');
  msg.innerHTML = '';
  item.querySelectorAll('button, input, select').forEach(el => el.disabled = true);
  try{
    await adminApi(action, { id: item.dataset.id, ...payload });
  }catch(err){
    if(isSessionError(err)) return;
    console.error(err);
    const text = BOOKING_ACTION_ERRORS[err.message] || 'Não foi possível concluir a ação. Tente novamente.';
    msg.innerHTML = `<div class="alert alert-error">${esc(text)}</div>`;
  }
  loadBookings(); // recarrega a sub-aba e os contadores, com sucesso ou erro
}

document.getElementById('bookingsList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if(!btn) return;
  const item = btn.closest('.booking-item');
  const form = item.querySelector('.complete-form');
  switch(btn.dataset.act){
    case 'open-complete':
      form.hidden = false;
      item.querySelector('[data-act="open-complete"]').disabled = true;
      form.querySelector('[data-field="valor"]').focus();
      break;
    case 'close-complete':
      form.hidden = true;
      item.querySelector('[data-act="open-complete"]').disabled = false;
      break;
    case 'save-complete': {
      const valorInput = form.querySelector('[data-field="valor"]');
      const forma = form.querySelector('[data-field="forma"]').value;
      const msg = document.getElementById('bookingsMsg');
      if(valorInput.validity.badInput || !valorInput.checkValidity()){
        msg.innerHTML = `<div class="alert alert-error">Informe um valor entre R$ 0 e R$ 10.000.</div>`;
        return;
      }
      if(!forma){
        msg.innerHTML = `<div class="alert alert-error">Escolha a forma de pagamento.</div>`;
        return;
      }
      runBookingAction(item, 'completeBooking', { valorCobrado: valorInput.value, formaPagamento: forma });
      break;
    }
    case 'noshow':
      if(confirm('Marcar que o cliente faltou?')) runBookingAction(item, 'markNoShow');
      break;
    case 'cancel':
      if(confirm('Cancelar este agendamento? O horário será liberado.')) runBookingAction(item, 'cancelBooking');
      break;
    case 'reopen':
      if(confirm('Desfazer a baixa? O agendamento volta para "confirmado".')) runBookingAction(item, 'reopenBooking');
      break;
  }
});

document.getElementById('refreshBookings').addEventListener('click', () => {
  document.getElementById('bookingsMsg').innerHTML = '';
  loadBookings();
});

/* Prefill da URL se config.js já tiver uma definida */
if(typeof APP_SCRIPT_URL !== 'undefined' && APP_SCRIPT_URL){
  document.getElementById('loginUrl').value = APP_SCRIPT_URL;
}
