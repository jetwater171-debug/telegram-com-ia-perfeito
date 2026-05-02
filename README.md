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

# Ordem de provedores. O multi-IA e entre OpenRouter e Gemini.
AI_MODEL_ORDER=openrouter,gemini

# Ordens por etapa, opcionais.
AI_STRATEGY_MODEL_ORDER=openrouter,gemini
AI_DRAFT_MODEL_ORDER=openrouter,gemini
AI_REVIEW_MODEL_ORDER=openrouter,gemini
AI_EVALUATOR_MODEL_ORDER=openrouter,gemini

# Modelos usados dentro de cada provedor.
OPENROUTER_DRAFT_MODEL=z-ai/glm-4.5-air:free
GEMINI_DRAFT_MODEL=gemini-2.5-flash
```

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
