require('dotenv').config();
const { 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    ChannelType 
} = require('discord.js');

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

    // NEW: Command to set the Staff Role
    new SlashCommandBuilder()
        .setName('setstaffrole')
        .setDescription('Set the role that can view and manage support tickets')
        .addRoleOption(option => 
            option.setName('role')
                .setDescription('The role for your staff team')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder()
        .setName('blocksupport')
        .setDescription('Blocks a user from support for 14 days')
        .addUserOption(option => 
            option.setName('target')
                .setDescription('The user to block')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('🔄 Sentinel: Refreshing slash commands...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID), 
            { body: commands }
        );
        console.log('✅ Sentinel: Slash commands synchronized successfully!');
    } catch (error) {
        console.error('❌ Registration Error:', error);
    }
})();