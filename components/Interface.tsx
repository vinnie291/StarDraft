import React, { useEffect, useRef, useState } from 'react';
import { GameEntity, EntityType, GameState, Owner, Difficulty } from '../types';
import { STATS, GAME_WIDTH, GAME_HEIGHT } from '../constants';
import { toggleMute, getMuteState } from '../services/audio';

interface Props {
  gameState: GameState;
  selectedEntities: GameEntity[];
  onCommand: (cmd: string) => void;
  onTrain: (type: EntityType) => void;
}

export const Interface: React.FC<Props> = ({ gameState, selectedEntities, onCommand, onTrain }) => {
  const resources = gameState.resources[Owner.PLAYER];
  const supply = gameState.supply[Owner.PLAYER];
  const [isMuted, setIsMuted] = useState(getMuteState());
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  
  // Selection Logic
  const singleSelection = selectedEntities.length === 1 ? selectedEntities[0] : null;
  const allWorkers = selectedEntities.length > 0 && selectedEntities.every(e => e.type === EntityType.WORKER);
  const canBuild = allWorkers && selectedEntities.length === 1; 
  
  const allBarracks = selectedEntities.filter(e => e.type === EntityType.BARRACKS && e.owner === Owner.PLAYER);
  const showBarracksMenu = singleSelection?.type === EntityType.BARRACKS || allBarracks.length > 0;

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        const key = e.key.toUpperCase();
        if ((e.target as HTMLElement).tagName === 'INPUT') return;

        if (singleSelection?.type === EntityType.BASE) {
            if (key === 'W') onTrain(EntityType.WORKER);
        }
        
        if (showBarracksMenu) {
            if (key === 'M') handleMultiTrain(EntityType.MARINE);
            if (key === 'E') handleMultiTrain(EntityType.MEDIC);
        }
        
        if (singleSelection?.type === EntityType.WORKER) {
            if (key === 'B') onCommand(`BUILD_${EntityType.BARRACKS}`);
            if (key === 'S') onCommand(`BUILD_${EntityType.SUPPLY_DEPOT}`);
            if (key === 'U') onCommand(`BUILD_${EntityType.BUNKER}`);
        }

        if (singleSelection?.type === EntityType.BUNKER && singleSelection.owner === Owner.PLAYER) {
            if (key === 'D') handleUnload();
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [singleSelection, showBarracksMenu, onTrain, onCommand]);

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const handleMultiTrain = (type: EntityType) => {
      if (allBarracks.length > 0) {
          const bestBarracks = [...allBarracks].sort((a, b) => (a.trainQueue?.length || 0) - (b.trainQueue?.length || 0))[0];
          window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
              detail: { action: 'TRAIN', id: bestBarracks.id, type } 
          }));
      } else if (singleSelection) {
          onTrain(type);
      }
  };

  const handleUnload = () => {
      if (singleSelection && singleSelection.type === EntityType.BUNKER) {
          window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
              detail: { action: 'UNLOAD_ALL', id: singleSelection.id } 
          }));
      }
  };

  const changeDifficulty = (diff: Difficulty) => {
      window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
          detail: { action: 'RESTART', difficulty: diff } 
      }));
  };

  const togglePause = () => {
      setMenuOpen(false);
      window.dispatchEvent(new CustomEvent('GAME_COMMAND', { detail: { action: 'TOGGLE_PAUSE' } }));
  };

  const handleToggleMute = () => setIsMuted(toggleMute());

  // --- Minimap Logic ---
  const [isDraggingMinimap, setIsDraggingMinimap] = useState(false);
  const minimapRef = useRef<HTMLDivElement>(null);

  const getMinimapPos = (clientX: number, clientY: number) => {
      if (!minimapRef.current) return null;
      const rect = minimapRef.current.getBoundingClientRect();
      const xPct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const yPct = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      return { x: xPct * GAME_WIDTH, y: yPct * GAME_HEIGHT };
  };

  const handleMinimapInteraction = (e: React.MouseEvent) => {
      const pos = getMinimapPos(e.clientX, e.clientY);
      if (!pos) return;
      
      if (e.button === 0) {
          // Left Click: Move Camera
          setIsDraggingMinimap(true);
          const centerX = pos.x - (window.innerWidth / 2);
          const centerY = pos.y - (window.innerHeight / 2);
          window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
              detail: { action: 'MOVE_CAMERA', x: centerX, y: centerY } 
          }));
      } else if (e.button === 2) {
          // Right Click: Move Unit / Attack Move
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
              detail: { action: 'MINIMAP_ACTION', x: pos.x, y: pos.y } 
          }));
      }
  };

  useEffect(() => {
      const handleMouseMove = (e: MouseEvent) => {
          if (isDraggingMinimap) {
              const pos = getMinimapPos(e.clientX, e.clientY);
              if (pos) {
                  const centerX = pos.x - (window.innerWidth / 2);
                  const centerY = pos.y - (window.innerHeight / 2);
                  window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
                      detail: { action: 'MOVE_CAMERA', x: centerX, y: centerY } 
                  }));
              }
          }
      };
      const handleMouseUp = () => setIsDraggingMinimap(false);
      
      if (isDraggingMinimap) {
          window.addEventListener('mousemove', handleMouseMove);
          window.addEventListener('mouseup', handleMouseUp);
      }
      return () => {
          window.removeEventListener('mousemove', handleMouseMove);
          window.removeEventListener('mouseup', handleMouseUp);
      };
  }, [isDraggingMinimap]);


  const isVisibleOnMinimap = (entity: GameEntity, playerUnits: GameEntity[]) => {
      if (entity.owner === Owner.PLAYER) return true;
      if (entity.type === EntityType.MINERAL && entity.resourceAmount! <= 0) return false;
      for(const pu of playerUnits) {
          const dx = entity.position.x - pu.position.x;
          const dy = entity.position.y - pu.position.y;
          if (dx*dx + dy*dy < 250000) return true;
      }
      return false;
  };
  
  const allEntities: GameEntity[] = Array.from(gameState.entities.values());
  const playerUnits = allEntities.filter(e => e.owner === Owner.PLAYER && e.state !== 'GARRISONED');

  const formatTime = (frames: number) => {
      const sec = Math.floor(frames / 60);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const noRushTimeLeft = Math.max(0, gameState.noRushFrames - gameState.gameTime);

  return (
    <div className="absolute inset-0 flex flex-col justify-between pointer-events-none font-sans text-white">
      {/* Top HUD */}
      <div className="h-16 w-full bg-gradient-to-b from-zinc-950/90 to-zinc-950/0 px-6 pt-3 flex items-start justify-between pointer-events-auto backdrop-blur-[2px]">
         {/* Resources */}
         <div className="flex gap-8 items-center pt-1">
             <div className="flex flex-col">
                 <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">Minerals</span>
                 <span className="text-2xl font-mono font-bold text-cyan-400 drop-shadow-lg flex items-center gap-2">
                     <div className="w-3 h-3 bg-cyan-400 rounded-sm rotate-45 shadow-[0_0_10px_rgba(34,211,238,0.5)]" />
                     {Math.floor(resources)}
                 </span>
             </div>
             <div className="flex flex-col">
                 <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">Supply</span>
                 <span className={`text-2xl font-mono font-bold flex items-center gap-2 drop-shadow-lg ${supply.used > supply.max ? "text-rose-500" : "text-white"}`}>
                    <div className={`w-3 h-3 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.3)] ${supply.used > supply.max ? "bg-rose-500" : "bg-emerald-500"}`} />
                    {supply.used}<span className="text-zinc-600 text-lg">/</span>{supply.max}
                 </span>
             </div>
         </div>

         {/* Center Widget */}
         <div className="flex flex-col items-center transform -translate-y-1">
             <div className="bg-zinc-900/90 backdrop-blur-md border border-white/10 px-6 py-1.5 rounded-full shadow-2xl flex items-center gap-2">
                 <div className={`w-2 h-2 rounded-full animate-pulse ${gameState.paused ? 'bg-yellow-500' : 'bg-green-500'}`} />
                 <span className="text-xl font-mono font-bold tracking-widest text-zinc-100">{formatTime(gameState.gameTime)}</span>
             </div>
             {noRushTimeLeft > 0 && (
                 <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400 bg-emerald-950/80 px-3 py-1 rounded-full border border-emerald-500/30 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                     No Rush: {Math.ceil(noRushTimeLeft / 60)}s
                 </div>
             )}
         </div>
         
         {/* Menu Button */}
         <div className="relative pt-1" ref={menuRef}>
            <button 
                onClick={() => setMenuOpen(!menuOpen)}
                className="w-10 h-10 flex flex-col items-center justify-center gap-1.5 bg-zinc-800/40 hover:bg-zinc-700/60 rounded-lg border border-white/10 hover:border-white/30 transition-all group backdrop-blur-sm"
            >
                <div className="w-5 h-0.5 bg-zinc-400 group-hover:bg-white transition-colors" />
                <div className="w-5 h-0.5 bg-zinc-400 group-hover:bg-white transition-colors" />
                <div className="w-5 h-0.5 bg-zinc-400 group-hover:bg-white transition-colors" />
            </button>
            
            {menuOpen && (
                <div className="absolute right-0 top-full mt-3 w-64 bg-zinc-950/95 border border-white/10 rounded-xl shadow-2xl flex flex-col p-1.5 z-50 text-sm backdrop-blur-xl">
                    <button onClick={togglePause} className="text-left px-4 py-3 hover:bg-white/5 rounded-lg font-semibold text-white transition-colors flex justify-between items-center group">
                        {gameState.paused ? 'Resume Mission' : 'Pause Mission'} 
                        <span className="text-zinc-600 text-xs font-mono border border-zinc-700 px-1.5 rounded group-hover:border-zinc-500 transition-colors">P</span>
                    </button>
                    <button onClick={handleToggleMute} className="text-left px-4 py-3 hover:bg-white/5 rounded-lg text-zinc-300 transition-colors">
                        Audio Systems: <span className={isMuted ? 'text-red-400' : 'text-green-400'}>{isMuted ? 'Offline' : 'Online'}</span>
                    </button>
                    <div className="h-px bg-white/10 my-1.5 mx-2"></div>
                    <button onClick={() => changeDifficulty(gameState.difficulty)} className="text-left px-4 py-3 text-rose-400 hover:bg-rose-500/10 rounded-lg font-bold transition-colors">
                        Restart Operation
                    </button>
                    <button onClick={() => onCommand('QUIT')} className="text-left px-4 py-3 text-amber-400 hover:bg-amber-500/10 rounded-lg font-bold transition-colors">
                        Abort to Menu
                    </button>
                </div>
            )}
         </div>
      </div>

      {/* Victory/Defeat Overlay */}
      {gameState.victory && (
         <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-50 pointer-events-auto backdrop-blur-md">
             <div className="bg-zinc-950 p-12 rounded-2xl border border-white/10 text-center shadow-[0_0_50px_rgba(0,0,0,0.5)] max-w-lg w-full relative overflow-hidden">
                 <div className={`absolute top-0 left-0 w-full h-1 ${gameState.victory === Owner.PLAYER ? 'bg-gradient-to-r from-emerald-500 via-cyan-500 to-blue-500' : 'bg-gradient-to-r from-red-600 via-orange-600 to-yellow-600'}`}></div>
                 
                 <h1 className={`text-7xl font-black mb-2 tracking-tighter ${gameState.victory === Owner.PLAYER ? "text-transparent bg-clip-text bg-gradient-to-br from-emerald-400 to-cyan-400" : "text-rose-500"}`}>
                     {gameState.victory === Owner.PLAYER ? "VICTORY" : "DEFEAT"}
                 </h1>
                 <p className="text-zinc-400 mb-10 font-mono text-xs uppercase tracking-[0.3em]">
                    {gameState.victory === Owner.PLAYER ? "All objectives complete" : "Mission failed critical"}
                 </p>
                 
                 <div className="grid grid-cols-2 gap-3 mb-6">
                     {[Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD].map(d => (
                         <button 
                            key={d}
                            className={`py-4 px-2 rounded-lg font-bold text-xs uppercase tracking-widest border transition-all col-span-1 first:col-span-2 first:mb-0
                                ${gameState.difficulty === d 
                                    ? 'bg-zinc-100 text-zinc-950 border-white shadow-[0_0_15px_rgba(255,255,255,0.3)]' 
                                    : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:bg-zinc-800 hover:text-white hover:border-zinc-600'}
                            `}
                            onClick={() => changeDifficulty(d)}
                         >
                             Retry {d}
                         </button>
                     ))}
                 </div>
                 <button 
                    onClick={() => onCommand('QUIT')}
                    className="w-full py-4 px-6 bg-zinc-900 hover:bg-zinc-800 text-amber-500 border border-zinc-800 hover:border-amber-500/50 rounded-lg font-bold uppercase tracking-widest transition-all"
                 >
                    Return to Menu
                 </button>
             </div>
         </div>
      )}

      {/* Bottom Panel */}
      <div className="h-64 bg-zinc-950/95 border-t border-white/10 flex pointer-events-auto select-none shadow-[0_-10px_40px_rgba(0,0,0,0.5)] backdrop-blur-lg">
          {/* Minimap Container */}
          <div className="h-full w-64 bg-black border-r border-white/10 relative flex-shrink-0 group">
              <div 
                  ref={minimapRef}
                  className="w-full h-full relative bg-zinc-950 cursor-crosshair overflow-hidden"
                  onMouseDown={handleMinimapInteraction}
                  onContextMenu={(e) => handleMinimapInteraction(e)}
              >
                 {/* Map Features */}
                 {allEntities.map(e => {
                     if (e.state === 'GARRISONED') return null;
                     if (!isVisibleOnMinimap(e, playerUnits)) return null;

                     let color = 'bg-zinc-600';
                     if (e.type === EntityType.WATER) color = 'bg-blue-900';
                     else if (e.type === EntityType.MOUNTAIN) color = 'bg-zinc-800';
                     else if (e.type === EntityType.MINERAL) color = 'bg-cyan-400 shadow-[0_0_4px_cyan]';
                     else if (e.owner === Owner.PLAYER) color = 'bg-blue-500 shadow-[0_0_4px_blue]';
                     else if (e.owner === Owner.AI) color = 'bg-rose-500 shadow-[0_0_4px_red]';
                     
                     const size = (e.type === EntityType.WATER || e.type === EntityType.MOUNTAIN) ? 4 : 3;

                     return (
                        <div key={e.id} 
                            className={`absolute rounded-full ${color}`}
                            style={{ 
                                left: `${(e.position.x / GAME_WIDTH) * 100}%`, 
                                top: `${(e.position.y / GAME_HEIGHT) * 100}%`,
                                width: size + 'px', height: size + 'px'
                            }} 
                        />
                     );
                 })}
                 {/* Camera Rect */}
                 <div className="absolute border border-white/50 pointer-events-none shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
                      style={{
                          left: `${(gameState.camera.x / GAME_WIDTH) * 100}%`,
                          top: `${(gameState.camera.y / GAME_HEIGHT) * 100}%`,
                          width: `${(window.innerWidth / GAME_WIDTH) * 100}%`,
                          height: `${(window.innerHeight / GAME_HEIGHT) * 100}%`,
                      }}
                 />
              </div>
              <div className="absolute top-2 left-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">Sector Map</div>
          </div>

          {/* Unit Info Panel */}
          <div className="flex-1 p-5 border-r border-white/10 bg-gradient-to-br from-zinc-900/50 to-zinc-950/50 overflow-hidden flex flex-col relative">
             <div className="absolute top-0 right-0 p-2 opacity-10 pointer-events-none">
                 <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zm0 9l2.5-1.25L12 8.5l-2.5 1.25L12 11zm0 2.5l-5-2.5-5 2.5L12 22l10-8.5-5-2.5-5 2.5z"/></svg>
             </div>
             {selectedEntities.length === 0 ? (
                 <div className="h-full flex flex-col items-center justify-center text-zinc-700">
                     <div className="text-4xl mb-2 opacity-20">⛝</div>
                     <span className="uppercase tracking-[0.2em] text-xs font-bold">No Signal</span>
                 </div>
             ) : (
                <>
                <div className="flex flex-wrap gap-2 content-start overflow-auto pr-2 custom-scrollbar pb-6">
                     {allBarracks.length > 1 && selectedEntities.length === allBarracks.length ? (
                         allBarracks.map(b => (
                             <div key={b.id} className="w-12 h-12 bg-zinc-800/80 border border-white/10 relative rounded hover:border-cyan-500/50 transition-colors">
                                 <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-zinc-500">BAR</div>
                                 {b.trainQueue && b.trainQueue.length > 0 && (
                                     <div className="absolute -top-1 -right-1 bg-cyan-600 text-white text-[9px] w-4 h-4 rounded shadow flex items-center justify-center font-bold z-10">{b.trainQueue.length}</div>
                                 )}
                                 <div className="absolute bottom-0 left-0 w-full h-1 bg-zinc-900 rounded-b overflow-hidden">
                                    <div className="h-full bg-cyan-400" style={{ width: `${(b.trainProgress! / STATS[EntityType.MARINE].buildTime) * 100}%` }} />
                                 </div>
                             </div>
                         ))
                     ) : (
                        selectedEntities.map(e => (
                            <div key={e.id} className="w-10 h-10 bg-zinc-800/60 border border-white/5 relative rounded hover:bg-zinc-700/60 transition-colors group">
                                <div className={`w-1.5 h-1.5 absolute top-1 left-1 rounded-full ${e.owner === Owner.PLAYER ? 'bg-blue-500 shadow-[0_0_5px_blue]' : 'bg-rose-500'}`} />
                                <div className="w-full h-full flex items-center justify-center text-[8px] text-zinc-400 font-bold uppercase overflow-hidden p-0.5 text-center leading-none tracking-tighter">
                                    {e.type}
                                </div>
                                {e.garrison && e.garrison.length > 0 && (
                                    <div className="flex gap-0.5 absolute bottom-2 left-1">
                                        {e.garrison.map((_, i) => <div key={i} className="w-1 h-1 bg-emerald-500 rounded-full" />)}
                                    </div>
                                )}
                                <div className="absolute bottom-0 left-0 w-full h-1 bg-zinc-900 rounded-b overflow-hidden">
                                    <div className={`h-full ${e.hp < e.maxHp / 3 ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${(e.hp / e.maxHp) * 100}%`}} />
                                </div>
                            </div>
                        ))
                     )}
                </div>
                <div className="absolute bottom-0 left-0 w-full p-2 bg-zinc-950/50 border-t border-white/5 text-[10px] text-zinc-400 font-mono uppercase tracking-widest flex justify-between items-center">
                    <span>Selection Group</span>
                    <span className="text-cyan-600">{selectedEntities.length} Units</span>
                </div>
                </>
             )}
          </div>

          {/* Command Card */}
          <div className="w-72 bg-zinc-925 p-4 grid grid-cols-3 grid-rows-3 gap-3 flex-shrink-0 border-l border-white/5 relative">
              <div className="absolute inset-0 bg-grid-pattern opacity-5 pointer-events-none"></div>
              
              {canBuild && (
                  <>
                    <CommandButton label="Supply" sub="100" hotkey="S" cost={100} res={resources} onClick={() => onCommand(`BUILD_${EntityType.SUPPLY_DEPOT}`)} />
                    <CommandButton label="Barracks" sub="150" hotkey="B" cost={150} res={resources} onClick={() => onCommand(`BUILD_${EntityType.BARRACKS}`)} />
                    <CommandButton label="Bunker" sub="100" hotkey="U" cost={100} res={resources} onClick={() => onCommand(`BUILD_${EntityType.BUNKER}`)} />
                  </>
              )}

              {singleSelection?.type === EntityType.BASE && (
                  <CommandButton 
                      label="Worker" sub="50" hotkey="W" cost={50} res={resources} 
                      onClick={() => onTrain(EntityType.WORKER)} 
                      progress={singleSelection.trainProgress} max={STATS[EntityType.WORKER].buildTime} queue={singleSelection.trainQueue?.length || 0}
                  />
              )}
              {showBarracksMenu && (
                  <>
                  <CommandButton 
                      label="Marine" sub="50" hotkey="M" cost={50} res={resources} 
                      onClick={() => handleMultiTrain(EntityType.MARINE)} 
                      progress={singleSelection ? singleSelection.trainProgress : 0} max={STATS[EntityType.MARINE].buildTime} queue={singleSelection ? singleSelection.trainQueue?.length : 0}
                  />
                  <CommandButton 
                      label="Medic" sub="75" hotkey="E" cost={75} res={resources} 
                      onClick={() => handleMultiTrain(EntityType.MEDIC)} 
                      progress={singleSelection ? singleSelection.trainProgress : 0} max={STATS[EntityType.MEDIC].buildTime} queue={singleSelection ? singleSelection.trainQueue?.length : 0}
                  />
                  </>
              )}
              
              {singleSelection?.type === EntityType.BUNKER && singleSelection.owner === Owner.PLAYER && (
                  <button 
                      onClick={handleUnload}
                      className="bg-zinc-800/80 hover:bg-zinc-700/80 border border-white/10 hover:border-amber-500/50 rounded flex flex-col items-center justify-center relative shadow-lg group transition-all active:scale-95 active:shadow-inner"
                  >
                      <span className="text-amber-500 font-bold text-[10px] absolute top-1 right-1 font-mono">D</span>
                      <span className="text-zinc-300 text-[10px] font-bold mt-1 tracking-wider group-hover:text-white">UNLOAD</span>
                  </button>
              )}
          </div>
      </div>
    </div>
  );
};

const CommandButton = ({ label, sub, hotkey, cost, res, onClick, progress, max, queue }: any) => {
    const disabled = res < cost;
    return (
        <button 
            disabled={disabled}
            onClick={onClick}
            className={`
                relative rounded-lg flex flex-col items-center justify-center p-1 transition-all duration-100 group
                ${disabled 
                    ? 'bg-zinc-900/50 border border-white/5 opacity-40 cursor-not-allowed' 
                    : 'bg-white/5 hover:bg-white/10 border border-white/10 hover:border-cyan-400/50 hover:shadow-[0_0_15px_rgba(34,211,238,0.1)] active:scale-95 active:bg-cyan-950/30'}
            `}
        >
            <span className="absolute top-1 right-1.5 text-[10px] font-bold text-zinc-500 group-hover:text-cyan-400 font-mono transition-colors">{hotkey}</span>
            <span className="text-[10px] text-zinc-300 font-bold leading-tight text-center mt-1 group-hover:text-white tracking-wide">{label}</span>
            <span className="text-[9px] text-cyan-700 group-hover:text-cyan-500 leading-none mt-0.5 font-mono">{sub}</span>
            
            {queue > 0 && (
                <span className="absolute top-1 left-1 bg-cyan-600 text-white text-[9px] w-4 h-4 rounded flex items-center justify-center shadow-lg font-bold">
                    {queue}
                </span>
            )}
            
            {progress !== undefined && progress > 0 && (
                <div className="absolute bottom-0 left-0 w-full h-1 bg-zinc-950 rounded-b overflow-hidden">
                    <div className="h-full bg-cyan-400 opacity-80" style={{ width: `${(progress / max) * 100}%` }} />
                </div>
            )}
        </button>
    );
}