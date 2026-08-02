# Guia de configuração — BarberNet

Este site funciona em duas partes:

- **Site + painel** (os arquivos `.html`, `.css`, `.js`) — a parte visual, que qualquer pessoa acessa.
- **Backend no Google** (`apps-script/Code.gs`) — guarda tudo numa Planilha Google e cria os agendamentos direto no Google Calendar. Não precisa de servidor pago nem de banco de dados.

Leva uns 10 minutos para configurar. Só precisa ser feito **uma vez**, por quem for usar o sistema (o dono da barbearia).

---

## Passo 1 — Criar a planilha com o backend

1. Acesse [sheets.google.com](https://sheets.google.com) e crie uma planilha em branco.
2. Dê um nome a ela, por exemplo **"BarberNet — Dados"**.
3. No menu, vá em **Extensões → Apps Script**.
4. Apague o conteúdo do arquivo `Código.gs` que abrir e cole todo o conteúdo do arquivo `apps-script/Code.gs` deste projeto.
5. Salve (ícone de disquete ou `Ctrl+S`).

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
Não — no momento da confirmação o sistema revalida a disponibilidade antes de gravar o agendamento.
