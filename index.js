const express = require('express')
const app = express()

app.get('/', (req, res) => {
  res.send('WA Bot aktif 🚀')
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log("🌐 Server running on port", PORT)
})

const makeWASocket = require('@whiskeysockets/baileys').default
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys')

const P = require('pino')
const cron = require('node-cron')
const fs = require('fs-extra')

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

      for (let item of data) {

        const jam = normalizeJam(item.jam)
        const [h, m] = jam.split(':').map(Number)
        const itemMinutes = h * 60 + m

        const key = `${item.id}-${now.date}-${item.jam}`

        if (item.type === 'once') {
          if (
            item.tanggal === now.date &&
            now.minutes >= itemMinutes &&
            !sentCache.has(key)
          ) {
            sentCache.add(key)

            await sock.sendMessage(item.group, {
              text: `⏰ ONCE REMINDER\n📅 ${item.tanggal}\n⏰ ${item.jam}\n📌 ${item.kegiatan}`
            })
          }
        }

        if (item.type === 'daily') {
          if (
            now.minutes >= itemMinutes &&
            !sentCache.has(key)
          ) {
            sentCache.add(key)

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
    printQRInTerminal: false
  })

  sockInstance = sock

  // =======================
  sock.ev.on('creds.update', saveCreds)

  // =======================
  sock.ev.on('connection.update', (update) => {
  const { connection, lastDisconnect } = update
  console.log('📡 STATUS:', connection)

    // =======================
    // PAIRING FIX (ANTI FAIL)
    if (connection === 'connecting') {

      if (!sock._pairingSent) {
        sock._pairingSent = true

        setTimeout(async () => {
          try {
            const phoneNumber = "6285772093943"

            const code = await sock.requestPairingCode(phoneNumber)

            console.log("🔥 PAIRING CODE:", code)

          } catch (err) {
            console.log("❌ Pairing error:", err)
          }
        }, 7000)
      }
    }

    // =======================
    if (connection === 'open') {
      console.log('✅ BOT CONNECTED')
      startScheduler(sock)
    }

    // =======================
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
  sock.ev.on('messages.upsert', async (m) => {

    console.log("📩 MESSAGE IN")

    try {

      const msg = m.messages?.[0]
      if (!msg || msg.key.fromMe) return

      const from = msg.key.remoteJid

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        ''

      console.log("📨 TEXT:", text)

      if (text === 'Check') {
        return await sock.sendMessage(from, {
          text: 'Alhamdulillah Sehat Pak Boss ✅'
        })
      }

    } catch (err) {
      console.log('❌ ERROR:', err)
    }
  })
}

// =======================
startBot()
