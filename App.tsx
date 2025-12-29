import React, { useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { Interface } from './components/Interface';
import { Lobby } from './components/Lobby';
import { GameState, GameEntity, EntityType, Owner, Difficulty } from './types';
import { initGame } from './services/gameLogic';

const App: React.FC = () => {
  const [view, setView] = useState<'LOBBY' | 'GAME'>('LOBBY');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [selectedEntities, setSelectedEntities] = useState<GameEntity[]>([]);
  const [commandMode, setCommandMode] = useState<string | null>(null);
  
  // Multiplayer Props
  const [isMultiplayer, setIsMultiplayer] = useState(false);
  const [gameSeed, setGameSeed] = useState(0);
  const [isHost, setIsHost] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>(Difficulty.MEDIUM);
  const [noRushSeconds, setNoRushSeconds] = useState(0);

  const handleGameStart = (seed: number, host: boolean, nrSeconds: number) => {
      setGameSeed(seed);
      setIsHost(host);
      setIsMultiplayer(true);
      setNoRushSeconds(nrSeconds);
      setDifficulty(Difficulty.MEDIUM); // Default MP difficulty to medium (or irrelevant)
      setView('GAME');
  };

  const handleSinglePlayer = (diff: Difficulty, nrSeconds: number) => {
      setDifficulty(diff);
      setNoRushSeconds(nrSeconds);
      setIsMultiplayer(false);
      setGameSeed(Math.random());
      setView('GAME');
  };

  const handleInterfaceTrain = (type: EntityType) => {
      // Find selected building
      selectedEntities.forEach(ent => {
          if (ent.owner === Owner.PLAYER) {
              window.dispatchEvent(new CustomEvent('GAME_COMMAND', { detail: { action: 'TRAIN', id: ent.id, type } }));
          }
      });
  };

  const handleInterfaceCommand = (cmd: string) => {
      if (cmd === 'QUIT') {
          setView('LOBBY');
          setGameState(null);
          // Optional: Reset other state
          setSelectedEntities([]);
          setCommandMode(null);
          return;
      }
      if (cmd === 'RESTART' && isMultiplayer) return; // Disable restart in MP for now
      if (cmd === 'RESTART') {
           window.dispatchEvent(new CustomEvent('GAME_COMMAND', { detail: { action: 'RESTART', difficulty } })); // Pass difficulty
           return;
      }
      setCommandMode(cmd); // e.g., 'BUILD_SUPPLY_DEPOT'
  };
  
  if (view === 'LOBBY') {
      return (
          <div className="relative w-full h-full bg-zinc-950">
              <Lobby onGameStart={handleGameStart} onSinglePlayerStart={handleSinglePlayer} />
          </div>
      )
  }

  return (
    <div className="relative w-full h-full bg-zinc-950 overflow-hidden select-none">
      {/* Game Layer */}
      <div className="absolute inset-0 z-0">
          <GameCanvas 
            onGameStateUpdate={setGameState} 
            onSelectionChange={setSelectedEntities}
            commandMode={commandMode}
            setCommandMode={setCommandMode}
            isMultiplayer={isMultiplayer}
            gameSeed={gameSeed}
            isHost={isHost}
            difficulty={difficulty}
            noRushSeconds={noRushSeconds}
          />
      </div>

      {/* UI Overlay Layer */}
      {gameState && (
          <div className="absolute inset-0 z-10 pointer-events-none">
             <Interface 
                gameState={gameState} 
                selectedEntities={selectedEntities}
                onCommand={handleInterfaceCommand}
                onTrain={handleInterfaceTrain}
             />
          </div>
      )}
    </div>
  );
};

export default App;