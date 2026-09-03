export type PromptBlockTone = 'cyan' | 'blue' | 'emerald' | 'pink' | 'amber' | 'violet' | 'indigo' | 'slate' | 'orange' | 'rose';

export type PromptVisualBlock = {
    id: string;
    heading: string;
    content: string;
    friendlyName: string;
    description: string;
    tone: PromptBlockTone;
    kind: 'section' | 'functions' | 'dynamic';
};

export type PromptFunctionItem = {
    name: string;
    content: string;
};

const normalize = (value: unknown) => String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const slug = (value: string) => normalize(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 54) || 'bloco';

const PLAIN_HEADING = String.raw`(?:\d+\.\s+)?[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ0-9 _.,:+&/()“”'’—→-]{3,}`;
const promptHeadingPattern = () => new RegExp(`^(?:#{1,3}\\s+.+|${PLAIN_HEADING})$`, 'gm');

const headingOf = (content: string) => {
    const firstLine = String(content || '').split('\n')[0]?.trim() || '';
    return firstLine.replace(/^#{1,3}\s+/, '').trim() || 'Bloco livre';
};

const metadataFor = (heading: string): Pick<PromptVisualBlock, 'friendlyName' | 'description' | 'tone' | 'kind'> => {
    const value = normalize(heading);
    if (value.includes('funcoes disponiveis')) return { friendlyName: 'Funções reais', description: 'PIX, áudio, prévias e consultas que a IA pode solicitar.', tone: 'pink', kind: 'functions' };
    if (value.includes('motor de conversao') || value.includes('venda natural')) return { friendlyName: 'Como vender', description: 'Quando conversar, oferecer, fechar e gerar o pagamento.', tone: 'emerald', kind: 'section' };
    if (value.includes('agente de conversa') || value.includes('master brain de conversa')) return { friendlyName: 'Quem é a Lari', description: 'Identidade, missão e objetivo principal da agente.', tone: 'cyan', kind: 'section' };
    if (value.includes('prioridades') || value.includes('prioridade e verdade')) return { friendlyName: 'Prioridades do turno', description: 'A ordem que a Lari segue antes de responder.', tone: 'blue', kind: 'section' };
    if (value.includes('voz, relacao') || value.includes('conteudo adulto')) return { friendlyName: 'Tom, relação e +18', description: 'Como a intimidade, o flerte e a confirmação adulta funcionam.', tone: 'pink', kind: 'section' };
    if (value.includes('verdade operacional') || value.includes('contrato operacional')) return { friendlyName: 'Regras de segurança', description: 'Evita promessas falsas, preços errados e ações inexistentes.', tone: 'amber', kind: 'section' };
    if (value === '5. memoria' || value.includes('memoria')) return { friendlyName: 'Memória do lead', description: 'O que lembrar e como usar sem inventar informações.', tone: 'violet', kind: 'section' };
    if (value.includes('decisao e saida') || value.includes('formato')) return { friendlyName: 'Formato da resposta', description: 'Decisão final e estrutura técnica esperada pelo backend.', tone: 'indigo', kind: 'section' };
    if (value.includes('catalogo comercial')) return { friendlyName: 'Planos e preços', description: 'Catálogo VIP oficial usado nas ofertas.', tone: 'emerald', kind: 'section' };
    if (value.includes('pacote automatico')) return { friendlyName: 'Dados automáticos', description: 'Pacote que o backend preenche para cada lead e turno.', tone: 'violet', kind: 'dynamic' };
    if (value.includes('contexto interno')) return { friendlyName: 'Contexto do lead', description: 'Horário, localização, dispositivo, sinais e dados do lead.', tone: 'violet', kind: 'dynamic' };
    if (value.includes('estado operacional')) return { friendlyName: 'Estado do backend', description: 'Pagamento, entrega, memória recuperada e limites reais.', tone: 'orange', kind: 'dynamic' };
    if (value.includes('orquestracao')) return { friendlyName: 'Modo de inteligência', description: 'Nível, objetivo e quantidade de mensagens consideradas.', tone: 'orange', kind: 'dynamic' };
    if (value.includes('compras confirmadas')) return { friendlyName: 'Compras confirmadas', description: 'Histórico real de produtos pagos pelo lead.', tone: 'emerald', kind: 'dynamic' };
    return { friendlyName: heading.replace(/^\d+\.\s*/, ''), description: 'Parte editável da instrução enviada para a IA.', tone: 'slate', kind: 'section' };
};

export const parsePromptVisualBlocks = (content: unknown): PromptVisualBlock[] => {
    const text = String(content || '').replace(/\r\n/g, '\n').trim();
    if (!text) return [];
    // O botão de copiar de alguns renderizadores remove os marcadores Markdown
    // (#, bullets e numeração de listas). O editor aceita as duas formas para
    // que o mesmo prompt continue dividido e arrastável depois de ser colado.
    const headings = [...text.matchAll(promptHeadingPattern())];
    if (headings.length === 0) {
        const heading = 'Bloco livre';
        return [{ id: 'section-0-bloco-livre', heading, content: text, ...metadataFor(heading) }];
    }

    const blocks: PromptVisualBlock[] = [];
    const firstIndex = headings[0].index || 0;
    if (firstIndex > 0 && text.slice(0, firstIndex).trim()) {
        const heading = 'Introdução';
        blocks.push({ id: 'section-0-introducao', heading, content: text.slice(0, firstIndex).trim(), ...metadataFor(heading) });
    }
    headings.forEach((match, index) => {
        const start = match.index || 0;
        const end = headings[index + 1]?.index ?? text.length;
        const blockContent = text.slice(start, end).trim();
        const heading = headingOf(blockContent);
        blocks.push({
            id: `section-${blocks.length}-${slug(heading)}`,
            heading,
            content: blockContent,
            ...metadataFor(heading),
        });
    });
    return blocks;
};

export const composePromptVisualBlocks = (blocks: PromptVisualBlock[]) => blocks
    .map((block) => String(block.content || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();

export const movePromptItem = <T,>(items: T[], from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
    const copy = [...items];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    return copy;
};

export const parsePromptFunctionItems = (content: unknown): PromptFunctionItem[] => String(content || '')
    .split('\n')
    .map((line) => line.match(/^(?:-\s+)?([a-z][a-z0-9_]*)\s+—\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ name: match[1], content: match[2].trim() }));

export const updatePromptFunctionItem = (content: string, name: string, nextContent: string) => content
    .split('\n')
    .map((line) => {
        const match = line.match(new RegExp(`^(-\\s+)?${name}\\s+—\\s+`));
        return match
            ? `${match[1] || ''}${name} — ${String(nextContent || '').replace(/\s*\n\s*/g, ' ').trim()}`
            : line;
    })
    .join('\n');

export const reorderPromptFunctionItems = (content: string, activeName: string, overName: string) => {
    const lines = content.split('\n');
    const positions = lines
        .map((line, index) => (/^(?:-\s+)?[a-z][a-z0-9_]*\s+—\s+/.test(line) ? index : -1))
        .filter((index) => index >= 0);
    const actionLines = positions.map((index) => lines[index]);
    const names = actionLines.map((line) => line.match(/^(?:-\s+)?([a-z][a-z0-9_]*)/)?.[1] || '');
    const from = names.indexOf(activeName);
    const to = names.indexOf(overName);
    const reordered = movePromptItem(actionLines, from, to);
    positions.forEach((position, index) => { lines[position] = reordered[index]; });
    return lines.join('\n');
};

export const extractPromptTokens = (content: unknown) => Array.from(new Set(
    String(content || '').match(/\{\{[A-Z0-9_]+\}\}/g) || [],
));

export const PROMPT_TOKEN_LABELS: Record<string, string> = {
    '{{LEAD_LOCAL_TIME}}': 'Horário do lead',
    '{{LEAD_LOCAL_PERIOD}}': 'Período do dia',
    '{{LEAD_CITY}}': 'Localização',
    '{{LEAD_DEVICE}}': 'Dispositivo',
    '{{LEAD_TOTAL_PAID}}': 'Total pago',
    '{{MINUTES_SINCE_OFFER}}': 'Tempo desde a oferta',
    '{{STAT_SEXUAL_OPENNESS}}': 'Abertura para flerte',
    '{{STAT_CONNECTION_NEED}}': 'Necessidade de conexão',
    '{{STAT_EMOTIONAL_SENSITIVITY}}': 'Sensibilidade emocional',
    '{{STAT_COMMERCIAL_READINESS}}': 'Prontidão para comprar',
    '{{LEAD_PROFILE}}': 'Perfil do lead',
    '{{LEAD_MEMORY}}': 'Memória do lead',
    '{{PREVIEW_CATALOG}}': 'Catálogo de prévias',
    '{{ANTI_REPEAT}}': 'Evitar repetições',
    '{{BACKEND_STATE}}': 'Estado real do backend',
    '{{ORCHESTRATION_TIER}}': 'Nível de inteligência',
    '{{ORCHESTRATION_LABEL}}': 'Nome do nível',
    '{{EPISODE_LEAD_MESSAGE_COUNT}}': 'Mensagens do episódio',
    '{{ORCHESTRATION_OBJECTIVE}}': 'Objetivo do turno',
    '{{CONFIRMED_PURCHASES}}': 'Compras confirmadas',
};

export const PROMPT_FUNCTION_LABELS: Record<string, { label: string; category: string; tone: PromptBlockTone }> = {
    none: { label: 'Responder em texto', category: 'Conversa', tone: 'slate' },
    send_custom_preview: { label: 'Mandar prévia ideal', category: 'Prévia', tone: 'pink' },
    send_video_preview: { label: 'Mandar vídeo', category: 'Prévia', tone: 'pink' },
    send_hot_video_preview: { label: 'Mandar vídeo +18', category: 'Prévia', tone: 'rose' },
    send_ass_photo_preview: { label: 'Mandar foto de costas', category: 'Prévia', tone: 'pink' },
    send_shower_photo: { label: 'Mandar foto no banho', category: 'Prévia', tone: 'cyan' },
    send_lingerie_photo: { label: 'Mandar foto de lingerie', category: 'Prévia', tone: 'pink' },
    send_wet_finger_photo: { label: 'Mandar foto +18 específica', category: 'Prévia', tone: 'rose' },
    send_voice_reply: { label: 'Mandar áudio', category: 'Áudio', tone: 'violet' },
    generate_pix_payment: { label: 'Gerar PIX', category: 'Pagamento', tone: 'emerald' },
    check_payment_status: { label: 'Ver pagamento', category: 'Pagamento', tone: 'amber' },
};
