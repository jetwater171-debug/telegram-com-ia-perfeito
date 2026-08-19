# Visão Avançada no Chat de Lead: Inspetor de Prompt e Resposta da IA

## 1. Visão Geral
Adicionar ao chat de lead do painel administrativo (`/admin/chat/[id]`) o modo **Visão Avançada** (`⚡ Visão Avançada`). Quando ativado, permite ao administrador inspecionar o prompt completo que foi enviado para a IA e a resposta JSON completa retornada pelo modelo para cada mensagem gerada.

---

## 2. Coleta e Estrutura de Dados (`ai_debug`)

### 2.1 O que é capturado em cada turno da IA (`src/lib/gemini.ts` & `src/app/api/process-message/route.ts`)
Durante a geração de resposta da IA em `sendMessageToGemini`, montamos o payload estruturado `ai_debug`:

```typescript
export interface AiDebugData {
    timestamp: string;
    model: string;
    provider: string;
    tier: string;
    duration_ms: number;
    system_prompt: string;
    user_prompt: string;
    clean_history?: Array<{ role: string; content: string }>;
    raw_response: Record<string, any>;
    stages?: {
        strategy?: { prompt?: string; output?: any; model?: string; duration_ms?: number };
        draft?: { prompt?: string; output?: any; model?: string; duration_ms?: number };
        review?: { prompt?: string; output?: any; model?: string; duration_ms?: number };
        evaluator?: { prompt?: string; output?: any; model?: string; duration_ms?: number };
    };
}
```

### 2.2 Persistência no Banco de Dados
1. **Schema SQL**:
   - Criação/migração `ALTER TABLE messages ADD COLUMN IF NOT EXISTS ai_debug JSONB;`
   - O campo `ai_debug` é inserido diretamente na linha da mensagem criada (mensagem `sender = 'thought'` ou `sender = 'bot'`).
2. **Resiliência / Fallback**:
   - Caso o banco ainda não tenha a coluna ou o payload falhe, o envio da mensagem ao lead continua ocorrendo normalmente sem travar.

---

## 3. Interface do Usuário (`src/app/admin/chat/[id]/page.tsx`)

### 3.1 Controles do Cabeçalho
- Adição do botão de alternância **`⚡ Visão Avançada`** no topo da página ao lado dos filtros atuais (*Sistema*, *Ideias IA*).
- Quando ativado, ativa o modo de inspeção visual no chat.

### 3.2 Indicadores no Feed de Mensagens
- Cada mensagem da IA / balão de pensamento gerado com dados de debug exibe um botão/badge interativo:
  - `[ 🔍 Inspecionar Prompt ]` com tag do modelo e tempo (ex: `gemini-2.5-flash · 840ms`).
- Clicar no botão abre o painel lateral de inspeção focado naquele turno específico.

### 3.3 Gaveta / Painel Lateral de Inspeção (Slide-over Drawer)
Um painel lateral deslizante com tema escuro e alta legibilidade contendo:
1. **Cabeçalho do Inspetor:**
   - Horário exato da mensagem.
   - Modelo utilizado (Provedor + Modelo).
   - Tempo de resposta em ms.
   - Botão de fechar `✕`.
2. **Abas de Visualização:**
   - **Aba 1 — 📤 Prompt Enviado:**
     - Visualização completa do System Instruction + Contexto Operacional + Mensagem do Lead.
     - Botão `📋 Copiar Prompt Completo`.
   - **Aba 2 — 📥 Resposta Bruta (JSON):**
     - Visualização do JSON bruto retornado pela IA (`messages`, `action`, `current_state`, `lead_stats`, `lead_memory_patch`, etc.) com syntax highlighting / formatação limpa.
     - Botão `📋 Copiar JSON`.
   - **Aba 3 — 🧠 Etapas do Pipeline (se houver estágios separados):**
     - Visualização do planejamento do *Cérebro Estratégico*, *Rascunho*, *Revisora* e *Avaliadora*.
3. **Tratamento para mensagens antigas:**
   - Mensagens legadas que não possuem `ai_debug` gravado exibem aviso amigável explicando que os dados detalhados ficam disponíveis a partir das novas mensagens geradas.

---

## 4. Plano de Verificação e Testes
1. **Banco e Migração:** Execução da migração SQL com `ai_debug JSONB` e teste de inserção.
2. **Fluxo de IA:** Envio de mensagem de teste pelo Telegram ou rota de teste e validação se `ai_debug` é preenchido com o prompt e JSON reais.
3. **UI do Painel Admin:**
   - Ativação do toggle `⚡ Visão Avançada`.
   - Abertura da gaveta de inspeção ao clicar no botão da mensagem.
   - Funcionamento dos botões de cópia (copiar prompt e copiar JSON).
   - Realtime: recebimento de nova mensagem da IA e abertura imediata do inspector.
