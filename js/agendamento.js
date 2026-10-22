/* ============================================================
   BarberNet — Página do agendamento do cliente (link pessoal)
   O token vem do hash (#TOKEN), que não é enviado ao servidor
   da página nem aparece em logs de acesso do site.
   ============================================================ */

const STATUS_LABELS = {
  confirmado: 'Agendado',
  cancelado: 'Cancelado',
  concluido: 'Concluído',
  faltou: 'Não compareceu',
};

const manage = {
  token: location.hash.slice(1).trim().toLowerCase(),
  booking: null,
  busy: false,
};

async function bookingApi(action, method = 'GET'){
  if(!APP_SCRIPT_URL) throw new Error('NOT_CONNECTED');
  let url = `${APP_SCRIPT_URL}?action=${encodeURIComponent(action)}`;
  const opts = { method };
  if(method === 'GET'){
    url += `&token=${encodeURIComponent(manage.token)}`;
  }else{
    opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' }; // evita preflight CORS no Apps Script
    opts.body = JSON.stringify({ token: manage.token });
  }
  const res = await fetch(url, opts);
  if(!res.ok) throw new Error('REQUEST_FAILED');
  const json = await res.json();
  if(json.error) throw new Error(json.error);
  return json;
}

/* Horário passado no relógio do cliente (o servidor confere de novo nas ações) */
function isPast(b){
  const [y, m, d] = b.date.split('-').map(Number);
  const [hh, mm] = b.time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm) <= new Date();
}

function whatsappButton(b){
  const digits = String(b.shopWhatsapp || '').replace(/\D/g, '');
  if(!digits) return '';
  return `<a class="btn btn-ghost btn-block" href="https://wa.me/${esc(digits)}" target="_blank" rel="noopener">Falar com a barbearia no WhatsApp</a>`;
}

function detailsList(b, statusLabel){
  return `
    <dl class="booking-dialog-details">
      ${b.shopName ? `<div><dt>Barbearia</dt><dd>${esc(b.shopName)}</dd></div>` : ''}
      <div><dt>Serviço</dt><dd>${esc(b.serviceName)}</dd></div>
      <div><dt>Data</dt><dd>${esc(formatDateLong(b.date))}</dd></div>
      <div><dt>Horário</dt><dd>${esc(b.time)}</dd></div>
      <div><dt>Status</dt><dd>${esc(statusLabel)}</dd></div>
    </dl>`;
}

function renderInvalid(){
  document.getElementById('manageBox').innerHTML = `
    <h1>Link inválido</h1>
    <div class="alert alert-error">Não encontramos este agendamento. Confira se o link foi copiado inteiro.</div>
    <div class="manage-actions">
      <a class="btn btn-primary btn-block" href="index.html#agendar">Agendar um horário</a>
    </div>`;
}

function renderLoadError(){
  document.getElementById('manageBox').innerHTML = `
    <h1>Meu agendamento</h1>
    <div class="alert alert-error">Não foi possível carregar o agendamento agora. Tente novamente em instantes.</div>
    <div class="manage-actions">
      <button type="button" class="btn btn-primary btn-block" id="retryBtn">Tentar de novo</button>
    </div>`;
  document.getElementById('retryBtn').addEventListener('click', loadBooking);
}

function renderBooking(message){
  const b = manage.booking;
  const box = document.getElementById('manageBox');
  const past = isPast(b);
  const active = b.status === 'confirmado' && !past;
  const alert = message ? `<div class="alert alert-error">${esc(message)}</div>` : '';

  if(b.status === 'cancelado'){
    box.innerHTML = `
      <h1>Agendamento cancelado</h1>
      ${detailsList(b, STATUS_LABELS.cancelado)}
      <p class="field-hint" style="margin:0 0 18px">Este horário foi liberado.</p>
      <div class="manage-actions">
        <a class="btn btn-primary btn-block" href="index.html#agendar">Agendar novo horário</a>
        ${whatsappButton(b)}
      </div>`;
    return;
  }

  if(!active){
    // concluído, faltou ou horário já passou
    const label = b.status === 'confirmado' ? 'Horário encerrado' : (STATUS_LABELS[b.status] || b.status);
    box.innerHTML = `
      <h1>${b.status === 'concluido' ? 'Atendimento concluído' : 'Este horário já passou'}</h1>
      ${alert}
      ${detailsList(b, label)}
      <div class="manage-actions">
        <a class="btn btn-primary btn-block" href="index.html#agendar">Agendar novo horário</a>
        ${whatsappButton(b)}
      </div>`;
    return;
  }

  box.innerHTML = `
    <h1>Seu agendamento</h1>
    ${b.presencaConfirmada ? `<div class="seal">✓ Presença confirmada</div>` : ''}
    ${alert}
    ${detailsList(b, STATUS_LABELS.confirmado)}
    <div class="manage-actions">
      ${b.presencaConfirmada ? '' : `<button type="button" class="btn btn-primary btn-block" id="confirmBtn">Confirmar presença</button>`}
      <button type="button" class="btn btn-ghost btn-block" id="cancelBtn">Cancelar agendamento</button>
      ${whatsappButton(b)}
    </div>`;

  const confirmBtn = document.getElementById('confirmBtn');
  if(confirmBtn) confirmBtn.addEventListener('click', () => runAction('confirmPresence', confirmBtn, 'Confirmando…'));
  const cancelBtn = document.getElementById('cancelBtn');
  cancelBtn.addEventListener('click', () => {
    if(!confirm('Tem certeza? O horário será liberado para outra pessoa.')) return;
    runAction('cancelByClient', cancelBtn, 'Cancelando…');
  });
}

const ACTION_ERRORS = {
  PRAZO_ENCERRADO: 'O horário deste agendamento já passou.',
  AGENDAMENTO_INATIVO: 'Este agendamento não está mais ativo.',
  SISTEMA_OCUPADO: 'O sistema está ocupado no momento. Tente novamente em alguns segundos.',
};

async function runAction(action, btn, busyText){
  if(manage.busy) return;
  manage.busy = true;
  document.querySelectorAll('#manageBox button').forEach(b => b.disabled = true);
  btn.textContent = busyText;
  let message = '';
  try{
    await bookingApi(action, 'POST');
  }catch(err){
    console.error(err);
    if(err.message === 'AGENDAMENTO_NAO_ENCONTRADO'){
      manage.busy = false;
      renderInvalid();
      return;
    }
    message = ACTION_ERRORS[err.message] || 'Não foi possível concluir agora. Tente novamente em instantes.';
  }
  // Recarrega do servidor para mostrar o estado real (cancelado, confirmado, encerrado…)
  try{
    manage.booking = await bookingApi('getBookingByToken');
  }catch(err){
    console.error(err);
  }
  manage.busy = false;
  renderBooking(message);
}

function renderBrand(b){
  if(!b.shopName) return;
  document.title = `Meu agendamento — ${b.shopName}`;
  document.getElementById('brandName').textContent = b.shopName;
  document.getElementById('footerBrand').textContent = `© ${new Date().getFullYear()} ${b.shopName}`;
}

async function loadBooking(){
  if(!/^[0-9a-f]{64}$/.test(manage.token)){
    renderInvalid();
    return;
  }
  try{
    manage.booking = await bookingApi('getBookingByToken');
    renderBrand(manage.booking);
    renderBooking();
  }catch(err){
    console.error(err);
    if(err.message === 'AGENDAMENTO_NAO_ENCONTRADO') renderInvalid();
    else renderLoadError();
  }
}

window.addEventListener('hashchange', () => {
  manage.token = location.hash.slice(1).trim().toLowerCase();
  loadBooking();
});

loadBooking();
