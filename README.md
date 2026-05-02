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

## Lari Multi-IAs

O bot usa um gateway de IAs com fallback por ordem, parecido com multigateway de pagamento. A mesma instrucao/persona da Lari e enviada para todos os provedores, entao trocar de modelo nao muda a personagem.

Configuracao principal:

```env
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_REFERER=https://seu-dominio.com
OPENROUTER_TITLE=Lari Telegram Bot

# Ordem global opcional. Se nao configurar, o padrao comeca no OpenRouter free.
AI_MODEL_ORDER=openrouter:z-ai/glm-4.5-air:free,openrouter:openai/gpt-oss-120b:free,openrouter:google/gemma-4-31b-it:free,openrouter:openrouter/free,gemini:gemini-2.5-flash

# Ordens por etapa, opcionais.
AI_STRATEGY_MODEL_ORDER=openrouter:z-ai/glm-4.5-air:free,openrouter:openai/gpt-oss-120b:free
AI_DRAFT_MODEL_ORDER=openrouter:z-ai/glm-4.5-air:free,openrouter:openai/gpt-oss-120b:free
AI_REVIEW_MODEL_ORDER=openrouter:openai/gpt-oss-120b:free,openrouter:z-ai/glm-4.5-air:free
AI_EVALUATOR_MODEL_ORDER=openrouter:openai/gpt-oss-120b:free,openrouter:z-ai/glm-4.5-air:free
```

Padrao sem variaveis de ordem:

1. `z-ai/glm-4.5-air:free`
2. `openai/gpt-oss-120b:free`
3. `google/gemma-4-31b-it:free`
4. `openrouter/free`
5. `gemini:gemini-2.5-flash`, apenas se `GEMINI_API_KEY` existir

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
