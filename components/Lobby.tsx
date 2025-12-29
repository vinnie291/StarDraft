
import React, { useEffect, useState, useRef } from 'react';
import { network } from '../services/network';
import { PlayerInfo, Difficulty } from '../types';
import { NO_RUSH_OPTIONS } from '../constants';

interface Props {
    onGameStart: (seed: number, isHost: boolean, noRushSeconds: number) => void;
    onSinglePlayerStart: (difficulty: Difficulty, noRushSeconds: number) => void;
}

const PUBLIC_ROOMS = [
    { id: 'STAR_DRAFT_ROOM_ALPHA', name: 'Sector Alpha' },
    { id: 'STAR_DRAFT_ROOM_BETA', name: 'Sector Beta' },
    { id: 'STAR_DRAFT_ROOM_GAMMA', name: 'Sector Gamma' }
];

const StarBackground = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    // Generate static stars
    const [stars] = useState(() => Array.from({ length: 150 }).map((_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 2 + 1,
        opacity: Math.random() * 0.7 + 0.3,
        animDuration: Math.random() * 4 + 2,
        animDelay: Math.random() * 5
    })));

    useEffect(() => {
        const handleMove = (e: MouseEvent) => {
            if (!containerRef.current) return;
            // Normalize coordinates from -0.5 to 0.5
            const x = (e.clientX / window.innerWidth) - 0.5;
            const y = (e.clientY / window.innerHeight) - 0.5;
            
            // Move uniformly opposite to cursor direction (Locked Layer Effect)
            // Multiplier determines magnitude. -40 means max shift of 20px in opposite direction.
            const moveX = x * -40; 
            const moveY = y * -40;
            
            containerRef.current.style.transform = `translate3d(${moveX}px, ${moveY}px, 0)`;
        };

        window.addEventListener('mousemove', handleMove);
        return () => window.removeEventListener('mousemove', handleMove);
    }, []);

    return (
        // inset-[-40px] ensures the container is larger than the viewport so edges don't show when shifting
        <div className="absolute inset-[-40px] overflow-hidden pointer-events-none">
            <div 
                ref={containerRef} 
                className="w-full h-full transition-transform duration-100 ease-out will-change-transform"
            >
                {stars.map(s => (
                    <div 
                        key={s.id} 
                        className="absolute bg-white rounded-full shadow-[0_0_2px_rgba(255,255,255,0.8)]"
                        style={{
                            left: `${s.x}%`, 
                            top: `${s.y}%`, 
                            width: `${s.size}px`, 
                            height: `${s.size}px`, 
                            opacity: s.opacity,
                            animation: `twinkle ${s.animDuration}s infinite ${s.animDelay}s`
                        }}
                    />
                ))}
            </div>
             <style>{`
                @keyframes twinkle {
                    0%, 100% { opacity: 0.3; transform: scale(0.8); }
                    50% { opacity: 1; transform: scale(1.2); }
                }
            `}</style>
        </div>
    );
};

export const Lobby: React.FC<Props> = ({ onGameStart, onSinglePlayerStart }) => {
    // MODES: MENU -> NAME_INPUT -> LOBBY (Hosting Private + Viewing Public) -> JOINING (Transition)
    const [mode, setMode] = useState<'MENU' | 'SINGLEPLAYER' | 'NAME_INPUT' | 'LOBBY' | 'JOINING'>('MENU');
    const [name, setName] = useState('Player');
    const [opponent, setOpponent] = useState<PlayerInfo | null>(null);
    const [isReady, setIsReady] = useState(false);
    const [opponentReady, setOpponentReady] = useState(false);
    const [seed, setSeed] = useState<number>(0);
    const [isHost, setIsHost] = useState(false);
    const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>(Difficulty.MEDIUM);
    const [selectedNoRush, setSelectedNoRush] = useState<number>(0); // 0 means disabled
    const [hostCode, setHostCode] = useState(''); // Private code
    const [joinCode, setJoinCode] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [statusMsg, setStatusMsg] = useState('');

    useEffect(() => {
        const handleMsg = (msg: any) => {
            if (msg.type === 'JOIN' && !opponent) {
                // Received JOIN request (I am Host)
                setOpponent({ id: msg.payload.id, name: msg.payload.name, isReady: false, isHost: false });
                const newSeed = Math.random() * 10000;
                setSeed(newSeed);
                network.send({ type: 'WELCOME', payload: { seed: newSeed, hostId: network.id } });
            }
            if (msg.type === 'WELCOME' && !opponent) {
                // Received WELCOME (I am Client)
                setSeed(msg.payload.seed);
                setOpponent({ id: msg.payload.hostId, name: 'Opponent', isReady: false, isHost: true });
                setStatusMsg('');
                setMode('LOBBY'); // ensure we are in lobby view (but now with opponent)
            }
            if (msg.type === 'READY' && opponent) {
                setOpponentReady(msg.payload.ready);
            }
            if (msg.type === 'START_GAME' && opponent) {
                onGameStart(seed, isHost, msg.payload.noRushSeconds || 0);
            }
            if (msg.type === 'ERROR') {
                setError(msg.payload.message);
                network.close(); // Disconnect
                setOpponent(null);
                setMode('NAME_INPUT'); // Kick back
            }
        };

        const cleanup = network.subscribe(handleMsg);
        return cleanup;
    }, [opponent, seed, onGameStart, isHost]);

    useEffect(() => {
        if (isReady && opponentReady && isHost) {
            network.send({ type: 'START_GAME', payload: { seed, noRushSeconds: selectedNoRush } });
            onGameStart(seed, true, selectedNoRush);
        }
    }, [isReady, opponentReady, isHost, seed, onGameStart, selectedNoRush]);

    const enterLobby = async () => {
        if (!name) return setError("Please enter a name");
        network.setName(name);
        setMode('LOBBY');
        setIsHost(true);
        // Automatically host a private room
        try {
            const id = await network.hostGame();
            setHostCode(id);
        } catch (e: any) {
            setError("Failed to generate private room.");
        }
    };

    const joinPrivate = async () => {
        if (!joinCode || joinCode.length !== 4) return setError("Invalid Code (Must be 4 chars)");
        setError(null);
        setStatusMsg("Joining Private Room...");
        try {
             await network.joinGame(joinCode);
             network.send({ type: 'JOIN', payload: { name, id: network.id } });
             setIsHost(false);
        } catch (e: any) {
             setError(e.message);
             setStatusMsg("");
             // Re-host private?
             const id = await network.hostGame();
             setHostCode(id);
             setIsHost(true);
        }
    };

    const handlePublicRoomClick = async (room: { id: string, name: string }) => {
        setError(null);
        setStatusMsg(`Connecting to ${room.name}...`);
        
        try {
            // 1. Try to Join
            await network.joinGame(room.id);
            // 2. If successful, send JOIN
            network.send({ type: 'JOIN', payload: { name, id: network.id } });
            setIsHost(false);
            setHostCode(room.id); // Just for display
        } catch (e: any) {
            // 3. If join failed, assume room is free and Try to Host
            // We must destroy current peer (private host) to claim the public ID
            console.log("Join failed, attempting to host...", e);
            setStatusMsg(`Creating ${room.name}...`);
            try {
                await network.hostGame(room.id);
                setHostCode(room.id); // "STAR_DRAFT_ROOM_ALPHA"
                setIsHost(true);
                setOpponent(null); 
                setStatusMsg("");
            } catch (hostErr: any) {
                setError("Room is busy or unavailable.");
                setStatusMsg("");
                // Revert to private host
                const id = await network.hostGame();
                setHostCode(id);
            }
        }
    };

    const toggleReady = () => {
        const newState = !isReady;
        setIsReady(newState);
        network.send({ type: 'READY', payload: { id: network.id, ready: newState } });
    };

    const copyCode = () => {
        navigator.clipboard.writeText(hostCode);
        alert("Code copied!");
    };

    const formatSeconds = (sec: number) => {
        if (sec === 0) return "No Rush: OFF";
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `No Rush: ${m}m${s > 0 ? s + 's' : ''}`;
    }

    // Render helper to keep layout consistent
    const renderContent = () => {
        // --- MAIN MENU ---
        if (mode === 'MENU') {
            return (
                <div className="max-w-md w-full bg-slate-900/90 backdrop-blur border border-slate-700 p-8 rounded-lg shadow-2xl text-center">
                    <h1 className="text-4xl font-black mb-2 text-cyan-400 tracking-tighter drop-shadow-lg">STARDRAFT</h1>
                    <p className="text-slate-500 mb-8 text-sm uppercase tracking-widest">Minimalist RTS</p>
                    
                    <div className="space-y-4">
                        <button 
                            onClick={() => setMode('SINGLEPLAYER')}
                            className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded uppercase tracking-widest transition-all hover:scale-105 shadow-lg border border-emerald-400/30"
                        >
                            Single Player
                        </button>
                        <button 
                            onClick={() => setMode('NAME_INPUT')}
                            className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded uppercase tracking-widest transition-all hover:scale-105 shadow-lg border border-blue-400/30"
                        >
                            Multiplayer
                        </button>
                    </div>
                </div>
            );
        }

        // --- SINGLE PLAYER ---
        if (mode === 'SINGLEPLAYER') {
            return (
                <div className="max-w-md w-full bg-slate-900/90 backdrop-blur border border-slate-700 p-8 rounded-lg shadow-2xl">
                    <button onClick={() => setMode('MENU')} className="text-slate-500 hover:text-white mb-4 text-xs uppercase tracking-widest">
                        &larr; Back
                    </button>
                    <h1 className="text-3xl font-bold mb-8 text-center text-emerald-400">VS COMPUTER</h1>
                    
                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm text-slate-400 mb-3 text-center uppercase tracking-widest">Select Difficulty</label>
                            <div className="grid grid-cols-3 gap-2">
                                {[Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD].map(diff => (
                                    <button
                                        key={diff}
                                        onClick={() => setSelectedDifficulty(diff)}
                                        className={`py-3 px-2 rounded font-bold text-sm uppercase transition-colors border ${
                                            selectedDifficulty === diff 
                                            ? 'bg-emerald-600 border-emerald-400 text-white' 
                                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                                        }`}
                                    >
                                        {diff}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm text-slate-400 mb-3 text-center uppercase tracking-widest">Peace Timer</label>
                            <div className="grid grid-cols-4 gap-2">
                                {NO_RUSH_OPTIONS.map(sec => (
                                    <button
                                        key={sec}
                                        onClick={() => setSelectedNoRush(sec)}
                                        className={`py-3 px-1 rounded font-bold text-xs uppercase transition-colors border ${
                                            selectedNoRush === sec 
                                            ? 'bg-blue-600 border-blue-400 text-white' 
                                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                                        }`}
                                    >
                                        {sec === 0 ? "Off" : `${sec}s`}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button 
                            onClick={() => onSinglePlayerStart(selectedDifficulty, selectedNoRush)}
                            className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-white font-bold rounded uppercase tracking-widest transition-colors shadow-lg mt-4 border border-emerald-400/30"
                        >
                            Start Game
                        </button>
                    </div>
                </div>
            );
        }
        
        // --- NAME INPUT ---
        if (mode === 'NAME_INPUT') {
            return (
                <div className="max-w-md w-full bg-slate-900/90 backdrop-blur border border-slate-700 p-8 rounded-lg shadow-2xl">
                    <button onClick={() => setMode('MENU')} className="text-slate-500 hover:text-white mb-4 text-xs uppercase tracking-widest">
                        &larr; Back
                    </button>
                    <h1 className="text-3xl font-bold mb-8 text-center text-cyan-400">MULTIPLAYER</h1>
                    {error && <div className="bg-red-900/50 text-red-200 p-3 mb-4 rounded text-sm border border-red-800">{error}</div>}
                    <div>
                        <label className="block text-sm text-slate-400 mb-2">Enter Username</label>
                        <input 
                            type="text" 
                            value={name} 
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && enterLobby()}
                            className="w-full bg-slate-800 border border-slate-600 p-3 rounded text-white focus:outline-none focus:border-cyan-500 mb-4"
                        />
                        <button onClick={enterLobby} className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 rounded font-bold uppercase tracking-widest shadow-lg border border-indigo-400/30">
                            Enter Lobby
                        </button>
                    </div>
                </div>
            );
        }

        // --- MAIN LOBBY ---
        if (mode === 'LOBBY') {
            return (
                <div className="max-w-4xl w-full bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg shadow-2xl flex flex-col md:flex-row overflow-hidden min-h-[500px]">
                    
                    {/* LEFT PANEL: Public Rooms */}
                    <div className="flex-1 p-6 border-b md:border-b-0 md:border-r border-slate-700 bg-slate-800/50">
                        <h2 className="text-xl font-bold mb-6 text-slate-300 uppercase tracking-widest flex items-center gap-2">
                            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                            Public Sectors
                        </h2>
                        
                        <div className="space-y-3">
                            {PUBLIC_ROOMS.map(room => (
                                <button
                                    key={room.id}
                                    disabled={!!opponent || statusMsg !== ''}
                                    onClick={() => handlePublicRoomClick(room)}
                                    className="w-full p-4 bg-slate-800 hover:bg-slate-700 border border-slate-600 hover:border-cyan-500 rounded flex justify-between items-center group transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <div className="flex flex-col items-start">
                                        <span className="font-bold text-slate-200 group-hover:text-cyan-400 transition-colors">{room.name}</span>
                                        <span className="text-xs text-slate-500">Official Server</span>
                                    </div>
                                    <span className="text-xs bg-slate-900 text-slate-400 px-2 py-1 rounded group-hover:bg-cyan-900/30 group-hover:text-cyan-300">
                                        JOIN / CREATE
                                    </span>
                                </button>
                            ))}
                        </div>

                        <div className="mt-8 pt-6 border-t border-slate-700">
                            <h3 className="text-sm font-bold text-slate-400 mb-3 uppercase tracking-wide">Join Private Room</h3>
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    placeholder="CODE"
                                    maxLength={4}
                                    value={joinCode}
                                    onChange={e => setJoinCode(e.target.value.toUpperCase())}
                                    className="bg-slate-900 border border-slate-600 p-2 rounded text-white text-sm uppercase font-mono focus:outline-none focus:border-cyan-500 flex-1"
                                />
                                <button 
                                    onClick={joinPrivate}
                                    disabled={!!opponent}
                                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded font-bold uppercase text-xs shadow disabled:opacity-50"
                                >
                                    Join
                                </button>
                            </div>
                        </div>
                        {error && <div className="mt-4 text-red-400 text-xs border border-red-900/50 bg-red-900/20 p-2 rounded">{error}</div>}
                    </div>

                    {/* RIGHT PANEL: Current Status */}
                    <div className="flex-1 p-6 flex flex-col relative">
                        <button onClick={() => { network.close(); setMode('MENU'); setOpponent(null); }} className="absolute top-4 right-4 text-slate-600 hover:text-white text-xs uppercase tracking-widest">
                            Exit Lobby
                        </button>
                        
                        <div className="flex-1 flex flex-col items-center justify-center">
                            {statusMsg ? (
                                <div className="text-center animate-pulse">
                                    <div className="text-cyan-400 text-xl font-bold mb-2">{statusMsg}</div>
                                    <div className="text-slate-500 text-sm">Please wait...</div>
                                </div>
                            ) : opponent ? (
                                <div className="w-full max-w-sm">
                                    <h3 className="text-center text-emerald-400 font-bold text-xl mb-6 tracking-widest uppercase">Match Ready</h3>
                                    <div className="bg-slate-800 p-4 rounded border border-slate-700 mb-6">
                                        <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-700">
                                            <span className="font-bold text-white">{name} <span className="text-slate-500 text-xs">(YOU)</span></span>
                                            <span className={`text-xs font-bold px-2 py-1 rounded ${isReady ? "bg-green-900 text-green-300" : "bg-yellow-900 text-yellow-300"}`}>
                                                {isReady ? "READY" : "PREPARING"}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="font-bold text-white">{opponent.name}</span>
                                            <span className={`text-xs font-bold px-2 py-1 rounded ${opponentReady ? "bg-green-900 text-green-300" : "bg-slate-700 text-slate-400"}`}>
                                                {opponentReady ? "READY" : "WAITING"}
                                            </span>
                                        </div>
                                    </div>
                                    
                                    {isHost && (
                                        <div className="mb-4">
                                            <label className="text-xs text-slate-500 uppercase font-bold block mb-2">Rules</label>
                                            <div className="grid grid-cols-4 gap-1">
                                                {NO_RUSH_OPTIONS.map(sec => (
                                                    <button
                                                        key={sec}
                                                        onClick={() => setSelectedNoRush(sec)}
                                                        className={`py-2 px-1 rounded text-[10px] font-bold uppercase transition-colors border ${
                                                            selectedNoRush === sec 
                                                            ? 'bg-blue-600 border-blue-400 text-white' 
                                                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                                                        }`}
                                                    >
                                                        {sec === 0 ? "Normal" : `NR ${sec}`}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <button 
                                        onClick={toggleReady}
                                        className={`w-full py-4 font-bold rounded uppercase tracking-widest transition-colors shadow-lg
                                            ${isReady ? 'bg-yellow-600 hover:bg-yellow-500 text-white' : 'bg-green-600 hover:bg-green-500 text-white'}
                                        `}
                                    >
                                        {isReady ? "Cancel Ready" : "READY UP"}
                                    </button>
                                </div>
                            ) : (
                                <div className="text-center">
                                    <div className="mb-6">
                                        <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-700 relative shadow-[0_0_15px_rgba(34,211,238,0.3)]">
                                            <div className="w-3 h-3 bg-cyan-500 rounded-full animate-ping absolute top-0 right-0"></div>
                                            <span className="text-2xl">📡</span>
                                        </div>
                                        <h3 className="text-white font-bold text-lg mb-1">Hosting Private Room</h3>
                                        <p className="text-slate-500 text-xs">Waiting for challenger...</p>
                                    </div>

                                    <div className="bg-black/40 p-4 rounded border border-slate-700/50 inline-block mb-4 shadow-inner">
                                        <div className="text-xs text-slate-500 uppercase mb-1">Your Room Code</div>
                                        <div onClick={copyCode} className="text-4xl font-mono font-black text-cyan-400 cursor-pointer hover:text-cyan-300 select-all tracking-widest">
                                            {hostCode || "...."}
                                        </div>
                                    </div>
                                    <p className="text-slate-600 text-xs">Share code or join a public sector on the left.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="w-full h-full bg-slate-950 flex items-center justify-center font-mono text-white relative overflow-hidden">
            <StarBackground />
            <div className="relative z-10 w-full h-full flex items-center justify-center p-4">
                {renderContent()}
            </div>
        </div>
    );
};
