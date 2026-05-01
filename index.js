require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType
} = require('discord.js');
const admin = require('firebase-admin');
const express = require('express');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require('@supabase/supabase-js');

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

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert('./serviceAccount.json') });
}
const db = admin.firestore();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Gemini Initialization - Using gemini-1.5-flash for SDK compatibility
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// --- 2. THE BRAIN (Daily Analysis) ---
async function runBoardAnalysis() {
    console.log("📊 CRON: Commencing Intelligence Briefing...");
    try {
        let rulesContext = "Standard server protocol.";
        if (rulesChannelId) {
            try {
                const rulesChannel = await client.channels.fetch(rulesChannelId);
                const rulesMessages = await rulesChannel.messages.fetch({ limit: 5 });
                if (rulesMessages.size > 0) {
                    rulesContext = rulesMessages.map(m => m.content).reverse().join('\n---\n');
                }
            } catch (e) { console.error("Rules Fetch Error:", e.message); }
        }

        const snapshot = await db.collection('raw_logs').orderBy('timestamp', 'desc').limit(100).get();
        if (snapshot.empty) return;

        let logString = "";
        snapshot.forEach(doc => {
            const data = doc.data();
            logString += `[${data.author}]: ${data.content}\n`;
        });

        const prompt = `SYSTEM: Sentinel Intelligence Unit for ${serverName}. Tone: Cold, authoritative. Serve only ${adminName}. LOGS: ${logString}`;
        const result = await model.generateContent(prompt);
        const reportText = result.response.text();

        if (reportChannelId) {
            const reportChannel = await client.channels.fetch(reportChannelId);
            await reportChannel.send(`**[--- START OF BOARD BRIEFING - ${new Date().toLocaleDateString()} ---]**`);
            for (let i = 0; i < reportText.length; i += 1900) {
                await reportChannel.send(reportText.substring(i, i + 1900));
            }
            await reportChannel.send(`**[--- END OF BRIEFING ---]**`);
        }
    } catch (err) { console.error("Analysis Error:", err); }
}

cron.schedule('0 0 * * *', () => { runBoardAnalysis(); });

// --- 3. COMMAND REGISTRATION ---
const commands = [
    new SlashCommandBuilder()
        .setName('setstaffrole')
        .setDescription('Set Staff Role')
        .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder()
        .setName('blocksupport')
        .setDescription('Rule 14: 14-day block for DMing staff')
        .addUserOption(o => o.setName('target').setDescription('User').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function registerCommands() {
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅ Sentinel: Slash commands synchronized.');
    } catch (error) { console.error('❌ Registration Error:', error); }
}

// --- 4. BOT EVENTS ---
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// Using clientReady as per latest logs to avoid deprecation warnings
client.once('clientReady', () => {
    console.log(`✅ Sentinel Online`);
    registerCommands();
});

client.on('messageCreate', async (message) => {
    if (!watchedChannels.includes(message.channelId) || (message.author.bot && message.author.id === client.user.id)) return;
    let logContent = message.content || (message.embeds[0] ? `${message.embeds[0].title} ${message.embeds[0].description}` : "");
    if (!logContent) return;
    try {
        await db.collection('raw_logs').add({
            author: message.author.tag,
            content: logContent,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (err) { console.error('Firebase Error:', err); }
});

client.login(process.env.DISCORD_TOKEN);