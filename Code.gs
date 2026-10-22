/* ============================================================
   BarberNet — Backend (Google Apps Script)
   ------------------------------------------------------------
   Este script transforma uma Planilha Google em banco de dados
   e usa o Google Calendar para os agendamentos.

   COMO USAR — resumo (veja o GUIA-DE-CONFIGURACAO.md completo):
   1) Cole este arquivo em Extensões > Apps Script de uma planilha
      nova.
   2) Rode a função setup() uma vez (menu ▶ ao lado de "setup").
   3) Implantar > Nova implantação > Aplicativo da Web
      - Executar como: Eu
      - Quem pode acessar: Qualquer pessoa
   4) Copie a URL gerada para js/config.js (site) e para a tela
      de login do admin.html.
   ============================================================ */

const SHEET_CONFIG      = 'Config';
const SHEET_SERVICES    = 'Servicos';
const SHEET_HOURS       = 'Horarios';
const SHEET_EXCEPTIONS  = 'Excecoes';
const SHEET_BOOKINGS    = 'Agendamentos';

const SLOT_STEP_MINUTES = 30; // granularidade dos horários oferecidos

/* Colunas que precisam ficar em formato texto ('@') para o Sheets não
   converter "09:00" em Date, telefones/senhas em número etc.
   conv(v, tz): como normalizar o valor já existente na migração. */
const TEXT_COLUMNS = {
  [SHEET_CONFIG]:     [{ col:'B', conv:v => toStr_(v) }],
  [SHEET_HOURS]:      [{ col:'C', conv:(v,tz) => toHHmm_(v,tz) }, { col:'D', conv:(v,tz) => toHHmm_(v,tz) }],
  [SHEET_EXCEPTIONS]: [{ col:'B', conv:(v,tz) => toISODate_(v,tz) }, { col:'D', conv:(v,tz) => toHHmm_(v,tz) }, { col:'E', conv:(v,tz) => toHHmm_(v,tz) }],
  [SHEET_BOOKINGS]:   [{ col:'B', conv:(v,tz) => toISODate_(v,tz) }, { col:'C', conv:(v,tz) => toHHmm_(v,tz) }, { col:'H', conv:v => toStr_(v) }],
};

/* ============================================================
   SETUP — rode uma única vez pelo editor do Apps Script
   ============================================================ */
function setup(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(tz_()); // planilha e script no mesmo fuso

  applyTextFormats_(ensureSheet_(ss, SHEET_CONFIG, ['chave','valor']));
  ensureSheet_(ss, SHEET_SERVICES, ['id','nome','preco','duracao','ativo']);
  applyTextFormats_(ensureSheet_(ss, SHEET_HOURS, ['diaSemana','ativo','abre','fecha']));
  applyTextFormats_(ensureSheet_(ss, SHEET_EXCEPTIONS, ['id','data','tipo','abre','fecha','nota']));
  applyTextFormats_(ensureSheet_(ss, SHEET_BOOKINGS, ['id','data','hora','duracao','servicoId','servicoNome','nome','telefone','nota','status','eventoId','criadoEm']));

  // Config padrão (só cria se ainda não existir)
  const cfg = getConfigSheet_();
  const existing = readConfig_();
  const defaults = {
    name: existing.name || 'BarberNet',
    tagline: existing.tagline || 'Seu corte, <em>sem espera</em>.',
    lede: existing.lede || 'Veja os horários livres em tempo real e garanta seu lugar na cadeira.',
    whatsapp: existing.whatsapp || '',
    phone: existing.phone || '',
    instagram: existing.instagram || '',
    address: existing.address || '',
    mapLink: existing.mapLink || '',
    password: existing.password || Utilities.getUuid().slice(0,8),
    slotStepMinutes: existing.slotStepMinutes || String(SLOT_STEP_MINUTES),
  };

  // Cria a agenda dedicada, se ainda não existe
  let calendarId = existing.calendarId;
  if(!calendarId){
    const cal = CalendarApp.createCalendar(`${defaults.name} — Agendamentos`);
    calendarId = cal.getId();
  }
  defaults.calendarId = calendarId;

  Object.keys(defaults).forEach(k => setConfigValue_(k, defaults[k]));

  // Horários padrão: seg–sáb, 09:00–19:00 (só preenche se a aba estiver vazia)
  const hoursSheet = ss.getSheetByName(SHEET_HOURS);
  if(hoursSheet.getLastRow() < 2){
    const rows = [];
    for(let d=0; d<7; d++){
      const active = d !== 0; // fechado aos domingos por padrão
      rows.push([d, active, '09:00', '19:00']);
    }
    hoursSheet.getRange(2,1,rows.length,4).setValues(rows);
  }

  Logger.log('Setup concluído. Senha do painel: ' + defaults.password);
  Logger.log('Guarde essa senha — ela também fica na aba "Config".');
}

function ensureSheet_(ss, name, headers){
  let sheet = ss.getSheetByName(name);
  if(!sheet){
    sheet = ss.insertSheet(name);
  }
  if(sheet.getLastRow() === 0){
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/* Aplica formato texto às colunas de TEXT_COLUMNS (idempotente) */
function applyTextFormats_(sheet){
  (TEXT_COLUMNS[sheet.getName()] || []).forEach(({ col }) => {
    sheet.getRange(`${col}:${col}`).setNumberFormat('@');
  });
}

/* ============================================================
   MIGRAÇÃO — rode uma vez em planilhas criadas antes desta versão.
   Pode ser rodada de novo sem efeito colateral.
   ============================================================ */
function migrarFormatos(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Datas/horas antigas foram gravadas no fuso da planilha: lê esse fuso antes de mudar qualquer coisa
  const sheetTz = ss.getSpreadsheetTimeZone();
  Object.keys(TEXT_COLUMNS).forEach(name => {
    const sheet = ss.getSheetByName(name);
    if(!sheet){
      Logger.log(`${name}: aba não encontrada, ignorada.`);
      return;
    }
    const lastRow = sheet.getLastRow();
    let fixed = 0;
    TEXT_COLUMNS[name].forEach(({ col, conv }) => {
      if(lastRow < 2){ sheet.getRange(`${col}:${col}`).setNumberFormat('@'); return; }
      const range = sheet.getRange(`${col}2:${col}${lastRow}`);
      // Lê ANTES de mudar o formato, enquanto o valor ainda é Date/número
      const values = range.getValues();
      const out = values.map(([v]) => {
        let s = conv(v, sheetTz);
        if(s === '' && toStr_(v) !== ''){
          // não reconheceu o formato: preserva o texto em vez de apagar
          Logger.log(`${name}!${col}: valor não reconhecido mantido como texto: ${v}`);
          s = toStr_(v);
        }
        if(typeof v !== 'string' || s !== v) fixed++;
        return [s];
      });
      sheet.getRange(`${col}:${col}`).setNumberFormat('@');
      range.setValues(out);
    });
    Logger.log(`${name}: ${fixed} célula(s) corrigida(s).`);
  });
  // Só depois de tudo convertido para texto, alinha o fuso da planilha ao do script
  if(sheetTz !== tz_()){
    ss.setSpreadsheetTimeZone(tz_());
    Logger.log(`Fuso da planilha alterado de ${sheetTz} para ${tz_()}.`);
  }
}

/* ============================================================
   ROTEAMENTO HTTP
   ============================================================ */
function doGet(e){
  try{
    const action = e.parameter.action;
    let result;
    switch(action){
      case 'getPublicData': result = getPublicData_(); break;
      case 'getAvailability': result = getAvailability_(e.parameter.date, e.parameter.serviceId); break;
      // Ações administrativas só existem no doPost (token no corpo, nunca na URL)
      default: result = { error: 'AÇÃO_DESCONHECIDA' };
    }
    return jsonOutput_(result);
  }catch(err){
    return jsonOutput_({ error: String(err.message || err) });
  }
}

function doPost(e){
  try{
    const action = e.parameter.action;
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    let result;
    switch(action){
      case 'createBooking': result = createBooking_(body); break;
      case 'login': result = login_(body); break;
      case 'logout': result = logout_(body); break;
      case 'getAdminData': requireAuth_(body); result = getAdminData_(); break;
      case 'getBookings': requireAuth_(body); result = { bookings: listBookings_() }; break;
      case 'saveInfo': requireAuth_(body); result = saveInfo_(body); break;
      case 'addService': requireAuth_(body); result = addService_(body); break;
      case 'removeService': requireAuth_(body); result = removeService_(body.id); break;
      case 'saveHours': requireAuth_(body); result = saveHours_(body); break;
      case 'addException': requireAuth_(body); result = addException_(body); break;
      case 'removeException': requireAuth_(body); result = removeException_(body.id); break;
      case 'cancelBooking': requireAuth_(body); result = cancelBooking_(body.id); break;
      default: result = { error: 'AÇÃO_DESCONHECIDA' };
    }
    return jsonOutput_(result);
  }catch(err){
    return jsonOutput_({ error: String(err.message || err) });
  }
}

function jsonOutput_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
   SESSÃO DO PAINEL
   A senha só é aceita na ação 'login', que devolve um token
   temporário. As demais ações administrativas exigem o token.
   ============================================================ */
const SESSION_TTL_SECONDS  = 21600; // 6 h (máximo do CacheService)
const LOGIN_MAX_FAILS      = 5;
const LOGIN_BLOCK_SECONDS  = 600;   // 10 min
const LOGIN_FAIL_KEY       = 'login_fail';
const TOKEN_PATTERN        = /^[0-9a-f-]{36}$/i;

function login_(body){
  const cache = CacheService.getScriptCache();
  // Lock para o contador de falhas não perder incrementos com tentativas simultâneas
  const lock = LockService.getScriptLock();
  try{
    lock.waitLock(10000);
  }catch(err){
    return { error: 'SISTEMA_OCUPADO' };
  }
  try{
    const fails = Number(cache.get(LOGIN_FAIL_KEY)) || 0;
    if(fails >= LOGIN_MAX_FAILS) return { error: 'LOGIN_BLOQUEADO' };

    const cfg = readConfig_();
    const pass = toStr_(body.pass);
    const expected = toStr_(cfg.password);
    if(!expected || !pass || pass !== expected){
      // O contador expira sozinho 10 min após a última falha
      cache.put(LOGIN_FAIL_KEY, String(fails + 1), LOGIN_BLOCK_SECONDS);
      return { error: fails + 1 >= LOGIN_MAX_FAILS ? 'LOGIN_BLOQUEADO' : 'SENHA_INVALIDA' };
    }

    cache.remove(LOGIN_FAIL_KEY);
    const token = Utilities.getUuid();
    cache.put('sess_' + token, '1', SESSION_TTL_SECONDS);
    return { token };
  }finally{
    lock.releaseLock();
  }
}

function logout_(body){
  const token = toStr_(body.token);
  if(TOKEN_PATTERN.test(token)) CacheService.getScriptCache().remove('sess_' + token);
  return { ok:true };
}

function requireAuth_(body){
  const token = toStr_(body.token);
  if(!TOKEN_PATTERN.test(token) || !CacheService.getScriptCache().get('sess_' + token)){
    throw new Error('SESSAO_EXPIRADA');
  }
}

/* ============================================================
   CONFIG (chave/valor)
   ============================================================ */
function getConfigSheet_(){
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG);
}
function readConfig_(){
  const sheet = getConfigSheet_();
  if(!sheet) return {};
  const rows = sheet.getDataRange().getValues().slice(1);
  const cfg = {};
  rows.forEach(([k,v]) => { if(toStr_(k)) cfg[toStr_(k)] = toStr_(v); });
  return cfg;
}
function setConfigValue_(key, value){
  const sheet = getConfigSheet_();
  const rows = sheet.getDataRange().getValues();
  for(let i=1;i<rows.length;i++){
    if(rows[i][0] === key){
      sheet.getRange(i+1,2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

/* ============================================================
   SERVIÇOS
   ============================================================ */
function listServices_(){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SERVICES);
  const rows = sheet.getDataRange().getValues().slice(1);
  return rows.filter(r => r[0]).map(r => ({
    id: r[0], name: r[1], price: r[2], duration: Number(r[3]), active: r[4] !== false,
  }));
}
function addService_(body){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SERVICES);
  const id = Utilities.getUuid();
  sheet.appendRow([id, body.name, Number(body.price), Number(body.duration), true]);
  return { ok:true, id };
}
function removeService_(id){
  deleteRowById_(SHEET_SERVICES, id);
  return { ok:true };
}

/* ============================================================
   HORÁRIOS
   ============================================================ */
function listHours_(){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_HOURS);
  const rows = sheet.getDataRange().getValues().slice(1);
  return rows.map(r => ({ weekday:Number(r[0]), active:r[1]===true, open:toHHmm_(r[2]), close:toHHmm_(r[3]) }));
}
function saveHours_(body){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_HOURS);
  sheet.getRange(2,1,sheet.getLastRow()-1,4).clearContent();
  const rows = body.hours.map(h => [h.weekday, h.active, h.open, h.close]);
  sheet.getRange(2,1,rows.length,4).setValues(rows);
  return { ok:true };
}

/* ============================================================
   EXCEÇÕES (feriados / horário especial)
   ============================================================ */
function listExceptions_(){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_EXCEPTIONS);
  const rows = sheet.getDataRange().getValues().slice(1);
  return rows.filter(r => r[0]).map(r => ({
    id:toStr_(r[0]), date:toISODate_(r[1]), type:toStr_(r[2]), open:toHHmm_(r[3]), close:toHHmm_(r[4]), note:toStr_(r[5]),
  }));
}
function addException_(body){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_EXCEPTIONS);
  const id = Utilities.getUuid();
  sheet.appendRow([id, body.date, body.type, body.open || '', body.close || '', body.note || '']);
  return { ok:true, id };
}
function removeException_(id){
  deleteRowById_(SHEET_EXCEPTIONS, id);
  return { ok:true };
}

/* ============================================================
   AGENDAMENTOS
   ============================================================ */
function listBookings_(){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_BOOKINGS);
  const rows = sheet.getDataRange().getValues().slice(1);
  return rows.filter(r => r[0] && r[9] !== 'cancelado')
    .map(r => ({
      id:toStr_(r[0]), date:toISODate_(r[1]), time:toHHmm_(r[2]), duration:Number(r[3]),
      serviceId:toStr_(r[4]), serviceName:toStr_(r[5]), name:toStr_(r[6]), phone:toStr_(r[7]), note:toStr_(r[8]), status:toStr_(r[9]),
    }))
    .sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time));
}

const MAX_DAYS_AHEAD = 60;          // agendamento até 60 dias à frente
const MAX_FUTURE_BOOKINGS_PER_PHONE = 2;

function createBooking_(body){
  const serviceId = toStr_(body.serviceId);
  const date = toStr_(body.date);
  const time = toStr_(body.time);
  const name = String(body.name == null ? '' : body.name).trim().slice(0, 60);
  const phone = String(body.phone == null ? '' : body.phone).trim().slice(0, 20);
  const note = String(body.note == null ? '' : body.note).trim().slice(0, 200);
  if(!name || !phone){
    return { error: 'DADOS_INVALIDOS' };
  }
  if(!serviceId || !date || !time){
    return { error: 'DADOS_INCOMPLETOS' };
  }
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)){
    return { error: 'DADOS_INVALIDOS' };
  }
  const maxDate = Utilities.formatDate(new Date(Date.now() + MAX_DAYS_AHEAD*86400000), tz_(), 'yyyy-MM-dd');
  if(date < todayISO_() || date > maxDate){
    return { error: 'DATA_FORA_DO_PERIODO' };
  }
  const phoneDigits = phone.replace(/\D/g, '');
  if(phoneDigits.length < 10 || phoneDigits.length > 13){
    return { error: 'DADOS_INVALIDOS' };
  }
  const services = listServices_();
  const service = services.find(s => s.id === serviceId);
  if(!service) return { error: 'SERVICO_NAO_ENCONTRADO' };

  // Uma confirmação por vez: sem o lock, duas requisições simultâneas poderiam
  // ver o mesmo horário livre e gravar as duas.
  const lock = LockService.getScriptLock();
  try{
    lock.waitLock(10000);
  }catch(err){
    return { error: 'SISTEMA_OCUPADO' };
  }
  try{
    // Anti-spam dentro do lock, para que dois pedidos simultâneos do mesmo telefone não passem juntos
    const nowKey = `${todayISO_()} ${Utilities.formatDate(new Date(), tz_(), 'HH:mm')}`;
    const futureForPhone = listBookings_().filter(b =>
      b.status === 'confirmado' &&
      `${b.date} ${b.time}` >= nowKey &&
      b.phone.replace(/\D/g, '') === phoneDigits
    ).length;
    if(futureForPhone >= MAX_FUTURE_BOOKINGS_PER_PHONE){
      return { error: 'LIMITE_DE_AGENDAMENTOS' };
    }

    // Revalida disponibilidade no momento da confirmação (evita choque de horário)
    const avail = getAvailability_(date, serviceId);
    if(avail.closed || !(avail.slots || []).includes(time)){
      return { error: 'HORARIO_INDISPONIVEL' };
    }

    const cfg = readConfig_();
    const start = new Date(`${date}T${toHHmm_(time)}:00`);
    const end = new Date(start.getTime() + service.duration * 60000);

    let eventId = '';
    try{
      const cal = CalendarApp.getCalendarById(cfg.calendarId);
      const event = cal.createEvent(`${service.name} — ${name}`, start, end, {
        description: `Cliente: ${name}\nTelefone: ${phone}\nObservação: ${note || '-'}`,
      });
      eventId = event.getId();
    }catch(err){
      // segue mesmo se a agenda falhar — o agendamento na planilha é a fonte da verdade
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_BOOKINGS);
    const id = Utilities.getUuid();
    sheet.appendRow([id, date, time, service.duration, service.id, service.name, name, phone, note || '', 'confirmado', eventId, new Date()]);
    SpreadsheetApp.flush(); // grava antes de liberar o lock, para o próximo já enxergar esta linha
    return { ok:true, id };
  }finally{
    lock.releaseLock();
  }
}

function cancelBooking_(id){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_BOOKINGS);
  const rows = sheet.getDataRange().getValues();
  for(let i=1;i<rows.length;i++){
    if(rows[i][0] === id){
      sheet.getRange(i+1,10).setValue('cancelado');
      const eventId = rows[i][10];
      if(eventId){
        try{
          const cfg = readConfig_();
          const cal = CalendarApp.getCalendarById(cfg.calendarId);
          cal.getEventById(eventId).deleteEvent();
        }catch(err){ /* evento pode já não existir */ }
      }
      return { ok:true };
    }
  }
  return { error: 'AGENDAMENTO_NAO_ENCONTRADO' };
}

/* ============================================================
   DISPONIBILIDADE
   ============================================================ */
function getAvailability_(dateStr, serviceId){
  if(!dateStr) return { error:'DATA_OBRIGATORIA' };
  const services = listServices_();
  const service = services.find(s => s.id === serviceId) || { duration: SLOT_STEP_MINUTES };
  const duration = service.duration;

  const date = new Date(`${dateStr}T00:00:00`);
  const weekday = date.getDay();

  const exceptions = listExceptions_();
  const exception = exceptions.find(e => e.date === dateStr);

  let open, close, closedReason = null;
  if(exception){
    if(exception.type === 'closed'){
      closedReason = exception.note || 'Fechado nesta data';
    }else{
      open = exception.open; close = exception.close;
    }
  }else{
    const hours = listHours_().find(h => h.weekday === weekday);
    if(!hours || !hours.active){
      closedReason = 'Fechado neste dia da semana';
    }else{
      open = hours.open; close = hours.close;
    }
  }

  if(closedReason){
    return { closed:true, reason:closedReason };
  }

  const candidates = buildSlotCandidates_(dateStr, open, close, duration);
  const busy = getBusyRanges_(dateStr);
  const now = new Date();

  const free = candidates.filter(slot => {
    if(slot.start < now) return false; // não oferece horário que já passou
    return !busy.some(b => slot.start < b.end && slot.end > b.start);
  }).map(s => s.label);

  return { slots: free };
}

function buildSlotCandidates_(dateStr, open, close, duration){
  open = toHHmm_(open); close = toHHmm_(close);
  if(!open || !close) return [];
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const openTime = new Date(dayStart); openTime.setHours(oh, om, 0, 0);
  const closeTime = new Date(dayStart); closeTime.setHours(ch, cm, 0, 0);

  const slots = [];
  let cursor = new Date(openTime);
  while(true){
    const end = new Date(cursor.getTime() + duration*60000);
    if(end > closeTime) break;
    slots.push({ start:new Date(cursor), end, label: Utilities.formatDate(cursor, tz_(), 'HH:mm') });
    cursor = new Date(cursor.getTime() + SLOT_STEP_MINUTES*60000);
  }
  return slots;
}

function getBusyRanges_(dateStr){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_BOOKINGS);
  const rows = sheet.getDataRange().getValues().slice(1);
  return rows
    .filter(r => r[0] && r[1] && toStr_(r[9]) !== 'cancelado' && toISODate_(r[1]) === dateStr)
    .map(r => {
      const time = toHHmm_(r[2]);
      if(!time){
        // hora ilegível: bloqueia o dia inteiro para não permitir agendamento duplo
        Logger.log(`Agendamento ${r[0]} com hora inválida: ${r[2]}`);
        const start = new Date(`${dateStr}T00:00:00`);
        return { start, end: new Date(start.getTime() + 86400000) };
      }
      const start = new Date(`${dateStr}T${time}:00`);
      const end = new Date(start.getTime() + Number(r[3])*60000);
      return { start, end };
    });
}

/* ============================================================
   DADOS PÚBLICOS / ADMIN
   ============================================================ */
function getPublicData_(){
  const cfg = readConfig_();
  const services = listServices_();
  const hours = listHours_();
  const exceptions = listExceptions_()
    .filter(e => e.date >= todayISO_())
    .slice(0,5)
    .map(e => ({ ...e, dateLabel: formatDateLabel_(e.date) }));

  const status = computeOpenStatus_(hours, listExceptions_());
  const nextSlots = computeNextSlots_(services, hours);

  return {
    name: cfg.name, tagline: cfg.tagline, lede: cfg.lede,
    whatsapp: cfg.whatsapp, phone: cfg.phone, instagram: cfg.instagram,
    address: cfg.address, mapLink: cfg.mapLink,
    services, hours, exceptions,
    openNow: status.openNow, closesAt: status.closesAt, opensAt: status.opensAt, opensAtLabel: status.opensAtLabel,
    nextSlots: nextSlots.slots, nextSlotsDateLabel: nextSlots.dateLabel,
  };
}

function getAdminData_(){
  const cfg = readConfig_();
  let sheetsOk = true, calendarOk = true;
  try{ SpreadsheetApp.getActiveSpreadsheet(); }catch(e){ sheetsOk = false; }
  try{ CalendarApp.getCalendarById(cfg.calendarId).getName(); }catch(e){ calendarOk = false; }

  return {
    name: cfg.name, tagline: cfg.tagline, lede: cfg.lede,
    whatsapp: cfg.whatsapp, phone: cfg.phone, instagram: cfg.instagram,
    address: cfg.address, mapLink: cfg.mapLink,
    services: listServices_(), hours: listHours_(),
    exceptions: listExceptions_().map(e => ({ ...e, dateLabel: formatDateLabel_(e.date) })),
    sheetsOk, calendarOk,
  };
}

function saveInfo_(body){
  ['name','tagline','lede','whatsapp','phone','instagram','address','mapLink'].forEach(k => {
    if(body[k] !== undefined) setConfigValue_(k, body[k]);
  });
  return { ok:true };
}

/* ============================================================
   UTILITÁRIOS
   ============================================================ */
function deleteRowById_(sheetName, id){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  const rows = sheet.getDataRange().getValues();
  for(let i=1;i<rows.length;i++){
    if(rows[i][0] === id){ sheet.deleteRow(i+1); return; }
  }
}
/* Fuso único do sistema (definido em appsscript.json) */
function tz_(){
  return Session.getScriptTimeZone();
}
function toStr_(v){
  return String(v ?? '').trim();
}
/* Date → 'HH:mm'; '9:00' / '09:00:00' → '09:00'; qualquer outra coisa → ''.
   tz opcional: usado só por migrarFormatos() para ler valores antigos no fuso da planilha. */
function toHHmm_(v, tz){
  if(v instanceof Date) return isNaN(v) ? '' : Utilities.formatDate(v, tz || tz_(), 'HH:mm');
  if(typeof v === 'string'){
    const m = v.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if(!m || Number(m[1]) > 23 || Number(m[2]) > 59) return '';
    return `${m[1].padStart(2,'0')}:${m[2]}`;
  }
  return '';
}
/* Date → 'yyyy-MM-dd'; string → como está */
function toISODate_(v, tz){
  if(v instanceof Date) return isNaN(v) ? '' : Utilities.formatDate(v, tz || tz_(), 'yyyy-MM-dd');
  return toStr_(v);
}
function formatDateLabel_(dateStr){
  const d = new Date(`${dateStr}T00:00:00`);
  return Utilities.formatDate(d, tz_(), 'dd/MM (EEEE)');
}
function todayISO_(){
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

function computeOpenStatus_(hours, exceptions){
  const now = new Date();
  const dateStr = todayISO_();
  const exception = exceptions.find(e => e.date === dateStr);
  let open, close, closedToday = false;

  if(exception){
    if(exception.type === 'closed'){ closedToday = true; }
    else{ open = toHHmm_(exception.open); close = toHHmm_(exception.close); }
  }else{
    const h = hours.find(x => x.weekday === now.getDay());
    if(!h || !h.active){ closedToday = true; }
    else{ open = toHHmm_(h.open); close = toHHmm_(h.close); }
  }

  if(!closedToday && open && close){
    const [oh,om] = open.split(':').map(Number);
    const [ch,cm] = close.split(':').map(Number);
    const openTime = new Date(now); openTime.setHours(oh,om,0,0);
    const closeTime = new Date(now); closeTime.setHours(ch,cm,0,0);
    if(now >= openTime && now <= closeTime){
      return { openNow:true, closesAt: close };
    }
    if(now < openTime){
      return { openNow:false, opensAt: open, opensAtLabel: 'hoje' };
    }
  }

  // Fechado — procura a próxima abertura nos próximos 7 dias
  for(let i=1;i<=7;i++){
    const d = new Date(now.getTime() + i*86400000);
    const ds = Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
    const exc = exceptions.find(e => e.date === ds);
    if(exc){
      if(exc.type === 'closed') continue;
      return { openNow:false, opensAt: toHHmm_(exc.open), opensAtLabel: formatDateLabel_(ds) };
    }
    const h = hours.find(x => x.weekday === d.getDay());
    if(h && h.active){
      return { openNow:false, opensAt: toHHmm_(h.open), opensAtLabel: i===1 ? 'amanhã' : formatDateLabel_(ds) };
    }
  }
  return { openNow:false };
}

function computeNextSlots_(services, hours){
  const active = services.filter(s => s.active !== false);
  if(!active.length) return { slots: [], dateLabel: '' };
  const shortest = active.reduce((min,s) => s.duration < min.duration ? s : min, active[0]);

  for(let i=0;i<7;i++){
    const d = new Date(Date.now() + i*86400000);
    const ds = Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
    const avail = getAvailability_(ds, shortest.id);
    if(!avail.closed && avail.slots && avail.slots.length){
      const label = i===0 ? 'hoje' : (i===1 ? 'amanhã' : formatDateLabel_(ds));
      return {
        slots: avail.slots.slice(0,3).map(t => ({ time:t, dateLabel: label })),
        dateLabel: label,
      };
    }
  }
  return { slots: [], dateLabel: '' };
}
