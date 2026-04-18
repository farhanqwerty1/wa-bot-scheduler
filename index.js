const express = require('express')
const app = express()

app.get('/', (req, res) => {
  res.send('WA Bot aktif 🚀')
})

const PORT = process.env.PORT || 3000
app.listen(PORT)

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
    minutes: wib.getHours() * 60 + wib.getMinutes(),
    hours: wib.getHours()
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

        // ONCE
        if (item.type === 'once') {
          if (
            item.tanggal === now.date &&
            now.minutes >= itemMinutes &&
            !sentCache.has(key)
          ) {
            sentCache.add(key)

            await sock.sendMessage(item.group, {
              text: `⏰ ONCE REMINDER\n📅 ${item.tanggal}\n⏰ ${item.jam}\n📌 ${item.kegiatan}`,
              mentions: item.mentions || []
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

            await sock.sendMessage(item.group, {
              text: `🔁 DAILY REMINDER\n⏰ ${item.jam}\n📌 ${item.kegiatan}`,
              mentions: item.mentions || []
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

  const { state, saveCreds } = await useMultiFileAuthState('session')
  const { version } = await fetchLatestBaileysVersion()

  sockInstance = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }),
    printQRInTerminal: false,
    markOnlineOnConnect: true
  })

  sockInstance.ev.on('creds.update', saveCreds)

  // =======================
  // CONNECTION
  sockInstance.ev.on('connection.update', (update) => {

    const { connection, lastDisconnect } = update

    // =======================
    // PAIRING CODE (ONLY ONCE)
    // =======================
    const phoneNumber = "6285772093943"

    if (!sockInstance._pairingSent) {
      sockInstance._pairingSent = true

      setTimeout(async () => {
        try {
          const code = await sockInstance.requestPairingCode(phoneNumber)
          console.log("🔥 PAIRING CODE:", code)
        } catch (err) {
          console.log("❌ Pairing error:", err)
        }
      }, 3000)
    }

    // =======================
    if (connection === 'open') {
      console.log('✅ Bot connected!')
      startScheduler(sockInstance)
      isRestarting = false
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      const reconnect = code !== DisconnectReason.loggedOut

      sockInstance = null

      if (reconnect && !isRestarting) {
        isRestarting = true
        console.log('🔄 Reconnect...')
        setTimeout(startBot, 5000)
      }
    }
  })

  // =======================
  // MESSAGE HANDLER
  sockInstance.ev.on('messages.upsert', async (m) => {

    try {

      const msg = m.messages[0]
      if (!msg.message) return

      const from = msg.key.remoteJid

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        ''

      if (text === 'Check') {
        return sockInstance.sendMessage(from, {
          text: 'Alhamdulillah Sehat Pak Boss ✅'
        })
      }

      // =======================
      if (text.startsWith('/jadwal once')) {

        const parts = text.split(' ')
        const tanggal = parts[2]
        const jam = normalizeJam(parts[3])
        const kegiatan = parts.slice(4).join(' ')

        const data = await loadJadwal()

        data.push({
          id: Date.now(),
          type: 'once',
          tanggal,
          jam,
          kegiatan,
          group: from,
          mentions: []
        })

        await saveJadwal(data)

        return sockInstance.sendMessage(from, {
          text: '✅ ONCE ditambahkan'
        })
      }

      // DAILY
      if (text.startsWith('/jadwal daily')) {

        const parts = text.split(' ')
        const jam = normalizeJam(parts[2])
        const kegiatan = parts.slice(3).join(' ')

        const data = await loadJadwal()

        data.push({
          id: Date.now(),
          type: 'daily',
          jam,
          kegiatan,
          group: from,
          mentions: []
        })

        await saveJadwal(data)

        return sockInstance.sendMessage(from, {
          text: '🔁 DAILY ditambahkan'
        })
      }

      // LIHAT
      if (text === '/jadwal lihat') {

        const data = await loadJadwal()

        let res = '📅 Jadwal:\n\n'

        data.forEach((j, i) => {
          res += `${i + 1}. ${j.type} - ${j.tanggal || '-'} ${j.jam} - ${j.kegiatan}\n`
        })

        return sockInstance.sendMessage(from, { text: res })
      }

    } catch (err) {
      console.log('❌ Error:', err)
    }
  })
}

// =======================
startBot()
