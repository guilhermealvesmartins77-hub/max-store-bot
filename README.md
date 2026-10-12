# MAX STORE 1 REAL — Bot de vendas para Discord

Projeto inicial funcional com botões, verificação obrigatória, produtos, estoque digital, pedidos PIX via Mercado Pago, webhook, entrega por DM e canal de registro.

## Requisitos
- Node.js 20+
- Aplicação/bot criado no Discord Developer Portal e convidado para o servidor
- Credenciais do Mercado Pago e uma URL pública HTTPS para receber webhooks
- Bot com permissões `View Channels`, `Send Messages`, `Embed Links`, `Use Application Commands`, `Read Message History` e `Manage Roles` (para dar o cargo de verificado, se configurado)

## Instalação
1. Extraia o ZIP.
2. Crie um arquivo `.env` copiando `.env.example` e preencha os valores.
3. No Discord Developer Portal, habilite o bot e convide-o ao servidor com os escopos `bot` e `applications.commands`.
4. No terminal, dentro da pasta do projeto, execute:
   ```bash
   npm install
   npm start
   ```
5. O bot registra os comandos no servidor configurado em `DISCORD_GUILD_ID`.
6. Crie os canais de vendas, verificação e registros e preencha os respectivos IDs no `.env`.
7. Execute `/painel` para publicar os painéis nos canais configurados.

## Mercado Pago / PIX real
- Configure `MP_ACCESS_TOKEN` com o token correto da conta do Mercado Pago.
- Configure `MP_WEBHOOK_URL` para uma URL HTTPS pública que encaminhe `POST /webhooks/mercadopago` a esta aplicação.
- Configure o webhook no painel do Mercado Pago para notificações de pagamentos.
- Se o painel fornecer um segredo de assinatura, configure `MP_WEBHOOK_SECRET`.
- Teste primeiro em ambiente de teste/sandbox. Só use produção após validar o fluxo inteiro.
- A API de webhook precisa permanecer acessível enquanto houver pedidos pendentes. Um host de bot que não aceite tráfego HTTP externo pode exigir hospedagem separada para o webhook.
- O webhook consulta o pagamento diretamente na API do Mercado Pago antes de liberar o produto. Não confie em comprovantes enviados pelo cliente.
- Para validar assinatura de webhook, configure o segredo conforme a documentação da conta/produto do Mercado Pago. A implementação abaixo verifica `x-signature` quando `MP_WEBHOOK_SECRET` está definido; confira o formato atual exigido pelo seu painel antes de produção.

## Cadastro de produtos
Use `/produto_adicionar` com nome, descrição, preço em reais e estoque. O estoque é cadastrado como linhas de texto, uma entrega por linha (ex.: código, link ou instrução). Para item físico, ajuste o módulo de entrega antes de usar.

Comandos:
- `/painel` — publica painéis de verificação e loja
- `/produto_adicionar`
- `/produto_remover`
- `/produto_editar`
- `/produtos`
- `/estoque`
- `/vendas`
- `/estatisticas`
- `/configurar_canal_vendas`
- `/configurar_canal_logs`
- `/configurar_verificacao`

## Segurança importante
- Nunca envie `DISCORD_TOKEN`, `MP_ACCESS_TOKEN` ou segredo de webhook em chats.
- Não coloque `.env` no ZIP público ou no GitHub.
- A entrega por DM pode falhar se o usuário bloquear mensagens privadas; o bot registra esse estado e o pedido permanece marcado para revisão, sem liberar estoque novamente automaticamente.
- Configure as permissões do cargo de verificado manualmente e confira a hierarquia de cargos.
- Este projeto é uma base de implementação: faça testes em servidor privado e em sandbox antes de aceitar pagamentos reais. Integrações externas podem exigir ajustes conforme a conta e a documentação atual do provedor.
