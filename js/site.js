/* ============================================================
   BarberNet — Lógica do site público
   ============================================================ */

const WEEKDAYS = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
const WEEKDAYS_SHORT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

const state = {
  data: null,
  selectedService: null,
  selectedDate: null,
  selectedTime: null,
};

function money(v){
  return Number(v || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}
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
  document.getElementById('brandName').innerHTML = `${name}`;
  document.getElementById('footerBrand').textContent = `© ${new Date().getFullYear()} ${name}`;
  if(data.tagline){
    document.getElementById('heroTitle').innerHTML = data.tagline;
  }
  if(data.lede){
    document.getElementById('heroLede').textContent = data.lede;
  }
}

function renderStatus(data){
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
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
      <span>${s.time}</span>
      <span class="tag">${s.dateLabel}</span>
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
      <h3>${s.name}</h3>
      <div class="service-meta">
        <span class="service-price">${money(s.price)}</span>
        <span class="service-duration">${s.duration} min</span>
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
      <td class="day">${WEEKDAYS[h.weekday]}</td>
      <td class="${h.active ? '' : 'state-closed'}">
        ${h.active ? `${h.open} – ${h.close}` : 'Fechado'}
      </td>
    </tr>
  `).join('');

  const exceptions = (data.exceptions || []);
  if(exceptions.length){
    document.getElementById('exceptionNote').innerHTML = exceptions.map(e => `
      <div class="exception-note">⚠ <span>${e.dateLabel}: ${e.type === 'closed' ? 'fechado' : `horário especial ${e.open}–${e.close}`}${e.note ? ` — ${e.note}` : ''}</span></div>
    `).join('');
  }
}

function renderContacts(data){
  const grid = document.getElementById('contactGrid');
  const items = [];
  if(data.whatsapp) items.push({label:'WhatsApp', value:data.whatsapp, href:`https://wa.me/${data.whatsapp.replace(/\D/g,'')}`});
  if(data.phone) items.push({label:'Telefone', value:data.phone, href:`tel:${data.phone.replace(/\D/g,'')}`});
  if(data.instagram) items.push({label:'Instagram', value:`@${data.instagram.replace('@','')}`, href:`https://instagram.com/${data.instagram.replace('@','')}`});
  if(data.address) items.push({label:'Endereço', value:data.address, href:data.mapLink || '#'});

  grid.innerHTML = items.length ? items.map(i => `
    <a class="contact-card" href="${i.href}" target="_blank" rel="noopener">
      <span class="label">${i.label}</span>
      <span class="value">${i.value}</span>
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
    <div class="pick-card" data-id="${s.id}" data-duration="${s.duration}">
      <h4>${s.name}</h4>
      <div class="price">${money(s.price)} · ${s.duration} min</div>
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
      <button class="slot-btn" data-time="${s}">${s}</button>
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

document.getElementById('confirmBooking').addEventListener('click', async () => {
  const name = document.getElementById('clientName').value.trim();
  const phone = document.getElementById('clientPhone').value.trim();
  const note = document.getElementById('clientNote').value.trim();
  const result = document.getElementById('bookingResult');
  const btn = document.getElementById('confirmBooking');

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
    result.innerHTML = `<div class="alert alert-success">Agendamento confirmado para ${state.selectedDate} às ${state.selectedTime}. Você vai receber a confirmação pelo contato informado.</div>`;
    btn.textContent = 'Confirmado ✓';
  }catch(err){
    console.error(err);
    result.innerHTML = `<div class="alert alert-error">Não foi possível confirmar — o horário pode ter acabado de ser ocupado. Volte e escolha outro.</div>`;
    btn.disabled = false;
    btn.textContent = 'Confirmar agendamento';
  }
});

/* ---------- Menu mobile ---------- */
document.getElementById('navToggle').addEventListener('click', () => {
  document.getElementById('navLinks').classList.toggle('open');
});
document.querySelectorAll('.nav-links a').forEach(a => a.addEventListener('click', () => {
  document.getElementById('navLinks').classList.remove('open');
}));

loadSite();
