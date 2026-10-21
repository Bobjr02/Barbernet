/* ============================================================
   BarberNet — Lógica do site público
   ============================================================ */

const WEEKDAYS_SHORT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

const state = {
  data: null,
  selectedService: null,
  selectedDate: null,
  selectedTime: null,
};

function pad(n){ return String(n).padStart(2,'0'); }
function todayISO(){
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

async function api(action, params = {}, method = 'GET', body = null){
  if(!APP_SCRIPT_URL){
    throw new Error('NOT_CONNECTED');
  }
  let url = `${APP_SCRIPT_URL}?action=${encodeURIComponent(action)}`;
  Object.entries(params).forEach(([k,v]) => url += `&${k}=${encodeURIComponent(v)}`);

  const opts = { method };
  if(method === 'POST'){
    opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' }; // evita preflight CORS no Apps Script
    opts.body = JSON.stringify(body || {});
  }
  const res = await fetch(url, opts);
  if(!res.ok) throw new Error('REQUEST_FAILED');
  const json = await res.json();
  if(json.error) throw new Error(json.error);
  return json;
}

/* ---------- Carregamento inicial ---------- */
async function loadSite(){
  if(!APP_SCRIPT_URL){
    showNotConnected();
    return;
  }
  try{
    const data = await api('getPublicData');
    state.data = data;
    renderBrand(data);
    renderStatus(data);
    renderHeroSlots(data);
    renderServices(data);
    renderHours(data);
    renderContacts(data);
    renderServicePickGrid(data);
  }catch(err){
    console.error(err);
    showLoadError();
  }
}

function showNotConnected(){
  const notice = document.createElement('div');
  notice.className = 'container';
  notice.innerHTML = `<div class="alert alert-info" style="margin-top:24px">
    Este site ainda não está conectado ao Google Sheets/Calendar do dono da barbearia.
    Abra <a href="admin.html" style="color:var(--gold-bright)">o painel do dono</a> e siga o guia de configuração.
  </div>`;
  document.querySelector('.hero').after(notice);
}
function showLoadError(){
  const notice = document.createElement('div');
  notice.className = 'container';
  notice.innerHTML = `<div class="alert alert-error" style="margin-top:24px">
    Não foi possível carregar as informações agora. Tente novamente em instantes.
  </div>`;
  document.querySelector('.hero').after(notice);
}

/* ---------- Renderização ---------- */
function renderBrand(data){
  const name = data.name || 'BarberNet';
  document.title = name;
  document.getElementById('brandName').textContent = name;
  document.getElementById('footerBrand').textContent = `© ${new Date().getFullYear()} ${name}`;
  if(data.tagline){
    document.getElementById('heroTitle').innerHTML = richText(data.tagline);
  }
  if(data.lede){
    document.getElementById('heroLede').textContent = data.lede;
  }
}

function renderStatus(data){
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  dot.classList.remove('open', 'closed'); // pode ser re-renderizado após um agendamento
  if(data.openNow){
    dot.classList.add('open');
    text.textContent = `Aberto agora · fecha às ${data.closesAt || '--'}`;
  }else{
    dot.classList.add('closed');
    text.textContent = data.opensAt
      ? `Fechado agora · abre ${data.opensAtLabel || ''} às ${data.opensAt}`
      : 'Fechado no momento';
  }
}

function renderHeroSlots(data){
  const wrap = document.getElementById('heroSlots');
  const dateLabel = document.getElementById('heroCardDate');
  const slots = data.nextSlots || [];
  dateLabel.textContent = data.nextSlotsDateLabel || 'hoje';
  if(!slots.length){
    wrap.innerHTML = `<div class="slot-row">Sem horários livres nos próximos dias</div>`;
    return;
  }
  wrap.innerHTML = slots.map(s => `
    <div class="slot-row free">
      <span>${esc(s.time)}</span>
      <span class="tag">${esc(s.dateLabel)}</span>
    </div>
  `).join('');
}

function renderServices(data){
  const grid = document.getElementById('servicesGrid');
  const services = (data.services || []).filter(s => s.active !== false);
  if(!services.length){
    grid.innerHTML = `<div class="empty-state">Nenhum serviço cadastrado ainda.</div>`;
    return;
  }
  grid.innerHTML = services.map(s => `
    <div class="service-card">
      <h3>${esc(s.name)}</h3>
      <div class="service-meta">
        <span class="service-price">${esc(money(s.price))}</span>
        <span class="service-duration">${esc(s.duration)} min</span>
      </div>
    </div>
  `).join('');
}

function renderHours(data){
  const tbody = document.querySelector('#hoursTable tbody');
  const hours = data.hours || [];
  const todayIdx = new Date().getDay();
  tbody.innerHTML = hours.map(h => `
    <tr class="${h.weekday === todayIdx ? 'today' : ''}">
      <td class="day">${esc(WEEKDAYS[h.weekday])}</td>
      <td class="${h.active ? '' : 'state-closed'}">
        ${h.active ? `${esc(h.open)} – ${esc(h.close)}` : 'Fechado'}
      </td>
    </tr>
  `).join('');

  const exceptions = (data.exceptions || []);
  if(exceptions.length){
    document.getElementById('exceptionNote').innerHTML = exceptions.map(e => `
      <div class="exception-note">⚠ <span>${esc(e.dateLabel)}: ${e.type === 'closed' ? 'fechado' : `horário especial ${esc(e.open)}–${esc(e.close)}`}${e.note ? ` — ${esc(e.note)}` : ''}</span></div>
    `).join('');
  }
}

function renderContacts(data){
  const grid = document.getElementById('contactGrid');
  const items = [];
  if(data.whatsapp) items.push({label:'WhatsApp', value:data.whatsapp, href:`https://wa.me/${String(data.whatsapp).replace(/\D/g,'')}`});
  if(data.phone) items.push({label:'Telefone', value:data.phone, href:`tel:${String(data.phone).replace(/\D/g,'')}`});
  if(data.instagram){
    const handle = String(data.instagram).replace('@','');
    items.push({label:'Instagram', value:`@${handle}`, href:`https://instagram.com/${encodeURIComponent(handle)}`});
  }
  if(data.address) items.push({label:'Endereço', value:data.address, href:safeUrl(data.mapLink)});

  grid.innerHTML = items.length ? items.map(i => `
    <a class="contact-card" href="${esc(i.href)}" target="_blank" rel="noopener">
      <span class="label">${esc(i.label)}</span>
      <span class="value">${esc(i.value)}</span>
    </a>
  `).join('') : `<div class="empty-state">Contatos ainda não cadastrados.</div>`;
}

/* ---------- Fluxo de agendamento ---------- */
function renderServicePickGrid(data){
  const grid = document.getElementById('servicePickGrid');
  const services = (data.services || []).filter(s => s.active !== false);
  if(!services.length){
    grid.innerHTML = `<div class="empty-state">Cadastre serviços no painel do dono para liberar o agendamento.</div>`;
    return;
  }
  grid.innerHTML = services.map(s => `
    <div class="pick-card" data-id="${esc(s.id)}" data-duration="${esc(s.duration)}">
      <h4>${esc(s.name)}</h4>
      <div class="price">${esc(money(s.price))} · ${esc(s.duration)} min</div>
    </div>
  `).join('');

  grid.querySelectorAll('.pick-card').forEach(card => {
    card.addEventListener('click', () => {
      grid.querySelectorAll('.pick-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.selectedService = { id: card.dataset.id, duration: Number(card.dataset.duration) };
      goToStep(2);
      const dateInput = document.getElementById('dateInput');
      if(!dateInput.value){
        dateInput.value = todayISO();
        dateInput.min = todayISO();
        loadSlotsForDate();
      }
    });
  });
}

function goToStep(n){
  [1,2,3].forEach(i => {
    document.getElementById(`step${i}`).style.display = (i === n) ? '' : 'none';
    const stepEl = document.querySelector(`.step[data-step="${i}"]`);
    stepEl.classList.toggle('active', i === n);
    stepEl.classList.toggle('done', i < n);
  });
}

document.addEventListener('click', (e) => {
  if(e.target.matches('[data-back]')){
    goToStep(Number(e.target.dataset.back));
  }
});

document.getElementById('dateInput').addEventListener('change', loadSlotsForDate);

async function loadSlotsForDate(){
  const dateInput = document.getElementById('dateInput');
  const hint = document.getElementById('dateHint');
  const slotsGrid = document.getElementById('slotsGrid');
  const toStep3 = document.getElementById('toStep3');
  state.selectedTime = null;
  toStep3.disabled = true;
  if(!dateInput.value || !state.selectedService) return;

  slotsGrid.innerHTML = `<div class="skeleton" style="height:38px"></div><div class="skeleton" style="height:38px"></div><div class="skeleton" style="height:38px"></div>`;
  hint.textContent = '';

  try{
    const res = await api('getAvailability', { date: dateInput.value, serviceId: state.selectedService.id });
    if(res.closed){
      slotsGrid.innerHTML = '';
      hint.textContent = res.reason || 'Fechado nesta data.';
      return;
    }
    const slots = res.slots || [];
    if(!slots.length){
      slotsGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">Sem horários livres nesta data. Tente outro dia.</div>`;
      return;
    }
    slotsGrid.innerHTML = slots.map(s => `
      <button class="slot-btn" data-time="${esc(s)}">${esc(s)}</button>
    `).join('');
    slotsGrid.querySelectorAll('.slot-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        slotsGrid.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.selectedTime = btn.dataset.time;
        toStep3.disabled = false;
      });
    });
  }catch(err){
    console.error(err);
    slotsGrid.innerHTML = '';
    hint.textContent = 'Não foi possível carregar os horários. Tente novamente.';
  }
}

document.getElementById('toStep3').addEventListener('click', () => {
  state.selectedDate = document.getElementById('dateInput').value;
  goToStep(3);
});

const BOOKING_ERRORS = {
  HORARIO_INDISPONIVEL: 'Esse horário acabou de ser ocupado. Volte e escolha outro.',
  LIMITE_DE_AGENDAMENTOS: 'Este telefone já tem 2 agendamentos marcados. Para marcar outro, fale com a barbearia.',
  DATA_FORA_DO_PERIODO: 'Escolha uma data entre hoje e os próximos 60 dias.',
  DADOS_INVALIDOS: 'Confira seus dados: informe o nome e um telefone com DDD (10 a 13 dígitos).',
  SISTEMA_OCUPADO: 'O sistema está ocupado no momento. Tente novamente em alguns segundos.',
};

document.getElementById('confirmBooking').addEventListener('click', async () => {
  const name = document.getElementById('clientName').value.trim();
  const phone = document.getElementById('clientPhone').value.trim();
  const note = document.getElementById('clientNote').value.trim();
  const result = document.getElementById('bookingResult');
  const btn = document.getElementById('confirmBooking');

  if(btn.disabled || document.getElementById('bookingDialog').open) return;

  if(!name || !phone){
    result.innerHTML = `<div class="alert alert-error">Preencha nome e telefone para confirmar.</div>`;
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Confirmando…';
  try{
    await api('createBooking', {}, 'POST', {
      serviceId: state.selectedService.id,
      date: state.selectedDate,
      time: state.selectedTime,
      name, phone, note,
    });
    // O botão continua desabilitado até o diálogo fechar e o fluxo reiniciar
    btn.textContent = 'Confirmado ✓';
    result.innerHTML = '';
    openBookingDialog();
  }catch(err){
    console.error(err);
    const msg = BOOKING_ERRORS[err.message] || 'Não foi possível confirmar agora. Tente novamente em instantes.';
    result.innerHTML = `<div class="alert alert-error">${esc(msg)}</div>`;
    btn.disabled = false;
    btn.textContent = 'Confirmar agendamento';
  }
});

/* ---------- Diálogo de confirmação ---------- */
const DIALOG_SECONDS = 10;
let dialogTimer = null;
let dialogPendingReset = false; // true enquanto a confirmação atual ainda não reiniciou o fluxo

function formatDateLong(iso){
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${weekday}, ${pad(d)}/${pad(m)}/${y}`;
}

function openBookingDialog(){
  const dialog = document.getElementById('bookingDialog');
  const countdown = document.getElementById('dialogCountdown');
  const service = ((state.data && state.data.services) || [])
    .find(s => String(s.id) === String(state.selectedService.id));

  document.getElementById('dialogService').textContent = service ? service.name : '';
  document.getElementById('dialogDate').textContent = formatDateLong(state.selectedDate);
  document.getElementById('dialogTime').textContent = state.selectedTime;

  let remaining = DIALOG_SECONDS;
  countdown.textContent = `Fechando em ${remaining}s`;
  dialogPendingReset = true;
  dialog.showModal();
  document.getElementById('dialogClose').focus();

  clearInterval(dialogTimer);
  dialogTimer = setInterval(() => {
    remaining--;
    if(remaining <= 0){
      dialog.close();
      return;
    }
    countdown.textContent = `Fechando em ${remaining}s`;
  }, 1000);
}

// Botão, Esc (cancel → close) e tempo esgotado chamam dialog.close(); todos caem aqui
function onBookingDialogClose(){
  clearInterval(dialogTimer);
  dialogTimer = null;
  if(!dialogPendingReset) return;
  dialogPendingReset = false;
  resetBooking();
}

document.getElementById('dialogClose').addEventListener('click', () => {
  document.getElementById('bookingDialog').close();
});
document.getElementById('bookingDialog').addEventListener('close', onBookingDialogClose);

function resetBooking(){
  state.selectedService = null;
  state.selectedDate = null;
  state.selectedTime = null;

  document.getElementById('clientName').value = '';
  document.getElementById('clientPhone').value = '';
  document.getElementById('clientNote').value = '';
  document.getElementById('dateInput').value = ''; // permite que a escolha do serviço preencha hoje de novo
  document.getElementById('slotsGrid').innerHTML = '';
  document.getElementById('dateHint').textContent = '';
  document.getElementById('bookingResult').innerHTML = '';

  document.querySelectorAll('#servicePickGrid .pick-card.selected, #slotsGrid .slot-btn.selected')
    .forEach(el => el.classList.remove('selected'));

  const btn = document.getElementById('confirmBooking');
  btn.disabled = false;
  btn.textContent = 'Confirmar agendamento';
  document.getElementById('toStep3').disabled = true;

  goToStep(1);

  // Atualiza "próximas vagas" para o horário recém-agendado sumir; falha aqui não incomoda o cliente
  api('getPublicData')
    .then(data => {
      state.data = data;
      renderStatus(data);
      renderHeroSlots(data);
    })
    .catch(err => console.error(err));

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Menu mobile ---------- */
document.getElementById('navToggle').addEventListener('click', () => {
  document.getElementById('navLinks').classList.toggle('open');
});
document.querySelectorAll('.nav-links a').forEach(a => a.addEventListener('click', () => {
  document.getElementById('navLinks').classList.remove('open');
}));

loadSite();
