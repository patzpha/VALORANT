# Painel Discord — bot + site em um só app

Controla canais, cargos, membros (kick/ban) e nome do servidor por um painel web.
Funciona só nos servidores onde você é administrador E convidou o bot.

## 1. Criar a aplicação no Discord

1. Acesse https://discord.com/developers/applications → **New Application**.
2. Em **Bot**: clique em "Reset Token" e copie o token → isso é `DISCORD_TOKEN`.
   Em "Privileged Gateway Intents", ative **Server Members Intent**.
3. Em **OAuth2 → General**: copie o **Client ID** e o **Client Secret** →
   `CLIENT_ID` e `CLIENT_SECRET`.
4. Ainda em OAuth2, em "Redirects", adicione a URL que você vai usar
   (ex: `http://localhost:3000/auth/callback` para testar, e depois a URL
   real do seu deploy, ex: `https://seu-app.up.railway.app/auth/callback`).

## 2. Convidar o bot pro seu servidor

Monte este link trocando `SEU_CLIENT_ID`, abra no navegador e escolha seu servidor:

```
https://discord.com/api/oauth2/authorize?client_id=SEU_CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

`permissions=8` = Administrador (controle total).

## 3. Configurar o projeto

```bash
cp .env.example .env
```

Preencha o `.env` com os valores do passo 1.

## 4. Rodar local (para testar)

```bash
npm install
npm start
```

Abra `http://localhost:3000`, clique em **Entrar com Discord** e faça login.

## 5. Colocar no ar 24h (hospedagem)

Esse projeto precisa de um serviço que rode Node.js continuamente
(GitHub Pages **não** serve — ele só hospeda arquivos estáticos).
Opção mais simples para começar: **Railway** (railway.app).

1. Suba este projeto para um repositório no GitHub (sem o `.env`, o
   `.gitignore` já impede isso).
2. No Railway: **New Project → Deploy from GitHub repo** → escolha o repositório.
3. Em **Variables**, adicione as mesmas variáveis do `.env`
   (trocando `REDIRECT_URI` pela URL que o Railway te der + `/auth/callback`).
4. Volte no Discord Developer Portal e adicione essa URL nos Redirects do OAuth2.
5. Pronto — o painel fica acessível pelo domínio que o Railway gerar, e
   o bot fica online 24h.

## O que já dá para controlar

- Canais: criar e excluir
- Cargos: criar, excluir, atribuir a membros
- Membros: kick e ban
- Servidor: trocar nome

## Próximos passos possíveis

- Mudar ícone do servidor
- Editar permissões de canais
- Mensagens automáticas / moderação automática
- Log de ações feitas pelo painel
