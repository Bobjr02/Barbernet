# Guia de configuração — BarberNet

Este site funciona em duas partes:

- **Site + painel** (os arquivos `.html`, `.css`, `.js`) — a parte visual, que qualquer pessoa acessa.
- **Backend no Google** (`Code.gs` + `appsscript.json`) — guarda tudo numa Planilha Google e cria os agendamentos direto no Google Calendar. Não precisa de servidor pago nem de banco de dados.

Leva uns 10 minutos para configurar. Só precisa ser feito **uma vez**, por quem for usar o sistema (o dono da barbearia).

---

## Passo 1 — Criar a planilha com o backend

1. Acesse [sheets.google.com](https://sheets.google.com) e crie uma planilha em branco.
2. Dê um nome a ela, por exemplo **"BarberNet — Dados"**.
3. No menu, vá em **Extensões → Apps Script**.
4. Apague o conteúdo do arquivo `Código.gs` que abrir e cole todo o conteúdo do arquivo `Code.gs` deste projeto.
5. Na barra lateral esquerda, clique na **engrenagem (Configurações do projeto)** e marque **"Mostrar arquivo de manifesto 'appsscript.json' no editor"**.
6. Volte ao **Editor** (ícone `< >`), abra o arquivo `appsscript.json` que apareceu, apague o conteúdo e cole todo o conteúdo do arquivo `appsscript.json` deste projeto. Ele define o fuso horário (America/Maceio) usado nos agendamentos.
7. Salve (ícone de disquete ou `Ctrl+S`).

## Passo 2 — Rodar a configuração inicial

1. Ainda no editor do Apps Script, no menu superior, selecione a função **`setup`** na lista de funções (ao lado do botão ▶ Executar).
2. Clique em **Executar**.
3. Na primeira vez, o Google vai pedir autorização — clique em **Revisar permissões**, escolha sua conta e depois em **Avançado → Acessar (nome do projeto), não seguro** (é normal, é o seu próprio script) e **Permitir**.
4. Isso vai:
   - Criar as abas `Config`, `Servicos`, `Horarios`, `Excecoes` e `Agendamentos` na planilha;
   - Criar uma **agenda dedicada no Google Calendar** chamada "BarberNet — Agendamentos";
   - Gerar uma **senha do painel** automaticamente.
5. Para ver a senha gerada: no editor do Apps Script, vá em **Ver → Registros** (ou `Ctrl+Enter`), ou abra a aba **Config** na planilha e procure a linha `password`.

> Dica: você pode trocar essa senha a qualquer momento — basta editar o valor na linha `password` da aba **Config**, na planilha.

## Passo 3 — Publicar como Aplicativo da Web

1. No editor do Apps Script, clique em **Implantar → Nova implantação**.
2. Em "Selecionar tipo", clique na engrenagem e escolha **Aplicativo da Web**.
3. Configure:
   - **Executar como:** Eu (seu e-mail)
   - **Quem pode acessar:** Qualquer pessoa
4. Clique em **Implantar** e autorize novamente se for pedido.
5. Copie a **URL do aplicativo da Web** gerada (algo como `https://script.google.com/macros/s/AKfycb.../exec`).

> Sempre que você editar o `Code.gs` no futuro, repita este passo escolhendo **Gerenciar implantações → editar (lápis) → Nova versão** para as mudanças valerem no site.

## Passo 4 — Conectar o site a essa planilha

1. Abra o arquivo `js/config.js` deste projeto.
2. Cole a URL copiada no Passo 3 na linha:
   ```js
   const APP_SCRIPT_URL = "https://script.google.com/macros/s/SEU_ID/exec";
   ```
3. Salve o arquivo.

Pronto — o site (`index.html`) já consegue ler serviços, horários e disponibilidade, e o painel (`admin.html`) já vem com a URL preenchida na tela de login.

## Passo 5 — Publicar o site na internet

Estes arquivos são um site estático (não precisam de servidor especial). As formas mais simples e gratuitas:

- **GitHub Pages**: suba a pasta para um repositório no GitHub e ative o Pages nas configurações do repositório.
- **Netlify ou Vercel**: arraste a pasta do projeto na área de upload do painel deles.

Depois de publicado, você terá um endereço para enviar aos clientes (e pode ligar um domínio próprio depois, se quiser).

## Passo 6 — Usar o painel do dono

1. Acesse `admin.html` (pelo link "Powered by BarberNet" no rodapé do site, ou direto pela URL).
2. Cole a URL do Apps Script (já vem preenchida se o Passo 4 foi feito) e a senha do Passo 2.
3. Preencha:
   - **Dados da barbearia**: nome, frase de destaque, WhatsApp, telefone, Instagram, endereço.
   - **Serviços**: nome, preço e duração de cada atendimento.
   - **Horários**: dias e horários de funcionamento — pode reativar/desativar dias quando quiser.
   - **Feriados/exceções**: para fechar um dia específico ou usar um horário especial pontual, sem mexer no horário fixo.
   - **Agendamentos**: lista dos horários marcados pelos clientes, com opção de cancelar.

Tudo isso é salvo direto na planilha e refletido no Google Calendar automaticamente.

---

## Atualizando uma instalação antiga

Se a sua planilha foi criada com uma versão anterior do BarberNet:

1. No editor do Apps Script, apague o conteúdo do `Code.gs` e cole o novo `Code.gs` deste projeto. Se o `appsscript.json` ainda não estiver configurado, siga os itens 5 e 6 do Passo 1.
2. Salve e publique uma nova versão: **Implantar → Gerenciar implantações → editar (lápis) → Versão: Nova versão → Implantar**. A URL continua a mesma.
3. Na lista de funções (ao lado do botão ▶ Executar), selecione **`migrarFormatos`** e clique em **Executar** uma única vez. Ela converte horários, datas e telefones já gravados para texto e alinha o fuso da planilha ao do script.
4. Confira o resultado em **Execuções** (ou `Ctrl+Enter`): o registro mostra quantas células foram corrigidas em cada aba. Rodar de novo não causa problema — só corrige 0 células.
5. Confira a senha na aba **Config**: se ela era só números, pode ter sido alterada pelo Google Sheets. Nesse caso, digite-a novamente.

---

## Deploy pelo Codespace (opcional)

Em vez de colar o `Code.gs` no editor a cada mudança, dá para publicar direto do Codespace com o [clasp](https://github.com/google/clasp) (versão 3.x). O script `scripts/deploy.sh` envia **somente** `Code.gs` e `appsscript.json` e atualiza a **implantação que já existe**. Por isso a URL do Web App (a mesma de `js/config.js`) **não muda**.

> **Importante:** faça tudo com a **mesma conta Google** dona da planilha e do script. Com outra conta, o clasp não encontra o projeto, ou o deploy falha por falta de permissão.

### 1. Ativar a Apps Script API (uma vez)

Abra <https://script.google.com/home/usersettings>, logado na conta dona do script, e ative **Google Apps Script API**. Depois de ativar, pode levar alguns minutos para funcionar.

### 2. Anotar os dois IDs

- **scriptId:** no editor do Apps Script, clique na **engrenagem (Configurações do projeto)**. Em **IDs**, copie o **ID do script**.
- **ID da implantação:** em **Implantar → Gerenciar implantações**, selecione a implantação do *Aplicativo da Web* e copie o **ID da implantação** (começa com `AKfycb...`). Ele é o trecho entre `/s/` e `/exec` da URL que está em `js/config.js`. Use o ID da implantação ativa, **não** o da "implantação de teste" (`/dev`).

### 3. Conferir o bloco `webapp` no manifesto (uma vez)

Quando você publicou o Web App pelo editor, o Google acrescentou ao `appsscript.json` remoto um bloco `"webapp"`. Esse bloco guarda quem executa o app e quem pode acessá-lo. O `appsscript.json` deste repositório precisa ter o mesmo bloco, porque o deploy sobrescreve o manifesto remoto com o local. Sem ele, a nova versão perde a configuração de Web App. O `scripts/deploy.sh` se recusa a rodar se o bloco faltar.

1. No editor do Apps Script, abra o `appsscript.json`. Se ele não aparecer, veja o item 5 do Passo 1.
2. Copie o bloco `"webapp": { ... }` para o `appsscript.json` deste projeto. Com as opções do Passo 3, ele costuma ser:
   ```json
   "webapp": {
     "executeAs": "USER_DEPLOYING",
     "access": "ANYONE_ANONYMOUS"
   }
   ```
3. Faça commit da mudança.

### 4. Fazer o login do clasp dentro do Codespace

O Codespace não tem navegador próprio. Por isso, use o login sem servidor local:

```bash
clasp login --no-localhost
```

1. O clasp mostra a mensagem `Authorize clasp by visiting this url:` seguida de um link. Abra esse link no navegador do seu computador.
2. Entre com a **conta dona da planilha e do script** e clique em **Permitir**.
3. No fim, o navegador tenta abrir um endereço `http://localhost:.../?code=...&state=...` e mostra um erro do tipo *"Não é possível acessar esse site"*. **Isso é esperado.**
4. Copie a **URL inteira** da barra de endereços desse erro, incluindo `code=` e `state=`. Cole no terminal, onde o clasp pergunta `After authorizing, copy the URL from your browser and paste it here:`, e tecle Enter.
5. Confira com `clasp show-authorized-user`.

As credenciais ficam em `~/.clasprc.json`, fora do repositório. Nunca faça commit desse arquivo nem o compartilhe. Para sair: `clasp logout`.

### 5. Criar `.clasp.json` e `.deploy-id`

Na raiz do projeto:

```bash
cp .clasp.json.example .clasp.json
# edite .clasp.json e troque COLE_AQUI pelo scriptId do item 2
echo "AKfycb...SEU_ID_DA_IMPLANTACAO" > .deploy-id
```

Os dois arquivos estão no `.gitignore` e não vão para o GitHub. Em vez do `.deploy-id`, você também pode usar a variável `DEPLOYMENT_ID=...`.

### 6. Publicar

1. Faça commit das mudanças em `Code.gs`/`appsscript.json`. O script se recusa a publicar alterações não commitadas.
2. Rode:
   ```bash
   scripts/deploy.sh
   ```
3. O script envia os arquivos (`clasp push`) e cria uma nova versão com a descrição `deploy AAAA-MM-DD HH:MM @ <commit>`. Depois aponta a implantação existente para essa versão (`clasp redeploy`).
4. No final, ele imprime a URL do Web App e a compara com a de `js/config.js`. Se aparecer **OK**, o site já está usando o código novo.

Se alguma função nova precisar de permissões novas do Google (Calendar, Gmail etc.), abra o editor do Apps Script e execute qualquer função uma vez para autorizar.

---

## Perguntas comuns

**Preciso pagar alguma coisa pro Google?**
Não. Google Sheets, Apps Script e Calendar são gratuitos para esse volume de uso.

**Cada barbearia que comprar o BarberNet precisa repetir esse processo?**
Sim — cada uma cria sua própria planilha (Passos 1–3), o que mantém os dados de cada barbearia completamente separados e privados.

**A senha do painel é segura?**
É uma proteção simples, suficiente para uso cotidiano do dono. Evite compartilhar a URL do painel publicamente. Se quiser um nível de segurança maior (login por e-mail, por exemplo), isso pode ser adicionado depois.

**Como mudo as cores/textos fixos do site (fora do que o painel controla)?**
As cores ficam no arquivo `css/style.css`, no topo (`:root`), e os textos fixos estão direto no `index.html`/`admin.html`.

**Um cliente pode agendar um horário que acabou de ser ocupado por outro?**
Não — as confirmações são processadas uma de cada vez, e o sistema revalida a disponibilidade antes de gravar o agendamento.
