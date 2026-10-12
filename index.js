require("dotenv").config();
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, Events
} = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

// Compatível com os nomes de variáveis usados na FadeHost e no .env.example.
const CLIENT_ID = process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || process.env.DISCORD_GUILD_ID;
const required = ["DISCORD_TOKEN", "SALES_CHANNEL_ID", "PIX_KEY"];
const missing = required.filter((k) => !process.env[k]);
if (!CLIENT_ID) missing.push("CLIENT_ID (ou DISCORD_CLIENT_ID)");
if (!GUILD_ID) missing.push("GUILD_ID (ou DISCORD_GUILD_ID)");
if (missing.length) {
  console.error("Configure as variáveis de ambiente obrigatórias:", missing.join(", "));
  process.exit(1);
}

const STORE = process.env.STORE_NAME || "MAX STORE 1 REAL";
const PIX_KEY = process.env.PIX_KEY;
const PIX_NAME = process.env.PIX_NAME || "Recebedor";
const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "[]");

function readOrders() {
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8")); }
  catch { return []; }
}
function writeOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}
function money(cents) { return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

const products = new Map(); // Produtos cadastrados em memória; recadastre após reiniciar.
const commands = [
  new SlashCommandBuilder().setName("painel-vendas").setDescription("Publica o painel de vendas da loja (administradores)."),
  new SlashCommandBuilder().setName("produto-adicionar").setDescription("Cadastra um produto (administradores).")
    .addStringOption(o => o.setName("nome").setDescription("Nome do produto").setRequired(true))
    .addNumberOption(o => o.setName("preco").setDescription("Preço em reais, por exemplo 1.00").setRequired(true).setMinValue(0.01))
    .addStringOption(o => o.setName("descricao").setDescription("Descrição do produto").setRequired(true))
    .addStringOption(o => o.setName("entrega").setDescription("Texto/ instruções entregues após confirmação manual").setRequired(true)),
  new SlashCommandBuilder().setName("produto-listar").setDescription("Lista os produtos cadastrados."),
  new SlashCommandBuilder().setName("venda-confirmar").setDescription("Confirma manualmente um pagamento Pix (administradores).")
    .addStringOption(o => o.setName("pedido").setDescription("ID do pedido").setRequired(true))
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("Comandos do servidor registrados.");
}
function isAdmin(interaction) {
  return interaction.memberPermissions?.has("Administrator") ?? false;
}
function panelEmbed() {
  return new EmbedBuilder()
    .setTitle(`🛍️ ${STORE}`)
    .setDescription("Escolha um produto abaixo para iniciar seu pedido. O pagamento é via Pix; a confirmação é feita por um administrador.")
    .setColor(0x7c3aed)
    .setFooter({ text: "MAX STORE • Atendimento e segurança" });
}
function productRows() {
  const all = [...products.values()].slice(0, 25);
  const rows = [];
  for (let i = 0; i < all.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(all.slice(i, i + 5).map(p =>
      new ButtonBuilder().setCustomId(`buy:${p.id}`).setLabel(`${p.name.slice(0, 60)} • ${money(p.cents)}`).setStyle(ButtonStyle.Primary)
    )));
  }
  return rows;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, c => console.log(`Bot conectado como ${c.user.tag}`));

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (["painel-vendas", "produto-adicionar", "venda-confirmar"].includes(interaction.commandName) && !isAdmin(interaction)) {
        return interaction.reply({ content: "Somente administradores podem usar este comando.", ephemeral: true });
      }
      if (interaction.commandName === "produto-adicionar") {
        const name = interaction.options.getString("nome", true).trim();
        const price = interaction.options.getNumber("preco", true);
        const description = interaction.options.getString("descricao", true);
        const delivery = interaction.options.getString("entrega", true);
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        products.set(id, { id, name, cents: Math.round(price * 100), description, delivery });
        return interaction.reply({ content: `Produto **${name}** cadastrado por ${money(Math.round(price * 100))}. Use /painel-vendas para publicar/atualizar o painel.`, ephemeral: true });
      }
      if (interaction.commandName === "produto-listar") {
        if (!products.size) return interaction.reply({ content: "Nenhum produto cadastrado ainda.", ephemeral: true });
        return interaction.reply({ content: [...products.values()].map(p => `• **${p.name}** — ${money(p.cents)} — ID \`${p.id}\``).join("\n"), ephemeral: true });
      }
      if (interaction.commandName === "painel-vendas") {
        if (!products.size) return interaction.reply({ content: "Cadastre primeiro um produto com /produto-adicionar.", ephemeral: true });
        return interaction.reply({ embeds: [panelEmbed()], components: productRows() });
      }
      if (interaction.commandName === "venda-confirmar") {
        const orderId = interaction.options.getString("pedido", true);
        const orders = readOrders();
        const order = orders.find(o => o.id === orderId);
        if (!order) return interaction.reply({ content: "Pedido não encontrado. O ID deve ser exatamente o informado ao comprador.", ephemeral: true });
        if (order.status === "pago") return interaction.reply({ content: "Este pedido já está confirmado como pago.", ephemeral: true });
        order.status = "pago";
        order.confirmedBy = interaction.user.id;
        order.confirmedAt = new Date().toISOString();
        writeOrders(orders);
        const buyer = await client.users.fetch(order.userId).catch(() => null);
        if (buyer) await buyer.send(`Pagamento confirmado para o pedido \`${order.id}\` de **${order.productName}**.\nEntrega/instruções: ${order.delivery}`).catch(() => {});
        const salesChannel = await client.channels.fetch(process.env.SALES_CHANNEL_ID).catch(() => null);
        if (salesChannel?.isTextBased()) {
          await salesChannel.send({ embeds: [new EmbedBuilder().setTitle("✅ Venda confirmada").setColor(0x22c55e)
            .addFields(
              { name: "Produto", value: order.productName, inline: true },
              { name: "Valor", value: money(order.cents), inline: true },
              { name: "Comprador", value: `<@${order.userId}>`, inline: true },
              { name: "Pedido", value: `\`${order.id}\`` }
            ).setTimestamp()] });
        }
        return interaction.reply({ content: `Pedido \`${order.id}\` marcado como pago.`, ephemeral: true });
      }
    }

    if (interaction.isButton() && interaction.customId.startsWith("buy:")) {
      const product = products.get(interaction.customId.slice(4));
      if (!product) return interaction.reply({ content: "Este produto não está mais disponível. Peça ao administrador para atualizar o painel.", ephemeral: true });
      const modal = new ModalBuilder().setCustomId(`verify:${product.id}`).setTitle("Verificação de compra");
      const answer = new TextInputBuilder().setCustomId("confirm").setLabel("Digite COMPRAR para continuar").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20);
      modal.addComponents(new ActionRowBuilder().addComponents(answer));
      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("verify:")) {
      if (interaction.fields.getTextInputValue("confirm").trim().toUpperCase() !== "COMPRAR") {
        return interaction.reply({ content: "Verificação não concluída. Feche esta janela e tente novamente.", ephemeral: true });
      }
      const product = products.get(interaction.customId.slice(7));
      if (!product) return interaction.reply({ content: "Produto indisponível.", ephemeral: true });
      const order = {
        id: `MS-${Date.now().toString(36).toUpperCase()}`,
        userId: interaction.user.id,
        productId: product.id,
        productName: product.name,
        cents: product.cents,
        delivery: product.delivery,
        status: "aguardando_pagamento",
        createdAt: new Date().toISOString()
      };
      const orders = readOrders(); orders.push(order); writeOrders(orders);
      const embed = new EmbedBuilder().setTitle("🧾 Pedido criado")
        .setDescription(`**Produto:** ${product.name}\n**Descrição:** ${product.description}\n**Valor:** ${money(product.cents)}\n**Pedido:** \`${order.id}\`\n\n**Pix:** \`${PIX_KEY}\`\n**Recebedor:** ${PIX_NAME}\n\nApós pagar, aguarde a confirmação manual do administrador. Não envie senha ou dados bancários.`)
        .setColor(0xf59e0b);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Ocorreu um erro. Avise um administrador e confira os logs da hospedagem.", ephemeral: true }).catch(() => {});
    }
  }
});

(async () => {
  try {
    await registerCommands();
    await client.login(process.env.DISCORD_TOKEN);
  } catch (err) {
    console.error("Falha ao iniciar:", err);
    process.exit(1);
  }
})();
