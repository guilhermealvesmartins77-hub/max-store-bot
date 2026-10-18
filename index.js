require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder,
TextInputStyle, Events, PermissionFlagsBits
} = require('discord.js');

const env = (a,b) => process.env[a] || process.env[b];
const TOKEN = env('DISCORD_TOKEN');
const CLIENT_ID = env('DISCORD_CLIENT_ID','CLIENT_ID');
const GUILD_ID = env('DISCORD_GUILD_ID','GUILD_ID');
const SALES_CHANNEL_ID = process.env.SALES_CHANNEL_ID;
const DELIVERY_LOG_CHANNEL_ID = '1558901094451515553';
const PIX_KEY = process.env.PIX_KEY;
const PIX_NAME = process.env.PIX_NAME || 'Recebedor';
const STORE_NAME = process.env.STORE_NAME || 'MAX STORE 1 REAL';
const VERIFY_CHANNEL_ID = process.env.VERIFY_CHANNEL_ID || '';
if (!TOKEN || !CLIENT_ID || !GUILD_ID || !SALES_CHANNEL_ID || !PIX_KEY) {
  console.error('Configure DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, SALES_CHANNEL_ID e PIX_KEY nas variáveis da FadeHost.');
  process.exit(1);
}
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR,{recursive:true});
const PRODUCTS_FILE = path.join(DATA_DIR,'products.json');
const ORDERS_FILE = path.join(DATA_DIR,'orders.json');
const SETTINGS_FILE = path.join(DATA_DIR,'settings.json');
for (const [f,initial] of [[PRODUCTS_FILE,[]],[ORDERS_FILE,[]],[SETTINGS_FILE,{}]]) if(!fs.existsSync(f)) fs.writeFileSync(f,JSON.stringify(initial,null,2));
function readJson(f, fallback){ try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return fallback;} }
function writeJson(f,v){ fs.writeFileSync(f,JSON.stringify(v,null,2)); }
let products = readJson(PRODUCTS_FILE,[]);
let orders = readJson(ORDERS_FILE,[]);
let settings = readJson(SETTINGS_FILE,{});
const money = cents => (cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const isAdmin = i => !!i.memberPermissions?.has(PermissionFlagsBits.Administrator);
const commands = [new SlashCommandBuilder()
  .setName('painel_suporte')
  .setDescription('Publica o painel de suporte'),
  new SlashCommandBuilder().setName('painel').setDescription('Publica o painel de vendas'),
  new SlashCommandBuilder().setName('configurar_verificacao').setDescription('Configura a verificação'),
  new SlashCommandBuilder().setName('configurar_canal_vendas').setDescription('Configura o canal de vendas'),
  new SlashCommandBuilder()
    .setName('produto_adicionar')
    .setDescription('Adiciona produto ao canal')
    .addStringOption(o => o.setName('nome').setDescription('Nome do produto').setRequired(true))
    .addNumberOption(o => o.setName('preco').setDescription('Preço em reais').setRequired(true))
    .addStringOption(o => o.setName('descricao').setDescription('Descrição do produto').setRequired(true))
    .addStringOption(o => o.setName('entrega').setDescription('Conteúdo entregue').setRequired(true)),
  new SlashCommandBuilder().setName('produto_listar').setDescription('Lista os produtos do canal'),
  new SlashCommandBuilder()
    .setName('venda_confirmar')
    .setDescription('Confirma um PIX após pagamento')
    .addStringOption(o => o.setName('pedido').setDescription('ID do pedido').setRequired(true)),
  new SlashCommandBuilder()
  .setName('produto_remover')
  .setDescription('Escolha um produto para remover'),

new SlashCommandBuilder()
  .setName('estoque')
  .setDescription('Consultar estoque dos produtos'),

new SlashCommandBuilder()
  .setName('estoque_adicionar')
  .setDescription('Adicionar unidades ao estoque')
  .addStringOption(o =>
    o.setName('produto')
      .setDescription('Nome do produto')
      .setRequired(true))
  .addIntegerOption(o =>
    o.setName('quantidade')
      .setDescription('Quantidade para adicionar')
      .setMinValue(1)
      .setRequired(true)),

new SlashCommandBuilder()
  .setName('estoque_remover')
  .setDescription('Remover unidades do estoque')
  .addStringOption(o =>
    o.setName('produto')
      .setDescription('Nome do produto')
      .setRequired(true))
  .addIntegerOption(o =>
    o.setName('quantidade')
      .setDescription('Quantidade para remover')
      .setMinValue(1)
      .setRequired(true)),
  ].map(c => c.toJSON());

                  const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});
function productPanel(channelId){
  const embed = new EmbedBuilder()
    .setTitle(`🎁 ${STORE_NAME}`)
    .setDescription(
        'Escolha um produto no menu abaixo para iniciar seu pedido.\n\n' +
        '🔐 É necessário verificar sua conta antes de comprar.\n' +
        '💳 Pagamento via PIX; um administrador confirma após conferir o recebimento.\n\n' +
        `${STORE_NAME} • Atendimento e segurança`
    )
.setColor(0x7c3aed)
.setImage('https://i.imgur.com/onrs9RT.png');

  const available = products.filter(
    p => p.active !== false && p.channelId === channelId
  );

  const rows = [];
  const botaoEstoque = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('solicitar_estoque')
    .setLabel('Solicitar Estoque')
    .setEmoji('📦')
    .setStyle(ButtonStyle.Success)
);

rows.push(botaoEstoque);

  if (available.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`select_product_${channelId}`)
      .setPlaceholder('➡️ Clique aqui para escolher um produto')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(available.slice(0, 25).map(p => ({
        label: p.name.slice(0, 100),
        description: `Preço: ${money(p.cents)} | Estoque: ${Number(p.quantity) || 0}`.slice(0, 100),
        value: p.id
      })));

    rows.push(new ActionRowBuilder().addComponents(menu));
  }

  return { embeds: [embed], components: rows };
}
function verifyPanel(){
  return {embeds:[new EmbedBuilder().setTitle('🔐 Verificação obrigatória').setDescription('Clique no botão abaixo para concluir a verificação e liberar as compras.').setColor(0x22c55e)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_member').setLabel('✅ Verificar-se').setStyle(ButtonStyle.Success))]};
}
async function sendOrder(interaction, p) {
  const verified = settings.verifiedUsers || [];

  if (!verified.includes(interaction.user.id)) {
    return interaction.reply({
      content: '🔒 Você precisa verificar sua conta antes de comprar.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const nomeTicket = `🛒-${p.name}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90);

  const ticket = await interaction.guild.channels.create({
    name: nomeTicket,
    type: 0,
    parent: interaction.channel.parentId || undefined,
    permissionOverwrites: [
      {
        id: interaction.guild.id,
        deny: ['ViewChannel']
      },
      {
        id: interaction.user.id,
        allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles']
      },
      {
        id: client.user.id,
        allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageChannels']
      }
    ]
  }).catch(() => null);

  if (!ticket) {
    return interaction.editReply({
      content: '❌ Não consegui criar o ticket. Verifique as permissões do bot.'
    });
  }

  const order = {
    id: `MS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    userId: interaction.user.id,
    productId: p.id,
    productName: p.name,
    price: p.price,
    cents: p.cents,
    channelId: ticket.id,
    status: 'pendente',
    createdAt: new Date().toISOString()
  };

  orders.push(order);
  writeJson(ORDERS_FILE, orders);

  const embed = new EmbedBuilder()
  .setTitle(`🛒 ${p.name}`)
  .setColor(0x2ec71)
  .setDescription(
    `Olá, ${interaction.user}!\n\n` +
    `📦 **Produto:** ${p.name}\n` +
    `💰 **Valor:** ${money(p.cents)}\n` +
    `🔑 **Chave Pix:**\n\`${PIX_KEY}\`\n\n` +
    `📩 Após pagar, envie o comprovante neste ticket.\n` +
    `⏳ Aguarde a confirmação de um administrador.\n\n` +
    `🧾 **Pedido:** ${order.id}`
  )
  .setImage('https://i.imgur.com/onrs9RT.png');
const botoesPagamento = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId(`pagar_${order.id}`)
    .setLabel('Ir para o Pagamento')
    .setEmoji('✅')
    .setStyle(ButtonStyle.Success),

  new ButtonBuilder()
    .setCustomId(`editar_${order.id}`)
    .setLabel('Editar Quantidade')
    .setEmoji('🖊️')
    .setStyle(ButtonStyle.Primary),

  new ButtonBuilder()
    .setCustomId(`cupom_${order.id}`)
    .setLabel('Usar Cupom')
    .setEmoji('🎟️')
    .setStyle(ButtonStyle.Secondary),

  new ButtonBuilder()
    .setCustomId(`cancelar_${order.id}`)
    .setLabel('Cancelar')
    .setEmoji('🗑️')
    .setStyle(ButtonStyle.Danger)
);

await ticket.send({
  content: `${interaction.user}`,
  embeds: [embed],
  components: [botoesPagamento]
});
  
}
client.once(Events.ClientReady, c=>console.log(`Bot conectado como ${c.user.tag}`));
client.on(Events.InteractionCreate,async i=>{
 try{
 if (i.isStringSelectMenu() && i.customId === 'support_ticket_type') {
  const tipo = i.values[0];

  const canal = await i.guild.channels.create({
    name: `${tipo}-${i.user.username}`.toLowerCase(),
    type: 0,
    permissionOverwrites: [
      {
        id: i.guild.id,
        deny: ['ViewChannel']
      },
      {
        id: i.user.id,
        allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory']
      },
      {
        id: i.client.user.id,
        allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageChannels']
      },
      {
  id: '1558900769707524207',
  allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory']
      }
    ]
  });

  const fechar = new ButtonBuilder()
    .setCustomId('fechar_ticket')
    .setLabel('Fechar ticket')
    .setEmoji('🔒')
    .setStyle(ButtonStyle.Danger);

const botoes = new ActionRowBuilder()
    .addComponents(fechar);

await canal.send({
    content: `🎫 Atendimento de **${tipo}**\nCliente: ${i.user}\nDescreva seu problema aqui.`,
    components: [botoes]
});

  return i.reply({
    content: `✅ Seu ticket foi criado: ${canal}`,
    ephemeral: true
  });
 }
   if(i.isChatInputCommand()){
    if(!['painel','configurar_verificacao','configurar_canal_vendas','produto_adicionar','venda_confirmar','estoque','estoque_adicionar','estoque_remover'].includes(i.commandName) && !isAdmin(i)) return i.reply({content:'Somente administradores podem usar este comando.',ephemeral:true});
    if(i.commandName==='configurar_canal_vendas') return i.reply({content:`ID deste canal: \`${i.channelId}\`. Configure SALES_CHANNEL_ID na FadeHost e reinicie o bot.`,ephemeral:true});
if(i.commandName==='configurar_verificacao'){
  settings.verifyChannelId=i.channelId;
  writeJson(SETTINGS_FILE,settings);
  await i.channel.send(verifyPanel());
  return i.reply({
    content:'✅ Painel de verificação publicado para todos neste canal!',
    ephemeral:true
  });
}
    
    if(i.commandName==='produto_adicionar'){
  const name=i.options.getString('nome',true).trim();
  const price=i.options.getNumber('preco',true);
  const description=i.options.getString('descricao',true);
  const delivery=i.options.getString('entrega',true);

  const p={
    id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),
    name,
    cents:Math.round(price*100),
    description,
    delivery,
    stock:'Disponível',
    active:true,
    channelId:i.channelId
  };

  products.push(p);
  writeJson(PRODUCTS_FILE,products);

  return i.reply({
    content:`Produto **${name}** adicionado por ${money(p.cents)}. Use /painel para publicar/atualizar o menu de produtos.`,
    ephemeral:true
  });
    }
   if (i.commandName === 'produto_remover') {
  const lista = products.filter(
    p => p.channelId === i.channelId && p.active !== false
  );

  if (!lista.length) {
    return i.reply({
      content: '❌ Não há produtos neste canal para remover.',
      ephemeral: true
    });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId('remover_produto')
    .setPlaceholder('🗑️ Escolha o produto que deseja remover')
    .addOptions(lista.slice(0, 25).map(p => ({
      label: p.name.slice(0, 100),
      description: `Preço: ${money(p.cents)}`.slice(0, 100),
      value: p.id
    })));

     const row = new ActionRowBuilder().addComponents(menu);

    return i.reply({
      content: '🗑️ Escolha o produto que deseja remover deste canal:',
      components: [row],
      ephemeral: true
    });
      }
    if(i.commandName==='produto_listar'){
const lista=products.filter(p=>p.channelId===i.channelId);
return i.reply({content:lista.length?lista.map(p=>`• **${p.name}** — ${money(p.cents)} — ID \`${p.id}\``).join('\n'):'Nenhum produto cadastrado neste canal.',ephemeral:true});
    } 
    if (i.commandName === 'estoque') {
  const lista = products.filter(
    p => p.channelId === i.channelId && p.active !== false
  );

  const texto = lista.length
    ? lista.map(p =>
        `📦 **${p.name}** — ${Number(p.quantity) || 0} unidades`
      ).join('\n')
    : '❌ Nenhum produto cadastrado neste canal.';

  return i.reply({
    content: `📦 **ESTOQUE — MAX STORE**\n\n${texto}`,
    ephemeral: true
  });
}

if (
  i.commandName === 'estoque_adicionar' ||
  i.commandName === 'estoque_remover'
) {
  const nome = i.options.getString('produto', true).trim();
  const quantidade = i.options.getInteger('quantidade', true);

  const produto = products.find(
    p => p.channelId === i.channelId &&
         p.active !== false &&
         p.name.toLowerCase() === nome.toLowerCase()
  );

  if (!produto) {
    return i.reply({
      content: '❌ Produto não encontrado neste canal. Confira o nome.',
      ephemeral: true
    });
  }

  const atual = Number(produto.quantity) || 0;

  if (
    i.commandName === 'estoque_remover' &&
    quantidade > atual
  ) {
    return i.reply({
      content: `❌ Estoque insuficiente. Quantidade atual: ${atual}.`,
      ephemeral: true
    });
  }

  produto.quantity =
    i.commandName === 'estoque_adicionar'
      ? atual + quantidade
      : atual - quantidade;

  writeJson(PRODUCTS_FILE, products);

  return i.reply({
    content:
      `✅ Estoque atualizado!\n` +
      `📦 Produto: **${produto.name}**\n` +
      `🔢 Quantidade disponível: **${produto.quantity}**`,
    ephemeral: true
  });
}
     if(i.commandName==='painel_suporte'){
  const embed = new EmbedBuilder()
    .setTitle('💜 MAX STORE | CENTRAL DE ATENDIMENTO')
    .setDescription(
      '✨ Precisando de ajuda? Escolha uma opção abaixo!\n\n' +
      '🛒 **Suporte:** problemas com compras ou entregas.\n' +
      '❓ **Dúvida:** perguntas sobre a loja.\n' +
      '💸 **Reembolso:** solicitação para análise.\n\n' +
      '🔒 Seu atendimento será privado.'
    )
    .setColor(0x7c3aed);

  const menu = new StringSelectMenuBuilder()
    .setCustomId('support_ticket_type')
    .setPlaceholder('🎫 Escolha o atendimento')
    .addOptions(
      { label: 'Suporte', value: 'suporte', emoji: '🛒' },
      { label: 'Dúvida', value: 'duvida', emoji: '❓' },
      { label: 'Reembolso', value: 'reembolso', emoji: '💸' }
    );

  await i.channel.send({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)]
  });

  return i.reply({
    content: '✅ Painel de suporte publicado!',
    ephemeral: true
  });
    }
    if(i.commandName==='painel'){
      if(!products.some(p=>p.channelId===i.channelId && p.active!==false)) return i.reply({content:'Cadastre primeiro um produto neste canal usando /produto_adicionar.',ephemeral:true});
      await i.channel.send(productPanel(i.channelId)); return i.reply({content:'Painel de produtos publicado.',ephemeral:true});
    }
    if(i.commandName==='venda_confirmar'){
      const id=i.options.getString('pedido',true).trim(); const order=orders.find(o=>o.id===id);
      if(!order) return i.reply({content:'Pedido não encontrado. Confira o ID exatamente como aparece no pedido.',ephemeral:true});
      if(order.status==='pago') return i.reply({content:'Este pedido já foi confirmado.',ephemeral:true});
      order.status='pago'; order.confirmedBy=i.user.id; order.confirmedAt=new Date().toISOString(); writeJson(ORDERS_FILE,orders);
      const buyer=await client.users.fetch(order.userId).catch(()=>null);
      const produto = products.find(p => p.id === order.productId);

if (buyer && produto) {
  await buyer.send(
    `✅ Pagamento confirmado!\n\n` +
    `🛒 Produto: ${produto.name}\n` +
    `📦 Sua entrega:\n${produto.delivery}`
  ).catch(() => {});
}
      
      const ch=await client.channels.fetch(DELIVERY_LOG_CHANNEL_ID).catch(()=>null);
      if(ch?.isTextBased()) await ch.send({embeds:[new EmbedBuilder().setTitle('✅ Venda confirmada').setColor(0x22c55e).addFields({name:'Produto',value:order.productName,inline:true},{name:'Valor',value:money(order.cents),inline:true},{name:'Comprador',value:`<@${order.userId}>`,inline:true},{name:'Pedido',value:order.id}).setTimestamp()]});
      const ticket = await client.channels.fetch(order.channelId).catch(() => null);

if (ticket && ticket.isTextBased()) {
  await ticket.send('✅ Pagamento confirmado! Este ticket será fechado em 5 segundos.');
  setTimeout(() => {
    ticket.delete().catch(() => {});
  }, 5000);
}

return i.reply({
  content: `✅ Pedido ${order.id} confirmado! O ticket será fechado automaticamente.`,
  ephemeral: true
});
    }
  }
 if (i.isButton() && i.customId === 'fechar_ticket') {
    if (!i.memberPermissions.has(PermissionFlagsBits.ManageChannels)) {
        return i.reply({
            content: '❌ Você não tem permissão para fechar este ticket.',
            ephemeral: true
        });
    }

    await i.reply('🔒 Este ticket será fechado em 5 segundos.');

    setTimeout(() => {
        i.channel.delete().catch(() => {});
    }, 5000);

    return;
 }
   if(i.isButton() && i.customId==='verify_member'){
  const verified=settings.verifiedUsers || [];
  if(!verified.includes(i.user.id)){
    verified.push(i.user.id);
    settings.verifiedUsers=verified;
    writeJson(SETTINGS_FILE,settings);
  }
  return i.reply({content:'✅ Verificação concluída! Agora você pode voltar ao painel e escolher seu produto.',ephemeral:true});
}

if(i.isStringSelectMenu() && i.customId.startsWith('select_product_')){
  const p=products.find(x=>x.id===i.values[0] && x.active!==false && x.channelId===i.channelId);
  if(!p) return i.reply({content:'Produto não encontrado. Peça ao administrador para atualizar o painel.',ephemeral:true});
  return sendOrder(i,p);
}
 if (i.isStringSelectMenu() && i.customId === 'remover_produto') {
  const produto = products.find(
    p => p.id === i.values[0] && p.channelId === i.channelId
  );

  if (!produto) {
    return i.reply({
      content: '❌ Produto não encontrado neste canal.',
      ephemeral: true
    });
  }

  products = products.filter(
  p => !(p.id === produto.id && p.channelId === i.channelId)
);
  writeJson(PRODUCTS_FILE, products);

  return i.update({
    content: `✅ Produto **${produto.name}** removido deste canal!`,
    components: []
  });
 } 
 
  } catch(e) {
  console.error(e);
  if(i.isRepliable()&&!i.replied&&!i.deferred){
   await i.reply({content:'Ocorreu um erro. Confira os logs da hospedagem.',ephemeral:true}).catch(()=>{});
  }
 }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== '1558901090282504233') return;

  try {
    await message.react('⭐');
    console.log('Reação adicionada!');
  } catch (error) {
    console.error('Erro ao reagir:', error);
  }
});
(async()=>{
 try{
  const rest = new REST({ version: '10' }).setToken(TOKEN);
await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('Comandos do servidor registrados.');
  await client.login(TOKEN);
 }catch(e){
  console.error('Falha ao iniciar:',e);
  process.exit(1);
 }
})();
