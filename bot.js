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
const UNLOCK_BASE_URL = process.env.UNLOCK_BASE_URL;


const FORCE_CHANNELS = ['@perfecttcinema'];

const bot = new TelegramBot(TOKEN, { polling: false });


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

/* ================= POSTER MEMORY ================= */

let LAST_POSTER = null;

/* ================= STORAGE LISTENER ================= */

bot.on('channel_post', async (msg) => {
  if (msg.chat.id !== PRIVATE_CHANNEL_ID) return;

  /* ---- 1️⃣ POSTER ---- */
  if (msg.photo) {
    LAST_POSTER = {
      file_id: msg.photo[msg.photo.length - 1].file_id,
      caption: msg.caption || '🎬 Movie Available'
    };
    console.log('🖼️ POSTER STORED');
    return;
  }

  /* ---- 2️⃣ FILE ---- */
  const file = msg.video || msg.document;
  if (!file) return;

  if (!LAST_POSTER) {
    console.log('⚠️ FILE RECEIVED WITHOUT POSTER — SKIPPED');
    return;
  }

  const fid = crypto.randomBytes(6).toString('hex');

  try {
    await FileMap.create({
      fid,
      channelId: msg.chat.id,
      messageId: msg.message_id
    });

    const caption = `
🎬 ${LAST_POSTER.caption}

━━━━━━━━━━━━━━
⬇️ Click below to download
━━━━━━━━━━━━━━
`.trim();

    await bot.sendPhoto(
      PUBLIC_CHANNEL_ID,
      LAST_POSTER.file_id,
      {
        caption,
        reply_markup: {
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
        }
      }
    );

    console.log('📢 AUTO POSTED:', fid);

    LAST_POSTER = null; // reset after use

  } catch (e) {
    console.error('❌ AUTO POST ERROR:', e.message);
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

/* ================= DOWNLOAD FLOW ================= */

bot.onText(/\/start\s+f_(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const fid = match[1];

  const row = await FileMap.findOne({ fid });
  if (!row) return bot.sendMessage(chatId, '❌ File not found');

  if (!(await checkForceJoin(userId))) {
    return bot.sendMessage(chatId, '📢 Join channel first', {
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
        [{ text: '🎥 Watch Video', url: `${UNLOCK_BASE_URL}/ads/video?uid=${userId}&fid=${fid}` }],
        [{ text: '🔗 Shortlink', url: `${UNLOCK_BASE_URL}/ads/shortlink?uid=${userId}&fid=${fid}` }]
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
        [{ text: '🎥 Watch Video', url: `${UNLOCK_BASE_URL}/ads/video?uid=${userId}&fid=${fid}` }],
        [{ text: '🔗 Shortlink', url: `${UNLOCK_BASE_URL}/ads/shortlink?uid=${userId}&fid=${fid}` }]
      ]
    }
  });
});

/* ================= VERIFY ================= */

bot.onText(/\/start\s+verify_(.+)/, async (msg, match) => {
  console.log('VERIFY START HIT', msg.chat.id); // 👈 ADD

  const chatId = msg.chat.id;

  let data;
  try {
    data = JSON.parse(Buffer.from(match[1], 'base64').toString());
  } catch {
    console.log('PAYLOAD DECODE FAIL'); // 👈 ADD
    return bot.sendMessage(chatId, '❌ Invalid verification');
  }

  console.log('PAYLOAD OK', data); // 👈 ADD

  const { uid, fid, method, ts, token } = data;

  const check = crypto
    .createHmac('sha256', WEB_SECRET)
    .update(`${uid}:${fid}:${method}:${ts}`)
    .digest('hex');

  if (uid !== chatId || check !== token) {
    console.log('HMAC FAIL'); // 👈 ADD
    return bot.sendMessage(chatId, '❌ Verification failed');
  }

  console.log('VERIFIED OK'); // 👈 ADD

  const row = await FileMap.findOne({ fid });
  console.log('DB ROW', row); // 👈 ADD

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

const BOT_BASE_URL = process.env.BOT_BASE_URL;

bot.setWebHook(`${BOT_BASE_URL}/webhook`);
