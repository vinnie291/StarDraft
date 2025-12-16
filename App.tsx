import React, { useState, useCallback } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { Interface } from './components/Interface';
import { GameState, Entity, EntityType, Owner } from './types';
import { STATS } from './constants';
import { initGame } from './services/gameLogic';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(initGame());
  const [selectedEntities, setSelectedEntities] = useState<Entity[]>([]);
  const [commandMode, setCommandMode] = useState<string | null>(null);

  const handleTrain = useCallback((type: EntityType) => {
     // Logic is handled in GameCanvas/GameLogic actually, but we need to pass intent
     // However, simpler to mutate the state reference in GameCanvas logic. 
     // But React state is separate from game loop Ref state. 
     // We need to signal the GameLogic.
     // To keep it clean, we'll expose a helper or just modify the Ref in GameCanvas via a passed callback.
     // Actually, standard pattern: GameCanvas owns the `ref`, we need to tell it to do something.
     // Since we don't have a Controller class, we will dispatch an event or use a ref exposed by GameCanvas?
     // Easiest: Pass a mutable action object or closure.
     
     // *Correction*: GameCanvas holds the authoritative state in `useRef`. 
     // We should move logic triggers into GameCanvas via props or ref.
     // But `Interface` is sibling.
     // Let's use a custom event or a shared context? 
     // Simple approach: The `onTrain` prop in App calls a function passed from GameCanvas? No, App renders GameCanvas.
     // We can use a `command` queue in props to GameCanvas.
  }, []);
  
  // Revised approach for commands:
  // App holds "pending command" state, GameCanvas consumes it.
  const [pendingCommand, setPendingCommand] = useState<{ type: 'TRAIN' | 'BUILD', payload: any } | null>(null);

  // We need to bridge the Interface buttons to the Game Loop in GameCanvas.
  // We can pass a RefObject to GameCanvas that we can call functions on.
  const gameApiRef = React.useRef<{ 
      trainUnit: (id: string, type: EntityType) => void; 
      gameState: GameState 
  }>(null);

  const handleInterfaceTrain = (type: EntityType) => {
      // Find selected building
      selectedEntities.forEach(ent => {
          if (ent.owner === Owner.PLAYER) {
              // Basic check, validation happens in logic
              window.dispatchEvent(new CustomEvent('GAME_COMMAND', { detail: { action: 'TRAIN', id: ent.id, type } }));
          }
      });
  };

  const handleInterfaceCommand = (cmd: string) => {
      setCommandMode(cmd); // e.g., 'BUILD_SUPPLY_DEPOT'
  };
  
  // Listen for commands in GameCanvas using event listener for simplicity in this setup
  React.useEffect(() => {
     const handler = (e: any) => {
        const { action, id, type } = e.detail;
        if (action === 'TRAIN') {
             // We need access to the game state ref which is inside GameCanvas.
             // This event pattern is a bit loose. 
             // Let's rewrite GameCanvas to expose an API or consume a queue prop.
        }
     };
     window.addEventListener('GAME_COMMAND', handler);
     return () => window.removeEventListener('GAME_COMMAND', handler);
  }, []);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <GameCanvas 
        onGameStateUpdate={setGameState} 
        onSelectionChange={setSelectedEntities}
        commandMode={commandMode}
        setCommandMode={setCommandMode}
      />
      <Interface 
        gameState={gameState} 
        selectedEntities={selectedEntities}
        onCommand={handleInterfaceCommand}
        onTrain={handleInterfaceTrain}
      />
      
      {/* Event Bridge inside GameCanvas Component is cleaner, let's inject a listener there. */}
      {/* We will handle the CustomEvent dispatch in Interface, and listener in GameCanvas. */}
    </div>
  );
};

export default App;