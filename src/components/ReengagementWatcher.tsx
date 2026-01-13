'use client';

import { useEffect } from 'react';

export default function ReengagementWatcher() {
    useEffect(() => {
        const interval = setInterval(async () => {
            try {
                // Chama o endpoint CRON a cada 60 segundos
                await fetch('/api/cron/reengagement');
                console.log('[ReengagementWatcher] Job executed.');
            } catch (e) {
                console.error('[ReengagementWatcher] Job failed:', e);
            }
        }, 60000); // 60 segundos

        // Rodar imediatamente ao montar (opcional, bom para teste rápido)
        // fetch('/api/cron/reengagement').catch(console.error);

        return () => clearInterval(interval);
    }, []);

    return null; // Componente invisível
}
