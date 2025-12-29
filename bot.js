const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const crypto = require('crypto');

console.log('BOT STARTED');

/* ================= ENV ================= */
const TOKEN = process.env.BOT_TOKEN;
const PRIVATE_CHANNEL_ID = Number(process.env.PRIVATE_CHANNEL_ID);
const PUBLIC_CHANNEL_ID = Number(process.env.PUBLIC_CHANNEL_ID);
const BOT_USERNAME = process.env.BOT_USERNAME;
const WEB_SECRET = process.env.WEB_SECRET;
const BASE_URL = process.env.RENDER_EXTERNAL_URL;

const FORCE_CHANNELS = ['@perfecttcinema'];

const bot = new TelegramBot(TOKEN);

/* ================= DB ================= */
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

const FileMap = mongoose.model('FileMap', new mongoose.Schema({
  fid: { type: String, unique: true },
  channelId: Number,
  messageId: Number,
  createdAt: { type: Date, default: Date.now }
}));

/* ================= STORAGE LISTENER ================= */

bot.on('channel_post', async (msg) => {
  if (msg.chat.id !== PRIVATE_CHANNEL_ID) return;

  const file = msg.video || msg.document;
  if (!file) return; // Only react to actual file uploads

  const fid = crypto.randomBytes(6).toString('hex');

  try {
    // 🔹 Save mapping in MongoDB
    await FileMap.create({
      fid,
      channelId: msg.chat.id,
      messageId: msg.message_id
    });

    console.log(`✅ FILE STORED: ${fid}`);

    // 🔹 Prepare caption for public post
    const caption = `
🎬 ${msg.caption || 'New Movie Uploaded!'}

━━━━━━━━━━━━━━
⬇️ Click below to download
━━━━━━━━━━━━━━
`.trim();

    // 🔹 Inline buttons for public channel post
    const keyboard = {
      inline_keyboard: [
        [
          { text: '⬇️ Download', url: `https://t.me/${BOT_USERNAME}?start=f_${fid}` }
        ],
        [
          { text: '⭐ Premium', url: 'https://t.me/+UvanPUhXGcoxNGI1' }
        ]
      ]
    };

    // 🔹 Handle thumbnail properly
    if (msg.video?.thumbnail?.file_id) {
      // Use the thumbnail if available
      await bot.sendPhoto(PUBLIC_CHANNEL_ID, msg.video.thumbnail.file_id, {
        caption,
        reply_markup: keyboard
      });
      console.log('📸 Thumbnail + Caption posted to Public Channel');
    } else {
      // If no thumbnail, just send text
      await bot.sendMessage(PUBLIC_CHANNEL_ID, caption, { reply_markup: keyboard });
      console.log('📝 Caption-only post (no thumbnail)');
    }

  } catch (e) {
    console.error('❌ AUTO POST ERROR:', e.message);
  }
});

/* ================= FORCE JOIN ================= */
async function checkForceJoin(userId) {
  for (const ch of FORCE_CHANNELS) {
    try {
      const m = await bot.getChatMember(ch, userId);
      if (!['member', 'administrator', 'creator'].includes(m.status)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/* ================= START ================= */
bot.onText(/^\/start$/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Use Download button from channel.');
});

/* ================= DOWNLOAD FLOW ================= */
bot.onText(/\/start\s+f_(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const fid = match[1];

  const row = await FileMap.findOne({ fid });
  if (!row) return bot.sendMessage(chatId, '❌ File not found');

  if (!(await checkForceJoin(userId))) {
    return bot.sendMessage(chatId, '📢 Join our channel first', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Join Channel', url: 'https://t.me/perfecttcinema' }],
          [{ text: '✅ I Joined', callback_data: `recheck_${fid}` }]
        ]
      }
    });
  }

  bot.sendMessage(chatId, '🔓 Choose ONE option:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎥 Watch Video', url: `${BASE_URL}/ads/video?uid=${userId}&fid=${fid}` }],
        [{ text: '🔗 Shortlink', url: `${BASE_URL}/ads/shortlink?uid=${userId}&fid=${fid}` }]
      ]
    }
  });
});

/* ================= RECHECK ================= */
bot.on('callback_query', async (q) => {
  if (!q.data.startsWith('recheck_')) return;

  const fid = q.data.replace('recheck_', '');
  const userId = q.from.id;

  if (!(await checkForceJoin(userId))) {
    return bot.answerCallbackQuery(q.id, {
      text: 'Join channel first',
      show_alert: true
    });
  }

  bot.answerCallbackQuery(q.id);

  bot.sendMessage(q.message.chat.id, '🔓 Choose ONE option:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎥 Watch Video', url: `${BASE_URL}/ads/video?uid=${userId}&fid=${fid}` }],
        [{ text: '🔗 Shortlink', url: `${BASE_URL}/ads/shortlink?uid=${userId}&fid=${fid}` }]
      ]
    }
  });
});

/* ================= VERIFY ================= */
bot.onText(/\/verify\s+(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  let data;
  try {
    data = JSON.parse(Buffer.from(match[1], 'base64').toString());
  } catch {
    return bot.sendMessage(chatId, '❌ Invalid verification');
  }

  const { uid, fid, method, ts, token } = data;

  const check = crypto
    .createHmac('sha256', WEB_SECRET)
    .update(`${uid}:${fid}:${method}:${ts}`)
    .digest('hex');

  if (uid !== chatId || check !== token) {
    return bot.sendMessage(chatId, '❌ Verification failed');
  }

  const row = await FileMap.findOne({ fid });
  if (!row) return bot.sendMessage(chatId, '❌ File not found');

  await bot.forwardMessage(chatId, row.channelId, row.messageId);
});

/* ================= WEBHOOK ================= */
const app = express();
app.use(bodyParser.json());

app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/', (_, res) => res.send('Bot alive'));

const PORT = process.env.PORT || 3000;
app.listen(PORT);

bot.setWebHook(`${BASE_URL}/webhook`);
