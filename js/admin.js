/* ============================================================
   BarberNet — Lógica do painel do dono
   Observação: por simplicidade e segurança, a senha fica apenas
   em memória (some ao fechar/recarregar a aba). Isso evita
   qualquer armazenamento sensível no navegador.
   ============================================================ */

const WEEKDAYS = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

const adminState = {
  baseUrl: '',
  pass: '',
  data: null,
};

function money(v){ return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }

async function adminApi(action, params = {}, method = 'GET', body = null){
  let url = `${adminState.baseUrl}?action=${encodeURIComponent(action)}&pass=${encodeURIComponent(adminState.pass)}`;
  Object.entries(params).forEach(([k,v]) => url += `&${k}=${encodeURIComponent(v)}`);
  const opts = { method };
  if(method === 'POST'){
    opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
    opts.body = JSON.stringify(body || {});
  }
  const res = await fetch(url, opts);
  if(!res.ok) throw new Error('REQUEST_FAILED');
  const json = await res.json();
  if(json.error) throw new Error(json.error);
  return json;
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
  adminState.pass = pass;
  msg.innerHTML = `<div class="alert alert-info">Conectando…</div>`;
  try{
    const data = await adminApi('getAdminData');
    adminState.data = data;
    document.getElementById('loginWrap').style.display = 'none';
    document.getElementById('adminShell').style.display = 'grid';
    hydrateAll(data);
  }catch(err){
    console.error(err);
    msg.innerHTML = `<div class="alert alert-error">Não foi possível entrar. Confira a URL e a senha.</div>`;
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => location.reload());

/* ---------- Navegação entre painéis ---------- */
document.querySelectorAll('.admin-nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.admin-nav button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`panel-${btn.dataset.panel}`).classList.add('active');
    if(btn.dataset.panel === 'agendamentos') loadBookings();
  });
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
    await adminApi('saveInfo', {}, 'POST', payload);
    msg.innerHTML = `<div class="alert alert-success">Dados salvos.</div>`;
  }catch(err){
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
        <div>${s.name}</div>
        <div class="muted">${money(s.price)} · ${s.duration} min</div>
      </div>
      <button class="icon-btn" data-remove-service="${s.id}" title="Remover">✕</button>
    </div>
  `).join('');
  wrap.querySelectorAll('[data-remove-service]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm('Remover este serviço?')) return;
      try{
        await adminApi('removeService', { id: btn.dataset.removeService }, 'POST');
        const data = await adminApi('getAdminData');
        adminState.data = data;
        renderServicesList(data.services || []);
      }catch(err){ console.error(err); alert('Erro ao remover.'); }
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
    await adminApi('addService', {}, 'POST', { name, price, duration });
    const data = await adminApi('getAdminData');
    adminState.data = data;
    renderServicesList(data.services || []);
    document.getElementById('svName').value = '';
    document.getElementById('svPrice').value = '';
    document.getElementById('svDuration').value = '';
  }catch(err){ console.error(err); alert('Erro ao adicionar serviço.'); }
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
        <span>${label}</span>
        <label class="switch">
          <input type="checkbox" ${h.active ? 'checked' : ''} data-field="active">
          <span class="track"></span>
        </label>
        <input type="time" value="${h.open}" data-field="open" ${h.active ? '' : 'disabled'}>
        <input type="time" value="${h.close}" data-field="close" ${h.active ? '' : 'disabled'}>
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
    await adminApi('saveHours', {}, 'POST', { hours });
    msg.innerHTML = `<div class="alert alert-success">Horários atualizados.</div>`;
  }catch(err){
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
        <div>${e.dateLabel || e.date}${e.note ? ` — ${e.note}` : ''}</div>
        <div class="muted">${e.type === 'closed' ? 'Fechado o dia todo' : `Horário especial ${e.open}–${e.close}`}</div>
      </div>
      <button class="icon-btn" data-remove-exception="${e.id}" title="Remover">✕</button>
    </div>
  `).join('');
  wrap.querySelectorAll('[data-remove-exception]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try{
        await adminApi('removeException', { id: btn.dataset.removeException }, 'POST');
        const data = await adminApi('getAdminData');
        adminState.data = data;
        renderExceptionsList(data.exceptions || []);
      }catch(err){ console.error(err); alert('Erro ao remover.'); }
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
    await adminApi('addException', {}, 'POST', { date, type, open, close, note });
    const data = await adminApi('getAdminData');
    adminState.data = data;
    renderExceptionsList(data.exceptions || []);
    document.getElementById('exDate').value = '';
    document.getElementById('exNote').value = '';
  }catch(err){ console.error(err); alert('Erro ao adicionar exceção.'); }
});

/* ---------- Agendamentos ---------- */
async function loadBookings(){
  const wrap = document.getElementById('bookingsList');
  wrap.innerHTML = `<div class="skeleton" style="height:60px"></div>`;
  try{
    const res = await adminApi('getBookings');
    const bookings = res.bookings || [];
    if(!bookings.length){
      wrap.innerHTML = `<div class="empty-state">Nenhum agendamento por enquanto.</div>`;
      return;
    }
    wrap.innerHTML = bookings.map(b => `
      <div class="list-item">
        <div class="grow">
          <div>${b.date} às ${b.time} — ${b.serviceName || ''}</div>
          <div class="muted">${b.name} · ${b.phone}${b.note ? ` · ${b.note}` : ''}</div>
        </div>
        <button class="icon-btn" data-cancel="${b.id}" title="Cancelar">✕</button>
      </div>
    `).join('');
    wrap.querySelectorAll('[data-cancel]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if(!confirm('Cancelar este agendamento?')) return;
        try{
          await adminApi('cancelBooking', { id: btn.dataset.cancel }, 'POST');
          loadBookings();
        }catch(err){ console.error(err); alert('Erro ao cancelar.'); }
      });
    });
  }catch(err){
    console.error(err);
    wrap.innerHTML = `<div class="alert alert-error">Erro ao carregar agendamentos.</div>`;
  }
}
document.getElementById('refreshBookings').addEventListener('click', loadBookings);

/* Prefill da URL se config.js já tiver uma definida */
if(typeof APP_SCRIPT_URL !== 'undefined' && APP_SCRIPT_URL){
  document.getElementById('loginUrl').value = APP_SCRIPT_URL;
}
