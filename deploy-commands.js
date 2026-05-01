require('dotenv').config();
const { 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    ChannelType 
} = require('discord.js');

// --- COMMAND DEFINITIONS ---
const commands = [
    // Updated: Allows channel selection and restricts to staff with "Manage Channels"
    new SlashCommandBuilder()
        .setName('setticketchannel')
        .setDescription('Designate a specific channel as the Support Hub')
        .addChannelOption(option => 
            option.setName('target')
                .setDescription('The channel where the support embed will be posted')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText)) // Limits selection to text channels
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels), // Restricted to Staff/Owner

    // Updated: Standard 14-day ban protocol for support bypass
    new SlashCommandBuilder()
        .setName('blocksupport')
        .setDescription('Blocks a user from support for 14 days')
        .addUserOption(option => 
            option.setName('target')
                .setDescription('The user to block')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
].map(command => command.toJSON());

// --- DEPLOYMENT LOGIC ---
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('🔄 Sentinel: Refreshing slash commands...');
        
        // This uses the Client ID (1421359342577520734) from your environment variables
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID), 
            { body: commands }
        );
        
        console.log('✅ Sentinel: Slash commands synchronized successfully!');
    } catch (error) {
        console.error('❌ Registration Error:', error);
    }
})();