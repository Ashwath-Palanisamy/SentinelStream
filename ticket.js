const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags } = require('discord.js');

module.exports = (client, supabase, genAI) => {

    async function generateTicketSummary(thread) {
        try {
            // Fetch messages specifically to find user input
            const messages = await thread.messages.fetch({ limit: 50 });
            const userMessages = messages.filter(m => !m.author.bot);

            // If no user typed anything, we can't summarize
            if (userMessages.size === 0) return "General Support";

            const conversation = userMessages
                .map(m => `${m.author.username}: ${m.content}`)
                .reverse()
                .join('\n');

            const model = genAI.getGenerativeModel({ model: "gemini-3-flash" });
            const prompt = `Provide a 3-word professional summary of this ticket: \n\n${conversation}`;
            
            const result = await model.generateContent(prompt);
            return result.response.text().replace(/["']/g, "").trim();
        } catch (error) {
            console.error("AI Summary Error:", error);
            return "Support Ticket"; // Fallback ensures Supabase update still runs
        }
    }

    client.on('interactionCreate', async (interaction) => {
        if (interaction.isChatInputCommand()) {
            // Handle Config Commands
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
                // Rule 14 Check
                const { data: block } = await supabase.from('blocked_players').select('unblock_at').eq('discord_id', interaction.user.id).single();
                if (block && new Date(block.unblock_at) > new Date()) return interaction.reply({ content: "❌ You are currently blocked.", flags: [MessageFlags.Ephemeral] });

                const thread = await interaction.channel.threads.create({
                    name: `ticket-${interaction.user.username}`,
                    type: ChannelType.PrivateThread,
                });

                await thread.members.add(interaction.user.id);
                const { data: conf } = await supabase.from('server_config').select('config_value').eq('config_key', 'staff_role_id').single();
                if (conf) await thread.send(`🔔 <@&${conf.config_value}> New ticket.`);

                // Insert into Supabase for website visibility
                await supabase.from('tickets').insert({ discord_id: interaction.user.id, channel_id: thread.id, status: 'open' });

                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger));
                await interaction.reply({ content: `Ticket: ${thread}`, flags: [MessageFlags.Ephemeral] });
                await thread.send({ content: `Hello <@${interaction.user.id}>, how can we help?`, components: [row] });
            }

            if (interaction.customId === 'close_ticket') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const aiTitle = await generateTicketSummary(interaction.channel);
                
                // Update existing row to 'closed' so it persists in your web gallery
                await supabase.from('tickets')
                    .update({ status: 'closed', title: aiTitle, closed_at: new Date() })
                    .eq('channel_id', interaction.channel.id);
                
                await interaction.editReply(`Ticket closed: **${aiTitle}**`);
                await interaction.channel.setArchived(true);
            }
        }
    });
};