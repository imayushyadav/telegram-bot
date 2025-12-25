const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');

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

const bot = new TelegramBot(TOKEN, { polling: true });

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
