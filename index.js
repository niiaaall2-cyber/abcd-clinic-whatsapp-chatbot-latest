require('dotenv').config()
const express = require('express')
const bodyParser = require('body-parser')
const axios = require('axios')
const fs = require('fs')

const app = express()
app.use(bodyParser.json())

const PORT = process.env.PORT || 3000
const STATE_FILE = './bookingState.json'

// create state file if not exists
if (!fs.existsSync(STATE_FILE)) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({}))
}

const getState = () => JSON.parse(fs.readFileSync(STATE_FILE))
const saveState = (data) =>
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2))

// 👉 MAIN WEBHOOK
app.post('/webhook', async (req, res) => {
  try {
    const from = req.body.from
    const message = req.body.message

    let states = getState()
    let userState = states[from]

    // booking flow already started
    if (userState) {
      await handleBooking(from, message, userState, states)
      return res.sendStatus(200)
    }

    // booking trigger words
    if (/book|appointment|schedule|reserve/i.test(message)) {
      states[from] = { step: 'name', data: {} }
      saveState(states)
      await sendWhatsApp(from, "Sure 🙂 What's your *name*?")
      return res.sendStatus(200)
    }

    // normal AI reply
    const reply = await aiReply(message)
    await sendWhatsApp(from, reply)

    res.sendStatus(200)
  } catch (err) {
    console.error(err)
    res.sendStatus(500)
  }
})

// 👉 BOOKING HANDLER
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

      // send booking alert to staff
      await sendWhatsApp(
        process.env.STAFF_WHATSAPP,
        `📢 *New Booking*\n\nName: ${state.data.name}\nService: ${state.data.service}\nPhone: ${state.data.phone}\nTime: ${state.data.datetime}`
      )

      // confirmation to user
      await sendWhatsApp(
        from,
        "✅ Thank you! One of our staff members will contact you shortly to confirm."
      )

      delete states[from]
      saveState(states)
      return
  }

  states[from] = state
  saveState(states)
}

// 👉 OPENAI REPLY
async function aiReply(text) {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content:
            'Reply in the same language as user (English, Malayalam, Manglish). YOUR FULL SYSTEM PROMPT AND KNOWLEDGE BASE HERE.'
        },
        { role: 'user', content: text }
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

// 👉 SEND WHATSAPP MESSAGE
async function sendWhatsApp(to, text) {
  await axios.post(
    process.env.CHATMITRA_SEND_URL,
    { to, message: text },
    {
      headers: {
        Authorization: `Bearer ${process.env.CHATMITRA_TOKEN}`
      }
    }
  )
}

app.listen(PORT, () =>
  console.log(`Bot running on port ${PORT}`)
)