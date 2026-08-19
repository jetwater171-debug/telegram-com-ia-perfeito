'use client';

import { useEffect } from 'react';

export default function ReengagementWatcher() {
    useEffect(() => {
        const runWatcher = async () => {
            try {
                await fetch('/api/cron/reengagement');
            } catch (e) {
                // Silencioso no background
            }
        };

        const interval = setInterval(runWatcher, 30000); // 30 segundos
        runWatcher();

        return () => clearInterval(interval);
    }, []);

    return null; // Componente invisível
}
