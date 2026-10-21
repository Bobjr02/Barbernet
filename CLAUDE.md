# CLAUDE.md — BarberNet

## Visão geral

- **Frontend:** site estático — `index.html` (página pública de agendamento), `admin.html` (painel do barbeiro), `css/` e `js/` (`config.js`, `site.js`, `admin.js`).
- **Backend:** Google Apps Script (`Code.gs`), publicado como Web App. Usa **Google Sheets** como banco de dados e **Google Calendar** para criar os eventos dos agendamentos.
- Configuração inicial do backend: ver `GUIA-DE-CONFIGURACAO.md`.

## Restrições

- `Code.gs` roda **somente** no Apps Script (runtime V8). Ele **não pode** ser executado neste ambiente — não tente rodá-lo com `node` (depende de `SpreadsheetApp`, `CalendarApp`, `ContentService` etc.).
- O frontend é **JavaScript puro**: sem etapa de build, sem frameworks, sem dependências npm.

## Regras de código

- Todo dado vindo do servidor inserido via `innerHTML` **deve** passar por `esc()` (escape HTML). Se `esc()` ainda não existir no arquivo, crie-a antes de usar.
- Toda escrita/leitura de horários, datas, telefones e senha na planilha deve tratar os valores **como texto** — o Sheets converte `"09:00"` em `Date` e `"5582..."` em número. Ao escrever, force formato texto (ex.: `setNumberFormat('@')` ou prefixo `'`); ao ler, normalize (ex.: `Utilities.formatDate` para `Date`, `String()` para números).
- Textos da interface em **português do Brasil**.
- **Não altere** a URL em `js/config.js`.
- Commits pequenos, mensagens em português no formato `tipo: descrição` (`fix`, `feat`, `refactor`, `docs`).

## Como testar

- **Backend (`Code.gs`):** as mudanças precisam ser **coladas manualmente** no editor do Apps Script e publicadas como **nova versão** do Web App (Implantar → Gerenciar implantações → Editar → Nova versão). Sem isso, o site continua usando a versão antiga.
- **Frontend:** sirva a pasta localmente e abra no navegador:

  ```bash
  python3 -m http.server 8080
  ```

  Depois acesse `http://localhost:8080/index.html` e `http://localhost:8080/admin.html`.
