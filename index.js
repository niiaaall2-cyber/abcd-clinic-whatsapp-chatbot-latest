require("dotenv").config();

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const Groq = require("groq-sdk");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const STATE_FILE = "./bookingState.json";

// -------------------- SYSTEM PROMPT --------------------
const SYSTEM_PROMPT = fs.readFileSync("./system_prompt.txt", "utf8");

// -------------------- GROQ --------------------
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

async function aiReply(text) {
  try {
    const completion = await groq.chat.completions.create({
      model: "llama3-8b-8192",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    });

    return completion.choices[0].message.content;
  } catch (err) {
    console.error("GROQ ERROR FULL:", err);
    return "I'm facing some issues right now. Try again shortly.";
  }
}

// -------------------- SAFE STATE HANDLING --------------------
function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(data) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
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
            kind: "raw",
            payload: {
              type: "text",
              text: { body: text },
            },
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.CHATMITRA_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("SEND ERROR:", err.response?.data || err.message);
  }
}

// -------------------- WEBHOOK --------------------
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const body = req.body;

  const from =
    body?.from ||
    body?.data?.from ||
    body?.messages?.[0]?.from;

  const message =
    body?.message ||
    body?.data?.message ||
    body?.messages?.[0]?.text?.body ||
    body?.messages?.[0]?.body;

  if (!from || !message) return;

  let states = loadState();
  let userState = states[from];

  if (userState) {
    await handleBooking(from, message, userState, states);
    return;
  }

  if (/book|appointment|schedule|reserve/i.test(message)) {
    states[from] = { step: "name", data: {} };
    saveState(states);
    await sendWhatsApp(from, "Sure 🙂 What's your *name*?");
    return;
  }

  const userText = typeof message === "string"
  ? message
  : JSON.stringify(message);

const reply = await aiReply(userText);
  await sendWhatsApp(from, reply);
});

// -------------------- BOOKING HANDLER --------------------
async function handleBooking(from, msg, state, states) {
  switch (state.step) {
    case "name":
      state.data.name = msg;
      state.step = "service";
      await sendWhatsApp(from, "Which *service* do you need?");
      break;

    case "service":
      state.data.service = msg;
      state.step = "phone";
      await sendWhatsApp(from, "Please share your *phone number* 📞");
      break;

    case "phone":
      state.data.phone = msg;
      state.step = "datetime";
      await sendWhatsApp(from, "Preferred *date & time*?");
      break;

    case "datetime":
      state.data.datetime = msg;

      await sendWhatsApp(
        process.env.STAFF_WHATSAPP,
        `📢 *New Booking*\n\nName: ${state.data.name}\nService: ${state.data.service}\nPhone: ${state.data.phone}\nTime: ${state.data.datetime}`
      );

      await sendWhatsApp(
        from,
        "Done 👍 Your request is received. Our team will confirm shortly."
      );

      delete states[from];
      saveState(states);
      return;
  }

  states[from] = state;
  saveState(states);
}

// -------------------- HEALTH --------------------
app.get("/", (_, res) => {
  res.send("WhatsApp Bot Running 🚀");
});

// -------------------- START --------------------
app.listen(PORT, () => {
  console.log(`Bot running on port ${PORT}`);
});