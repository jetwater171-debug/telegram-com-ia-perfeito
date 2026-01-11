"use client";
import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

export default function AdminSettingsPage() {
    const [token, setToken] = useState("");
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState("");

    useEffect(() => {
        loadToken();
    }, []);

    const loadToken = async () => {
        const { data } = await supabase.from('bot_settings').select('value').eq('key', 'telegram_bot_token').single();
        if (data) setToken(data.value);
    };

    const saveToken = async () => {
        setLoading(true);
        setMsg("");

        const { error } = await supabase.from('bot_settings').upsert({
            key: 'telegram_bot_token',
            value: token
        });

        if (error) {
            setMsg("Erro ao salvar: " + error.message);
        } else {
            setMsg("Token salvo com sucesso!");
        }
        setLoading(false);
    };

    return (
        <div className="p-8 bg-gray-900 min-h-screen text-white flex flex-col items-center">
            <div className="w-full max-w-md bg-gray-800 p-6 rounded-lg border border-gray-700">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold">Configurações do Bot</h1>
                    <Link href="/admin" className="text-blue-400 hover:underline">Voltar</Link>
                </div>

                <div className="mb-4">
                    <label className="block text-gray-400 mb-2">Telegram Bot Token</label>
                    <input
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        type="text"
                        className="w-full bg-gray-700 p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="123456:ABC-DEF..."
                    />
                </div>

                <button
                    onClick={saveToken}
                    disabled={loading}
                    className={`w-full py-2 rounded font-bold ${loading ? 'bg-gray-600' : 'bg-green-600 hover:bg-green-700'}`}
                >
                    {loading ? 'Salvando...' : 'Salvar Token'}
                </button>

                {msg && (
                    <div className={`mt-4 p-2 rounded text-center ${msg.includes('Erro') ? 'bg-red-900/50 text-red-200' : 'bg-green-900/50 text-green-200'}`}>
                        {msg}
                    </div>
                )}
            </div>
        </div>
    );
}
