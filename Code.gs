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

/* Cabeçalho da aba Agendamentos. Colunas novas entram SEMPRE no final
   (planilhas antigas recebem as que faltam via migrarAgendamentosV2). */
const BOOKING_HEADERS = [
  'id','data','hora','duracao','servicoId','servicoNome','nome','telefone','nota','status','eventoId','criadoEm',
  'preco','token','aceitaWhatsapp','presencaConfirmadaEm','canceladoPor','valorCobrado','formaPagamento','concluidoEm','lembreteEnviadoEm',
];
/* Status: 'confirmado' (agendado e ativo), 'cancelado', 'concluido', 'faltou' */
/* Só estes liberam o horário. Qualquer outro status — inclusive vazio ou digitado
   errado — ocupa, para nunca permitir agendamento duplo por engano. */
const FREE_STATUSES = ['cancelado', 'faltou'];

/* Lembretes pelo WhatsApp (enviados pelo dono a partir do painel) */
const REMINDER_HOURS_OPTIONS = [2, 3, 6, 12, 24, 48];
const REMINDER_HOURS_DEFAULT = 24;
const REMINDER_TEMPLATE_MAX = 1000;
const REMINDER_TEMPLATE_DEFAULT =
  'Olá, {nome}! Passando para lembrar do seu horário na {barbearia}:\n' +
  '{servico} — {data} às {hora}.\n' +
  '\n' +
  'Confirme sua presença pelo link abaixo. Se não puder vir, cancele por lá mesmo, assim liberamos o horário para outra pessoa:\n' +
  '{link}';
const WEEKDAYS_PT = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];

/* Colunas (pelo nome do cabeçalho) que precisam ficar em formato texto ('@')
   para o Sheets não converter "09:00" em Date, telefones/senhas em número etc.
   conv(v, tz): como normalizar o valor já existente na migração. */
const TEXT_COLUMNS = {
  [SHEET_CONFIG]:     [{ col:'valor', conv:v => toStr_(v) }],
  [SHEET_HOURS]:      [{ col:'abre', conv:(v,tz) => toHHmm_(v,tz) }, { col:'fecha', conv:(v,tz) => toHHmm_(v,tz) }],
  [SHEET_EXCEPTIONS]: [{ col:'data', conv:(v,tz) => toISODate_(v,tz) }, { col:'abre', conv:(v,tz) => toHHmm_(v,tz) }, { col:'fecha', conv:(v,tz) => toHHmm_(v,tz) }],
  [SHEET_BOOKINGS]:   [
    { col:'data', conv:(v,tz) => toISODate_(v,tz) }, { col:'hora', conv:(v,tz) => toHHmm_(v,tz) }, { col:'telefone', conv:v => toStr_(v) },
    { col:'token', conv:v => toStr_(v) }, { col:'canceladoPor', conv:v => toStr_(v) }, { col:'formaPagamento', conv:v => toStr_(v) },
  ],
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
  const bookings = ensureSheet_(ss, SHEET_BOOKINGS, BOOKING_HEADERS);
  ensureColumns_(bookings, BOOKING_HEADERS);
  applyTextFormats_(bookings);

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
    siteUrl: existing.siteUrl || '', // o painel sugere o endereço; aqui não há como descobrir
    reminderHoursBefore: existing.reminderHoursBefore || String(REMINDER_HOURS_DEFAULT),
    reminderTemplate: existing.reminderTemplate || REMINDER_TEMPLATE_DEFAULT,
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
  const c = cols_(sheet);
  (TEXT_COLUMNS[sheet.getName()] || []).forEach(({ col }) => {
    if(c[col] === undefined) return;
    sheet.getRange(1, c[col] + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
  });
}

/* Mapeia o cabeçalho da aba para índices (base 0): { id:0, data:1, ... } */
function cols_(sheet){
  const c = {};
  const lastCol = sheet.getLastColumn();
  if(!lastCol) return c;
  sheet.getRange(1, 1, 1, lastCol).getValues()[0].forEach((h, i) => {
    const name = toStr_(h);
    if(name && c[name] === undefined) c[name] = i;
  });
  return c;
}

/* Garante que as colunas usadas existem; senão a planilha precisa da migração */
function requireCols_(c, names){
  const missing = names.filter(n => c[n] === undefined);
  if(missing.length){
    Logger.log(`Colunas ausentes em ${SHEET_BOOKINGS}: ${missing.join(', ')} — rode migrarAgendamentosV2()`);
    throw new Error('PLANILHA_DESATUALIZADA');
  }
  return c;
}

/* Acrescenta AO FINAL as colunas do cabeçalho que faltarem. Retorna os nomes adicionados. */
function ensureColumns_(sheet, headers){
  const c = cols_(sheet);
  const missing = headers.filter(h => c[h] === undefined);
  if(missing.length){
    sheet.getRange(1, sheet.getLastColumn() + 1, 1, missing.length).setValues([missing]);
  }
  return missing;
}

function getBookingsSheet_(){
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_BOOKINGS);
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
    const c = cols_(sheet);
    let fixed = 0;
    TEXT_COLUMNS[name].forEach(({ col, conv }) => {
      if(c[col] === undefined){
        Logger.log(`${name}: coluna ${col} não encontrada, ignorada.`);
        return;
      }
      const colRange = sheet.getRange(1, c[col] + 1, sheet.getMaxRows(), 1);
      if(lastRow < 2){ colRange.setNumberFormat('@'); return; }
      const range = sheet.getRange(2, c[col] + 1, lastRow - 1, 1);
      // Lê ANTES de mudar o formato, enquanto o valor ainda é Date/número
      const values = range.getValues();
      const out = values.map(([v]) => {
        let s = conv(v, sheetTz);
        if(s === '' && toStr_(v) !== ''){
          // não reconheceu o formato: preserva o texto em vez de apagar
          Logger.log(`${name}.${col}: valor não reconhecido mantido como texto: ${v}`);
          s = toStr_(v);
        }
        if(typeof v !== 'string' || s !== v) fixed++;
        return [s];
      });
      colRange.setNumberFormat('@');
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

/* Agendamentos V2: colunas de status/preço/token. Idempotente: pode rodar de novo. */
function migrarAgendamentosV2(){
  const sheet = getBookingsSheet_();
  if(!sheet){
    Logger.log(`${SHEET_BOOKINGS}: aba não encontrada. Rode setup() primeiro.`);
    return;
  }
  const added = ensureColumns_(sheet, BOOKING_HEADERS);
  Logger.log(added.length ? `Colunas adicionadas: ${added.join(', ')}` : 'Nenhuma coluna nova.');
  applyTextFormats_(sheet);

  const c = cols_(sheet);
  const lastRow = sheet.getLastRow();
  if(lastRow < 2){
    Logger.log('Nenhum agendamento para atualizar.');
    return;
  }
  const rows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const prices = {};
  listServices_().forEach(s => prices[toStr_(s.id)] = s.price);
  const now = new Date();

  let priceFilled = 0, tokensCreated = 0, changedRows = 0;
  const priceCol = [], tokenCol = [];
  rows.forEach(r => {
    let changed = false;
    let price = r[c.preco];
    if(toStr_(price) === '' && toStr_(r[c.id])){
      const current = prices[toStr_(r[c.servicoId])];
      if(current !== undefined && toStr_(current) !== ''){
        price = Number(current);
        priceFilled++; changed = true;
      }
    }
    let token = toStr_(r[c.token]);
    if(!token && toStr_(r[c.id]) && toStr_(r[c.status]) === 'confirmado'){
      const start = bookingStart_(toISODate_(r[c.data]), toHHmm_(r[c.hora]));
      if(start && start > now){
        token = newBookingToken_();
        tokensCreated++; changed = true;
      }
    }
    if(changed) changedRows++;
    priceCol.push([price]);
    tokenCol.push([token]);
  });
  sheet.getRange(2, c.preco + 1, rows.length, 1).setValues(priceCol);
  sheet.getRange(2, c.token + 1, rows.length, 1).setValues(tokenCol);
  SpreadsheetApp.flush();
  Logger.log(`${changedRows} linha(s) alterada(s): ${priceFilled} preço(s) preenchido(s), ${tokensCreated} token(s) gerado(s).`);
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
      case 'getBookingByToken': result = getBookingByToken_(e.parameter.token); break;
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
      case 'confirmPresence': result = confirmPresence_(body); break;
      case 'cancelByClient': result = cancelByClient_(body); break;
      case 'login': result = login_(body); break;
      case 'logout': result = logout_(body); break;
      case 'getAdminData': requireAuth_(body); result = getAdminData_(); break;
      case 'getBookings': requireAuth_(body); result = getBookings_(body.view); break;
      case 'completeBooking': requireAuth_(body); result = completeBooking_(body); break;
      case 'markNoShow': requireAuth_(body); result = markNoShow_(body); break;
      case 'reopenBooking': requireAuth_(body); result = reopenBooking_(body); break;
      case 'getReminders': requireAuth_(body); result = getReminders_(); break;
      case 'markReminderSent': requireAuth_(body); result = markReminderSent_(body); break;
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
/* Lê a aba Agendamentos UMA vez e normaliza cada linha pelo nome da coluna.
   Campos internos (nunca vão ao navegador): start, rowNumber, eventId, token.
   As colunas da V2 são opcionais aqui, para listar mesmo antes de migrarAgendamentosV2. */
function readBookingsSheet_(){
  const sheet = getBookingsSheet_();
  const c = requireCols_(cols_(sheet), ['id','data','hora','duracao','servicoId','servicoNome','nome','telefone','nota','status']);
  const get = (r, name) => c[name] === undefined ? '' : r[c[name]];
  const rows = sheet.getDataRange().getValues();
  const bookings = [];
  for(let i=1;i<rows.length;i++){
    const r = rows[i];
    if(!r[c.id]) continue;
    const date = toISODate_(r[c.data]);
    const time = toHHmm_(r[c.hora]);
    bookings.push({
      id: toStr_(r[c.id]), date, time, duration: Number(r[c.duracao]),
      serviceId: toStr_(r[c.servicoId]), serviceName: toStr_(r[c.servicoNome]),
      name: toStr_(r[c.nome]), phone: toStr_(r[c.telefone]), note: toStr_(r[c.nota]),
      status: toStr_(r[c.status]).toLowerCase(),
      preco: toNumberOrEmpty_(get(r, 'preco')),
      valorCobrado: toNumberOrEmpty_(get(r, 'valorCobrado')),
      formaPagamento: toStr_(get(r, 'formaPagamento')),
      presencaConfirmada: toStr_(get(r, 'presencaConfirmadaEm')) !== '',
      aceitaWhatsapp: toBool_(get(r, 'aceitaWhatsapp')),
      canceladoPor: toStr_(get(r, 'canceladoPor')),
      concluidoEm: toIsoDateTime_(get(r, 'concluidoEm')),
      lembreteEnviadoEm: toIsoDateTime_(get(r, 'lembreteEnviadoEm')),
      start: bookingStart_(date, time),
      rowNumber: i + 1,
      eventId: toStr_(get(r, 'eventoId')),
      token: toStr_(get(r, 'token')),
    });
  }
  return { sheet, c, bookings };
}
function readBookings_(){
  return readBookingsSheet_().bookings;
}

/* Remove os campos internos antes de enviar ao painel */
function publicBooking_(b){
  const { start, rowNumber, eventId, token, ...rest } = b;
  return rest;
}

function listBookings_(){
  return readBookings_()
    .filter(b => b.status !== 'cancelado')
    .map(b => ({
      id:b.id, date:b.date, time:b.time, duration:b.duration,
      serviceId:b.serviceId, serviceName:b.serviceName, name:b.name,
      phone:b.phone, note:b.note, status:b.status,
    }))
    .sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time));
}

/* Grava uma linha montada pelo nome das colunas (as não informadas ficam vazias) */
function appendBooking_(sheet, c, values){
  const row = new Array(sheet.getLastColumn()).fill('');
  Object.keys(values).forEach(k => { row[c[k]] = values[k]; });
  sheet.appendRow(row);
}

/* Token do link pessoal do cliente: 64 caracteres hexadecimais */
const BOOKING_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
function newBookingToken_(){
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

/* Início do agendamento no fuso do script; null se data/hora ilegíveis */
function bookingStart_(dateStr, timeStr){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !timeStr) return null;
  const d = new Date(`${dateStr}T${timeStr}:00`);
  return isNaN(d) ? null : d;
}

/* Executa fn com o lock do script (o mesmo do createBooking_) */
function withScriptLock_(fn){
  const lock = LockService.getScriptLock();
  try{
    lock.waitLock(10000);
  }catch(err){
    return { error: 'SISTEMA_OCUPADO' };
  }
  try{
    return fn();
  }finally{
    lock.releaseLock();
  }
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
  const aceitaWhatsapp = body.aceitaWhatsapp === true;
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

  const sheet = getBookingsSheet_();
  const c = requireCols_(cols_(sheet), BOOKING_HEADERS);

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
    const futureForPhone = readBookings_().filter(b =>
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

    const id = Utilities.getUuid();
    const token = newBookingToken_();
    // Preço congelado: vale o do serviço no momento do agendamento
    appendBooking_(sheet, c, {
      id, data: date, hora: time, duracao: service.duration, servicoId: service.id, servicoNome: service.name,
      nome: name, telefone: phone, nota: note || '', status: 'confirmado', eventoId: eventId, criadoEm: new Date(),
      preco: Number(service.price), token, aceitaWhatsapp,
    });
    SpreadsheetApp.flush(); // grava antes de liberar o lock, para o próximo já enxergar esta linha
    return { ok:true, id, token };
  }finally{
    lock.releaseLock();
  }
}

function cancelBooking_(id){
  return updateBookingById_(id, (b, ctx) => {
    if(b.status !== 'confirmado') return { error: 'ACAO_INVALIDA_PARA_STATUS' };
    cancelBookingRow_(ctx.sheet, ctx.c, b.rowNumber, b.eventId, 'dono');
    return { ok:true };
  });
}

/* Marca a linha como cancelada e remove o evento da agenda */
function cancelBookingRow_(sheet, c, rowNumber, eventId, by){
  writeBookingCells_(sheet, c, rowNumber, { status: 'cancelado', canceladoPor: by });
  if(eventId){
    try{
      const cfg = readConfig_();
      const cal = CalendarApp.getCalendarById(cfg.calendarId);
      cal.getEventById(eventId).deleteEvent();
    }catch(err){ /* evento pode já não existir */ }
  }
}

/* ============================================================
   BAIXA DE ATENDIMENTOS (painel)
   ============================================================ */
const BOOKING_VIEWS = ['hoje', 'proximos', 'pendentes', 'historico'];
const HISTORY_STATUSES = ['concluido', 'faltou', 'cancelado'];
const PAYMENT_METHODS = ['dinheiro', 'pix', 'debito', 'credito', 'outro'];
const MAX_CHARGE = 10000;

function isoDaysFromToday_(n){
  return Utilities.formatDate(new Date(Date.now() + n*86400000), tz_(), 'yyyy-MM-dd');
}

/* 'confirmado' cujo início já passou. Hora ilegível: usa só a data, para não sumir da lista. */
function isAwaitingClose_(b, now, today){
  if(b.status !== 'confirmado') return false;
  return b.start ? b.start <= now : (b.date !== '' && b.date <= today);
}

function bookingCounts_(bookings, now, today, cfg){
  const hours = reminderHours_(cfg);
  return {
    lembretesPendentes: bookings.filter(b => isReminderDue_(b, now, hours)).length,
    pendentes: bookings.filter(b => isAwaitingClose_(b, now, today)).length,
    naoConfirmadosHoje: bookings.filter(b =>
      b.status === 'confirmado' && b.date === today && b.start && b.start > now && !b.presencaConfirmada
    ).length,
  };
}

function getBookings_(view){
  view = toStr_(view) || 'hoje';
  if(!BOOKING_VIEWS.includes(view)) return { error: 'DADOS_INVALIDOS' };
  const all = readBookings_();
  const now = new Date();
  const today = todayISO_();
  const cfg = readConfig_();
  const byStart = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);
  let list;
  switch(view){
    case 'hoje':
      list = all.filter(b => b.date === today && b.status !== 'cancelado').sort(byStart);
      break;
    case 'proximos': {
      const until = isoDaysFromToday_(14);
      list = all.filter(b => b.status === 'confirmado' && b.date > today && b.date <= until).sort(byStart);
      break;
    }
    case 'pendentes':
      list = all.filter(b => isAwaitingClose_(b, now, today)).sort(byStart);
      break;
    case 'historico': {
      const since = isoDaysFromToday_(-30);
      list = all.filter(b => HISTORY_STATUSES.includes(b.status) && b.date >= since).sort((a, b) => byStart(b, a));
      break;
    }
  }
  return { bookings: list.map(publicBooking_), counts: bookingCounts_(all, now, today, cfg) };
}

/* Escreve células da linha pelo nome da coluna (confere todas antes de gravar a primeira) */
function writeBookingCells_(sheet, c, rowNumber, values){
  requireCols_(c, Object.keys(values));
  Object.keys(values).forEach(k => sheet.getRange(rowNumber, c[k] + 1).setValue(values[k]));
}

/* Localiza pelo id e roda fn(booking, {sheet, c}) dentro do lock, com flush no final */
function updateBookingById_(id, fn){
  return withScriptLock_(() => {
    id = toStr_(id);
    const ctx = readBookingsSheet_();
    const b = id ? ctx.bookings.find(x => x.id === id) : null;
    if(!b) return { error: 'AGENDAMENTO_NAO_ENCONTRADO' };
    const result = fn(b, ctx);
    SpreadsheetApp.flush();
    return result;
  });
}

function completeBooking_(body){
  return updateBookingById_(body.id, (b, ctx) => {
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(b.date);
    if(b.status !== 'confirmado' || !validDate || b.date > todayISO_()) return { error: 'ACAO_INVALIDA_PARA_STATUS' };

    const raw = body.valorCobrado;
    let valor;
    if(raw === undefined || raw === null || toStr_(raw) === '') valor = b.preco; // vazio: usa o preço congelado
    else if(typeof raw === 'number' || typeof raw === 'string') valor = Number(raw);
    if(typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0 || valor > MAX_CHARGE) return { error: 'DADOS_INVALIDOS' };
    const forma = toStr_(body.formaPagamento).toLowerCase();
    if(!PAYMENT_METHODS.includes(forma)) return { error: 'DADOS_INVALIDOS' };

    writeBookingCells_(ctx.sheet, ctx.c, b.rowNumber, {
      status: 'concluido',
      valorCobrado: Math.round((valor + Number.EPSILON) * 100) / 100,
      formaPagamento: forma,
      concluidoEm: new Date(),
    });
    return { ok:true };
  });
}

function markNoShow_(body){
  return updateBookingById_(body.id, (b, ctx) => {
    if(b.status !== 'confirmado' || !b.start || b.start > new Date()) return { error: 'ACAO_INVALIDA_PARA_STATUS' };
    writeBookingCells_(ctx.sheet, ctx.c, b.rowNumber, { status: 'faltou' });
    return { ok:true };
  });
}

/* Desfaz a baixa (concluído ou faltou) para corrigir enganos */
function reopenBooking_(body){
  return updateBookingById_(body.id, (b, ctx) => {
    if(b.status !== 'concluido' && b.status !== 'faltou') return { error: 'ACAO_INVALIDA_PARA_STATUS' };
    writeBookingCells_(ctx.sheet, ctx.c, b.rowNumber, { status: 'confirmado', valorCobrado: '', formaPagamento: '', concluidoEm: '' });
    return { ok:true };
  });
}

/* ============================================================
   LEMBRETES PELO WHATSAPP
   O painel abre o WhatsApp do dono com a mensagem pronta; nada é
   enviado automaticamente. Só recebe quem marcou o consentimento.
   ============================================================ */
function reminderHours_(cfg){
  const n = Number(cfg && cfg.reminderHoursBefore);
  return REMINDER_HOURS_OPTIONS.includes(n) ? n : REMINDER_HOURS_DEFAULT;
}

/* Endereço base do site, sempre com "/" no final; '' se ausente ou sem https */
function normalizeSiteUrl_(v){
  let url = toStr_(v);
  if(!/^https:\/\/[^\s"'<>?#]+$/i.test(url)) return ''; // sem query/hash: o link do cliente vai no final
  if(!url.endsWith('/')) url += '/';
  return url;
}

/* Regra única de quem entra na lista de lembretes (lista e contadores) */
function isReminderDue_(b, now, hours){
  return b.status === 'confirmado'
    && b.aceitaWhatsapp === true            // consentimento explícito do cliente
    && !b.presencaConfirmada
    && b.lembreteEnviadoEm === ''
    && !!b.start && b.start > now
    && b.start - now <= hours * 3600000
    && b.token !== ''                       // sem token não há link para confirmar/cancelar
    && toWaPhone_(b.phone) !== '';
}

/* "quinta-feira, 23/10" a partir de 'AAAA-MM-DD' (só aritmética de calendário, sem fuso) */
function formatReminderDate_(dateStr){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if(!m) return dateStr;
  const weekday = WEEKDAYS_PT[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  return `${weekday}, ${m[3]}/${m[2]}`;
}

/* Monta o texto do lembrete. Independente do painel: um gatilho automático pode reutilizar.
   booking: { name, serviceName, date ('AAAA-MM-DD' no fuso tz_()), time, token }
   cfg: objeto de readConfig_() */
function buildReminderMessage_(booking, cfg){
  const siteUrl = normalizeSiteUrl_(cfg.siteUrl);
  if(!siteUrl) throw new Error('SITE_URL_NAO_CONFIGURADO');
  const template = toStr_(cfg.reminderTemplate) ? String(cfg.reminderTemplate) : REMINDER_TEMPLATE_DEFAULT;
  const values = {
    nome: toStr_(booking.name).split(/\s+/)[0],
    barbearia: toStr_(cfg.name),
    servico: toStr_(booking.serviceName),
    data: formatReminderDate_(toStr_(booking.date)),
    hora: toStr_(booking.time),
    link: `${siteUrl}agendamento.html#${toStr_(booking.token)}`,
  };
  // Placeholders desconhecidos ficam como estão
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match);
}

function getReminders_(){
  const cfg = readConfig_();
  const all = readBookings_();
  const now = new Date();
  const hours = reminderHours_(cfg);
  const reminders = all
    .filter(b => isReminderDue_(b, now, hours))
    .sort((a, b) => a.start - b.start)
    .map(b => ({
      id: b.id, date: b.date, time: b.time, serviceName: b.serviceName, name: b.name,
      waPhone: toWaPhone_(b.phone),
      message: buildReminderMessage_(b, cfg), // lança SITE_URL_NAO_CONFIGURADO se faltar o endereço
    }));
  return { reminders, counts: bookingCounts_(all, now, todayISO_(), cfg) };
}

function markReminderSent_(body){
  return updateBookingById_(body.id, (b, ctx) => {
    if(b.status !== 'confirmado') return { error: 'ACAO_INVALIDA_PARA_STATUS' };
    writeBookingCells_(ctx.sheet, ctx.c, b.rowNumber, { lembreteEnviadoEm: new Date() }); // repetido: só atualiza
    return { ok:true };
  });
}

/* ============================================================
   AUTOGESTÃO DO CLIENTE (link pessoal com token, sem login)
   ============================================================ */
/* Localiza o agendamento pelo token; null se não existir */
function findBookingByToken_(token){
  token = toStr_(token).toLowerCase();
  if(!BOOKING_TOKEN_PATTERN.test(token)) return null;
  const sheet = getBookingsSheet_();
  const c = requireCols_(cols_(sheet), BOOKING_HEADERS);
  const rows = sheet.getDataRange().getValues();
  for(let i=1;i<rows.length;i++){
    if(toStr_(rows[i][c.token]) === token) return { sheet, c, rowNumber: i + 1, row: rows[i] };
  }
  return null;
}

/* Valida se o cliente ainda pode mexer no agendamento; devolve o erro ou null */
function clientActionError_(found){
  const { c, row } = found;
  if(toStr_(row[c.status]) !== 'confirmado') return 'AGENDAMENTO_INATIVO';
  const start = bookingStart_(toISODate_(row[c.data]), toHHmm_(row[c.hora]));
  if(!start || start <= new Date()) return 'PRAZO_ENCERRADO';
  return null;
}

/* Só dados do agendamento e da barbearia — nada que identifique o cliente */
function getBookingByToken_(token){
  const found = findBookingByToken_(token);
  if(!found) return { error: 'AGENDAMENTO_NAO_ENCONTRADO' };
  const { c, row } = found;
  const cfg = readConfig_();
  return {
    serviceName: toStr_(row[c.servicoNome]),
    date: toISODate_(row[c.data]),
    time: toHHmm_(row[c.hora]),
    status: toStr_(row[c.status]),
    presencaConfirmada: toStr_(row[c.presencaConfirmadaEm]) !== '',
    shopName: cfg.name || '',
    shopWhatsapp: cfg.whatsapp || '',
  };
}

function confirmPresence_(body){
  return withScriptLock_(() => {
    const found = findBookingByToken_(body.token);
    if(!found) return { error: 'AGENDAMENTO_NAO_ENCONTRADO' };
    const { sheet, c, rowNumber, row } = found;
    if(toStr_(row[c.status]) !== 'confirmado') return { error: 'AGENDAMENTO_INATIVO' };
    if(toStr_(row[c.presencaConfirmadaEm]) !== '') return { ok:true }; // já confirmada
    const err = clientActionError_(found);
    if(err) return { error: err };
    sheet.getRange(rowNumber, c.presencaConfirmadaEm + 1).setValue(new Date());
    SpreadsheetApp.flush();
    return { ok:true };
  });
}

function cancelByClient_(body){
  return withScriptLock_(() => {
    const found = findBookingByToken_(body.token);
    if(!found) return { error: 'AGENDAMENTO_NAO_ENCONTRADO' };
    const err = clientActionError_(found);
    if(err) return { error: err };
    cancelBookingRow_(found.sheet, found.c, found.rowNumber, toStr_(found.row[found.c.eventoId]), 'cliente');
    SpreadsheetApp.flush(); // libera o horário antes de soltar o lock
    return { ok:true };
  });
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
  const sheet = getBookingsSheet_();
  const c = requireCols_(cols_(sheet), ['id','data','hora','duracao','servicoId','status']);
  const rows = sheet.getDataRange().getValues().slice(1);
  const validDuration = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  let serviceDurations = null; // lido no máximo uma vez por chamada, só se alguma linha precisar
  const wholeDay = () => {
    const start = new Date(`${dateStr}T00:00:00`);
    return { start, end: new Date(start.getTime() + 86400000) };
  };
  return rows
    .filter(r => r[c.id] && r[c.data] && !FREE_STATUSES.includes(toStr_(r[c.status]).toLowerCase()) && toISODate_(r[c.data]) === dateStr)
    .map(r => {
      const time = toHHmm_(r[c.hora]);
      if(!time){
        // hora ilegível: bloqueia o dia inteiro para não permitir agendamento duplo
        Logger.log(`Agendamento ${r[c.id]} com hora inválida: ${r[c.hora]}`);
        return wholeDay();
      }
      let duration = validDuration(r[c.duracao]);
      if(duration === null){
        // duração ilegível: usa a duração atual do serviço; sem ela, bloqueia o dia inteiro
        if(!serviceDurations){
          serviceDurations = {};
          listServices_().forEach(s => serviceDurations[toStr_(s.id)] = s.duration);
        }
        duration = validDuration(serviceDurations[toStr_(r[c.servicoId])]);
        if(duration === null){
          Logger.log(`Agendamento ${r[c.id]} com duração inválida (${r[c.duracao]}) e serviço ${r[c.servicoId]} sem duração válida: dia inteiro bloqueado`);
          return wholeDay();
        }
        Logger.log(`Agendamento ${r[c.id]} com duração inválida (${r[c.duracao]}): usando ${duration} min do serviço ${r[c.servicoId]}`);
      }
      const start = new Date(`${dateStr}T${time}:00`);
      return { start, end: new Date(start.getTime() + duration*60000) };
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
  // Os alertas não podem impedir a entrada no painel
  let counts = null;
  try{ counts = bookingCounts_(readBookings_(), new Date(), todayISO_(), cfg); }catch(e){ Logger.log(`counts: ${e.message}`); }

  return {
    name: cfg.name, tagline: cfg.tagline, lede: cfg.lede,
    whatsapp: cfg.whatsapp, phone: cfg.phone, instagram: cfg.instagram,
    address: cfg.address, mapLink: cfg.mapLink,
    services: listServices_(), hours: listHours_(),
    exceptions: listExceptions_().map(e => ({ ...e, dateLabel: formatDateLabel_(e.date) })),
    siteUrl: normalizeSiteUrl_(cfg.siteUrl),
    reminderHoursBefore: reminderHours_(cfg),
    reminderTemplate: toStr_(cfg.reminderTemplate) ? cfg.reminderTemplate : REMINDER_TEMPLATE_DEFAULT,
    reminderTemplateDefault: REMINDER_TEMPLATE_DEFAULT,
    reminderHoursOptions: REMINDER_HOURS_OPTIONS,
    sheetsOk, calendarOk, counts,
  };
}

function saveInfo_(body){
  // Valida as chaves de lembrete ANTES de gravar qualquer coisa
  const reminder = {};
  if(body.siteUrl !== undefined){
    reminder.siteUrl = normalizeSiteUrl_(body.siteUrl);
    if(!reminder.siteUrl || reminder.siteUrl.length > 500) return { error: 'DADOS_INVALIDOS' };
  }
  if(body.reminderHoursBefore !== undefined){
    const n = Number(body.reminderHoursBefore);
    if(!REMINDER_HOURS_OPTIONS.includes(n)) return { error: 'DADOS_INVALIDOS' };
    reminder.reminderHoursBefore = String(n);
  }
  if(body.reminderTemplate !== undefined){
    const t = typeof body.reminderTemplate === 'string' ? body.reminderTemplate.trim() : '';
    if(!t || t.length > REMINDER_TEMPLATE_MAX) return { error: 'DADOS_INVALIDOS' };
    reminder.reminderTemplate = t;
  }

  ['name','tagline','lede','whatsapp','phone','instagram','address','mapLink'].forEach(k => {
    if(body[k] !== undefined) setConfigValue_(k, body[k]);
  });
  Object.keys(reminder).forEach(k => setConfigValue_(k, reminder[k]));
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
/* Número finito, ou '' se vazio/ilegível */
function toNumberOrEmpty_(v){
  if(toStr_(v) === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n : '';
}
/* Telefone → número para wa.me: só dígitos, com 55 se vier sem DDI (10 ou 11 dígitos).
   Mesma regra de toWaPhone() em js/utils.js. */
function toWaPhone_(phone){
  const digits = String(phone ?? '').replace(/\D/g, '');
  return (digits.length === 10 || digits.length === 11) ? '55' + digits : digits;
}
/* TRUE do Sheets ou o texto "true" */
function toBool_(v){
  return v === true || toStr_(v).toLowerCase() === 'true';
}
/* Date → ISO 8601; texto → como está */
function toIsoDateTime_(v){
  if(v instanceof Date) return isNaN(v) ? '' : v.toISOString();
  return toStr_(v);
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
