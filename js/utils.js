/* ============================================================
   BarberNet — Utilitários compartilhados (site e painel)
   ============================================================ */

const WEEKDAYS = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

function money(v){
  return Number(v || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}

/* Escapa HTML — use em TODO valor vindo da API antes de innerHTML */
function esc(s){
  if(s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Aceita apenas links http(s); qualquer outro esquema (javascript:, data:…) vira "#" */
function safeUrl(u){
  const s = String(u || '').trim();
  return /^https?:\/\//i.test(s) ? s : '#';
}

/* Escapa tudo e reativa somente <em>, <strong> e <br> (usado no tagline) */
function richText(s){
  return esc(s).replace(/&lt;(\/?(?:em|strong)|br)&gt;/gi, (_, tag) => `<${tag.toLowerCase()}>`);
}

function pad(n){ return String(n).padStart(2,'0'); }

/* 'AAAA-MM-DD' → 'Sexta-feira, 24/10/2026' (sem fuso: monta a data local a partir dos números) */
function formatDateLong(iso){
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${weekday}, ${pad(d)}/${pad(m)}/${y}`;
}
