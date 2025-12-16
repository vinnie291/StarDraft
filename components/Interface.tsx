import React, { useEffect, useRef, useState } from 'react';
import { Entity, EntityType, GameState, Owner, Difficulty } from '../types';
import { STATS, GAME_WIDTH, GAME_HEIGHT } from '../constants';
import { toggleMute, getMuteState } from '../services/audio';

interface Props {
  gameState: GameState;
  selectedEntities: Entity[];
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
  const canBuild = allWorkers && selectedEntities.length === 1; // Only 1 worker can build at a time to keep UI simple
  
  // Group Selection logic
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
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
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

  const handleRestart = () => {
      setMenuOpen(false);
      window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
          detail: { action: 'RESTART', difficulty: gameState.difficulty } 
      }));
  };

  const changeDifficulty = (diff: Difficulty) => {
      setMenuOpen(false);
      window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
          detail: { action: 'RESTART', difficulty: diff } 
      }));
  };

  const togglePause = () => {
      setMenuOpen(false);
      window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
          detail: { action: 'TOGGLE_PAUSE' } 
      }));
  };

  const handleToggleMute = () => {
      setIsMuted(toggleMute());
  };

  // --- Minimap Logic ---
  const [isDraggingMinimap, setIsDraggingMinimap] = useState(false);
  const minimapRef = useRef<HTMLDivElement>(null);

  const updateCameraFromMinimap = (clientX: number, clientY: number) => {
      if (!minimapRef.current) return;
      const rect = minimapRef.current.getBoundingClientRect();
      const xPct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const yPct = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      
      const targetX = xPct * GAME_WIDTH;
      const targetY = yPct * GAME_HEIGHT;
      
      const centerX = targetX - (window.innerWidth / 2);
      const centerY = targetY - (window.innerHeight / 2);
      
      window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
          detail: { action: 'MOVE_CAMERA', x: centerX, y: centerY } 
      }));
  };

  const handleMinimapMouseDown = (e: React.MouseEvent) => {
      setIsDraggingMinimap(true);
      updateCameraFromMinimap(e.clientX, e.clientY);
  };

  useEffect(() => {
      const handleMouseMove = (e: MouseEvent) => {
          if (isDraggingMinimap) {
              updateCameraFromMinimap(e.clientX, e.clientY);
          }
      };
      const handleMouseUp = () => {
          setIsDraggingMinimap(false);
      };
      
      if (isDraggingMinimap) {
          window.addEventListener('mousemove', handleMouseMove);
          window.addEventListener('mouseup', handleMouseUp);
      }
      return () => {
          window.removeEventListener('mousemove', handleMouseMove);
          window.removeEventListener('mouseup', handleMouseUp);
      };
  }, [isDraggingMinimap]);


  // Helper for Fog of War on Minimap
  const isVisibleOnMinimap = (entity: Entity, playerUnits: Entity[]) => {
      if (entity.owner === Owner.PLAYER) return true;
      if (entity.type === EntityType.MINERAL && entity.resourceAmount! <= 0) return false;

      // Optimisation: Player units are already filtered in the parent, but we need a list
      // Iterate players units to see if this entity is close enough
      for(const pu of playerUnits) {
          const dx = entity.position.x - pu.position.x;
          const dy = entity.position.y - pu.position.y;
          // Simple squared check is faster, assume max vision ~500
          if (dx*dx + dy*dy < 250000) { // 500^2
              return true;
          }
      }
      return false;
  };
  
  const allEntities = Array.from(gameState.entities.values());
  const playerUnits = allEntities.filter(e => e.owner === Owner.PLAYER && e.state !== 'GARRISONED');

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between">
      {/* Top Bar */}
      <div className="bg-gray-900 bg-opacity-90 text-white p-2 flex gap-4 border-b border-gray-700 pointer-events-auto select-none items-center shadow-md justify-between px-4">
         <div className="flex gap-4">
             <div className="font-bold text-yellow-400">Minerals: {Math.floor(resources)}</div>
             <div className={supply.used > supply.max ? "text-red-500 font-bold" : "text-green-400"}>
                 Supply: {supply.used}/{supply.max}
             </div>
             <div className="text-gray-400 text-sm">Time: {Math.floor(gameState.gameTime / 60)}s</div>
         </div>
         
         {/* Menu Button */}
         <div className="relative" ref={menuRef}>
            <button 
                onClick={() => setMenuOpen(!menuOpen)}
                className="px-4 py-1 bg-gray-700 hover:bg-gray-600 rounded border border-gray-500 font-bold text-sm"
            >
                MENU
            </button>
            
            {menuOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-gray-800 border border-gray-600 rounded shadow-xl flex flex-col p-2 gap-2 z-50">
                    <button 
                        onClick={togglePause} 
                        className="text-left px-3 py-2 bg-gray-700 hover:bg-blue-600 rounded text-sm font-semibold"
                    >
                        {gameState.paused ? 'RESUME' : 'PAUSE'} (P)
                    </button>
                    
                    <div className="border-t border-gray-600 my-1"></div>
                    
                    <div className="text-xs text-gray-400 px-1 mb-1">Difficulty (Restarts Game)</div>
                    <div className="flex gap-1 mb-2">
                        {[Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD].map(d => (
                            <button 
                                key={d}
                                className={`flex-1 py-1 text-[10px] rounded border ${gameState.difficulty === d ? 'bg-blue-600 border-blue-400' : 'bg-gray-700 border-gray-600 hover:bg-gray-600'}`}
                                onClick={() => changeDifficulty(d)}
                            >
                                {d}
                            </button>
                        ))}
                    </div>
                    
                    <button 
                        onClick={handleToggleMute} 
                        className="text-left px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                    >
                        Sound: {isMuted ? 'OFF' : 'ON'}
                    </button>
                    
                    <div className="border-t border-gray-600 my-1"></div>

                    <button 
                        onClick={handleRestart} 
                        className="text-left px-3 py-2 bg-red-900 hover:bg-red-700 border border-red-800 rounded text-sm font-bold"
                    >
                        RESTART GAME
                    </button>
                </div>
            )}
         </div>
      </div>

      {/* Victory Screen Overlay */}
      {gameState.victory && (
         <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-70 z-50 pointer-events-auto">
             <div className="bg-gray-800 p-8 rounded-lg border-2 border-yellow-500 text-center shadow-2xl">
                 <h1 className="text-4xl font-bold text-yellow-500 mb-4">
                     {gameState.victory === Owner.PLAYER ? "VICTORY!" : "DEFEAT"}
                 </h1>
                 <button 
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded"
                    onClick={handleRestart}
                 >
                     PLAY AGAIN
                 </button>
             </div>
         </div>
      )}

      {/* Bottom Panel */}
      <div className="h-48 bg-gray-900 border-t border-gray-700 flex pointer-events-auto select-none shadow-lg">
          {/* Minimap */}
          <div 
              ref={minimapRef}
              className="w-48 bg-black border-r border-gray-700 relative overflow-hidden cursor-move"
              onMouseDown={handleMinimapMouseDown}
          >
             {/* Map Features */}
             {allEntities.map(e => {
                 if (e.state === 'GARRISONED') return null;
                 if (!isVisibleOnMinimap(e, playerUnits)) return null;

                 let color = 'bg-gray-500';
                 if (e.type === EntityType.WATER) color = 'bg-blue-800';
                 else if (e.type === EntityType.MOUNTAIN) color = 'bg-gray-700';
                 else if (e.type === EntityType.MINERAL) color = 'bg-teal-500';
                 else if (e.owner === Owner.PLAYER) color = 'bg-blue-500';
                 else if (e.owner === Owner.AI) color = 'bg-red-500';
                 
                 const size = (e.type === EntityType.WATER || e.type === EntityType.MOUNTAIN) ? 4 : 2;

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
             <div className="absolute border border-white pointer-events-none"
                  style={{
                      left: `${(gameState.camera.x / GAME_WIDTH) * 100}%`,
                      top: `${(gameState.camera.y / GAME_HEIGHT) * 100}%`,
                      width: `${(window.innerWidth / GAME_WIDTH) * 100}%`,
                      height: `${(window.innerHeight / GAME_HEIGHT) * 100}%`,
                  }}
             />
          </div>

          {/* Unit Info */}
          <div className="flex-1 p-4 border-r border-gray-700 flex flex-wrap gap-2 overflow-auto content-start">
             {selectedEntities.length === 0 && <span className="text-gray-500 italic">No selection</span>}
             
             {/* Barracks Group View */}
             {allBarracks.length > 1 && selectedEntities.length === allBarracks.length ? (
                 <div className="flex flex-wrap gap-2">
                     {allBarracks.map(b => (
                         <div key={b.id} className="w-16 h-16 bg-gray-800 border border-gray-600 p-1 flex flex-col items-center justify-center text-xs text-white relative">
                             <span>Barracks</span>
                             {b.trainQueue && b.trainQueue.length > 0 && (
                                 <div className="absolute top-1 right-1 text-blue-400 font-bold">{b.trainQueue.length}</div>
                             )}
                             <div className="w-full h-1 bg-gray-900 mt-2">
                                <div className="h-full bg-white" style={{ width: `${(b.trainProgress! / STATS[EntityType.MARINE].buildTime) * 100}%` }} />
                             </div>
                         </div>
                     ))}
                 </div>
             ) : (
                selectedEntities.length > 0 && selectedEntities.length < 18 && selectedEntities.map(e => (
                    <div key={e.id} className="w-12 h-12 bg-gray-800 border border-gray-600 p-1 flex flex-col items-center justify-center text-[10px] text-white overflow-hidden">
                        <div className={`w-2 h-2 rounded-full mb-1 ${e.owner === Owner.PLAYER ? 'bg-blue-500' : 'bg-red-500'}`} />
                        <span className="truncate w-full text-center">{e.type}</span>
                        {/* Garrison Indicator */}
                        {e.garrison && e.garrison.length > 0 && (
                            <div className="flex gap-0.5 mt-0.5">
                                {e.garrison.map((_, i) => <div key={i} className="w-1 h-1 bg-green-500 rounded-full" />)}
                            </div>
                        )}
                        <div className="w-full h-1 bg-red-900 mt-1">
                            <div className="h-full bg-green-500" style={{ width: `${(e.hp / e.maxHp) * 100}%`}} />
                        </div>
                    </div>
                ))
             )}
             
             {selectedEntities.length >= 18 && (
                 <div className="text-white p-4 font-bold text-lg">
                     Selected: {selectedEntities.length} Units
                 </div>
             )}
          </div>

          {/* Command Card */}
          <div className="w-64 bg-gray-800 p-2 grid grid-cols-3 gap-2">
              {/* Build Commands */}
              {canBuild && (
                  <>
                    <CommandButton 
                        label="Depot (100)" 
                        hotkey="S" 
                        cost={100} 
                        currentResources={resources}
                        onClick={() => onCommand(`BUILD_${EntityType.SUPPLY_DEPOT}`)} 
                    />
                    <CommandButton 
                        label="Barracks (150)" 
                        hotkey="B" 
                        cost={150} 
                        currentResources={resources}
                        onClick={() => onCommand(`BUILD_${EntityType.BARRACKS}`)} 
                    />
                    <CommandButton 
                        label="Bunker (100)" 
                        hotkey="U" 
                        cost={100} 
                        currentResources={resources}
                        onClick={() => onCommand(`BUILD_${EntityType.BUNKER}`)} 
                    />
                  </>
              )}

              {/* Train Commands */}
              {singleSelection?.type === EntityType.BASE && (
                  <CommandButton 
                      label="Worker (50)" 
                      hotkey="W" 
                      cost={50} 
                      currentResources={resources}
                      onClick={() => onTrain(EntityType.WORKER)} 
                      progress={singleSelection.trainProgress}
                      maxProgress={STATS[EntityType.WORKER].buildTime}
                      queue={singleSelection.trainQueue?.length || 0}
                  />
              )}
              {showBarracksMenu && (
                  <>
                  <CommandButton 
                      label="Marine (50)" 
                      hotkey="M" 
                      cost={50} 
                      currentResources={resources}
                      onClick={() => handleMultiTrain(EntityType.MARINE)} 
                      progress={singleSelection ? singleSelection.trainProgress : 0}
                      maxProgress={STATS[EntityType.MARINE].buildTime}
                      queue={singleSelection ? singleSelection.trainQueue?.length : 0}
                  />
                  <CommandButton 
                      label="Medic (75)" 
                      hotkey="E" 
                      cost={75} 
                      currentResources={resources}
                      onClick={() => handleMultiTrain(EntityType.MEDIC)} 
                      progress={singleSelection ? singleSelection.trainProgress : 0}
                      maxProgress={STATS[EntityType.MEDIC].buildTime}
                      queue={singleSelection ? singleSelection.trainQueue?.length : 0}
                  />
                  </>
              )}
              
              {/* Bunker Commands */}
              {singleSelection?.type === EntityType.BUNKER && singleSelection.owner === Owner.PLAYER && (
                  <button 
                      onClick={handleUnload}
                      className={`relative bg-gray-700 border border-gray-500 text-white text-xs p-1 hover:bg-gray-600 active:bg-gray-500 flex flex-col items-center justify-center h-20 shadow-sm transition-colors`}
                  >
                      <span className="font-bold text-yellow-300 mb-1">D</span>
                      <span className="text-center leading-tight">Unload All</span>
                  </button>
              )}
          </div>
      </div>
    </div>
  );
};

const CommandButton = ({ label, hotkey, cost, currentResources, onClick, progress, maxProgress, queue }: any) => {
    const disabled = currentResources < cost;
    return (
        <button 
            disabled={disabled}
            onClick={onClick}
            className={`relative bg-gray-700 border border-gray-500 text-white text-xs p-1 hover:bg-gray-600 active:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed flex flex-col items-center justify-center h-20 shadow-sm transition-colors`}
        >
            <span className="font-bold text-yellow-300 mb-1">{hotkey}</span>
            <span className="text-center leading-tight">{label}</span>
            {queue > 0 && <span className="absolute top-0 right-0 bg-blue-600 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center shadow">{queue}</span>}
            {progress !== undefined && progress > 0 && (
                <div className="absolute bottom-0 left-0 w-full h-1 bg-black">
                    <div className="h-full bg-white transition-all duration-75" style={{ width: `${(progress / maxProgress) * 100}%` }} />
                </div>
            )}
        </button>
    );
}