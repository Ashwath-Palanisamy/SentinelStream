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
const reportChannelId = process.env.REPORT_CHANNEL_ID;
const adminName = process.env.ADMIN_NAME || 'AKSG';
const serverName = process.env.SERVER_NAME || 'FriendSMP75';

const app = express();
app.get('/', (req, res) => { res.send('Sentinel Intelligence is Operational'); });
app.listen(port, () => console.log(`🚀 Health check listening on port ${port}`));

// Firebase & Gemini Init
if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert('./serviceAccount.json') });
}
const db = admin.firestore();

// Using Gemini 3 Flash for the 2026 API lifecycle
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

// --- 2. THE BRAIN (Analysis Function) ---
async function runBoardAnalysis() {
    console.log("📊 CRON: Commencing Intelligence Briefing...");
    try {
        // A. DYNAMIC RULES FETCHING
        let rulesContext = "Standard server protocol.";
        if (rulesChannelId) {
            try {
                const rulesChannel = await client.channels.fetch(rulesChannelId);
                const rulesMessages = await rulesChannel.messages.fetch({ limit: 5 });
                if (rulesMessages.size > 0) {
                    rulesContext = rulesMessages.map(m => m.content).reverse().join('\n---\n');
                    console.log("📖 Rules synchronized from Discord.");
                }
            } catch (e) {
                console.error("Rules Fetch Error:", e.message);
            }
        }

        // B. FETCH LOGS FROM FIREBASE
        const snapshot = await db.collection('raw_logs')
            .orderBy('timestamp', 'desc')
            .limit(100)
            .get();

        if (snapshot.empty) return console.log("CRON: No logs found.");

        let logString = "";
        snapshot.forEach(doc => {
            const data = doc.data();
            logString += `[${data.author}]: ${data.content}\n`;
        });

        // C. THE BALANCED SENTINEL PROMPT
        const prompt = `
            SYSTEM: 
            You are the **Sentinel Intelligence Unit** for the ${serverName} Executive Board. 
            Tone: Cold, clinical, and authoritative. Serve only ${adminName}.

            CORE PROTOCOLS (READ FROM #RULES):
            ${rulesContext}

            ANALYSIS GUIDELINES:
            1. **Strict Enforcement**: Any direct violation of the protocols above (DMing staff, bypasses, slurs, or malicious spam) must be flagged as a **CRITICAL RISK**.
            2. **Social Calibration**: Distinguish between "Casual Human Interaction" and "System Disruption." 
               - Do not flag informal laughter, emojis, or minor repetition as a risk. 
               - Recognize these as "Social Cohesion" which is beneficial for server longevity.
            3. **Support Logic**: Identify if users are helping each other correctly versus giving bad advice.

            REQUIRED OUTPUT STRUCTURE:
            1. **OPERATIONAL STATUS**: [STABLE / HEATED / CRITICAL]
            2. **RULE COMPLIANCE**: Identify specific violations of the protocols. Ignore casual banter.
            3. **SOCIAL COHESION REPORT**: Summarize the community vibe.
            4. **SUPPORT AUDIT**: Audit any ticket-related or help-seeking chatter.
            5. **EXECUTIVE DIRECTIVE**: Give ${adminName} one strategic command.

            LOG DATA:
            ---
            ${logString}
            ---
        `;

        const result = await model.generateContent(prompt);
        const reportText = result.response.text();

        // D. DELIVERY WITH CHUNKING
        if (reportChannelId) {
            const reportChannel = await client.channels.fetch(reportChannelId);
            const dateStr = new Date().toLocaleDateString();
            
            for (let i = 0; i < reportText.length; i += 1900) {
                const chunk = reportText.substring(i, i + 1900);
                await reportChannel.send(`**[BOARD BRIEFING - ${dateStr}]**\n${chunk}`);
            }
        }
        console.log("✅ Analysis delivered.");

    } catch (err) {
        console.error("Analysis Error:", err);
    }
}

// --- 3. THE CRON SCHEDULE ---
// Set to '0 0 * * *' for midnight daily. Testing: '* * * * *'
cron.schedule('0 0 * * *', () => {
    runBoardAnalysis();
});

// --- 4. DISCORD BOT LOGIC ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ],
});

client.once('clientReady', () => {
    console.log(`✅ Sentinel Online | Watching ${watchedChannels.length} channels.`);
});

client.on('messageCreate', async (message) => {
    const isBot = message.author.bot;
    const isWatchedChannel = watchedChannels.includes(message.channelId);

    // LOGGING LOGIC:
    // 1. Must be a watched channel.
    // 2. Ignore the bot's own messages (don't log your own reports).
    // 3. Allow other bots (like the MC Bridge) to be logged.
    if (!isWatchedChannel || (isBot && message.author.id === client.user.id)) return;

    try {
        await db.collection('raw_logs').add({
            author: message.author.tag,
            content: message.content,
            channel: message.channel.name,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            fromBot: isBot
        });
        console.log(`[LOGGED] ${isBot ? '[BRIDGE]' : ''} ${message.author.username}`);
    } catch (err) {
        console.error('Firebase Error:', err);
    }
});

client.login(process.env.DISCORD_TOKEN);