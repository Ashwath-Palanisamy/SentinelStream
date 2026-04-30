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

// Firebase Initialization
if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert('./serviceAccount.json') });
}
const db = admin.firestore();

// Gemini 3 Flash Initialization
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

// --- 2. THE BRAIN (Analysis Function) ---
async function runBoardAnalysis() {
    console.log("📊 CRON: Commencing Intelligence Briefing...");
    try {
        // A. DYNAMIC RULES SYNC
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

        // B. FETCH LOGS FROM FIREBASE (Last 100 entries)
        const snapshot = await db.collection('raw_logs')
            .orderBy('timestamp', 'desc')
            .limit(100)
            .get();

        if (snapshot.empty) return console.log("CRON: No logs found in Database.");

        let logString = "";
        snapshot.forEach(doc => {
            const data = doc.data();
            logString += `[${data.author}]: ${data.content}\n`;
        });

        // C. THE SMART SENTINEL PROMPT
        const prompt = `
            SYSTEM: 
            You are the **Sentinel Intelligence Unit** for the ${serverName} Executive Board. 
            Tone: Cold, authoritative, and clinical. Serve only ${adminName}.

            OPERATIONAL CONTEXT:
            - Messages from "**FriendSMP75 Server chat#3273**" or formatted as "[Title] Description" are Minecraft Bridge events.
            - These represent players currently active in-game. 
            - These logs include **Embed Data**: Deaths, Joins, Leaves, and Advancements. Treat "Death Messages" as environmental hazards or PvP indicators.

            CORE PROTOCOLS (SYNCED FROM #RULES):
            ${rulesContext}

            ANALYSIS GUIDELINES:
            1. **Strict Enforcement**: Flag direct protocol violations (DMing staff, slurs, malicious spam, or hacks like X-Ray) as **CRITICAL**.
            2. **Social Calibration**: Distinguish between "Casual Human Interaction" and "System Disruption." 
               - Banter between long-term associates is beneficial Social Cohesion.
            3. **Activity Tracking**: Use Join/Leave data to determine server population density and "vibe."

            REQUIRED OUTPUT STRUCTURE:
            1. **OPERATIONAL STATUS**: [STABLE / HEATED / CRITICAL]
            2. **RULE COMPLIANCE**: Identify specific violations of the protocols. Ignore casual banter.
            3. **SOCIAL COHESION REPORT**: Briefly summarize player interactions and community vibe.
            4. **INCIDENT AUDIT**: Summarize deaths, combat events, or technical malfunctions (like blank packets).
            5. **EXECUTIVE DIRECTIVE**: Give ${adminName} one strategic command.

            LOG DATA:
            ---
            ${logString}
            ---
        `;

        const result = await model.generateContent(prompt);
        const reportText = result.response.text();

        // D. CLEAN FRAGMENTED DELIVERY
        if (reportChannelId) {
            const reportChannel = await client.channels.fetch(reportChannelId);
            const dateStr = new Date().toLocaleDateString();
            
            await reportChannel.send(`**[--- START OF BOARD BRIEFING - ${dateStr} ---]**`);

            for (let i = 0; i < reportText.length; i += 1900) {
                const chunk = reportText.substring(i, i + 1900);
                await reportChannel.send(chunk);
            }

            await reportChannel.send(`**[--- END OF BRIEFING - SENTINEL UNIT ---]**`);
        }
        console.log("✅ Analysis complete and delivered.");

    } catch (err) {
        console.error("Analysis Error:", err);
    }
}

// --- 3. THE CRON SCHEDULE (Daily at Midnight) ---
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

    if (!isWatchedChannel || (isBot && message.author.id === client.user.id)) return;

    // --- EMBED PARSING FOR BRIDGE BOT ---
    let logContent = message.content;

    if (!logContent && message.embeds.length > 0) {
        const embed = message.embeds[0];
        const title = embed.title ? `[${embed.title}] ` : "";
        const desc = embed.description ? embed.description : "";
        const fields = embed.fields.map(f => `${f.name}: ${f.value}`).join(' | ');
        
        logContent = `${title}${desc} ${fields}`.trim();
    }

    if (!logContent) return; // Skip if no text and no embed content

    try {
        await db.collection('raw_logs').add({
            author: message.author.tag,
            content: logContent,
            channel: message.channel.name,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            fromBot: isBot
        });
        console.log(`[LOGGED] ${isBot ? '[BRIDGE/EMBED]' : ''} ${message.author.username}`);
    } catch (err) {
        console.error('Firebase Error:', err);
    }
});

client.login(process.env.DISCORD_TOKEN);