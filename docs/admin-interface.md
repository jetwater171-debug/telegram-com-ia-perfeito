# Interface administrativa

## Escopo

Refinamento visual restrito ao painel `/admin`. As rotas de API, integrações do Telegram, regras da IA, regras de cobrança, banco de dados e página pública não são alterados.

## Direção visual

- Canvas grafite `#101114`, painéis `#18191e` e bordas sutis.
- Verde suave `#c4ed87` reservado a ações principais e destaques.
- Tipografia existente do projeto, hierarquia consistente e números tabulares.
- Navegação lateral agrupada em operação, inteligência e gestão.
- Layout adaptável a desktop, tablet e celular; movimento reduzido respeitado.

## Caixa de entrada

- Indicadores de conversas, leads quentes, compradores e receita acumulada, derivados dos dados já carregados — sem gráficos ou tendências fictícias.
- Filtros de status e de fase, busca e ordenação por recência, valor pago ou abertura.
- Etapas do funil apresentadas em português sem alterar seus identificadores internos.
- Avatares por iniciais, prévia da mensagem, sinais de interesse e valor por conversa.
- O ponto âmbar significa apenas que a última mensagem carregada foi enviada pelo lead; não é um contador global de mensagens não lidas.
- Carregamento progressivo, estado vazio com limpeza de filtros e feedback de atualização.
- Confirmação explícita antes da reativação em lote, esclarecendo que os filtros da listagem não restringem os destinatários. As regras de elegibilidade continuam no backend existente.

## Manutenção

- `src/app/admin/admin.css`: tokens, estrutura, componentes visuais e breakpoints exclusivos do admin.
- `src/app/admin/page.tsx`: caixa de entrada e suas interações.
- `src/app/admin/insights/page.tsx`: rótulos de funil e estados vazios/erro da tela de resultados.
- `src/app/admin/settings/page.tsx`: associação acessível do campo de token e feedback do formulário.
- `src/components/AdminIcon.tsx`: ícones SVG locais, sem dependência adicional.
- `src/components/AdminTopbar.tsx`: navegação, busca de páginas e status dos serviços.
- `src/app/admin/login/page.tsx`: formulário de acesso administrativo.

## Validação local segura

Use dados fictícios em um ambiente isolado para a revisão visual. O dashboard existente dispara conciliação de pagamentos automaticamente; não abra uma prévia apontada para produção para fazer testes de interface. Não execute reativação, exclusão, envio de mensagens ou alterações de configurações contra dados reais durante o teste visual.

Uma compilação feita com variáveis de ambiente de teste incorpora o endereço público de teste no bundle. Antes de publicar, execute novamente o build com as variáveis corretas do ambiente de destino. Este trabalho não inclui deploy.

### Comandos de verificação

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src/app/admin src/components/AdminTopbar.tsx src/components/AdminIcon.tsx
```

Também foi executado um smoke test local com Playwright/Chrome e APIs operacionais simuladas: login, filtros, estado vazio, cancelamento da confirmação de reativação, busca de páginas, navegação mobile, Resultados e Ajustes. A caixa de entrada foi verificada em larguras de 1440, 1100, 800, 390 e 320 px, sem overflow horizontal ou erros de página. As capturas e scripts locais de revisão ficam em `.codex-artifacts/` e não fazem parte da publicação.
