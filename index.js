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
const qrcode = require('qrcode-terminal')
const cron = require('node-cron')
const fs = require('fs-extra')

// =======================
const JADWAL_FILE = './jadwal.json'

let sockInstance = null
let isRestarting = false
const sentCache = new Set()

// =======================
// NORMALIZE JAM (AUTO DETECT FORMAT)
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
// WIB FIX
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
// SCHEDULER (CATCH-UP SYSTEM)
function startScheduler(sock) {
  cron.schedule('* * * * *', async () => {
    try {

      const now = getWIBTime()
      const data = await loadJadwal()

      console.log('⏰ CHECK:', now.date, now.minutes)
      console.log('📦 TOTAL:', data.length)

      for (let item of data) {

        const jam = normalizeJam(item.jam)
        const [h, m] = jam.split(':').map(Number)
        const itemMinutes = h * 60 + m

        const key = `${item.id}-${now.date}-${item.jam}`

        // =======================
        // ONCE (CATCH UP SAFE)
        // =======================
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

            // DM
            for (let u of item.mentions || []) {
              await sock.sendMessage(u, {
                text: `🔔 REMINDER PRIBADI\n📌 ${item.kegiatan}\n⏰ ${item.jam}`
              })
            }
          }
        }

        // =======================
        // DAILY (EVERY DAY + CATCH UP)
        // =======================
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

            for (let u of item.mentions || []) {
              await sock.sendMessage(u, {
                text: `🔔 DAILY REMINDER\n📌 ${item.kegiatan}\n⏰ ${item.jam}`
              })
            }
          }
        }

        // =======================
        // LEGACY
        // =======================
        if (!item.type) {

          if (
            item.tanggal === now.date &&
            now.minutes >= itemMinutes &&
            !sentCache.has(key)
          ) {

            sentCache.add(key)

            await sock.sendMessage(item.group, {
              text: `⏰ REMINDER\n📅 ${item.tanggal}\n⏰ ${item.jam}\n📌 ${item.kegiatan}`,
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
 const phoneNumber = "6285772093943" // ganti nomor kamu

setTimeout(async () => {
  try {
    const code = await sockInstance.requestPairingCode(phoneNumber)
    console.log("🔥 PAIRING CODE:", code)
  } catch (err) {
    console.log("❌ Pairing error:", err)
  }
}, 3000)
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
  sockInstance.ev.on('messages.upsert', async (m) => {

    try {

      const msg = m.messages[0]
      if (!msg.message) return

      const from = msg.key.remoteJid

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        ''

      const mentionedJid =
        msg.message.extendedTextMessage?.contextInfo?.mentionedJid || []

      // =======================
      if (text === 'Check') {
        return sockInstance.sendMessage(from, {
          text: 'Alhamdulillah Sehat Pak Boss ✅'
        })
      }

      // =======================
      // ONCE
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
          mentions: mentionedJid
        })

        await saveJadwal(data)

        return sockInstance.sendMessage(from, {
          text: `✅ ONCE ditambahkan`
        })
      }

      // =======================
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
          mentions: mentionedJid
        })

        await saveJadwal(data)

        return sockInstance.sendMessage(from, {
          text: `🔁 DAILY ditambahkan`
        })
      }

      // =======================
      // LEGACY
      if (text.startsWith('/jadwal tambah')) {

        const now = getWIBTime()
        const parts = text.split(' ')

        const jam = normalizeJam(parts[2])
        const kegiatan = parts.slice(3).join(' ')

        const data = await loadJadwal()

        data.push({
          id: Date.now(),
          type: 'once',
          tanggal: now.date,
          jam,
          kegiatan,
          group: from,
          mentions: mentionedJid
        })

        await saveJadwal(data)

        return sockInstance.sendMessage(from, {
          text: `✅ Jadwal berhasil ditambahkan`
        })
      }

      // =======================
      // LIHAT
      if (text === '/jadwal lihat') {

        const data = await loadJadwal()

        if (!data.length) {
          return sockInstance.sendMessage(from, {
            text: '📭 kosong'
          })
        }

        let res = '📅 Jadwal:\n\n'

        data.forEach((j, i) => {
          res += `${i + 1}. ${j.type} - ${j.tanggal || '-'} ${j.jam} - ${j.kegiatan}\n`
        })

        return sockInstance.sendMessage(from, { text: res })
      }
	// =======================
      // HAPUS JADWAL
      // =======================
      if (text.startsWith('/jadwal hapus')) {

        let data = await loadJadwal()
        const args = text.split(' ').slice(2)

        if (!args.length) {
          return sockInstance.sendMessage(from, {
            text: '❌ Contoh:\n/jadwal hapus 1\n/jadwal hapus 1 3\n/jadwal hapus 2-4'
          })
        }

        let indexes = []

        for (let arg of args) {

          if (arg.includes('-')) {
            let [start, end] = arg.split('-').map(Number)

            for (let i = start; i <= end; i++) {
              indexes.push(i - 1)
            }

          } else {
            indexes.push(parseInt(arg) - 1)
          }
        }

        indexes = [...new Set(indexes)].sort((a, b) => b - a)

        let removed = []

        for (let i of indexes) {

          if (i >= 0 && i < data.length && data[i].group === from) {
            removed.push(data[i])
            data.splice(i, 1)
          }
        }

        await saveJadwal(data)

        return sockInstance.sendMessage(from, {
          text: `🗑️ ${removed.length} jadwal berhasil dihapus`
        })
      }

    } catch (err) {
      console.log('❌ Error:', err)
    }
  })
}

// =======================
startBot()
