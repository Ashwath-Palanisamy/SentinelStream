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

// Firebase Initialization
if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert('./serviceAccount.json') });
}
const db = admin.firestore();

// Supabase Initialization
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Gemini 3 Flash Initialization
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash" });

// --- 2. THE BRAIN (Analysis Function) ---
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
                    console.log("📖 Rules synchronized from Discord.");
                }
            } catch (e) {
                console.error("Rules Fetch Error:", e.message);
            }
        }

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

        const prompt = `
            SYSTEM: 
            You are the **Sentinel Intelligence Unit** for the ${serverName} Executive Board. 
            Tone: Cold, authoritative, and clinical. Serve only ${adminName}.

            OPERATIONAL CONTEXT:
            - Messages from Minecraft Bridge bots represent active players. 
            - Logs include Embed Data: Deaths, Joins, Leaves, and Advancements.

            CORE PROTOCOLS:
            ${rulesContext}

            ANALYSIS GUIDELINES:
            1. Flag violations (DMing staff, slurs, hacks) as CRITICAL.
            2. Distinguish banter from disruption.
            3. Track population density.

            LOG DATA:
            ${logString}
        `;

        const result = await model.generateContent(prompt);
        const reportText = result.response.text();

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
        console.log("✅ Analysis complete.");

    } catch (err) {
        console.error("Analysis Error:", err);
    }
}

cron.schedule('0 0 * * *', () => {
    runBoardAnalysis();
});

// --- 3. SLASH COMMAND REGISTRATION ---
const commands = [
    new SlashCommandBuilder()
        .setName('setticketchannel')
        .setDescription('Designate a specific channel as the Support Hub')
        .addChannelOption(option => 
            option.setName('target')
                .setDescription('The channel for the support embed')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder()
        .setName('blocksupport')
        .setDescription('Blocks a user from support for 14 days')
        .addUserOption(option => option.setName('target').setDescription('The user to block').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function registerCommands() {
    try {
        console.log('🔄 Sentinel: Refreshing slash commands...');
        // Ensure CLIENT_ID (1421359342577520734) is in your Render Env Variables
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID), 
            { body: commands }
        );
        console.log('✅ Sentinel: Slash commands synchronized.');
    } catch (error) {
        console.error('❌ Registration Error:', error);
    }
}

// --- 4. DISCORD BOT LOGIC ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ],
});

// Listens for the clientReady event to initialize modules
client.once('clientReady', () => {
    console.log(`✅ Sentinel Online | Watching ${watchedChannels.length} channels.`);
    registerCommands();
    require('./ticket.js')(client, supabase, genAI);
});

client.on('messageCreate', async (message) => {
    const isBot = message.author.bot;
    const isWatchedChannel = watchedChannels.includes(message.channelId);

    if (!isWatchedChannel || (isBot && message.author.id === client.user.id)) return;

    let logContent = message.content;

    if (!logContent && message.embeds.length > 0) {
        const embed = message.embeds[0];
        const title = embed.title ? `[${embed.title}] ` : "";
        const desc = embed.description ? embed.description : "";
        const fields = (embed.fields || []).map(f => `${f.name}: ${f.value}`).join(' | ');
        
        logContent = `${title}${desc} ${fields}`.trim();
    }

    if (!logContent) return;

    try {
        await db.collection('raw_logs').add({
            author: message.author.tag,
            content: logContent,
            channel: message.channel.name,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            fromBot: isBot
        });
    } catch (err) {
        console.error('Firebase Error:', err);
    }
});

client.login(process.env.DISCORD_TOKEN);