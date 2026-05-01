const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags } = require('discord.js');

module.exports = (client, supabase, genAI) => {

    async function generateTicketSummary(thread) {
        try {
            // Fetch messages to analyze user needs
            const messages = await thread.messages.fetch({ limit: 50 });
            const userMessages = messages.filter(m => !m.author.bot);

            // Returns fallback if no user message found
            if (userMessages.size === 0) return "General Support";

            const conversation = userMessages
                .map(m => `${m.author.username}: ${m.content}`)
                .reverse()
                .join('\n');

            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const prompt = `Provide a 3-word professional summary of this ticket: \n\n${conversation}`;
            
            const result = await model.generateContent(prompt);
            return result.response.text().replace(/["']/g, "").trim();
        } catch (error) {
            console.error("AI Summary Error:", error);
            return "Support Ticket"; 
        }
    }

    client.on('interactionCreate', async (interaction) => {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'setticketchannel') {
                const chan = interaction.options.getChannel('target');
                await supabase.from('server_config').upsert({ config_key: 'ticket_channel_id', config_value: chan.id });
                await interaction.reply({ content: `✅ Hub set to <#${chan.id}>.`, flags: [MessageFlags.Ephemeral] });
            }
            
            if (interaction.commandName === 'setstaffrole') {
                const role = interaction.options.getRole('role');
                await supabase.from('server_config').upsert({ config_key: 'staff_role_id', config_value: role.id });
                await interaction.reply({ content: `✅ Staff set to ${role.name}.`, flags: [MessageFlags.Ephemeral] });
            }

            if (interaction.commandName === 'blocksupport') {
                const target = interaction.options.getUser('target');
                const expiry = new Date(); expiry.setDate(expiry.getDate() + 14);
                await supabase.from('blocked_players').upsert({ discord_id: target.id, unblock_at: expiry.toISOString() });
                await interaction.reply({ content: `🛡️ Rule 14 applied to <@${target.id}>.` });
            }
        }

        if (interaction.isButton()) {
            if (interaction.customId === 'open_ticket') {
                // Immediate defer to prevent 10062 "Unknown Interaction" during high traffic
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                try {
                    // Rule 14 Check
                    const { data: block } = await supabase.from('blocked_players').select('unblock_at').eq('discord_id', interaction.user.id).single();
                    if (block && new Date(block.unblock_at) > new Date()) {
                        return interaction.editReply({ content: "❌ You are currently blocked from using support hub." });
                    }

                    const thread = await interaction.channel.threads.create({
                        name: `ticket-${interaction.user.username}`,
                        type: ChannelType.PrivateThread,
                        autoArchiveDuration: 10080
                    });

                    await thread.members.add(interaction.user.id);
                    
                    // Notify Staff
                    const { data: conf } = await supabase.from('server_config').select('config_value').eq('config_key', 'staff_role_id').single();
                    if (conf) await thread.send(`🔔 <@&${conf.config_value}> New ticket opened by ${interaction.user.tag}.`);

                    // Website persistence
                    await supabase.from('tickets').insert({ discord_id: interaction.user.id, channel_id: thread.id, status: 'open' });

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger)
                    );

                    await interaction.editReply({ content: `Ticket created: ${thread}` });
                    await thread.send({ content: `Hello <@${interaction.user.id}>, staff will be with you shortly.`, components: [row] });

                } catch (err) {
                    console.error("Ticket Creation Error:", err);
                    await interaction.editReply({ content: "❌ Failed to create ticket." });
                }
            }

            if (interaction.customId === 'close_ticket') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const aiTitle = await generateTicketSummary(interaction.channel);
                
                await supabase.from('tickets')
                    .update({ status: 'closed', title: aiTitle, closed_at: new Date() })
                    .eq('channel_id', interaction.channel.id);
                
                await interaction.editReply(`Ticket closed: **${aiTitle}**`);
                await interaction.channel.setArchived(true);
            }
        }
    });
};