import React, { useEffect, useRef } from 'react';
import { GameState, Entity, EntityType, Owner, Vector2, Marker, Difficulty } from '../types';
import { STATS, GAME_WIDTH, GAME_HEIGHT } from '../constants';
import { updateGame, initGame, createEntity, addNotification } from '../services/gameLogic';
import { playSound } from '../services/audio';

interface Props {
  onGameStateUpdate: (state: GameState) => void;
  onSelectionChange: (selected: Entity[]) => void;
  commandMode: string | null;
  setCommandMode: (mode: string | null) => void;
}

export const GameCanvas: React.FC<Props> = ({ onGameStateUpdate, onSelectionChange, commandMode, setCommandMode }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameStateRef = useRef<GameState>(initGame());
  const requestRef = useRef<number>(0);
  
  // Fog of War Canvases (Offscreen)
  const exploredCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const visionCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Input State via Refs
  const mouseDownStateRef = useRef<{ screen: Vector2, world: Vector2 } | null>(null);
  const mousePosRef = useRef<Vector2>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  
  // Camera Controls State
  const keysPressed = useRef<Set<string>>(new Set());
  const isDraggingCamera = useRef(false); // Middle mouse
  const isRightDragging = useRef(false);  // Right mouse
  const lastDragPos = useRef<Vector2>({ x: 0, y: 0 });
  const rightDragStart = useRef<Vector2>({ x: 0, y: 0 });

  // Initialize offscreen canvases
  useEffect(() => {
      const explored = document.createElement('canvas');
      explored.width = GAME_WIDTH;
      explored.height = GAME_HEIGHT;
      const ctxE = explored.getContext('2d');
      if (ctxE) {
          ctxE.fillStyle = 'black';
          ctxE.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      }
      exploredCanvasRef.current = explored;

      const vision = document.createElement('canvas');
      vision.width = GAME_WIDTH;
      vision.height = GAME_HEIGHT;
      visionCanvasRef.current = vision;
  }, []);

  // Reset Fog on Restart
  useEffect(() => {
      if (gameStateRef.current.gameTime === 0 && exploredCanvasRef.current) {
          const ctx = exploredCanvasRef.current.getContext('2d');
          if (ctx) {
             ctx.globalCompositeOperation = 'source-over';
             ctx.fillStyle = 'black';
             ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
          }
      }
  }, [gameStateRef.current.gameTime]); 

  // Helper to check visibility
  const isEntityVisible = (entity: Entity, playerUnits: Entity[]) => {
      if (entity.owner === Owner.PLAYER) return true;
      const stats = STATS[entity.type];
      for (const pUnit of playerUnits) {
          const pStats = STATS[pUnit.type];
          const dist = Math.sqrt(Math.pow(entity.position.x - pUnit.position.x, 2) + Math.pow(entity.position.y - pUnit.position.y, 2));
          if (dist < pStats.vision + entity.radius) return true;
      }
      return false;
  };

  // Command Listener
  useEffect(() => {
      const handleCommand = (e: Event) => {
          const detail = (e as CustomEvent).detail;
          
          if (detail.action === 'RESTART') {
              gameStateRef.current = initGame(detail.difficulty || Difficulty.MEDIUM);
              if (exploredCanvasRef.current) {
                  const ctx = exploredCanvasRef.current.getContext('2d');
                  if (ctx) {
                     ctx.globalCompositeOperation = 'source-over';
                     ctx.fillStyle = 'black';
                     ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
                  }
              }
              onGameStateUpdate({ ...gameStateRef.current });
              return;
          }

          if (detail.action === 'TOGGLE_PAUSE') {
              gameStateRef.current.paused = !gameStateRef.current.paused;
              onGameStateUpdate({ ...gameStateRef.current }); 
              return;
          }

          if (detail.action === 'MOVE_CAMERA') {
              gameStateRef.current.camera = { 
                  x: Math.max(0, Math.min(detail.x, GAME_WIDTH - window.innerWidth)), 
                  y: Math.max(0, Math.min(detail.y, GAME_HEIGHT - window.innerHeight)) 
              };
              return;
          }

          if (detail.action === 'TRAIN') {
              const ent = gameStateRef.current.entities.get(detail.id);
              if (ent && ent.owner === Owner.PLAYER) {
                  const stats = STATS[detail.type as EntityType];
                  if (gameStateRef.current.resources[Owner.PLAYER] >= stats.cost) {
                      if (!ent.trainQueue) ent.trainQueue = [];
                      if (ent.trainQueue.length < 5) {
                          ent.trainQueue.push(detail.type);
                          gameStateRef.current.resources[Owner.PLAYER] -= stats.cost;
                          playSound('train');
                      } else {
                          playSound('error');
                      }
                  } else {
                      addNotification(gameStateRef.current, "Not Enough Minerals!");
                      playSound('error');
                  }
              }
          }
          
          if (detail.action === 'UNLOAD_ALL') {
              const ent = gameStateRef.current.entities.get(detail.id);
              if (ent && ent.type === EntityType.BUNKER && ent.garrison) {
                  ent.garrison.forEach(unitId => {
                      const unit = gameStateRef.current.entities.get(unitId);
                      if (unit) {
                          unit.state = 'IDLE';
                          unit.containerId = null;
                          // Spawn around bunker
                          const angle = Math.random() * Math.PI * 2;
                          unit.position = {
                              x: ent.position.x + Math.cos(angle) * (ent.radius + 15),
                              y: ent.position.y + Math.sin(angle) * (ent.radius + 15)
                          };
                      }
                  });
                  ent.garrison = [];
                  playSound('click');
              }
          }

          if (detail.action === 'SET_RALLY') {
              const ent = gameStateRef.current.entities.get(detail.id);
              if (ent) {
                  ent.rallyPoint = detail.pos;
                  ent.rallyTargetId = detail.targetId;
                  playSound('click');
              }
          }
      };
      window.addEventListener('GAME_COMMAND', handleCommand);
      return () => window.removeEventListener('GAME_COMMAND', handleCommand);
  }, []);

  // Keyboard Listeners
  useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
          keysPressed.current.add(e.code);

          const key = e.key.toUpperCase();
          if ((e.target as HTMLElement).tagName === 'INPUT') return;

          // Attack Move Shortcut
          if (key === 'A') {
              const hasAttackers = gameStateRef.current.selection.some(id => {
                  const ent = gameStateRef.current.entities.get(id);
                  return ent && ent.owner === Owner.PLAYER && STATS[ent.type].damage > 0;
              });
              if (hasAttackers) {
                  setCommandMode('ATTACK');
              }
          }

          // Pause Shortcut
          if (key === 'P') {
              gameStateRef.current.paused = !gameStateRef.current.paused;
              onGameStateUpdate({ ...gameStateRef.current });
          }

          // Shortcuts
          if (key === '1') {
              const workers = Array.from(gameStateRef.current.entities.values()).filter(ent => 
                  ent.owner === Owner.PLAYER && ent.type === EntityType.WORKER
              );
              let target = workers.find(w => w.state === 'IDLE');
              if (!target) target = workers.find(w => w.state === 'GATHERING');
              if (!target && workers.length > 0) target = workers[0];

              if (target) {
                  gameStateRef.current.selection = [target.id];
                  onSelectionChange([target]);
                  playSound('click');
              }
          }
          if (key === '2') {
              const marines = Array.from(gameStateRef.current.entities.values()).filter(ent => 
                  ent.owner === Owner.PLAYER && ent.type === EntityType.MARINE
              );
              if (marines.length > 0) {
                  gameStateRef.current.selection = marines.map(m => m.id);
                  onSelectionChange(marines);
                  playSound('click');
              }
          }
      };
      const onKeyUp = (e: KeyboardEvent) => keysPressed.current.delete(e.code);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      return () => {
          window.removeEventListener('keydown', onKeyDown);
          window.removeEventListener('keyup', onKeyUp);
      };
  }, [onSelectionChange, setCommandMode]);

  const getWorldPos = (clientX: number, clientY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const x = clientX - rect.left + gameStateRef.current.camera.x;
    const y = clientY - rect.top + gameStateRef.current.camera.y;
    return { x, y };
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    const state = gameStateRef.current;
    const { width, height } = ctx.canvas;
    const mousePos = mousePosRef.current;

    // Filter Visible Entities
    const allEntities = Array.from(state.entities.values());
    const playerUnits = allEntities.filter(e => e.owner === Owner.PLAYER && e.state !== 'GARRISONED');
    const visibleEntities = new Set<string>();
    allEntities.forEach(e => {
        if (e.state === 'GARRISONED') return;
        if (isEntityVisible(e, playerUnits)) visibleEntities.add(e.id);
    });

    // --- FOG UPDATE (Offscreen) ---
    if (exploredCanvasRef.current && visionCanvasRef.current) {
        const ctxExp = exploredCanvasRef.current.getContext('2d');
        const ctxVis = visionCanvasRef.current.getContext('2d');
        if (ctxExp && ctxVis) {
            // Update Explored
            ctxExp.globalCompositeOperation = 'destination-out';
            ctxExp.fillStyle = 'white';
            
            // Setup Current Vision
            ctxVis.globalCompositeOperation = 'source-over';
            ctxVis.fillStyle = 'rgba(0, 0, 0, 0.6)'; 
            ctxVis.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
            ctxVis.globalCompositeOperation = 'destination-out';
            ctxVis.fillStyle = 'white';

            playerUnits.forEach(u => {
                const range = STATS[u.type].vision;
                ctxExp.beginPath();
                ctxExp.arc(u.position.x, u.position.y, range, 0, Math.PI * 2);
                ctxExp.fill();

                ctxVis.beginPath();
                ctxVis.arc(u.position.x, u.position.y, range, 0, Math.PI * 2);
                ctxVis.fill();
            });
        }
    }

    // --- DRAW WORLD ---
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(-state.camera.x, -state.camera.y);

    // Grid
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    for (let x = 0; x <= GAME_WIDTH; x += 100) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, GAME_HEIGHT); ctx.stroke();
    }
    for (let y = 0; y <= GAME_HEIGHT; y += 100) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(GAME_WIDTH, y); ctx.stroke();
    }
    
    ctx.strokeStyle = '#444';
    ctx.strokeRect(0,0, GAME_WIDTH, GAME_HEIGHT);

    // Markers
    state.markers.forEach(mk => {
        const lifePct = mk.life / mk.maxLife;
        ctx.save();
        ctx.translate(mk.position.x, mk.position.y);
        ctx.globalAlpha = lifePct;
        if (mk.type === 'MOVE') {
             ctx.strokeStyle = '#4ade80'; // Green
             ctx.lineWidth = 2;
             const r = 15 * (0.5 + lifePct * 0.5); 
             ctx.beginPath();
             for(let i=0; i<4; i++) {
                 ctx.rotate(Math.PI/2);
                 ctx.moveTo(0, -r); ctx.lineTo(4, -r-4); ctx.moveTo(0, -r); ctx.lineTo(-4, -r-4);
             }
             ctx.stroke();
        } else if (mk.type === 'ATTACK') {
             ctx.strokeStyle = '#ef4444'; // Red
             ctx.lineWidth = 2;
             ctx.beginPath();
             const r = 10;
             ctx.moveTo(-r, -r); ctx.lineTo(r, r);
             ctx.moveTo(r, -r); ctx.lineTo(-r, r);
             ctx.stroke();
        } else if (mk.type === 'LOAD') {
            ctx.strokeStyle = '#fbbf24'; // Yellow
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 10 + lifePct * 10, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    });
    ctx.globalAlpha = 1.0;

    // Entities
    state.entities.forEach(entity => {
      // VISIBILITY CHECK
      if (!visibleEntities.has(entity.id)) return;

      ctx.save();
      ctx.translate(entity.position.x, entity.position.y);

      // Rally Point
      if (state.selection.includes(entity.id) && entity.rallyPoint && (entity.type === EntityType.BASE || entity.type === EntityType.BARRACKS)) {
          ctx.save();
          ctx.strokeStyle = '#fbbf24'; 
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(0, 0); 
          ctx.lineTo(entity.rallyPoint.x - entity.position.x, entity.rallyPoint.y - entity.position.y);
          ctx.stroke();
          ctx.restore();
      }

      // Selection Ring
      if (state.selection.includes(entity.id)) {
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, entity.radius + 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Body Drawing
      if (entity.type === EntityType.MINERAL) {
        ctx.fillStyle = '#38bdf8'; 
        ctx.beginPath();
        ctx.moveTo(0, -12); ctx.lineTo(10, -5); ctx.lineTo(6, 8); ctx.lineTo(-6, 8); ctx.lineTo(-10, -5);
        ctx.fill();
        ctx.strokeStyle = '#0ea5e9';
        ctx.stroke();
      } else if (entity.type === EntityType.MOUNTAIN) {
        ctx.fillStyle = '#4b5563'; 
        ctx.beginPath();
        ctx.moveTo(0, -40); 
        ctx.lineTo(30, -10); ctx.lineTo(20, 20); ctx.lineTo(40, 40);
        ctx.lineTo(0, 30); ctx.lineTo(-30, 40); ctx.lineTo(-40, 10); ctx.lineTo(-20, -20);
        ctx.fill();
        ctx.fillStyle = '#6b7280';
        ctx.beginPath();
        ctx.moveTo(0, -40); ctx.lineTo(15, 0); ctx.lineTo(-5, 5);
        ctx.fill();
      } else if (entity.type === EntityType.WATER) {
        ctx.fillStyle = '#1e3a8a';
        ctx.beginPath(); ctx.arc(0,0, 30, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0,0, 25, 0, Math.PI*2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath(); 
        ctx.moveTo(-15, 0); ctx.quadraticCurveTo(0, -10, 15, 0);
        ctx.stroke();
      } else {
        ctx.fillStyle = entity.owner === Owner.PLAYER ? '#3b82f6' : '#ef4444';
        
        if (entity.type === EntityType.BASE) {
          ctx.fillRect(-30, -30, 60, 60);
          ctx.fillStyle = '#1e3a8a';
          ctx.fillRect(-10, 10, 20, 20);
          ctx.strokeStyle = 'rgba(255,255,255,0.3)';
          ctx.beginPath(); ctx.moveTo(-30, -30); ctx.lineTo(30,30); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(30, -30); ctx.lineTo(-30,30); ctx.stroke();
        } else if (entity.type === EntityType.BARRACKS) {
            ctx.fillRect(-25, -25, 50, 50);
            ctx.fillStyle = '#1f2937';
            ctx.fillRect(-15, -15, 30, 30);
        } else if (entity.type === EntityType.BUNKER) {
            ctx.fillRect(-20, -20, 40, 40);
            ctx.fillStyle = '#374151';
            ctx.fillRect(-15, -5, 30, 10); // Slit
            // Indicators for garrison
            if (entity.garrison && entity.garrison.length > 0) {
                 ctx.fillStyle = '#22c55e';
                 for(let i=0; i<entity.garrison.length; i++) {
                     ctx.beginPath(); ctx.arc(-12 + i * 8, 12, 3, 0, Math.PI*2); ctx.fill();
                 }
            }
        } else if (entity.type === EntityType.SUPPLY_DEPOT) {
            ctx.fillRect(-15, -15, 30, 30);
            ctx.beginPath(); ctx.moveTo(-15, -15); ctx.lineTo(15,15); ctx.stroke();
        } else if (entity.type === EntityType.WORKER) {
            ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#9ca3af';
            ctx.beginPath(); ctx.arc(4, 4, 3, 0, Math.PI * 2); ctx.fill();
            if (entity.resourceAmount && entity.resourceAmount > 0) {
                ctx.fillStyle = '#38bdf8'; 
                ctx.beginPath(); ctx.arc(0, -6, 4, 0, Math.PI * 2); ctx.fill();
            }
        } else if (entity.type === EntityType.MARINE) {
            ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(10, 0); ctx.stroke();
        } else if (entity.type === EntityType.MEDIC) {
            ctx.fillStyle = '#e5e7eb'; // White
            ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
            // Red Cross
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(-2, -5, 4, 10);
            ctx.fillRect(-5, -2, 10, 4);
        }

        // HP Bar
        if (entity.hp < entity.maxHp || state.selection.includes(entity.id)) {
            const pct = Math.max(0, entity.hp / entity.maxHp);
            const w = 24;
            ctx.fillStyle = 'red';
            ctx.fillRect(-w/2, -entity.radius - 10, w, 4);
            ctx.fillStyle = '#22c55e'; // Green
            ctx.fillRect(-w/2, -entity.radius - 10, w * pct, 4);
        }

        if (entity.constructionProgress! < 100) {
            ctx.fillStyle = 'yellow';
            ctx.fillRect(-15, 0, 30, 4);
            ctx.fillStyle = 'blue';
            ctx.fillRect(-15, 0, 30 * (entity.constructionProgress! / 100), 4);
        }
        
        if (entity.trainQueue && entity.trainQueue.length > 0) {
             ctx.fillStyle = 'white';
             ctx.beginPath(); ctx.arc(0, -entity.radius-15, 2, 0, Math.PI*2); ctx.fill();
        }
      }
      ctx.restore();
      
      // Attack Lines
      if (entity.state === 'ATTACKING' && entity.targetId && entity.cooldown > STATS[entity.type].attackSpeed - 5) {
          const target = state.entities.get(entity.targetId);
          if (target && visibleEntities.has(target.id)) {
              ctx.strokeStyle = entity.type === EntityType.MARINE ? 'yellow' : 'white';
              ctx.lineWidth = entity.type === EntityType.MARINE ? 2 : 1;
              ctx.beginPath();
              ctx.moveTo(entity.position.x, entity.position.y);
              ctx.lineTo(target.position.x, target.position.y);
              ctx.stroke();
          }
      }
      // Bunker Attack Line
      if (entity.type === EntityType.BUNKER && entity.targetId && entity.cooldown > STATS[entity.type].attackSpeed - 5) {
          const target = state.entities.get(entity.targetId);
           if (target && visibleEntities.has(target.id)) {
              ctx.strokeStyle = 'yellow';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(entity.position.x, entity.position.y);
              ctx.lineTo(target.position.x, target.position.y);
              ctx.stroke();
           }
      }
      // Medic Beam
      if (entity.state === 'HEALING' && entity.targetId && entity.cooldown > STATS[entity.type].attackSpeed - 10) {
          const target = state.entities.get(entity.targetId);
           if (target) {
              ctx.strokeStyle = '#22c55e';
              ctx.lineWidth = 2;
              ctx.setLineDash([5, 5]);
              ctx.beginPath();
              ctx.moveTo(entity.position.x, entity.position.y);
              ctx.lineTo(target.position.x, target.position.y);
              ctx.stroke();
              ctx.setLineDash([]);
           }
      }
    });

    // --- DRAW EFFECTS ---
    state.effects.forEach(fx => {
        let visible = false;
        for(const u of playerUnits) {
             const d = Math.sqrt(Math.pow(u.position.x - fx.position.x, 2) + Math.pow(u.position.y - fx.position.y, 2));
             if (d < STATS[u.type].vision) { visible = true; break; }
        }
        if (!visible) return;

        ctx.save();
        ctx.translate(fx.position.x, fx.position.y);
        const lifePct = fx.life / fx.maxLife; 
        
        if (fx.type === 'EXPLOSION') {
            const r = (1 - lifePct) * 40 * fx.scale;
            ctx.globalAlpha = lifePct;
            ctx.fillStyle = '#fff7ed'; 
            ctx.beginPath(); ctx.arc(0,0, r * 0.5, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#ea580c'; 
            ctx.beginPath(); ctx.arc(0,0, r, 0, Math.PI*2); ctx.fill();
        } else if (fx.type === 'BUILDING_EXPLOSION') {
             const r = (1 - lifePct) * 80;
             ctx.globalAlpha = lifePct;
             ctx.fillStyle = '#fef08a';
             ctx.beginPath(); ctx.arc(0,0, r, 0, Math.PI*2); ctx.fill();
             
             for(let i=0; i<5; i++) {
                 const offsetAngle = (i/5) * Math.PI*2 + state.gameTime * 0.1;
                 const ex = Math.cos(offsetAngle) * r * 0.5;
                 const ey = Math.sin(offsetAngle) * r * 0.5;
                 ctx.fillStyle = i % 2 === 0 ? '#ef4444' : '#f97316';
                 ctx.beginPath(); ctx.arc(ex, ey, r*0.6, 0, Math.PI*2); ctx.fill();
             }
        } else if (fx.type === 'BLOOD') {
            ctx.fillStyle = '#991b1b'; 
            ctx.globalAlpha = lifePct;
            ctx.beginPath(); ctx.arc(0,0, 10, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(5,5, 6, 0, Math.PI*2); ctx.fill();
        } else if (fx.type === 'HEAL') {
            ctx.strokeStyle = '#22c55e';
            ctx.globalAlpha = lifePct;
            ctx.lineWidth = 2;
            ctx.beginPath(); 
            ctx.moveTo(0, -10 + lifePct * 10); ctx.lineTo(0, -20);
            ctx.moveTo(-5, -15); ctx.lineTo(5, -15);
            ctx.stroke();
        }
        ctx.restore();
    });
    ctx.globalAlpha = 1.0;
    
    // --- DRAW FOG OVERLAY ---
    if (visionCanvasRef.current) ctx.drawImage(visionCanvasRef.current, 0, 0); 
    if (exploredCanvasRef.current) ctx.drawImage(exploredCanvasRef.current, 0, 0);

    // Selection Box
    if (mouseDownStateRef.current) {
        const currentWorldPos = {
            x: mousePos.x + state.camera.x,
            y: mousePos.y + state.camera.y
        };
        const startWorld = mouseDownStateRef.current.world;
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(startWorld.x, startWorld.y, currentWorldPos.x - startWorld.x, currentWorldPos.y - startWorld.y);
        ctx.setLineDash([]);
    }
    
    // Ghost Building
    if (commandMode && commandMode.startsWith('BUILD_')) {
       const type = commandMode.replace('BUILD_', '') as EntityType;
       const worldMouse = { x: mousePos.x + state.camera.x, y: mousePos.y + state.camera.y };
       const stats = STATS[type];
       ctx.fillStyle = 'rgba(34, 197, 94, 0.5)';
       ctx.fillRect(worldMouse.x - stats.width/2, worldMouse.y - stats.height/2, stats.width, stats.height);
       ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
       ctx.strokeRect(worldMouse.x - stats.width/2, worldMouse.y - stats.height/2, stats.width, stats.height);
    }
    
    // Pause Overlay
    if (state.paused) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 48px sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'black';
        ctx.shadowBlur = 10;
        ctx.fillText('PAUSED', width / 2, height / 2);
        ctx.restore();
    }
    
    // Notifications (Screen Space)
    ctx.restore(); // Undo Camera transform for HUD-like elements
    if (state.notifications.length > 0) {
        ctx.save();
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f87171';
        ctx.shadowColor = 'black';
        ctx.shadowBlur = 4;
        
        state.notifications.forEach((n, i) => {
            const y = height - 250 - (i * 30);
            const alpha = Math.min(1, n.life / 30);
            ctx.globalAlpha = alpha;
            ctx.fillText(n.text, width / 2, y);
        });
        ctx.restore();
    }

  };

  const loop = () => {
    if (!gameStateRef.current.victory && !gameStateRef.current.paused) {
        gameStateRef.current = updateGame(gameStateRef.current);
        if (gameStateRef.current.soundEvents.length > 0) {
            gameStateRef.current.soundEvents.forEach(evt => playSound(evt as any));
            gameStateRef.current.soundEvents = [];
        }
    }
    
    const mousePos = mousePosRef.current;
    
    // Edge Panning
    const panSpeed = 15;
    const margin = 20;
    const keySpeed = 20;
    
    if (keysPressed.current.has('ArrowLeft')) gameStateRef.current.camera.x -= keySpeed;
    if (keysPressed.current.has('ArrowRight')) gameStateRef.current.camera.x += keySpeed;
    if (keysPressed.current.has('ArrowUp')) gameStateRef.current.camera.y -= keySpeed;
    if (keysPressed.current.has('ArrowDown')) gameStateRef.current.camera.y += keySpeed;

    if (!isDraggingCamera.current && !isRightDragging.current) {
        if (mousePos.x < margin && mousePos.x >= 0) gameStateRef.current.camera.x -= panSpeed;
        if (mousePos.x > window.innerWidth - margin && mousePos.x <= window.innerWidth) gameStateRef.current.camera.x += panSpeed;
        if (mousePos.y < margin && mousePos.y >= 0) gameStateRef.current.camera.y -= panSpeed;
        if (mousePos.y > window.innerHeight - margin && mousePos.y <= window.innerHeight) gameStateRef.current.camera.y += panSpeed;
    }

    gameStateRef.current.camera.x = Math.max(0, Math.min(gameStateRef.current.camera.x, GAME_WIDTH - window.innerWidth));
    gameStateRef.current.camera.y = Math.max(0, Math.min(gameStateRef.current.camera.y, GAME_HEIGHT - window.innerHeight));

    if (canvasRef.current) {
      draw(canvasRef.current.getContext('2d')!);
    }

    if (gameStateRef.current.gameTime % 5 === 0 || gameStateRef.current.paused) {
        onGameStateUpdate({ ...gameStateRef.current });
    }

    requestRef.current = requestAnimationFrame(loop);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(requestRef.current!);
  }, [commandMode]); 

  // --- Input Handlers ---
  const handleMouseDown = (e: React.MouseEvent) => {
    if (gameStateRef.current.paused) return; // Ignore inputs when paused

    if (e.button === 1) {
        e.preventDefault();
        isDraggingCamera.current = true;
        lastDragPos.current = { x: e.clientX, y: e.clientY };
        return;
    }

    if (e.button === 2) { 
        e.preventDefault();
        rightDragStart.current = { x: e.clientX, y: e.clientY };
        lastDragPos.current = { x: e.clientX, y: e.clientY };
        isRightDragging.current = false;
        return;
    }

    if (e.button === 0) { 
      if (commandMode === 'ATTACK') {
          const pos = getWorldPos(e.clientX, e.clientY);
          // Check Visibility for interaction
          const allEntities = Array.from(gameStateRef.current.entities.values());
          const playerUnits = allEntities.filter(e => e.owner === Owner.PLAYER);

          const clickedEntity = allEntities.find(ent => {
             const dist = Math.sqrt(Math.pow(ent.position.x - pos.x, 2) + Math.pow(ent.position.y - pos.y, 2));
             if (dist < ent.radius + 15) {
                 return isEntityVisible(ent, playerUnits);
             }
             return false;
          });
          
          gameStateRef.current.selection.forEach(id => {
              const unit = gameStateRef.current.entities.get(id);
              if (unit && unit.owner === Owner.PLAYER) {
                  unit.state = 'ATTACKING';
                  unit.targetPosition = pos; // Default Attack Move to ground
                  unit.targetId = null;

                  if (clickedEntity && clickedEntity.owner !== Owner.PLAYER) {
                      unit.targetId = clickedEntity.id;
                      unit.targetPosition = null;
                  }

                  gameStateRef.current.markers.push({
                      id: `mk_${Math.random()}`,
                      position: clickedEntity ? clickedEntity.position : pos,
                      type: 'ATTACK',
                      life: 20, maxLife: 20
                  });
              }
          });
          setCommandMode(null);
          playSound('click');
          return;
      }

      if (commandMode && commandMode.startsWith('BUILD_')) {
          const type = commandMode.replace('BUILD_', '') as EntityType;
          const pos = getWorldPos(e.clientX, e.clientY);
          const stats = STATS[type];
          
          if (gameStateRef.current.resources[Owner.PLAYER] >= stats.cost) {
             gameStateRef.current.resources[Owner.PLAYER] -= stats.cost;
             const b = createEntity(type, Owner.PLAYER, pos);
             b.constructionProgress = 0; 
             gameStateRef.current.entities.set(b.id, b);
             setCommandMode(null);
             playSound('build');
          } else {
              addNotification(gameStateRef.current, "Not Enough Minerals!");
              playSound('error');
          }
          return;
      }
      
      const worldPos = getWorldPos(e.clientX, e.clientY);
      mouseDownStateRef.current = {
          screen: { x: e.clientX, y: e.clientY },
          world: worldPos
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    mousePosRef.current = { x: e.clientX, y: e.clientY };
    
    if (gameStateRef.current.paused) return;

    if (isDraggingCamera.current) {
        const dx = e.clientX - lastDragPos.current.x;
        const dy = e.clientY - lastDragPos.current.y;
        gameStateRef.current.camera.x -= dx;
        gameStateRef.current.camera.y -= dy;
        lastDragPos.current = { x: e.clientX, y: e.clientY };
        return;
    }

    if (e.buttons === 2) {
        const dist = Math.sqrt(Math.pow(e.clientX - rightDragStart.current.x, 2) + Math.pow(e.clientY - rightDragStart.current.y, 2));
        if (dist > 5) {
            isRightDragging.current = true;
        }

        if (isRightDragging.current) {
            const dx = e.clientX - lastDragPos.current.x;
            const dy = e.clientY - lastDragPos.current.y;
            gameStateRef.current.camera.x -= dx;
            gameStateRef.current.camera.y -= dy;
            lastDragPos.current = { x: e.clientX, y: e.clientY };
        }
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
     if (gameStateRef.current.paused) return;

     if (e.button === 1) {
         isDraggingCamera.current = false;
         return;
     }

     if (e.button === 2) { 
         e.preventDefault();
         if (!isRightDragging.current) {
             const pos = getWorldPos(e.clientX, e.clientY);
             
             // Check Visibility for Interaction
             const allEntities = Array.from(gameStateRef.current.entities.values());
             const playerUnits = allEntities.filter(e => e.owner === Owner.PLAYER && e.state !== 'GARRISONED');
             
             const clickedEntity = allEntities.find(ent => {
                 const dist = Math.sqrt(Math.pow(ent.position.x - pos.x, 2) + Math.pow(ent.position.y - pos.y, 2));
                 if (dist < ent.radius + 15) {
                     return isEntityVisible(ent, playerUnits);
                 }
                 return false;
             });

             const hasBuildingsSelected = gameStateRef.current.selection.some(id => {
                 const ent = gameStateRef.current.entities.get(id);
                 return ent && ent.owner === Owner.PLAYER && (ent.type === EntityType.BASE || ent.type === EntityType.BARRACKS);
             });

             if (hasBuildingsSelected) {
                  gameStateRef.current.selection.forEach(id => {
                      const ent = gameStateRef.current.entities.get(id);
                      if (ent && ent.owner === Owner.PLAYER && (ent.type === EntityType.BASE || ent.type === EntityType.BARRACKS)) {
                          window.dispatchEvent(new CustomEvent('GAME_COMMAND', {
                              detail: { action: 'SET_RALLY', id: ent.id, pos, targetId: clickedEntity ? clickedEntity.id : null }
                          }));
                      }
                  });
             } else {
                 playSound('click');
                 gameStateRef.current.selection.forEach(id => {
                    const unit = gameStateRef.current.entities.get(id);
                    if (unit && unit.owner === Owner.PLAYER) {
                       if (clickedEntity) {
                           if (clickedEntity.owner === Owner.NEUTRAL && clickedEntity.type === EntityType.MINERAL && unit.type === EntityType.WORKER) {
                               unit.state = 'GATHERING';
                               unit.targetId = clickedEntity.id;
                               unit.targetPosition = null;
                               gameStateRef.current.markers.push({ id: `mk_${Math.random()}`, position: { ...clickedEntity.position }, type: 'MOVE', life: 20, maxLife: 20 });
                           } else if (clickedEntity.owner !== Owner.PLAYER && (unit.type === EntityType.MARINE || unit.type === EntityType.MEDIC)) {
                               // Medic won't attack but will move to
                               unit.state = unit.type === EntityType.MEDIC ? 'MOVING' : 'ATTACKING';
                               unit.targetId = clickedEntity.id;
                               unit.targetPosition = null;
                               gameStateRef.current.markers.push({ id: `mk_${Math.random()}`, position: { ...clickedEntity.position }, type: 'ATTACK', life: 20, maxLife: 20 });
                           } else if (clickedEntity.owner !== Owner.PLAYER && unit.type === EntityType.WORKER) {
                               unit.state = 'ATTACKING';
                               unit.targetId = clickedEntity.id;
                               gameStateRef.current.markers.push({ id: `mk_${Math.random()}`, position: { ...clickedEntity.position }, type: 'ATTACK', life: 20, maxLife: 20 });
                           } else if (clickedEntity.owner === Owner.PLAYER && clickedEntity.type === EntityType.BUNKER && unit.type === EntityType.MARINE) {
                               // Load into Bunker
                               unit.state = 'ENTERING';
                               unit.targetId = clickedEntity.id;
                               unit.targetPosition = null;
                               gameStateRef.current.markers.push({ id: `mk_${Math.random()}`, position: { ...clickedEntity.position }, type: 'LOAD', life: 20, maxLife: 20 });
                           }
                       } else {
                           unit.state = 'MOVING';
                           unit.targetPosition = pos;
                           unit.targetId = null;
                           gameStateRef.current.markers.push({ id: `mk_${Math.random()}`, position: { ...pos }, type: 'MOVE', life: 20, maxLife: 20 });
                       }
                    }
                 });
             }
             setCommandMode(null);
         }
         isRightDragging.current = false;
         return;
     }

     if (e.button === 0 && mouseDownStateRef.current) {
         const screenDiffX = Math.abs(e.clientX - mouseDownStateRef.current.screen.x);
         const screenDiffY = Math.abs(e.clientY - mouseDownStateRef.current.screen.y);
         const isClick = (screenDiffX < 5 && screenDiffY < 5);
         const currentWorldPos = getWorldPos(e.clientX, e.clientY);
         const startWorld = mouseDownStateRef.current.world;
         
         const minX = Math.min(startWorld.x, currentWorldPos.x);
         const maxX = Math.max(startWorld.x, currentWorldPos.x);
         const minY = Math.min(startWorld.y, currentWorldPos.y);
         const maxY = Math.max(startWorld.y, currentWorldPos.y);

         const newSelection: string[] = [];
         
         // Only select Visible things (own units are always visible)
         const allEntities = Array.from(gameStateRef.current.entities.values());
         const playerUnits = allEntities.filter(e => e.owner === Owner.PLAYER && e.state !== 'GARRISONED');

         gameStateRef.current.entities.forEach(ent => {
             if (ent.type === EntityType.MOUNTAIN || ent.type === EntityType.WATER) return; 
             if (ent.state === 'GARRISONED') return; // Cannot select garrisoned units directly

             // Must be visible to be selected
             if (!isEntityVisible(ent, playerUnits)) return;

             if (!isClick && ent.owner !== Owner.PLAYER) return; 
             
             if (isClick) {
                 const dx = ent.position.x - currentWorldPos.x;
                 const dy = ent.position.y - currentWorldPos.y;
                 if (Math.sqrt(dx*dx + dy*dy) < ent.radius + 15) { 
                     newSelection.push(ent.id);
                 }
             } else {
                 if (ent.position.x > minX && ent.position.x < maxX && 
                     ent.position.y > minY && ent.position.y < maxY) {
                         if (ent.owner === Owner.PLAYER) newSelection.push(ent.id);
                     }
             }
         });
         
         if (isClick) playSound('click');

         if (isClick && newSelection.length > 1) {
             gameStateRef.current.selection = [newSelection[0]];
         } else {
             gameStateRef.current.selection = newSelection;
         }
         
         if (!isClick && newSelection.length > 0) {
             const units = newSelection.filter(id => {
                 const t = gameStateRef.current.entities.get(id)?.type;
                 return t !== EntityType.BASE && t !== EntityType.BARRACKS && t !== EntityType.SUPPLY_DEPOT && t !== EntityType.BUNKER;
             });
             if (units.length > 0) gameStateRef.current.selection = units;
         }
         
         const selectedEntities = gameStateRef.current.selection
            .map(id => gameStateRef.current.entities.get(id)!)
            .filter(Boolean);

         onSelectionChange(selectedEntities);
         mouseDownStateRef.current = null;
     }
  };
  
  const handleMouseLeave = () => {
     mouseDownStateRef.current = null;
     isDraggingCamera.current = false;
     isRightDragging.current = false;
     mousePosRef.current = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  };

  return (
    <canvas
      ref={canvasRef}
      width={window.innerWidth}
      height={window.innerHeight}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onContextMenu={(e) => e.preventDefault()}
      className={`block ${commandMode === 'ATTACK' ? 'cursor-crosshair' : 'cursor-default'}`}
    />
  );
};