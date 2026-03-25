import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Send, MessageSquare } from 'lucide-react';
import { GameState } from '../types';
import { processCommanderInput } from '../services/commanderService';

interface Props {
    gameState: GameState;
}

export const CommanderChat: React.FC<Props> = ({ gameState }) => {
    const [input, setInput] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [messages, setMessages] = useState<{role: 'user' | 'system', text: string}[]>([]);
    
    const recognitionRef = useRef<any>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    useEffect(() => {
        // Initialize Speech Recognition
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = false;
            recognitionRef.current.interimResults = false;
            
            recognitionRef.current.onresult = (event: any) => {
                const transcript = event.results[0][0].transcript;
                setInput(transcript);
                handleSend(transcript);
            };

            recognitionRef.current.onend = () => {
                setIsListening(false);
            };
            
            recognitionRef.current.onerror = (event: any) => {
                console.error("Speech recognition error", event.error);
                if (event.error === 'not-allowed') {
                    setMessages(prev => [...prev, { role: 'system', text: 'Microphone access denied. Please allow microphone permissions in your browser.' }]);
                } else if (event.error === 'no-speech') {
                    setMessages(prev => [...prev, { role: 'system', text: 'No speech detected. Please try again.' }]);
                } else {
                    setMessages(prev => [...prev, { role: 'system', text: `Speech recognition error: ${event.error}` }]);
                }
                setIsListening(false);
            };
        }
        
        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.stop();
            }
        };
    }, [gameState]);

    const toggleListen = () => {
        if (isListening) {
            recognitionRef.current?.stop();
            setIsListening(false);
        } else {
            try {
                recognitionRef.current?.start();
                setIsListening(true);
            } catch (e) {
                console.error(e);
            }
        }
    };

    const handleSend = async (text: string = input) => {
        if (!text.trim() || isProcessing) return;
        
        const userText = text.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', text: userText }]);
        setIsProcessing(true);
        
        try {
            const response = await processCommanderInput(userText, gameState);
            setMessages(prev => [...prev, { role: 'system', text: response }]);
        } catch (error) {
            setMessages(prev => [...prev, { role: 'system', text: 'Error processing command.' }]);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="w-full h-full flex flex-col bg-zinc-950 relative">
            {/* Header */}
            <div className="bg-zinc-900 p-2 border-b border-white/10 flex justify-between items-center flex-shrink-0">
                <div className="flex items-center gap-2 text-cyan-400">
                    <MessageSquare size={16} />
                    <span className="text-xs font-bold uppercase tracking-wider">Commander Uplink</span>
                </div>
            </div>
            
            {/* Messages Area */}
            <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-2 text-sm custom-scrollbar">
                {messages.length === 0 && (
                    <div className="text-zinc-500 text-center italic mt-4 text-xs">
                        Awaiting orders, Commander. Try "Build a barracks" or "Attack the enemy base".
                    </div>
                )}
                {messages.map((msg, idx) => (
                    <div key={idx} className={`max-w-[90%] rounded p-2 ${msg.role === 'user' ? 'bg-cyan-900/40 text-cyan-100 self-end border border-cyan-500/20' : 'bg-zinc-800/60 text-zinc-300 self-start border border-white/5'}`}>
                        {msg.text}
                    </div>
                ))}
                {isProcessing && (
                    <div className="text-cyan-500 text-xs animate-pulse self-start">Processing...</div>
                )}
                <div ref={messagesEndRef} />
            </div>
            
            {/* Input Area */}
            <div className="p-2 bg-zinc-900 border-t border-white/10 flex gap-2 flex-shrink-0">
                <button 
                    onClick={toggleListen}
                    className={`p-2 rounded transition-colors ${isListening ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50 animate-pulse' : 'bg-zinc-800 text-zinc-400 hover:text-cyan-400 border border-white/5 hover:border-cyan-500/30'}`}
                    title={isListening ? "Stop listening" : "Start listening"}
                >
                    {isListening ? <Mic size={18} /> : <MicOff size={18} />}
                </button>
                <input 
                    type="text" 
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSend()}
                    placeholder="Type orders..."
                    className="flex-1 bg-zinc-950 border border-white/10 rounded px-3 text-sm text-white focus:outline-none focus:border-cyan-500/50"
                />
                <button 
                    onClick={() => handleSend()}
                    disabled={!input.trim() || isProcessing}
                    className="p-2 bg-cyan-900/50 text-cyan-400 rounded border border-cyan-500/30 hover:bg-cyan-800/50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Send size={18} />
                </button>
            </div>
        </div>
    );
};
