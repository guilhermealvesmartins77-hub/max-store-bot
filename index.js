require("dotenv").config();
const express = require("express");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const {
  Client, GatewayIntentBits, Partials, REST, Routes,
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require("discord.js");

const required = ["DISCORD_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_GUILD_ID"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Falta configurar ${key} no arquivo .env`);
    process.exit(1);
  }
}
const STORE = process.env.STORE_NAME || "MAX STORE 1 REAL";
const PORT = Number(process.env.PORT || 3000);
const db = new Database("./data.sqlite");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS verified (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, verified_at TEXT NOT NULL, PRIMARY KEY(guild_id,user_id));
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL, price_cents INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS stock (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, payload TEXT NOT NULL, reserved_by TEXT, delivered INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, product_id INTEGER NOT NULL, stock_id INTEGER, amount_cents INTEGER NOT NULL, status TEXT NOT NULL, payment_id TEXT, created_at TEXT NOT NULL, paid_at TEXT, delivered_at TEXT, delivery_status TEXT NOT NULL DEFAULT 'PENDING');
CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
`);
const now = () => new Date().toISOString();
const logDb = (kind, detail) => db.prepare("INSERT INTO logs(kind,detail,created_at) VALUES(?,?,?)").run(kind, detail, now());
const money = cents => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const safeText = (s, max=900) => String(s || "").slice(0, max);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

function isAdmin(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const roleId = process.env.ADMIN_ROLE_ID;
  return !!roleId && interaction.member?.roles?.cache?.has(roleId);
}
function isVerified(guildId, userId) {
  return !!db.prepare("SELECT 1 FROM verified WHERE guild_id=? AND user_id=?").get(guildId, userId);
}
function embed(title, description, color=0x202225) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setFooter({ text: STORE }).setTimestamp();
}
async function sendLog(guild, message) {
  const channelId = process.env.LOG_CHANNEL_ID;
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased()) await channel.send({ embeds: [message] }).catch(err => logDb("LOG_CHANNEL_ERROR", err.message));
}
async function getSalesChannel(guild) {
  const id = process.env.SALES_CHANNEL_ID;
  return id ? guild.channels.fetch(id).catch(() => null) : null;
}
async function getVerifyChannel(guild) {
  const id = process.env.VERIFY_CHANNEL_ID;
  return id ? guild.channels.fetch(id).catch(() => null) : null;
}

const commands = [
  new SlashCommandBuilder().setName("painel").setDescription("Publica os painéis da loja").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("produto_adicionar").setDescription("Adiciona produto e estoque digital").setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o=>o.setName("nome").setDescription("Nome do produto").setRequired(true))
    .addStringOption(o=>o.setName("descricao").setDescription("Descrição").setRequired(true))
    .addNumberOption(o=>o.setName("preco").setDescription("Preço em reais").setRequired(true).setMinValue(0.01))
    .addStringOption(o=>o.setName("estoque").setDescription("Itens para entrega, um por linha").setRequired(true)),
  new SlashCommandBuilder().setName("produto_remover").setDescription("Desativa um produto").setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(o=>o.setName("id").setDescription("ID do produto").setRequired(true)),
  new SlashCommandBuilder().setName("produto_editar").setDescription("Edita nome, descrição e preço").setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(o=>o.setName("id").setDescription("ID do produto").setRequired(true))
    .addStringOption(o=>o.setName("nome").setDescription("Novo nome").setRequired(true))
    .addStringOption(o=>o.setName("descricao").setDescription("Nova descrição").setRequired(true))
    .addNumberOption(o=>o.setName("preco").setDescription("Novo preço em reais").setRequired(true).setMinValue(0.01)),
  new SlashCommandBuilder().setName("produtos").setDescription("Lista os produtos e estoque"),
  new SlashCommandBuilder().setName("estoque").setDescription("Mostra estoque por produto").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("vendas").setDescription("Lista pedidos recentes").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("estatisticas").setDescription("Mostra estatísticas da loja").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("configurar_canal_vendas").setDescription("Define o canal atual como canal de vendas").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("configurar_canal_logs").setDescription("Define o canal atual como canal de registro de vendas").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("configurar_verificacao").setDescription("Publica a mensagem de verificação no canal atual").setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID), { body: commands });
  console.log("Comandos de servidor registrados.");
}

function storePanel() {
  const products = db.prepare("SELECT * FROM products WHERE active=1 ORDER BY id").all();
  const desc = products.length ? products.map(p => {
    const count = db.prepare("SELECT COUNT(*) n FROM stock WHERE product_id=? AND delivered=0 AND reserved_by IS NULL").get(p.id).n;
    return `**${p.name}** — ${money(p.price_cents)}\n${p.description}\n📦 Disponíveis: **${count}** · ID: \`${p.id}\``;
  }).join("\n\n") : "Ainda não há produtos cadastrados. Um administrador pode usar `/produto_adicionar`.";
  const e = embed(`🛒 ${STORE}`, desc, 0x5865F2).setDescription(`Bem-vindo à loja! Verifique-se antes de comprar.\n\n${desc}`);
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("buy_open").setLabel("Comprar agora").setEmoji("🛒").setStyle(ButtonStyle.Success));
  return { embeds: [e], components: [row] };
}
function verifyPanel() {
  return {
    embeds: [embed("🔐 Verificação obrigatória", "Clique em **Verificar-se** para liberar as compras. Esta etapa confirma que você está no servidor.", 0x57F287)],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("verify_me").setLabel("Verificar-se").setEmoji("✅").setStyle(ButtonStyle.Primary))]
  };
}

async function createPixPayment(order, product, user) {
  if (!process.env.MP_ACCESS_TOKEN || !process.env.MP_WEBHOOK_URL || process.env.MP_ACCESS_TOKEN.includes("COLOQUE")) {
    throw new Error("Pagamento não configurado: defina MP_ACCESS_TOKEN e MP_WEBHOOK_URL no .env.");
  }
  const response = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": order.id
    },
    body: JSON.stringify({
      transaction_amount: Number((order.amount_cents / 100).toFixed(2)),
      description: `${STORE} - ${product.name}`,
      payment_method_id: "pix",
      external_reference: order.id,
      notification_url: process.env.MP_WEBHOOK_URL,
      payer: { email: `discord-${user.id}@example.com`, first_name: safeText(user.username, 60) }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Mercado Pago (${response.status}): ${safeText(data.message || JSON.stringify(data), 400)}`);
  return data;
}

async function processApprovedPayment(payment) {
  const orderId = String(payment.external_reference || "");
  if (!orderId) return;
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
  if (!order || order.status === "PAID" || order.status === "DELIVERED") return;
  if (payment.status !== "approved") return;
  const stock = db.prepare("SELECT * FROM stock WHERE id=? AND reserved_by=? AND delivered=0").get(order.stock_id, order.id);
  if (!stock) {
    db.prepare("UPDATE orders SET status='PAID', payment_id=?, paid_at=?, delivery_status='REVIEW' WHERE id=?")
      .run(String(payment.id), now(), order.id);
    logDb("PAID_STOCK_MISSING", order.id);
    return;
  }
  db.prepare("UPDATE orders SET status='PAID', payment_id=?, paid_at=? WHERE id=?").run(String(payment.id), now(), order.id);
  try {
    const user = await client.users.fetch(order.user_id);
    await user.send({ embeds: [embed("✅ Pagamento aprovado!", `Seu pedido **#${order.id}** foi aprovado.\n📦 Produto: **${db.prepare("SELECT name FROM products WHERE id=?").get(order.product_id).name}**\n\nSua entrega está abaixo:\n\`\`\`\n${stock.payload.slice(0, 1500)}\n\`\`\``, 0x57F287)] });
    db.prepare("UPDATE stock SET delivered=1, reserved_by=NULL WHERE id=?").run(stock.id);
    db.prepare("UPDATE orders SET status='DELIVERED', delivery_status='DELIVERED', delivered_at=? WHERE id=?").run(now(), order.id);
  } catch (err) {
    db.prepare("UPDATE orders SET delivery_status='DM_FAILED' WHERE id=?").run(order.id);
    logDb("DELIVERY_DM_FAILED", `${order.id}: ${err.message}`);
  }
  const fresh = db.prepare("SELECT * FROM orders WHERE id=?").get(order.id);
  const product = db.prepare("SELECT name FROM products WHERE id=?").get(order.product_id);
  const guild = await client.guilds.fetch(order.guild_id).catch(() => null);
  if (guild) {
    await sendLog(guild, embed("🛒 NOVA VENDA REALIZADA!", [
      `👤 Comprador: <@${order.user_id}> (\`${order.user_id}\`)`,
      `📦 Produto: **${product.name}**`,
      `💰 Valor: **${money(order.amount_cents)}**`,
      `🧾 Pedido: \`#${order.id}\``,
      `💳 Pagamento: **APROVADO**`,
      `📦 Entrega: **${fresh.delivery_status === "DELIVERED" ? "CONCLUÍDA" : "PENDENTE DE REVISÃO"}**`,
      `📅 Data: <t:${Math.floor(new Date(fresh.paid_at).getTime()/1000)}:F>`
    ].join("\n"), 0x57F287));
  }
  logDb("PAYMENT_APPROVED", order.id);
}

const app = express();
app.use(express.json({ limit: "100kb" }));
app.post("/webhooks/mercadopago", async (req, res) => {
  try {
    const paymentId = req.query["data.id"] || req.body?.data?.id;
    if (!paymentId) return res.status(400).send("missing payment id");
    const secret = process.env.MP_WEBHOOK_SECRET;
    if (secret) {
      const signature = req.get("x-signature") || "";
      const requestId = req.get("x-request-id") || "";
      const parts = Object.fromEntries(signature.split(",").map(p => p.trim().split("=").map(x => x.trim())));
      const ts = parts.ts, v1 = parts.v1;
      const dataId = String(paymentId).toLowerCase();
      const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
      const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
      if (!v1 || !ts || !crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected))) {
        return res.status(401).send("invalid signature");
      }
    }
    // Consulta direta à API: não confiar apenas no conteúdo da notificação.
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    const payment = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).send("could not verify payment");
    if (payment.status === "approved") await processApprovedPayment(payment);
    res.status(200).send("ok");
  } catch (e) {
    logDb("WEBHOOK_ERROR", e.message);
    res.status(500).send("error");
  }
});
app.listen(PORT, () => console.log(`Webhook HTTP ouvindo na porta ${PORT}`));

client.once("ready", () => console.log(`Online como ${client.user.tag}`));
client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;
      if (["painel","produto_adicionar","produto_remover","produto_editar","estoque","vendas","estatisticas","configurar_canal_vendas","configurar_canal_logs","configurar_verificacao"].includes(name) && !isAdmin(interaction)) {
        return interaction.reply({ content: "⛔ Apenas administradores autorizados podem usar este comando.", ephemeral: true });
      }
      if (name === "painel") {
        const vc = await getVerifyChannel(interaction.guild);
        const sc = await getSalesChannel(interaction.guild);
        if (vc?.isTextBased()) await vc.send(verifyPanel());
        if (sc?.isTextBased()) await sc.send(storePanel());
        return interaction.reply({ content: `Painéis publicados. Verificação: ${vc ? `<#${vc.id}>` : "canal não configurado"}. Vendas: ${sc ? `<#${sc.id}>` : "canal não configurado"}.`, ephemeral: true });
      }
      if (name === "produto_adicionar") {
        const pname = safeText(interaction.options.getString("nome"), 100);
        const desc = safeText(interaction.options.getString("descricao"), 900);
        const price = Math.round(interaction.options.getNumber("preco") * 100);
        const lines = interaction.options.getString("estoque").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
        if (!lines.length) return interaction.reply({ content: "Informe ao menos um item de estoque, um por linha.", ephemeral: true });
        const result = db.prepare("INSERT INTO products(name,description,price_cents) VALUES(?,?,?)").run(pname, desc, price);
        const insertStock = db.prepare("INSERT INTO stock(product_id,payload) VALUES(?,?)");
        const tx = db.transaction(() => lines.forEach(line => insertStock.run(result.lastInsertRowid, line)));
        tx();
        logDb("PRODUCT_CREATED", `${result.lastInsertRowid}:${pname}`);
        return interaction.reply({ content: `✅ Produto **${pname}** criado (ID ${result.lastInsertRowid}) com ${lines.length} itens de estoque. Use \`/painel\` para atualizar a vitrine.`, ephemeral: true });
      }
      if (name === "produto_remover") {
        const id = interaction.options.getInteger("id");
        db.prepare("UPDATE products SET active=0 WHERE id=?").run(id);
        return interaction.reply({ content: "Produto desativado, se o ID existia.", ephemeral: true });
      }
      if (name === "produto_editar") {
        db.prepare("UPDATE products SET name=?,description=?,price_cents=? WHERE id=?").run(
          safeText(interaction.options.getString("nome"),100), safeText(interaction.options.getString("descricao"),900),
          Math.round(interaction.options.getNumber("preco")*100), interaction.options.getInteger("id"));
        return interaction.reply({ content: "Produto atualizado, se o ID existia. Use `/painel` para atualizar a vitrine.", ephemeral: true });
      }
      if (name === "produtos") {
        const products = db.prepare("SELECT * FROM products WHERE active=1 ORDER BY id").all();
        return interaction.reply({ embeds: [embed("📦 Produtos", products.length ? products.map(p=>`**${p.id}. ${p.name}** — ${money(p.price_cents)}\n${p.description}`).join("\n\n") : "Nenhum produto cadastrado.")], ephemeral: true });
      }
      if (name === "estoque") {
        const rows = db.prepare("SELECT p.id,p.name, SUM(CASE WHEN s.delivered=0 AND s.reserved_by IS NULL THEN 1 ELSE 0 END) available, SUM(CASE WHEN s.reserved_by IS NOT NULL AND s.delivered=0 THEN 1 ELSE 0 END) reserved FROM products p LEFT JOIN stock s ON s.product_id=p.id GROUP BY p.id ORDER BY p.id").all();
        return interaction.reply({ embeds: [embed("📦 Estoque", rows.map(x=>`**${x.id}. ${x.name}** — disponíveis: ${x.available||0}; reservados: ${x.reserved||0}`).join("\n") || "Sem produtos.")], ephemeral: true });
      }
      if (name === "vendas") {
        const rows = db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 15").all();
        return interaction.reply({ embeds: [embed("🧾 Pedidos recentes", rows.map(o=>`#${o.id} · <@${o.user_id}> · ${money(o.amount_cents)} · **${o.status}** · entrega: ${o.delivery_status}`).join("\n") || "Nenhum pedido.")], ephemeral: true });
      }
      if (name === "estatisticas") {
        const totals = db.prepare("SELECT COUNT(*) count, COALESCE(SUM(amount_cents),0) revenue FROM orders WHERE status IN ('PAID','DELIVERED')").get();
        const pending = db.prepare("SELECT COUNT(*) count FROM orders WHERE status='PENDING'").get().count;
        return interaction.reply({ embeds: [embed("📊 Estatísticas", `🛒 Vendas pagas: **${totals.count}**\n💰 Faturamento confirmado: **${money(totals.revenue)}**\n⏳ Pedidos pendentes: **${pending}**`)], ephemeral: true });
      }
      if (name === "configurar_canal_vendas") {
        return interaction.reply({ content: `Copie o ID deste canal para \`SALES_CHANNEL_ID\` no arquivo .env: \`${interaction.channelId}\`, reinicie o bot e use /painel.`, ephemeral: true });
      }
      if (name === "configurar_canal_logs") {
        return interaction.reply({ content: `Copie o ID deste canal para \`LOG_CHANNEL_ID\` no arquivo .env: \`${interaction.channelId}\`, reinicie o bot.`, ephemeral: true });
      }
      if (name === "configurar_verificacao") {
        await interaction.channel.send(verifyPanel());
        return interaction.reply({ content: "Painel de verificação publicado neste canal.", ephemeral: true });
      }
    }
    if (interaction.isButton() && interaction.customId === "verify_me") {
      db.prepare("INSERT OR IGNORE INTO verified(guild_id,user_id,verified_at) VALUES(?,?,?)").run(interaction.guildId, interaction.user.id, now());
      return interaction.reply({ content: "✅ Verificação concluída! Você pode voltar ao canal de vendas e iniciar uma compra.", ephemeral: true });
    }
    if (interaction.isButton() && interaction.customId === "buy_open") {
      if (!isVerified(interaction.guildId, interaction.user.id)) return interaction.reply({ content: "🔐 Antes de comprar, vá ao canal de verificação e clique em **Verificar-se**.", ephemeral: true });
      const products = db.prepare("SELECT * FROM products WHERE active=1 ORDER BY id").all()
        .filter(p => db.prepare("SELECT 1 FROM stock WHERE product_id=? AND delivered=0 AND reserved_by IS NULL").get(p.id));
      if (!products.length) return interaction.reply({ content: "No momento não há produtos disponíveis.", ephemeral: true });
      const menu = new StringSelectMenuBuilder().setCustomId("product_select").setPlaceholder("Selecione um produto").addOptions(products.slice(0,25).map(p=>({
        label: safeText(p.name,100), description: safeText(`${money(p.price_cents)} — ${p.description}`,100), value: String(p.id)
      })));
      return interaction.reply({ content: "Escolha o produto que deseja comprar:", components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
    }
    if (interaction.isStringSelectMenu() && interaction.customId === "product_select") {
      if (!isVerified(interaction.guildId, interaction.user.id)) return interaction.reply({ content: "Você precisa concluir a verificação primeiro.", ephemeral: true });
      const productId = Number(interaction.values[0]);
      const product = db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(productId);
      if (!product) return interaction.reply({ content: "Produto indisponível.", ephemeral: true });
      const orderId = crypto.randomUUID();
      const stock = db.prepare("SELECT * FROM stock WHERE product_id=? AND delivered=0 AND reserved_by IS NULL ORDER BY id LIMIT 1").get(productId);
      if (!stock) return interaction.reply({ content: "Estoque esgotado.", ephemeral: true });
      const reserve = db.prepare("UPDATE stock SET reserved_by=? WHERE id=? AND reserved_by IS NULL AND delivered=0").run(orderId, stock.id);
      if (!reserve.changes) return interaction.reply({ content: "Outro cliente reservou o último item. Tente novamente.", ephemeral: true });
      db.prepare("INSERT INTO orders(id,guild_id,user_id,product_id,stock_id,amount_cents,status,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(orderId, interaction.guildId, interaction.user.id, productId, stock.id, product.price_cents, "PENDING", now());
      await interaction.deferReply({ ephemeral: true });
      try {
        const payment = await createPixPayment({ id: orderId, amount_cents: product.price_cents }, product, interaction.user);
        db.prepare("UPDATE orders SET payment_id=? WHERE id=?").run(String(payment.id), orderId);
        const tx = payment.point_of_interaction?.transaction_data || {};
        const qrText = safeText(tx.qr_code || "QR code indisponível; abra o link de pagamento.", 1500);
        const ticket = tx.ticket_url;
        const e = embed("💳 Pagamento PIX", `Pedido: \`#${orderId}\`\nProduto: **${product.name}**\nValor: **${money(product.price_cents)}**\n\n**PIX copia e cola:**\n\`\`\`\n${qrText}\n\`\`\`\nO produto só será entregue depois que o Mercado Pago confirmar o pagamento.`, 0xF1C40F);
        const rows = ticket ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Abrir pagamento").setURL(ticket).setStyle(ButtonStyle.Link))] : [];
        await interaction.editReply({ embeds: [e], components: rows });
      } catch (err) {
        db.prepare("UPDATE stock SET reserved_by=NULL WHERE id=? AND reserved_by=?").run(stock.id, orderId);
        db.prepare("UPDATE orders SET status='ERROR',delivery_status='NOT_SENT' WHERE id=?").run(orderId);
        logDb("PAYMENT_CREATE_FAILED", `${orderId}: ${err.message}`);
        await interaction.editReply({ content: `Não consegui gerar o PIX. Nenhum produto foi entregue. Erro: ${safeText(err.message,500)}`, embeds: [], components: [] });
      }
    }
  } catch (err) {
    logDb("INTERACTION_ERROR", err.stack || err.message);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Ocorreu um erro. Tente novamente ou avise a administração.", ephemeral: true }).catch(()=>{});
    }
  }
});

(async () => {
  try {
    await registerCommands();
    await client.login(process.env.DISCORD_TOKEN);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
