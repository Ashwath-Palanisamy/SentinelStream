require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const admin = require('firebase-admin');
const express = require('express');

// --- 1. CONFIG & ENVIRONMENT ---
// We use lowercase 'port' and 'watchedChannels' to avoid duplicate declaration errors
const port = process.env.PORT || 3000;
const watchedChannels = process.env.WATCHED_CHANNELS ? process.env.WATCHED_CHANNELS.split(',') : [];

// --- 2. HEALTH CHECK SERVER ---
const app = express();
app.get('/', (req, res) => { res.send('Sentinel is Watching'); });
app.listen(port, () => console.log(` Health check listening on port ${port}`));

// --- 3. FIREBASE INITIALIZATION ---
admin.initializeApp({
  credential: admin.credential.cert('./serviceAccount.json') 
});

const db = admin.firestore();

// --- 4. DISCORD BOT SETUP ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, 
  ],
});

client.once('ready', () => {
  console.log(`✅ Sentinel Online | Watching ${watchedChannels.length} channels.`);
});

client.on('messageCreate', async (message) => {
  // Ignore bot messages to prevent infinite loops
  if (message.author.bot) return;

  // Verify the message is in a monitored channel
  if (watchedChannels.includes(message.channelId)) {
    try {
      await db.collection('raw_logs').add({
        author: message.author.tag,
        content: message.content,
        channel: message.channel.name,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`[LOGGED] ${message.author.username} in #${message.channel.name}`);
    } catch (err) {
      console.error('Firebase Error:', err);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);