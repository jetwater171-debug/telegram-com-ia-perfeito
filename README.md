This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Arquitetura da Lari

O bot usa um único gateway com fallback por provedor e o mesmo piso de qualidade para todo lead:

1. **Todos os níveis:** somente B.AI, Gemini 3.x e NVIDIA usam o scheduler de saúde, capacidade e fallback.
2. **Turnos críticos:** uma revisão adicional entra somente quando há risco real, como PIX, mídia, contradição ou baixa confiança.
3. **Backend:** continua sendo a autoridade para preço, aceite, PIX, deduplicação e entrega de mídia em todos os níveis.

O VIP possui preço único de **R$ 19,90**. Foto, vídeo, áudio personalizado, chamada e demais produtos seguem a oferta adaptativa do pedido real do lead. O aumento de inteligência melhora continuidade e atendimento; não libera pressão por vulnerabilidade emocional ou financeira.

A memória por lead guarda fatos confirmados, assuntos pendentes, tom, desejos, produtos, recusas e objeções. Starter e Buyer consultam até 80 mensagens recentes, Premium até 100 e Elite até 120. Cada `/start` abre um episódio novo: fatos úteis continuam privados na memória, mas falas íntimas, ofertas e ganchos da conversa anterior não voltam para o novo primeiro contato.

### Provedores e modelos confirmados

- B.AI: `glm-5.3-flash`, `qwen3.8-flash` e `hy3`. O router consulta `/models` no teste de conexão e não presume que uma promoção de 0 créditos será permanente.
- Google Gemini: `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash` e `gemini-3.5-flash`. Não há Gemini 2.x nem Flash-Lite na rota. Configurações antigas são promovidas para `gemini-3.6-flash`.
- NVIDIA NIM: `deepseek-ai/deepseek-v4-pro-0813`, `deepseek-ai/deepseek-v4-flash-0731`, `moonshotai/kimi-k3` e `nvidia/nemotron-3.5-lightning-30b-a3b`.

O endpoint hospedado gratuito do NVIDIA Build é de avaliação. Em `NODE_ENV=production` ele fica bloqueado por padrão; produção deve apontar `NVIDIA_BASE_URL`/`baseUrl` para um NIM licenciado ou endpoint contratado. `NVIDIA_ALLOW_TRIAL_ENDPOINT_IN_PRODUCTION=true` existe somente para uma decisão explícita do operador, não como padrão.

Configuracao principal:

```env
# Ordem real de prioridade. Provedor sem credencial é ignorado.
AI_MODEL_ORDER=bai,gemini,nvidia

# Ordens por etapa, opcionais.
AI_STRATEGY_MODEL_ORDER=bai,gemini,nvidia
AI_DRAFT_MODEL_ORDER=bai,gemini,nvidia
AI_REVIEW_MODEL_ORDER=bai,gemini,nvidia

# Modelos usados dentro de cada provedor.
BAI_DRAFT_MODEL=glm-5.3-flash
GEMINI_DRAFT_MODEL=gemini-3.8-flash
NVIDIA_API_KEY=nvapi-...
NVIDIA_DRAFT_MODEL=deepseek-ai/deepseek-v4-pro-0813
```

### Várias credenciais

Não há limite fixo no código. Para poucas chaves, use listas separadas por vírgula, ponto e vírgula ou quebra de linha:

```env
BAI_API_KEYS=chave_1,chave_2,chave_3
NVIDIA_API_KEYS=nvapi-1,nvapi-2
```

Para metadados por chave/projeto, use JSON. No Gemini, `projectId` deve ser o projeto autorizado dono da quota; várias keys com o mesmo `projectId` compartilham o mesmo grupo de RPM/TPM/RPD.

```env
GEMINI_CREDENTIALS_JSON=[{"apiKey":"AIza...","projectId":"projeto-a","label":"Gemini projeto A","limits":{"rpm":10,"tpm":250000}},{"apiKey":"AIza...","projectId":"projeto-b","label":"Gemini projeto B"}]
NVIDIA_CREDENTIALS_JSON=[{"apiKey":"nvapi-...","accountId":"conta-nvidia-a","label":"NIM A","baseUrl":"https://seu-nim.example/v1","limits":{"rpm":40}}]
BAI_CREDENTIALS_JSON=[{"apiKey":"...","accountId":"conta-bai-a","label":"B.AI 1","limits":{"rpm":30}}]
```

Para quantidade maior, aplique `ai_gateway_v2_migration.sql`, configure `AI_CREDENTIALS_ENCRYPTION_KEY` no secret store e use a API administrativa `GET/POST/DELETE /api/admin/ai-credentials`. Os segredos persistidos são AES-256-GCM e a exclusão administrativa é recuperável (desabilita a credencial).

### Roteamento adaptativo para volume

O gateway não usa mais uma lista cega. Cada chamada passa por um roteador que considera:

- limite por minuto e por dia de requisições e tokens;
- concorrência em andamento, latência média e taxa recente de sucesso;
- afinidade estável por lead sem concentrar todos os leads no mesmo provedor;
- circuit breaker diferente para chave inválida, quota, timeout, erro 5xx e JSON ruim;
- fila curta por nível do cliente e fallback imediato quando outra rota tem capacidade;
- recuperação textual em outro provedor quando a visão do Gemini não responder.

Os provedores nem sempre publicam limites fixos, e no Gemini a cota real pertence ao projeto/tier mostrado no AI Studio. Sem configuração, o router não inventa um teto baixo: aprende com 429/cooldown. Para exibir capacidade restante exata, cadastre os limites reais do projeto:

```env
GEMINI_GATEWAY_RPM=<RPM mostrado no seu projeto>
GEMINI_GATEWAY_TPM=<TPM mostrado no seu projeto>
GEMINI_GATEWAY_RPD=<RPD mostrado no seu projeto>
BAI_GATEWAY_RPM=<limite da sua conta>
BAI_GATEWAY_TPM=<limite da sua conta>
NVIDIA_GATEWAY_RPM=<limite do seu endpoint>
NVIDIA_GATEWAY_CONCURRENCY=4
AI_SHARED_RATE_LIMIT_ENABLED=true
```

Para coordenar várias instâncias da Vercel, execute `ai_gateway_capacity_migration.sql` e `ai_gateway_v2_migration.sql` no Supabase e configure `SUPABASE_SERVICE_ROLE_KEY`. O bucket do Gemini é agrupado por projeto e o RPD reinicia à meia-noite do Pacífico. Sem a migration de capacidade, o roteador continua com controle local conservador.

O painel `/admin/ai` possui autosave, teste de conexão e ordem visual dos provedores. `/admin/ai/capacity` e `GET /api/admin/ai-capacity` mostram uso e restante por provedor/modelo/credencial/projeto, tokens de entrada/saída/contexto/raciocínio, custo estimado, 429/5xx, cooldown e resets. Limite desconhecido aparece como “não publicado”, nunca como número inventado. A telemetria usa somente `ai_gateway_usage_events`; o JSON duplicado antigo em `bot_settings` não é mais escrito. Para retenção, agende `select public.prune_ai_gateway_usage_events(90);` diariamente.

### Cérebro de conversa humanizado

O contrato comportamental fica centralizado em `src/lib/lariConversationPrompts.ts` e é compartilhado por três etapas:

1. **Cérebro geral:** separa fatos de hipóteses, lê estágio/necessidade e escolhe um único próximo passo.
2. **Lari:** responde primeiro à mensagem literal, preserva ritmo e escreve normalmente 1 balão; mídia e venda só entram quando o turno sustenta.
3. **Revisora:** entra em primeiro contato, estágio novo, mídia, preço, pagamento, baixa confiança ou rascunho frágil.

O histórico operacional continua em 80/100/120 mensagens conforme o nível, mas cada `/start` abre um episódio novo. O formatador não divide uma resposta apenas para fabricar volume. Não existe mais prompt legado alternativo: produção, testes e painel usam o mesmo contrato central.

Validação rápida do comportamento:

```powershell
node scripts/verify-lari-humanization.cjs
node scripts/verify-conversation-brain.cjs
node scripts/verify-ai-orchestration.cjs
```

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
