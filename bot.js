
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILES_PATH = path.join(__dirname, 'files.json');

function readFiles() {
  if (!fs.existsSync(FILES_PATH)) {
    fs.writeFileSync(FILES_PATH, JSON.stringify({}));
  }
  return JSON.parse(fs.readFileSync(FILES_PATH, 'utf8'));
}

function saveFiles(data) {
  fs.writeFileSync(FILES_PATH, JSON.stringify(data, null, 2));
}


console.log("BOT STARTED");

// =============== CONFIG ==================
const TOKEN = process.env.BOT_TOKEN; // 🔴 active token only
const CHANNEL = '@perfecttcinema';

// 🔐 MUST MATCH Render ENV VARIABLE
const WEB_SECRET = process.env.WEB_SECRET;

// 🌐 RENDER URL (ngrok NAHI)
const WEB_BASE = 'https://unlock-page.onrender.com/unlock';

// 📦 File source
const PRIVATE_CHANNEL_ID = -1003686844186;
const FILE_MESSAGE_ID = 5;
// ========================================

const bot = new TelegramBot(TOKEN);


/**
 * 🔑 Create signed unlock URL (MUST MATCH server.js)
 */
function createUnlockURL(userId, fileId) {
  const ts = Date.now().toString();

  const sig = crypto
    .createHmac('sha256', WEB_SECRET)
    .update(`${userId}:${fileId}:${ts}`)
    .digest('hex');

  return `${WEB_BASE}?uid=${userId}&fid=${fileId}&ts=${ts}&sig=${sig}`;
}

// ================= START ==================
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    const member = await bot.getChatMember(CHANNEL, userId);

    if (!['member', 'administrator', 'creator'].includes(member.status)) {
      return bot.sendMessage(chatId,
`🚫 ACCESS BLOCKED

━━━━━━━━━━━━━━
📢 Join our channel first
━━━━━━━━━━━━━━`,
{
  reply_markup: {
    inline_keyboard: [
      [{ text: '📢 Join Channel', url: `https://t.me/${CHANNEL.replace('@','')}` }],
      [{ text: '✅ Verify', callback_data: 'verify' }]
    ]
  }
});
    }

    return bot.sendMessage(chatId,
`👋 WELCOME

━━━━━━━━━━━━━━
🎬 Secure File Access
🔐 Verified Unlock System
━━━━━━━━━━━━━━

👇 Click below to continue`,
{
  reply_markup: {
    inline_keyboard: [
      [{ text: '🎬 View Content', callback_data: 'content' }]
    ]
  }
});

  } catch (e) {
    bot.sendMessage(chatId, 'Error. Try again.');
  }
});

// ============== CALLBACKS ==================
bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;
  const data = q.data;

  bot.answerCallbackQuery(q.id);

  // CONTENT → SEND USER TO RENDER UNLOCK PAGE
  if (data === 'content') {
    const unlockURL = createUnlockURL(userId, FILE_MESSAGE_ID);

    return bot.sendMessage(chatId,
`🔓 UNLOCK FILE

━━━━━━━━━━━━━━
• You will be redirected
• Stay on page briefly
• File will be sent automatically
━━━━━━━━━━━━━━`,
{
  reply_markup: {
    inline_keyboard: [
      [{ text: '⚡ Unlock Now', url: unlockURL }]
    ]
  }
});
  }
});

// KEEP ALIVE SERVER (FOR RENDER FREE)
const express = require('express');
const app = express();

const bodyParser = require('body-parser');

// parse JSON coming from Telegra
app.use(bodyParser.json());

// Webhook endpoint
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});


const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is alive'));
app.listen(PORT, () => console.log('Keep-alive server running'));

// tell Telegram where to send updates
const WEBHOOK_URL = `${process.env.RENDER_EXTERNAL_URL}/webhook`;

bot.setWebHook(WEBHOOK_URL)
  .then(() => console.log('Webhook set:', WEBHOOK_URL))
  .catch(err => console.error('Webhook error:', err));


bot.on('channel_post', (msg) => {
  // only storage channel
  if (msg.chat.id !== Number(process.env.PRIVATE_CHANNEL_ID)) return;

  const file =
    msg.video ||
    msg.document ||
    msg.forward_from_chat ||
    msg.forward_origin;

  if (!file) return;

  console.log('📥 FILE DETECTED');

  const files = readFiles();

  const fileId =
    msg.video?.file_id ||
    msg.document?.file_id;

  files[msg.message_id] = {
    file_id: fileId,
    type: msg.video ? 'video' : 'document',
    caption: msg.caption || '',
    forwarded: !!msg.forward_from_chat || !!msg.forward_origin,
    date: msg.date
  };

  saveFiles(files);

  console.log('✅ SAVED TO files.json');
  console.log('Message ID:', msg.message_id);
});



