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

O bot usa um gateway com fallback por provedor e inteligencia progressiva por valor confirmado:

1. **Starter (R$ 0–19,89):** cérebro geral econômico separado + Lari; revisão extra em risco de começo estranho, PIX, mídia ou baixa confiança.
2. **Buyer (R$ 19,90–99,99):** cérebro central separado + Lari; revisão extra apenas em PIX, baixa confiança, começo estranho ou encontro.
3. **Premium (R$ 100–199,99):** cérebro + Lari + revisão em todos os turnos, com janela de contexto maior.
4. **Elite (R$ 200+):** cérebro + Lari + revisão + avaliadora final, com até 120 mensagens recentes consultadas e memória persistente.
5. **Backend:** continua sendo a autoridade para preço, aceite, PIX, deduplicação e entrega de mídia em todos os níveis.

O VIP possui preço único de **R$ 19,90**. Foto, vídeo, áudio personalizado, chamada e demais produtos seguem a oferta adaptativa do pedido real do lead. O aumento de inteligência melhora continuidade e atendimento; não libera pressão por vulnerabilidade emocional ou financeira.

A memória por lead guarda fatos confirmados, assuntos pendentes, tom, desejos, produtos, recusas e objeções. Starter e Buyer consultam até 80 mensagens recentes, Premium até 100 e Elite até 120. Cada `/start` abre um episódio novo: fatos úteis continuam privados na memória, mas falas íntimas, ofertas e ganchos da conversa anterior não voltam para o novo primeiro contato.

### Ranking operacional de provedores

**Produção, em ordem:**

1. Gemini AI Studio: melhor rota geral e obrigatória para visão; a cota real varia por modelo e projeto.
2. Groq: maior volume gratuito previsível para texto curto e baixa latência; o limite diário de tokens pesa antes do RPD nos modelos grandes.
3. NVIDIA NIM: rota oficial hospedada e OpenAI-compatible para desenvolvimento, ativada somente quando a chave NVIDIA existe.
4. Cloudflare Workers AI: 10.000 neurons/dia e bom encaixe para o primeiro cérebro barato.
5. Mistral Free mode: API oficial sem cartão, boa reserva; a cota exata aparece por organização no painel.
6. OpenRouter: ótimo agregador/fallback, mas o free puro é baixo (50 req/dia; 1.000/dia depois de adicionar US$ 10 em créditos).
7. Cerebras: muito rápido, porém hoje é trial de US$ 5/30 dias, não uma franquia grátis renovável.
8. GitHub Models, Hugging Face, AwanLLM e self-host com vLLM/Ollama: entram depois de teste real de conta, preço, licença e latência; self-host é a única rota de volume realmente controlável.

**Laboratório isolado:** FreeLLMAPI, OmniRoute/9Router, AI-Worker-Proxy, GeminiHydra e outros gateways OpenAI-compatible podem usar `AI_CUSTOM_GATEWAY_*` quando rodam em infraestrutura e chaves próprias. Eles agregam fallback, mas não criam cota nova.

**Fora da rota de conversas reais:** Puter Account Pool Manager, FreeBuff Proxy, ApiFreeLLM, Completeons.me, Algion, NaraRouter, endpoints anônimos não verificados, pools de contas, resets de MachineID, sessões móveis transplantadas, IP/fingerprint rotation e chaves públicas. Essas opções não têm cota, propriedade de sessão, privacidade ou disponibilidade previsíveis.

Configuracao principal:

```env
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_REFERER=https://seu-dominio.com
OPENROUTER_TITLE=Lari Telegram Bot

# Ordem de provedores. Provedor sem chave e ignorado automaticamente.
AI_MODEL_ORDER=gemini,groq,nvidia,cloudflare,mistral,openrouter,cerebras,custom

# Ordens por etapa, opcionais.
AI_STRATEGY_MODEL_ORDER=gemini,groq,nvidia,cloudflare,mistral,openrouter,cerebras,custom
AI_DRAFT_MODEL_ORDER=gemini,groq,nvidia,cloudflare,mistral,openrouter,cerebras,custom
AI_REVIEW_MODEL_ORDER=gemini,groq,nvidia,cloudflare,mistral,openrouter,cerebras,custom

# Modelos usados dentro de cada provedor.
OPENROUTER_DRAFT_MODEL=z-ai/glm-4.5-air:free
GEMINI_DRAFT_MODEL=gemini-3.6-flash

# Provedores oficiais diretos opcionais. So entram quando a respectiva chave existe.
GROQ_API_KEY=gsk_...
GROQ_DRAFT_MODEL=openai/gpt-oss-120b
NVIDIA_API_KEY=nvapi-...
NVIDIA_DRAFT_MODEL=meta/llama-3.1-8b-instruct
MISTRAL_API_KEY=...
MISTRAL_DRAFT_MODEL=mistral-small-latest
CEREBRAS_API_KEY=...
CEREBRAS_DRAFT_MODEL=gpt-oss-120b
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_AI_API_TOKEN=...
CLOUDFLARE_DRAFT_MODEL=@cf/openai/gpt-oss-20b

# Qualquer gateway OpenAI-compatible administrado por voce
# (LiteLLM, FreeLLMAPI, OmniRoute, 9Router ou outro proxy isolado).
AI_CUSTOM_GATEWAY_BASE_URL=http://seu-gateway/v1
AI_CUSTOM_GATEWAY_API_KEY=...
AI_CUSTOM_DRAFT_MODEL=auto
AI_CUSTOM_GATEWAY_TIERS=starter,buyer
AI_CUSTOM_GATEWAY_WEIGHT=5
```

No nível starter, Gemini Flash-Lite recebe a maior parte dos leads. O restante é distribuído de forma estável entre os provedores econômicos configurados; 429, falta de crédito e falhas de autenticação ativam cooldown automático antes do próximo fallback.

### Roteamento adaptativo para volume

O gateway não usa mais uma lista cega. Cada chamada passa por um roteador que considera:

- limite por minuto e por dia de requisições e tokens;
- concorrência em andamento, latência média e taxa recente de sucesso;
- afinidade estável por lead sem concentrar todos os leads no mesmo provedor;
- circuit breaker diferente para chave inválida, quota, timeout, erro 5xx e JSON ruim;
- fila curta por nível do cliente e fallback imediato quando outra rota tem capacidade;
- modelo Groq 8B no primeiro contato e modelo maior somente depois da primeira compra;
- recuperação textual em outro provedor quando a visão do Gemini não responder.

Os limites conservadores podem ser ajustados sem alterar código. Exemplo:

```env
GEMINI_GATEWAY_RPM=10
GEMINI_GATEWAY_TPM=250000
GROQ_GATEWAY_RPM=30
GROQ_GATEWAY_TPM=6000
NVIDIA_GATEWAY_RPM=20
NVIDIA_GATEWAY_CONCURRENCY=4
CLOUDFLARE_GATEWAY_CONCURRENCY=6
AI_SHARED_RATE_LIMIT_ENABLED=true
```

Para coordenar várias instâncias da Vercel, execute `ai_gateway_capacity_migration.sql` no Supabase e configure `SUPABASE_SERVICE_ROLE_KEY`. Sem isso, o roteador continua funcionando com controle local por instância.

O painel `/admin/ai` possui autosave, teste de conexão, estado da chave, ordem visual dos provedores e link direto para criar cada API key.

O prompt compacto é o padrão. Para diagnóstico temporário do prompt antigo, use `LARI_LEGACY_PROMPT=true`.

Padrao sem variaveis de ordem:

1. OpenRouter
2. Gemini, apenas se `GEMINI_API_KEY` existir

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
