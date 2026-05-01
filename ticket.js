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
     * 1. AI Summary Function
     * Reads the thread and uses Gemini 3 Flash to create a title.
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
     * Handles Rule 14 blocks, ticket creation, and closing.
     */
    client.on('interactionCreate', async (interaction) => {
        
        // --- HANDLE RULE 14 SLASH COMMAND ---
        if (interaction.isChatInputCommand() && interaction.commandName === 'blocksupport') {
            const target = interaction.options.getUser('target');
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 14); // 14-day ban rule

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

        // --- HANDLE BUTTONS ---
        if (interaction.isButton()) {
            
            // ACTION: OPEN TICKET
            if (interaction.customId === 'open_ticket') {
                // Check Rule 14 Block Status in Supabase
                const { data: blockData } = await supabase
                    .from('blocked_players')
                    .select('unblock_at')
                    .eq('discord_id', interaction.user.id)
                    .single();

                if (blockData && new Date(blockData.unblock_at) > new Date()) {
                    const timestamp = Math.floor(new Date(blockData.unblock_at).getTime() / 1000);
                    return interaction.reply({ 
                        content: `❌ You are currently blocked for violating support protocols. Expires <t:${timestamp}:R>.`, 
                        ephemeral: true 
                    });
                }

                // Create Private Thread
                const thread = await interaction.channel.threads.create({
                    name: `ticket-${interaction.user.username}`,
                    autoArchiveDuration: 10080,
                    type: ChannelType.PrivateThread,
                });

                await thread.members.add(interaction.user.id);

                // Log to Supabase for the Website Dashboard
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
                    content: `Welcome <@${interaction.user.id}>! Please describe your issue.\n\n**Note:** DMing staff directly results in a 14-day ban.`,
                    components: [closeRow]
                });
            }

            // ACTION: CLOSE TICKET & SUMMARIZE
            if (interaction.customId === 'close_ticket') {
                await interaction.deferReply({ ephemeral: true });
                const thread = interaction.channel;

                // AI Analysis for Dashboard Title
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