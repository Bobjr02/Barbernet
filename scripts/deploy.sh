#!/usr/bin/env bash
# Publica o backend (Code.gs + appsscript.json) no Apps Script e atualiza a
# implantação EXISTENTE do Web App — a URL em js/config.js não muda.
# Uso: scripts/deploy.sh   (ID da implantação em DEPLOYMENT_ID ou no arquivo .deploy-id)
set -euo pipefail

cd "$(dirname "$0")/.."

erro() { echo "ERRO: $*" >&2; exit 1; }

# (a) Configuração local
[[ -f .clasp.json ]] || erro ".clasp.json não encontrado. Copie .clasp.json.example para .clasp.json e preencha o scriptId (veja GUIA-DE-CONFIGURACAO.md)."
grep -q 'COLE_AQUI' .clasp.json && erro ".clasp.json ainda está com o scriptId de exemplo (COLE_AQUI)."

DEPLOYMENT_ID="${DEPLOYMENT_ID:-}"
if [[ -z "$DEPLOYMENT_ID" && -f .deploy-id ]]; then
  DEPLOYMENT_ID="$(tr -d '[:space:]' < .deploy-id)"
fi
[[ -n "$DEPLOYMENT_ID" ]] || erro "ID da implantação não definido. Use DEPLOYMENT_ID=... ou crie o arquivo .deploy-id (veja GUIA-DE-CONFIGURACAO.md)."

command -v clasp >/dev/null || erro "clasp não instalado. Rode: npm i -g @google/clasp"

# O manifesto precisa do bloco "webapp"; sem ele a nova versão perde a configuração de Web App.
grep -q '"webapp"' appsscript.json || erro "appsscript.json sem o bloco \"webapp\". Copie-o do manifesto no editor do Apps Script (veja GUIA-DE-CONFIGURACAO.md)."

# (b) Só publica o que está commitado
if [[ -n "$(git status --porcelain -- Code.gs appsscript.json)" ]]; then
  git status --short -- Code.gs appsscript.json >&2
  erro "Code.gs ou appsscript.json têm alterações não commitadas. Faça commit antes do deploy."
fi

COMMIT="$(git rev-parse --short HEAD)"
DESCRICAO="deploy $(TZ=America/Maceio date '+%Y-%m-%d %H:%M') @ ${COMMIT}"

# (c) Envia os arquivos (-f: o manifesto versionado no git é a fonte da verdade)
echo "==> clasp push"
clasp push -f

# (d) Cria nova versão e aponta a implantação existente para ela
echo "==> clasp redeploy ${DEPLOYMENT_ID}"
clasp redeploy "$DEPLOYMENT_ID" --description "$DESCRICAO"

# (e) Confere a URL
URL="https://script.google.com/macros/s/${DEPLOYMENT_ID}/exec"
# Lê só a linha de código (o comentário do topo tem uma URL de exemplo)
LINHAS_URL="$(awk '
  emcomentario { if (sub(/.*\*\//, "")) emcomentario = 0; else next }
  { gsub(/\/\*.*\*\//, "") }
  /\/\*/ { sub(/\/\*.*/, ""); emcomentario = 1 }
  /^[[:space:]]*\/\// { next }
  /^[[:space:]]*const[[:space:]]+APP_SCRIPT_URL[[:space:]]*=/ { print }
' js/config.js)"
QTD_LINHAS="$(printf '%s' "$LINHAS_URL" | grep -c . || true)"
[[ "$QTD_LINHAS" -eq 1 ]] || erro "Esperava exatamente 1 linha 'const APP_SCRIPT_URL' em js/config.js, encontrei ${QTD_LINHAS}. Confira a URL manualmente: ${URL}"
URL_SITE="$(sed -E 's/^[^"]*"([^"]*)".*$/\1/' <<< "$LINHAS_URL")"
[[ "$URL_SITE" == https://* && "$URL_SITE" != *"..."* ]] || erro "URL inválida lida de js/config.js: '${URL_SITE}'. Confira a URL manualmente: ${URL}"
echo
echo "Descrição: ${DESCRICAO}"
echo "URL do Web App:    ${URL}"
echo "URL no config.js:  ${URL_SITE}"
if [[ "$URL" == "$URL_SITE" ]]; then
  echo "OK — mesma URL do js/config.js."
else
  echo "ATENÇÃO — a URL é diferente da que está em js/config.js. Confira o .deploy-id." >&2
  exit 1
fi
