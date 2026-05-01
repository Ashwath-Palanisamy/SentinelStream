const { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

module.exports = (client, supabase, genAI) => {

    /**
     * Helper: Send the Support Hub Embed
     */
    async function sendSupportPost(channel) {
        const supportEmbed = new EmbedBuilder()
            .setTitle('🛡️ FriendSMP75 Support Hub')
            .setDescription('Need assistance? Our staff team is here to help! Click the button below to open a private support ticket.')
            .addFields(
                { name: '📜 Server Rules', value: 'Please ensure you have read the rules before opening a ticket.' },
                { name: '⚠️ Support Protocol', value: 'Bypassing this system to DM staff directly is a violation of support rules and may result in a **14-day ban**.' }
            )
            .setColor('#5865F2')
            .setTimestamp()
            .setFooter({ text: 'FriendSMP75 | Memories Alive' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('open_ticket')
                .setLabel('Open a Ticket')
                .setStyle(ButtonStyle.Success)
                .setEmoji('📩')
        );

        await channel.send({ embeds: [supportEmbed], components: [row] });
    }

    /**
     * 1. AI Summary Function
     */
    async function generateTicketSummary(thread) {
        try {
            const messages = await thread.messages.fetch({ limit: 50 });
            const conversation = messages
                .filter(m => !m.author.bot)
                .map(m => `${m.author.username}: ${m.content}`)
                .reverse()
                .join('\n');

            if (!conversation) return "Inquiry";

            const model = genAI.getGenerativeModel({ model: "gemini-3-flash" });
            const prompt = `Based on this Minecraft ticket, provide a 3-word professional summary title (e.g., "Griefing Report", "Technical Issue"):\n\n${conversation}`;
            
            const result = await model.generateContent(prompt);
            return result.response.text().replace(/["']/g, "").trim();
        } catch (error) {
            console.error("AI Title Error:", error);
            return "Support Ticket";
        }
    }

    /**
     * 2. Interaction Listener
     */
    client.on('interactionCreate', async (interaction) => {
        
        // --- HANDLE SLASH COMMANDS ---
        if (interaction.isChatInputCommand()) {
            
            // COMMAND: SET TICKET CHANNEL
            if (interaction.commandName === 'setticketchannel') {
                const channel = interaction.channel;

                const { error } = await supabase
                    .from('server_config')
                    .upsert({ 
                        config_key: 'ticket_channel_id', 
                        config_value: channel.id 
                    });

                if (error) return interaction.reply({ content: 'Database error while saving config.', ephemeral: true });

                await interaction.reply({ content: `✅ Support Hub established in <#${channel.id}>.`, ephemeral: true });
                await sendSupportPost(channel);
            }

            // COMMAND: BLOCK SUPPORT (Rule 14)
            if (interaction.commandName === 'blocksupport') {
                const target = interaction.options.getUser('target');
                const expiryDate = new Date();
                expiryDate.setDate(expiryDate.getDate() + 14);

                const { error } = await supabase
                    .from('blocked_players')
                    .upsert({ 
                        discord_id: target.id, 
                        unblock_at: expiryDate.toISOString(),
                        reason: 'Support bypass / DMing staff'
                    });

                if (error) return interaction.reply({ content: 'Database error.', ephemeral: true });

                return interaction.reply({ 
                    content: `🛡️ **Rule 14 Applied:** <@${target.id}> is blocked until <t:${Math.floor(expiryDate.getTime() / 1000)}:F>.`,
                });
            }
        }

        // --- HANDLE BUTTONS ---
        if (interaction.isButton()) {
            
            // ACTION: OPEN TICKET
            if (interaction.customId === 'open_ticket') {
                // Verify if this is the active ticket channel
                const { data: config } = await supabase
                    .from('server_config')
                    .select('config_value')
                    .eq('config_key', 'ticket_channel_id')
                    .single();

                if (config && interaction.channelId !== config.config_value) {
                    return interaction.reply({ content: "❌ This ticket station is no longer active.", ephemeral: true });
                }

                // Check Rule 14 Block Status
                const { data: blockData } = await supabase
                    .from('blocked_players')
                    .select('unblock_at')
                    .eq('discord_id', interaction.user.id)
                    .single();

                if (blockData && new Date(blockData.unblock_at) > new Date()) {
                    const timestamp = Math.floor(new Date(blockData.unblock_at).getTime() / 1000);
                    return interaction.reply({ 
                        content: `❌ You are blocked for violating support protocols. Expires <t:${timestamp}:R>.`, 
                        ephemeral: true 
                    });
                }

                const thread = await interaction.channel.threads.create({
                    name: `ticket-${interaction.user.username}`,
                    autoArchiveDuration: 10080,
                    type: ChannelType.PrivateThread,
                });

                await thread.members.add(interaction.user.id);

                await supabase.from('tickets').insert({
                    discord_id: interaction.user.id,
                    channel_id: thread.id,
                    status: 'open'
                });

                const closeRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('close_ticket')
                        .setLabel('Close & Summarize')
                        .setStyle(ButtonStyle.Danger)
                );

                await interaction.reply({ content: `Ticket created: ${thread}`, ephemeral: true });
                await thread.send({
                    content: `Welcome <@${interaction.user.id}>! Describe your issue.\n**Note:** DMing staff results in a 14-day ban.`,
                    components: [closeRow]
                });
            }

            // ACTION: CLOSE TICKET
            if (interaction.customId === 'close_ticket') {
                await interaction.deferReply({ ephemeral: true });
                const thread = interaction.channel;
                const aiTitle = await generateTicketSummary(thread);

                await supabase
                    .from('tickets')
                    .update({ 
                        status: 'closed', 
                        title: aiTitle, 
                        closed_at: new Date() 
                    })
                    .eq('channel_id', thread.id);

                await interaction.editReply(`Ticket closed and summarized as: **${aiTitle}**`);
                await thread.setArchived(true);
            }
        }
    });

    console.log("🎟️ Ticket System Module Loaded and Operational.");
};