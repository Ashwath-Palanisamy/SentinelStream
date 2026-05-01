require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

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

(async () => {
  try {
    console.log('🔄 Registering slash commands...');
    // Replace CLIENT_ID with your Bot's ID from Discord Developer Portal
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID), 
      { body: commands }
    );
    console.log('✅ Commands registered successfully!');
  } catch (error) {
    console.error(error);
  }
})();