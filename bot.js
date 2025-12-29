const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const crypto = require('crypto');

/* ================= BASIC SETUP ================= */

console.log('BOT STARTED');

const TOKEN = process.env.BOT_TOKEN;
const PRIVATE_CHANNEL_ID = Number(process.env.PRIVATE_CHANNEL_ID);
const PUBLIC_CHANNEL_ID = Number(process.env.PUBLIC_CHANNEL_ID);
const BOT_USERNAME = process.env.BOT_USERNAME;
const WEB_SECRET = process.env.WEB_SECRET;

const FORCE_CHANNELS = [
  '@perfecttcinema' // ❗ ONLY CHANNEL, NO GROUP
];

const bot = new TelegramBot(TOKEN);

/* ================= MONGODB ================= */

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

const fileMapSchema = new mongoose.Schema({
  fid: { type: String, unique: true },
  channelId: Number,
  messageId: Number,
  type: String,
  createdAt: { type: Date, default: Date.now }
});

const FileMap = mongoose.model('FileMap', fileMapSchema);

/* ================= STORAGE → PUBLIC POST ================= */

bot.on('channel_post', async (msg) => {
  if (msg.chat.id !== PRIVATE_CHANNEL_ID) return;

  const file = msg.video || msg.document;
  if (!file) return;

  const fid = crypto.randomBytes(6).toString('hex');

  try {
    await FileMap.create({
      fid,
      channelId: msg.chat.id,
      messageId: msg.message_id,
      type: msg.video ? 'video' : 'document'
    });

    console.log('✅ FILE STORED:', fid);

    const caption = `
🎬 ${msg.caption || 'Movie Available'}

━━━━━━━━━━━━━━
⬇️ Click below to download
━━━━━━━━━━━━━━
`.trim();

    const keyboard = {
      inline_keyboard: [
        [
          {
            text: '⬇️ Download',
            url: `https://t.me/${BOT_USERNAME}?start=f_${fid}`
          }
        ],
        [
          { text: '⭐ Premium', url: 'https://t.me/+UvanPUhXGcoxNGI1' }
        ]
      ]
    };

    // PUBLIC POST SHOULD ONLY USE REAL PHOTO
const lastPoster = msg.reply_to_message?.photo;

if (lastPoster) {
  await bot.sendPhoto(
    PUBLIC_CHANNEL_ID,
    lastPoster[lastPoster.length - 1].file_id,
    {
      caption,
      reply_markup: keyboard
    }
  );
  console.log('📢 POSTED USING POSTER IMAGE');
} else {
  await bot.sendMessage(
    PUBLIC_CHANNEL_ID,
    caption,
    { reply_markup: keyboard }
  );
  console.log('📢 POSTED WITHOUT IMAGE (NO POSTER FOUND)');
}


    console.log('📢 AUTO POSTED TO PUBLIC CHANNEL');

  } catch (err) {
    console.error('❌ AUTO POST ERROR:', err.message);
  }
});

/* ================= FORCE JOIN ================= */

async function checkForceJoin(userId) {
  for (const ch of FORCE_CHANNELS) {
    try {
      const m = await bot.getChatMember(ch, userId);
      if (!['member', 'administrator', 'creator'].includes(m.status)) {
        return false;
      }
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

/* ================= ADS GATE ================= */

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
        [{ text: '🎥 Watch Video', url: `${process.env.RENDER_EXTERNAL_URL}/ads/video?uid=${userId}&fid=${fid}` }],
        [{ text: '🔗 Shortlink', url: `${process.env.RENDER_EXTERNAL_URL}/ads/shortlink?uid=${userId}&fid=${fid}` }]
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
        [{ text: '🎥 Watch Video', url: `${process.env.RENDER_EXTERNAL_URL}/ads/video?uid=${userId}&fid=${fid}` }],
        [{ text: '🔗 Shortlink', url: `${process.env.RENDER_EXTERNAL_URL}/ads/shortlink?uid=${userId}&fid=${fid}` }]
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

bot.setWebHook(`${process.env.RENDER_EXTERNAL_URL}/webhook`);
