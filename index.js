require('dotenv').config()

const express = require('express')
const axios = require('axios')
const fs = require('fs')

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const PORT = process.env.PORT || 3000
const STATE_FILE = './bookingState.json'

// -------------------- INIT STATE FILE --------------------
if (!fs.existsSync(STATE_FILE)) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({}))
}

const getState = () => JSON.parse(fs.readFileSync(STATE_FILE))
const saveState = (data) =>
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2))

// -------------------- WEBHOOK --------------------
app.post('/webhook', async (req, res) => {
  try {
    console.log("RAW BODY:", JSON.stringify(req.body, null, 2))

    const from =
      req.body.from ||
      req.body?.data?.from ||
      req.body?.messages?.[0]?.from

    const message =
      req.body.message ||
      req.body?.data?.message ||
      req.body?.messages?.[0]?.body

    if (!from || !message) {
      console.log("Invalid payload - missing from/message")
      return res.sendStatus(200)
    }

    let states = getState()
    let userState = states[from]

    // ---------------- BOOKING FLOW ----------------
    if (userState) {
      await handleBooking(from, message, userState, states)
      return res.sendStatus(200)
    }

    // ---------------- TRIGGER BOOKING ----------------
    if (/book|appointment|schedule|reserve/i.test(message)) {
      states[from] = { step: 'name', data: {} }
      saveState(states)

      await sendWhatsApp(from, "Sure 🙂 What's your *name*?")
      return res.sendStatus(200)
    }

    // ---------------- AI RESPONSE ----------------
    const reply = await aiReply(message)
    await sendWhatsApp(from, reply)

    res.sendStatus(200)

  } catch (err) {
    console.error("WEBHOOK ERROR:", err)
    res.sendStatus(200)
  }
})

// -------------------- BOOKING HANDLER --------------------
async function handleBooking(from, msg, state, states) {
  switch (state.step) {

    case 'name':
      state.data.name = msg
      state.step = 'service'
      await sendWhatsApp(from, "Which *service* do you need?")
      break

    case 'service':
      state.data.service = msg
      state.step = 'phone'
      await sendWhatsApp(from, "Please share your *phone number* 📞")
      break

    case 'phone':
      state.data.phone = msg
      state.step = 'datetime'
      await sendWhatsApp(from, "Preferred *date & time*?")
      break

    case 'datetime':
      state.data.datetime = msg

      // ---------------- STAFF ALERT ----------------
      await sendWhatsApp(
        process.env.STAFF_WHATSAPP,
        `📢 *New Booking Request*\n\nName: ${state.data.name}\nService: ${state.data.service}\nPhone: ${state.data.phone}\nTime: ${state.data.datetime}`
      )

      // ---------------- USER CONFIRMATION ----------------
      await sendWhatsApp(
        from,
        "Thank you! 😊 Your booking request has been received. One of our team members will contact you shortly to confirm your appointment."
      )

      delete states[from]
      saveState(states)
      return
  }

  states[from] = state
  saveState(states)
}

// -------------------- OPENAI --------------------
async function aiReply(text) {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: process.env.SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: text
        }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      }
    }
  )

  return response.data.choices[0].message.content
}

// -------------------- WHATSAPP SENDER --------------------
async function sendWhatsApp(to, text) {
  try {
    await axios.post(
      process.env.CHATMITRA_SEND_URL,
      {
        recipient_mobile_number: to,
        messages: [
          {
            kind: "text",
            text: text
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.CHATMITRA_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    )
  } catch (err) {
    console.error("SEND ERROR:", err.response?.data || err.message)
  }
}

// -------------------- HEALTH CHECK --------------------
app.get('/', (req, res) => {
  res.send("WhatsApp Bot is Running 🚀")
})

// -------------------- START SERVER --------------------
app.listen(PORT, () => {
  console.log(`Bot running on port ${PORT}`)
})