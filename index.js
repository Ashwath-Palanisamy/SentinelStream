require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const admin = require('firebase-admin');
const express = require('express');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- 1. CONFIG & INIT ---
const port = process.env.PORT || 3000;
const watchedChannels = process.env.WATCHED_CHANNELS ? process.env.WATCHED_CHANNELS.split(',') : [];
const rulesChannelId = process.env.RULES_CHANNEL_ID;
const reportChannelId = process.env.REPORT_CHANNEL_ID; // NEW: The private Chennai channel ID
const adminName = process.env.ADMIN_NAME || 'AKSG';
const serverName = process.env.SERVER_NAME || 'FriendSMP75';

const app = express();
app.get('/', (req, res) => { res.send('Sentinel is Watching'); });
app.listen(port, () => console.log(`🚀 Health check listening on port ${port}`));

// Firebase & Gemini Init
if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert('./serviceAccount.json') });
}
const db = admin.firestore();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

// --- 2. THE BRAIN (Analysis Function) ---
async function runBoardAnalysis() {
    console.log("📊 CRON: Commencing Intelligence Briefing...");
    try {
        // A. Fetch Rules Context
        let rulesContext = "Standard server protocol.";
        if (rulesChannelId) {
            const rulesChannel = await client.channels.fetch(rulesChannelId);
            const messages = await rulesChannel.messages.fetch({ limit: 1 });
            rulesContext = messages.first()?.content || rulesContext;
        }

        // B. Fetch Logs
        const snapshot = await db.collection('raw_logs').orderBy('timestamp', 'desc').limit(100).get();
        if (snapshot.empty) return;

        let logString = "";
        snapshot.forEach(doc => {
            const data = doc.data();
            logString += `[${data.author}]: ${data.content}\n`;
        });

        // C. The Dynamic Prompt
        const prompt = `
            SYSTEM: You are the Sentinel Intelligence Unit for the ${serverName} Executive Board. 
            Tone: Cold, clinical, authoritative. Serve only ${adminName}.

            CORE PROTOCOLS (from #rules):
            ${rulesContext}

            TASK: Analyze logs for hazards and efficiency.
            OUTPUT STRUCTURE:
            1. STATUS: [STABLE/HEATED/CRITICAL]
            2. RULE COMPLIANCE: Identify violations of ${rulesContext}.
            3. SUPPORT AUDIT: Are users following support protocols?
            4. PATTERN RECOGNITION: Top 3 discussion topics.
            5. EXECUTIVE DIRECTIVE: One command for ${adminName}.

            LOGS:
            ---
            ${logString}
            ---
        `;

        const result = await model.generateContent(prompt);
        const reportText = result.response.text();

        // D. Send to Discord Channel with Chunking (to avoid 2000 char limit)
        if (reportChannelId) {
            const reportChannel = await client.channels.fetch(reportChannelId);
            for (let i = 0; i < reportText.length; i += 1900) {
                const chunk = reportText.substring(i, i + 1900);
                await reportChannel.send(`**[BOARD BRIEFING - ${new Date().toLocaleDateString()}]**\n${chunk}`);
            }
        }
        
        console.log("✅ Report delivered to Discord.");

    } catch (err) {
        console.error("Analysis Error:", err);
    }
}

// --- 3. SCHEDULE (Runs daily at midnight) ---
cron.schedule('* * * * *', () => { runBoardAnalysis(); });

// --- 4. DISCORD BOT LOGIC ---
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once('clientReady', (c) => {
    console.log(`✅ Sentinel Online | Watching ${watchedChannels.length} channels.`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !watchedChannels.includes(message.channelId)) return;
    try {
        await db.collection('raw_logs').add({
            author: message.author.tag,
            content: message.content,
            channel: message.channel.name,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[LOGGED] ${message.author.username}`);
    } catch (err) {
        console.error('Firebase Error:', err);
    }
});

client.login(process.env.DISCORD_TOKEN);