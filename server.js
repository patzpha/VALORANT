require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ChannelType,
} = require('discord.js');

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  SESSION_SECRET,
  PAINEL_USUARIO,
  PAINEL_SENHA,
  PORT = 3000,
} = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  console.error('Faltam variáveis no .env. Confira o .env.example.');
  process.exit(1);
}

// ---------- BOT DO DISCORD ----------
const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ],
});

bot.once('ready', () => {
  console.log(`Bot online como ${bot.user.tag}`);
});

bot.login(DISCORD_TOKEN);

// ---------- SITE / PAINEL ----------
const app = express();
app.use(express.json());
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'painel.html'));
});
app.use(
  session({
    secret: SESSION_SECRET || 'troque-isto',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 6 }, // 6 horas
  })
);

const ADMIN_FLAG = BigInt(0x8); // bit de permissão ADMINISTRATOR

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ erro: 'Não autenticado' });
  next();
}

// ---------- PORTÃO DE USUÁRIO/SENHA (antes do login do Discord) ----------
function requireLocal(req, res, next) {
  if (!req.session.localOk) return res.status(401).json({ erro: 'Acesso bloqueado' });
  next();
}

// Diz ao site se o usuário já passou do portão nesta sessão
app.get('/api/auth-local', (req, res) => {
  res.json({ ok: !!req.session.localOk });
});

// Confere usuário/senha vindos do formulário
app.post('/api/auth-local', (req, res) => {
  const { usuario, senha } = req.body;
  if (usuario === PAINEL_USUARIO && senha === PAINEL_SENHA) {
    req.session.localOk = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, erro: 'Usuário ou senha incorretos' });
});

// A partir daqui, essas rotas só funcionam se já passou pelo portão acima
app.use('/auth/login', requireLocal);
app.use('/auth/callback', requireLocal);
app.use('/api/guilds', requireLocal);

// Confere, para uma guild específica, se o usuário logado é admin nela
// (usa a lista de guilds que guardamos na sessão no momento do login)
function isAdminOfGuild(req, guildId) {
  const g = (req.session.guilds || []).find((x) => x.id === guildId);
  if (!g) return false;
  return (BigInt(g.permissions) & ADMIN_FLAG) === ADMIN_FLAG;
}

// ---------- LOGIN COM DISCORD (OAuth2) ----------
app.get('/auth/login', (req, res) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds',
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?erro=sem_code');

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect('/?erro=token_invalido');

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = await userRes.json();

    const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const guilds = await guildsRes.json();

    req.session.user = { id: user.id, username: user.username, avatar: user.avatar };
    req.session.guilds = guilds;

    res.redirect('/');
  } catch (e) {
    console.error(e);
    res.redirect('/?erro=falha_login');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

// Lista só as guilds onde: o usuário é admin E o bot já foi adicionado
app.get('/api/guilds', requireLogin, (req, res) => {
  const minhas = (req.session.guilds || []).filter(
    (g) => (BigInt(g.permissions) & ADMIN_FLAG) === ADMIN_FLAG
  );
  const resultado = minhas.map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.icon,
    botPresente: bot.guilds.cache.has(g.id),
  }));
  res.json(resultado);
});

function getGuildOr404(req, res) {
  const { guildId } = req.params;
  if (!isAdminOfGuild(req, guildId)) {
    res.status(403).json({ erro: 'Você não é administrador desse servidor' });
    return null;
  }
  const guild = bot.guilds.cache.get(guildId);
  if (!guild) {
    res.status(404).json({ erro: 'O bot não está nesse servidor' });
    return null;
  }
  return guild;
}

// ---------- INFO DO SERVIDOR ----------
app.get('/api/guilds/:guildId', requireLogin, async (req, res) => {
  const guild = getGuildOr404(req, res);
  if (!guild) return;
  res.json({
    id: guild.id,
    name: guild.name,
    memberCount: guild.memberCount,
    icon: guild.iconURL(),
  });
});

app.patch('/api/guilds/:guildId', requireLogin, async (req, res) => {
  const guild = getGuildOr404(req, res);
  if (!guild) return;
  try {
    const { name } = req.body;
    if (name) await guild.setName(name);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// ---------- CANAIS ----------
app.get('/api/guilds/:guildId/channels', requireLogin, async (req, res) => {
  const guild = getGuildOr404(req, res);
  if (!guild) return;
  const canais = guild.channels.cache.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
  }));
  res.json(canais);
});

app.post('/api/guilds/:guildId/channels', requireLogin, async (req, res) => {
  const guild = getGuildOr404(req, res);
  if (!guild) return;
  try {
    const { name, tipo } = req.body; // tipo: "texto" ou "voz"
    const channel = await guild.channels.create({
      name,
      type: tipo === 'voz' ? ChannelType.GuildVoice : ChannelType.GuildText,
    });
    res.json({ id: channel.id, name: channel.name });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.delete('/api/guilds/:guildId/channels/:channelId', requireLogin, async (req, res) => {
  const guild = getGuildOr404(req, res);
  if (!guild) return;
  try {
    const channel = guild.channels.cache.get(req.params.channelId);
    if (!channel) return res.status(404).json({ erro: 'Canal não encontrado' });
    await channel.delete();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// ---------- CARGOS ----------
app.get('/api/guilds/:guildId/roles', requireLogin, async (req, res) => {
  const guild = getGuildOr404(req, res);
  if (!guild) return;
  const cargos = guild.roles.cache.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.hexColor,
  }));
  res.json(cargos);
});

app.post('/api/guilds/:guildId/roles', requireLogin, async (req, res) => {
  const guild = getGuildOr404(req, res);
  if (!guild) return;
  try {
    const { name, color } = req.body;
    const role = await guild.roles.create({ name, color: color || undefined });
    res.json({ id: role.id, name: role.name });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.delete('/api/guilds/:guildId/roles/:roleId', requireLogin, async (req, res) => {
  const guild = getGuildOr404(req, res);
  if (!guild) return;
  try {
    const role = guild.roles.cache.get(req.params.roleId);
    if (!role) return res.status(404).json({ erro: 'Cargo não encontrado' });
    await role.delete();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// ---------- MEMBROS ----------
app.get('/api/guilds/:guildId/members', requireLogin, async (req, res) => {
  const guild = getGuildOr404(req, res);
  if (!guild) return;
  try {
    const query = (req.query.q || '').toLowerCase();
    const membros = await guild.members.fetch();
    const filtrados = membros
      .filter((m) => !query || m.user.username.toLowerCase().includes(query))
      .first(50);
    res.json(
      filtrados.map((m) => ({
        id: m.id,
        username: m.user.username,
        avatar: m.user.displayAvatarURL(),
        roles: m.roles.cache.filter((r) => r.name !== '@everyone').map((r) => r.id),
      }))
    );
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.post('/api/guilds/:guildId/members/:userId/kick', requireLogin, async (req, res) => {
  const guild = getGuildOr404(req, res);
  if (!guild) return;
  try {
    await guild.members.kick(req.params.userId, req.body.motivo || 'Sem motivo informado');
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.post('/api/guilds/:guildId/members/:userId/ban', requireLogin, async (req, res) => {
  const guild = getGuildOr404(req, res);
  if (!guild) return;
  try {
    await guild.members.ban(req.params.userId, { reason: req.body.motivo || 'Sem motivo informado' });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.post('/api/guilds/:guildId/members/:userId/roles/:roleId', requireLogin, async (req, res) => {
  const guild = getGuildOr404(req, res);
  if (!guild) return;
  try {
    const member = await guild.members.fetch(req.params.userId);
    await member.roles.add(req.params.roleId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.delete('/api/guilds/:guildId/members/:userId/roles/:roleId', requireLogin, async (req, res) => {
  const guild = getGuildOr404(req, res);
  if (!guild) return;
  try {
    const member = await guild.members.fetch(req.params.userId);
    await member.roles.remove(req.params.roleId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Painel rodando em http://localhost:${PORT}`);
});
