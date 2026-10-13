require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, Events, PermissionFlagsBits
} = require('discord.js');

const env = (a,b) => process.env[a] || process.env[b];
const TOKEN = env('DISCORD_TOKEN');
const CLIENT_ID = env('DISCORD_CLIENT_ID','CLIENT_ID');
const GUILD_ID = env('DISCORD_GUILD_ID','GUILD_ID');
const SALES_CHANNEL_ID = process.env.SALES_CHANNEL_ID;
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
const commands = [
  new SlashCommandBuilder().setName('painel').setDescription('Publica/atualiza o painel de produtos da loja.'),
  new SlashCommandBuilder().setName('configurar_verificacao').setDescription('Publica o botão de verificação obrigatória.'),
  new SlashCommandBuilder().setName('configurar_canal_vendas').setDescription('Mostra o ID deste canal para configurar o canal de vendas.'),
  new SlashCommandBuilder().setName('produto_adicionar').setDescription('Adiciona produto à loja.')
    .addStringOption(o=>o.setName('nome').setDescription('Nome do produto').setRequired(true))
    .addNumberOption(o=>o.setName('preco').setDescription('Preço em reais, exemplo 1.00').setRequired(true).setMinValue(0.01))
    .addStringOption(o=>o.setName('descricao').setDescription('Descrição do produto').setRequired(true))
    .addStringOption(o=>o.setName('entrega').setDescription('Conteúdo/instruções entregues após confirmação').setRequired(true)),
  new SlashCommandBuilder().setName('produto_listar').setDescription('Lista os produtos cadastrados.'),
  new SlashCommandBuilder().setName('venda_confirmar').setDescription('Confirma um PIX após verificar o recebimento no banco.')
    .addStringOption(o=>o.setName('pedido').setDescription('ID do pedido informado ao comprador').setRequired(true))
].map(c=>c.toJSON());
const rest = new REST({version:'10'}).setToken(TOKEN);
const client = new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
function productPanel(channelId){
  const embed = new EmbedBuilder()
    .setTitle(`🛍️ ${STORE_NAME}`)
    .setDescription('Escolha um produto abaixo.')
    .setColor(0x7c3aed);

  const available = products.filter(
    p => p.active !== false && p.channelId === channelId
  );

  const rows = [];

  if (available.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`select_product_${channelId}`)
      .setPlaceholder('➡️ Clique aqui para escolher um produto')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(available.slice(0, 25).map(p => ({
        label: p.name.slice(0, 100),
        description: `Preço: ${money(p.cents)}`.slice(0, 100),
        value: p.id
      })));

    rows.push(new ActionRowBuilder().addComponents(menu));
  }

  return { embeds: [embed], components: rows };
}
function verifyPanel(){
  return {embeds:[new EmbedBuilder().setTitle('🔐 Verificação obrigatória').setDescription('Clique no botão abaixo para concluir a verificação e liberar as compras.').setColor(0x22c55e)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_member').setLabel('✅ Verificar-se').setStyle(ButtonStyle.Success))]};
}
async function sendOrder(interaction,p){
  const verified = settings.verifiedUsers || [];
  if(!verified.includes(interaction.user.id)) return interaction.reply({content:'Você precisa concluir a verificação antes de comprar. Use o botão Verificar-se no canal de verificação.',ephemeral:true});
  const order={id:`MS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,5).toUpperCase()}`,userId:interaction.user.id,productId:p.id,productName:p.name,cents:p.cents,delivery:p.delivery,status:'aguardando_pagamento',createdAt:new Date().toISOString()};
  orders.push(order); writeJson(ORDERS_FILE,orders);
  const embed=new EmbedBuilder().setTitle('🧾 Pedido criado').setColor(0xf59e0b).setDescription(`**Produto:** ${p.name}\n**Descrição:** ${p.description}\n**Valor:** ${money(p.cents)}\n**Pedido:** \`${order.id}\`\n\n**PIX (chave):** \`${PIX_KEY}\`\n**Recebedor:** ${PIX_NAME}\n\nApós pagar, aguarde um administrador confirmar. A entrega só ocorre depois da conferência do pagamento. Não envie senha ou dados bancários.`);
  return interaction.reply({embeds:[embed],ephemeral:true});
}
client.once(Events.ClientReady, c=>console.log(`Bot conectado como ${c.user.tag}`));
client.on(Events.InteractionCreate,async i=>{
 try{
  if(i.isChatInputCommand()){
    if(['painel','configurar_verificacao','configurar_canal_vendas','produto_adicionar','venda_confirmar'].includes(i.commandName) && !isAdmin(i)) return i.reply({content:'Somente administradores podem usar este comando.',ephemeral:true});
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
    if(i.commandName==='produto_listar'){
const lista=products.filter(p=>p.channelId===i.channelId);
return i.reply({content:lista.length?lista.map(p=>`• **${p.name}** — ${money(p.cents)} — ID \`${p.id}\``).join('\n'):'Nenhum produto cadastrado neste canal.',ephemeral:true});
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
      if(buyer) await buyer.send(`✅ Pagamento confirmado para o pedido ${order.id} — ${order.productName}.\nEntrega/instruções: ${order.delivery}`).catch(()=>{});
      const ch=await client.channels.fetch(SALES_CHANNEL_ID).catch(()=>null);
      if(ch?.isTextBased()) await ch.send({embeds:[new EmbedBuilder().setTitle('✅ Venda confirmada').setColor(0x22c55e).addFields({name:'Produto',value:order.productName,inline:true},{name:'Valor',value:money(order.cents),inline:true},{name:'Comprador',value:`<@${order.userId}>`,inline:true},{name:'Pedido',value:order.id}).setTimestamp()]});
      return i.reply({content:`Pedido ${order.id} marcado como pago. A entrega foi enviada por mensagem privada se o comprador aceitar DMs.`,ephemeral:true});
    }
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
  
 
  } catch(e) {
  console.error(e);
  if(i.isRepliable()&&!i.replied&&!i.deferred){
   await i.reply({content:'Ocorreu um erro. Confira os logs da hospedagem.',ephemeral:true}).catch(()=>{});
  }
 }
});

(async()=>{
 try{
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID),{body:commands});
  console.log('Comandos do servidor registrados.');
  await client.login(TOKEN);
 }catch(e){
  console.error('Falha ao iniciar:',e);
  process.exit(1);
 }
})();
