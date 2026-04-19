// =======================
// EXPRESS (WAJIB RENDER)
const express = require('express')
const app = express()
const path = require('path')

app.get('/', (req, res) => {
  res.send('WA Bot aktif 🚀')
})

// 🔥 AKSES QR VIA BROWSER
app.get('/qr', (req, res) => {
  res.sendFile(path.join(__dirname, 'qr.png'))
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log("🌐 Server running on port", PORT)
})

// =======================
const makeWASocket = require('@whiskeysockets/baileys').default
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys')

const P = require('pino')
const cron = require('node-cron')
const fs = require('fs-extra')
const QRCode = require('qrcode')

// =======================
fs.ensureDirSync('./auth_info')

const JADWAL_FILE = './jadwal.json'

let sockInstance = null
let isRestarting = false
const sentCache = new Set()

// =======================
// NORMALIZE JAM
function normalizeJam(input) {
  if (!input) return null

  let jam = input.toString().replace(/\./g, ':')

  if (/^\d{3,4}$/.test(jam)) {
    jam = jam.padStart(4, '0')
    jam = jam.slice(0, 2) + ':' + jam.slice(2)
  }

  if (/^\d{1,2}$/.test(jam)) {
    jam = jam.padStart(2, '0') + ':00'
  }

  return jam
}

// =======================
// WIB TIME
function getWIBTime() {
  const now = new Date()
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000)
  const wib = new Date(utc + (7 * 60 * 60000))

  return {
    date: wib.toISOString().slice(0, 10),
    minutes: wib.getHours() * 60 + wib.getMinutes()
  }
}

// =======================
async function loadJadwal() {
  if (!(await fs.pathExists(JADWAL_FILE))) {
    await fs.writeJson(JADWAL_FILE, [])
  }
  return await fs.readJson(JADWAL_FILE)
}

async function saveJadwal(data) {
  await fs.writeJson(JADWAL_FILE, data, { spaces: 2 })
}

// =======================
// SCHEDULER
function startScheduler(sock) {
  cron.schedule('* * * * *', async () => {
    try {
      const now = getWIBTime()
      const data = await loadJadwal()

      console.log('⏰ CHECK:', now.date, now.minutes)

      for (let item of data) {

        const jam = normalizeJam(item.jam)
        if (!jam) continue

        const [h, m] = jam.split(':').map(Number)
        const itemMinutes = h * 60 + m

        const key = `${item.id}-${now.date}-${item.jam}`

        // ONCE
        if (item.type === 'once') {
          if (
            item.tanggal === now.date &&
            now.minutes >= itemMinutes &&
            !sentCache.has(key)
          ) {
            sentCache.add(key)

            console.log('🔥 ONCE TRIGGER')

            await sock.sendMessage(item.group, {
              text: `⏰ ONCE REMINDER\n📅 ${item.tanggal}\n⏰ ${item.jam}\n📌 ${item.kegiatan}`
            })
          }
        }

        // DAILY
        if (item.type === 'daily') {
          if (
            now.minutes >= itemMinutes &&
            !sentCache.has(key)
          ) {
            sentCache.add(key)

            console.log('🔥 DAILY TRIGGER')

            await sock.sendMessage(item.group, {
              text: `🔁 DAILY REMINDER\n⏰ ${item.jam}\n📌 ${item.kegiatan}`
            })
          }
        }
      }

    } catch (err) {
      console.log('❌ Scheduler error:', err)
    }
  })
}

// =======================
// BOT START
async function startBot() {

  const { state, saveCreds } = await useMultiFileAuthState('./auth_info')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }),

    // 🔥 FIX RENDER
    keepAliveIntervalMs: 10000,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0
  })

  sockInstance = sock

  // =======================
  sock.ev.on('creds.update', saveCreds)

  // =======================
  sock.ev.on('connection.update', async (update) => {

    const { connection, lastDisconnect, qr } = update
    console.log('📡 STATUS:', connection)

    // 🔥 QR IMAGE (ANTI WRAP)
    if (qr) {
      console.log('📱 Generating QR...')

      await QRCode.toFile('./qr.png', qr, { scale: 8 })

      console.log('✅ QR ready: /qr')
    }

    // CONNECTED
    if (connection === 'open') {
      console.log('✅ BOT CONNECTED')
      startScheduler(sock)
    }

    // DISCONNECT
    if (connection === 'close') {

      const reconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut

      sockInstance = null

      if (reconnect && !isRestarting) {
        isRestarting = true
        console.log('🔄 RECONNECT...')
        setTimeout(startBot, 5000)
      }
    }
  })

  // =======================
  // AUTO CHECK SOCKET
  setInterval(() => {
    if (sock?.ws?.readyState !== 1) {
      console.log('⚠️ Reconnecting socket...')
      startBot()
    }
  }, 20000)

  // =======================
  // MESSAGE
  sock.ev.on('messages.upsert', async (m) => {

    try {
      const msg = m.messages?.[0]
      if (!msg || msg.key.fromMe) return

      const from = msg.key.remoteJid

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        ''

      console.log("📩", text)

      if (text.toLowerCase() === 'test') {
        return await sock.sendMessage(from, {
          text: 'Bot aktif ✅'
        })
      }

    } catch (err) {
      console.log('❌ ERROR:', err)
    }
  })
}

// =======================
startBot()
