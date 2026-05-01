require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    PermissionFlagsBits 
} = require('discord.js'); // Added necessary builders
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
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash" });

// --- 2. THE BRAIN (Analysis Function) ---
// (Your runBoardAnalysis function remains unchanged here)

// --- 3. SLASH COMMAND REGISTRATION (NEW) ---
const commands = [
    new SlashCommandBuilder()
        .setName('setticketchannel')
        .setDescription('Sets the current channel as the Support Hub')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
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
        // Ensure CLIENT_ID is added to your Render Env Variables
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

// FIXED: Changed 'clientReady' to 'ready' to ensure initialization
client.once('clientReady', () => {
    console.log(`✅ Sentinel Online | Watching ${watchedChannels.length} channels.`);
    registerCommands(); // Register commands once the bot is online
    require('./ticket.js')(client, supabase, genAI);
});

// (Your messageCreate listener remains unchanged)

client.login(process.env.DISCORD_TOKEN);