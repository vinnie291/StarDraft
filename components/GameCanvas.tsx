
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GameState, GameEntity, EntityType, Owner, Vector2, Marker, Difficulty, NetMessage } from '../types';
import { STATS, GAME_WIDTH, GAME_HEIGHT, UI_TOP_HEIGHT } from '../constants';
import { updateGame, initGame, createEntity, addNotification } from '../services/gameLogic';
import { playSound } from '../services/audio';
import { network } from '../services/network';

interface Props {
  onGameStateUpdate: (state: GameState) => void;
  onSelectionChange: (selected: GameEntity[]) => void;
  commandMode: string | null;
  setCommandMode: (mode: string | null) => void;
  isMultiplayer?: boolean;
  gameSeed?: number;
  isHost?: boolean;
  difficulty?: Difficulty;
  noRushSeconds?: number;
}

// Generate terrain texture once
const renderTerrain = () => {
    const canvas = document.createElement('canvas');
    canvas.width = GAME_WIDTH;
    canvas.height = GAME_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    // 1. Base Ground
    ctx.fillStyle = '#1c1917'; // Dark stone/dirt
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // 2. Noise/Dust
    for (let i = 0; i < 40000; i++) {
        const x = Math.random() * GAME_WIDTH;
        const y = Math.random() * GAME_HEIGHT;
        const s = Math.random() * 3 + 1;
        ctx.fillStyle = Math.random() > 0.5 ? '#292524' : '#0c0a09';
        ctx.globalAlpha = 0.3;
        ctx.fillRect(x, y, s, s);
    }

    // 3. Subtle Grid Overlay
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.1;
    for (let x = 0; x <= GAME_WIDTH; x += 100) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, GAME_HEIGHT); ctx.stroke();
    }
    for (let y = 0; y <= GAME_HEIGHT; y += 100) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(GAME_WIDTH, y); ctx.stroke();
    }
    
    // 4. Craters / Details
    ctx.globalAlpha = 0.2;
    for (let i = 0; i < 50; i++) {
        const cx = Math.random() * GAME_WIDTH;
        const cy = Math.random() * GAME_HEIGHT;
        const r = Math.random() * 50 + 20;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#444'; // Highlight edge
        ctx.beginPath();
        ctx.arc(cx + 2, cy + 2, r * 0.9, 0, Math.PI * 2);
        ctx.fill();
    }

    return canvas;
};

const isEntityVisible = (entity: GameEntity, playerUnits: GameEntity[]) => {
    if (entity.owner === Owner.PLAYER) return true;
    if (entity.owner === Owner.NEUTRAL) {
        if (entity.type === EntityType.MINERAL && entity.resourceAmount! <= 0) return false;
        return true;
    }
    for(const pu of playerUnits) {
        const dx = entity.position.x - pu.position.x;
        const dy = entity.position.y - pu.position.y;
        if (dx*dx + dy*dy < 250000) return true; // 500 range
    }
    return false;
};

const drawUnit = (ctx: CanvasRenderingContext2D, entity: GameEntity, isSelected: boolean, isHovered: boolean = false) => {
    ctx.save();
    ctx.translate(entity.position.x, entity.position.y);
    
    const isPlayer = entity.owner === Owner.PLAYER;
    const isEnemy = entity.owner === Owner.AI || entity.owner === Owner.OPPONENT;
    const primaryColor = isPlayer ? '#3b82f6' : (isEnemy ? '#ef4444' : '#9ca3af'); // Blue : Red : Gray
    
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(3, 3, entity.radius, entity.radius * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();

    const isUnderConstruction = entity.constructionProgress !== undefined && entity.constructionProgress < 100;

    // Construction Scaffold
    if (isUnderConstruction) {
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = '#fbbf24';
        ctx.setLineDash([4, 2]);
        ctx.strokeRect(-entity.radius, -entity.radius, entity.radius*2, entity.radius*2);
        ctx.setLineDash([]);
        ctx.globalAlpha = 1.0;
    }

    ctx.save();
    if (isUnderConstruction) {
        const gridSize = 10;
        const cols = Math.ceil((entity.radius * 2) / gridSize);
        const rows = Math.ceil((entity.radius * 2) / gridSize);
        const totalBlocks = cols * rows;
        const blocksToDraw = Math.floor((entity.constructionProgress! / 100) * totalBlocks);
        
        ctx.beginPath();
        let drawn = 0;
        for (let r = rows - 1; r >= 0; r--) {
            for (let c = 0; c < cols; c++) {
                if (drawn < blocksToDraw) {
                    ctx.rect(-entity.radius + c * gridSize, -entity.radius + r * gridSize, gridSize, gridSize);
                    drawn++;
                }
            }
        }
        ctx.clip();
    }

    // Normal Rendering
    if (entity.type === EntityType.WORKER) {
        // Body
        const grad = ctx.createRadialGradient(-2, -2, 1, 0, 0, 8);
        grad.addColorStop(0, '#e5e7eb');
        grad.addColorStop(1, '#9ca3af');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI*2); ctx.fill();
        // Team indicator
        ctx.fillStyle = primaryColor;
        ctx.beginPath(); ctx.arc(0, -3, 3, 0, Math.PI*2); ctx.fill();
        // Resource shard
        if (entity.resourceAmount && entity.resourceAmount > 0) {
            ctx.fillStyle = '#06b6d4'; // Cyan crystal
            ctx.beginPath();
            ctx.moveTo(0, 2);
            ctx.lineTo(4, 5);
            ctx.lineTo(2, 9);
            ctx.lineTo(-2, 9);
            ctx.lineTo(-4, 5);
            ctx.closePath();
            ctx.fill();
            
            ctx.strokeStyle = '#cffafe';
            ctx.lineWidth = 0.5;
            ctx.stroke();
        }
    } else if (entity.type === EntityType.MARINE) {
         ctx.fillStyle = primaryColor;
         ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI*2); ctx.fill();
         // Gun
         ctx.strokeStyle = '#1f2937';
         ctx.lineWidth = 3;
         ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(8, 2); ctx.stroke();
    } else if (entity.type === EntityType.MEDIC) {
         ctx.fillStyle = '#fff';
         ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI*2); ctx.fill();
         // Cross
         ctx.fillStyle = '#ef4444';
         ctx.fillRect(-2, -5, 4, 10);
         ctx.fillRect(-5, -2, 10, 4);
    } else if (entity.type === EntityType.BASE) {
         ctx.fillStyle = isPlayer ? '#1e3a8a' : '#7f1d1d';
         ctx.fillRect(-25, -25, 50, 50);
         ctx.fillStyle = primaryColor;
         ctx.fillRect(-20, -20, 40, 40);
         // Roof detail
         ctx.fillStyle = 'rgba(255,255,255,0.1)';
         ctx.beginPath(); ctx.moveTo(-20, -20); ctx.lineTo(20, 20); ctx.lineTo(-20, 20); ctx.fill();
    } else if (entity.type === EntityType.BARRACKS) {
         ctx.fillStyle = '#374151';
         ctx.fillRect(-20, -20, 40, 40);
         ctx.strokeStyle = primaryColor;
         ctx.lineWidth = 2;
         ctx.strokeRect(-20, -20, 40, 40);
         // Hatch
         ctx.fillStyle = '#111';
         ctx.fillRect(-10, -10, 20, 20);
    } else if (entity.type === EntityType.BUNKER) {
         ctx.fillStyle = '#4b5563';
         // Hexagon
         ctx.beginPath();
         for (let i = 0; i < 6; i++) {
             const angle = (i * Math.PI) / 3;
             ctx.lineTo(Math.cos(angle) * 20, Math.sin(angle) * 20);
         }
         ctx.closePath();
         ctx.fill();
         ctx.strokeStyle = primaryColor;
         ctx.lineWidth = 3;
         ctx.stroke();
         if (entity.garrison && entity.garrison.length > 0) {
             ctx.fillStyle = '#10b981'; // Green slots
             entity.garrison.forEach((_, i) => {
                 ctx.beginPath(); ctx.arc(-10 + i*6, 0, 2, 0, Math.PI*2); ctx.fill();
             });
         }
    } else if (entity.type === EntityType.SUPPLY_DEPOT) {
         ctx.fillStyle = '#374151';
         ctx.fillRect(-15, -15, 30, 30);
         ctx.fillStyle = primaryColor;
         ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI*2); ctx.fill();
    } else if (entity.type === EntityType.MINERAL) {
         ctx.fillStyle = '#06b6d4';
         ctx.beginPath();
         ctx.moveTo(0, -15); 
         ctx.lineTo(5, -5); 
         ctx.lineTo(15, 0); 
         ctx.lineTo(8, 8); 
         ctx.lineTo(10, 15); 
         ctx.lineTo(0, 10); 
         ctx.lineTo(-10, 15); 
         ctx.lineTo(-8, 8); 
         ctx.lineTo(-15, 0); 
         ctx.lineTo(-5, -5);
         ctx.closePath();
         ctx.fill();
         
         // Inner highlight
         ctx.fillStyle = '#67e8f9';
         ctx.beginPath();
         ctx.moveTo(0, -10);
         ctx.lineTo(3, -2);
         ctx.lineTo(8, 0);
         ctx.lineTo(4, 4);
         ctx.lineTo(0, 8);
         ctx.lineTo(-4, 4);
         ctx.lineTo(-8, 0);
         ctx.lineTo(-3, -2);
         ctx.closePath();
         ctx.fill();
         
         ctx.strokeStyle = '#cffafe';
         ctx.lineWidth = 1;
         ctx.stroke();
         // Glow
         if (Math.random() > 0.95) {
             ctx.globalAlpha = 0.5;
             ctx.fillStyle = '#fff';
             ctx.beginPath(); ctx.arc(Math.random()*10-5, Math.random()*10-5, 2, 0, Math.PI*2); ctx.fill();
             ctx.globalAlpha = 1.0;
         }
    } else if (entity.type === EntityType.MOUNTAIN) {
        ctx.fillStyle = '#44403c';
        ctx.beginPath();
        ctx.moveTo(-30, 30); ctx.lineTo(-10, -20); ctx.lineTo(10, 0); ctx.lineTo(30, -30); ctx.lineTo(40, 30);
        ctx.closePath();
        ctx.fill();
    } else if (entity.type === EntityType.WATER) {
        ctx.fillStyle = '#1e3a8a';
        ctx.beginPath(); ctx.arc(0, 0, 25, 0, Math.PI*2); ctx.fill();
    }

    ctx.restore();

    if (isUnderConstruction) {
        // Progress bar for construction
        ctx.fillStyle = '#000';
        ctx.fillRect(-15, -10, 30, 4);
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(-15, -10, 30 * (entity.constructionProgress! / 100), 4);
    }

    // Damage Effects for Buildings
    const isBuilding = STATS[entity.type].speed === 0 && entity.type !== EntityType.MINERAL && entity.type !== EntityType.MOUNTAIN && entity.type !== EntityType.WATER;
    if (isBuilding && !isUnderConstruction) {
        const hpPct = entity.hp / entity.maxHp;
        if (hpPct < 0.5) {
            // Smoke
            ctx.fillStyle = 'rgba(50, 50, 50, 0.5)';
            ctx.beginPath();
            ctx.arc(Math.sin(Date.now() / 200 + entity.position.x) * 5, -10 - Math.cos(Date.now() / 300 + entity.position.y) * 5, 8, 0, Math.PI * 2);
            ctx.fill();
            
            if (hpPct < 0.25) {
                // Fire
                ctx.fillStyle = 'rgba(255, 100, 0, 0.8)';
                ctx.beginPath();
                ctx.arc(Math.cos(Date.now() / 150 + entity.position.x) * 8, -5 + Math.sin(Date.now() / 250 + entity.position.y) * 5, 6, 0, Math.PI * 2);
                ctx.fill();
                
                ctx.fillStyle = 'rgba(255, 200, 0, 0.8)';
                ctx.beginPath();
                ctx.arc(Math.cos(Date.now() / 100 + entity.position.x) * 4, -2 + Math.sin(Date.now() / 200 + entity.position.y) * 3, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // Selection & Health
    if (isSelected || isHovered) {
        if (isSelected) {
            ctx.strokeStyle = '#10b981'; // Green selection
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(0, 0, entity.radius + 6, 0, Math.PI * 2);
            ctx.stroke();
        }

        // HP Bar
        if (entity.hp !== undefined && entity.maxHp !== undefined) {
            const hpPct = entity.hp / entity.maxHp;
            ctx.fillStyle = '#000';
            ctx.fillRect(-12, -entity.radius - 12, 24, 4);
            ctx.fillStyle = hpPct > 0.5 ? '#10b981' : (hpPct > 0.25 ? '#fbbf24' : '#ef4444');
            ctx.fillRect(-12, -entity.radius - 12, 24 * hpPct, 4);
        }
    }

    ctx.restore();
};

export const GameCanvas: React.FC<Props> = ({
  onGameStateUpdate,
  onSelectionChange,
  commandMode,
  setCommandMode,
  isMultiplayer = false,
  gameSeed = 123,
  isHost = true,
  difficulty = Difficulty.MEDIUM,
  noRushSeconds = 0
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const fogCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const stateRef = useRef<GameState | null>(null);
    const requestRef = useRef<number>();
    const keysPressed = useRef<Set<string>>(new Set());
    
    const UI_BOTTOM_OVERLAY_HEIGHT = 256; 
    
    const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
    
    // Mouse Interaction
    const [dragStart, setDragStart] = useState<Vector2 | null>(null);
    const [mousePos, setMousePos] = useState<Vector2 | null>(null);

    const applyCommandLocally = useCallback((action: string, data: any, owner: Owner) => {
        const state = stateRef.current;
        if (!state) return;

        if (action === 'TRAIN') {
            const building = state.entities.get(data.id);
            if (building && building.owner === owner) {
                const stats = STATS[data.type as EntityType];
                const cost = stats.cost;
                const supplyCost = stats.supplyCost || 0;
                
                // Calculate currently used supply + queued supply
                let queuedSupply = 0;
                if (building.trainQueue) {
                    queuedSupply = building.trainQueue.reduce((acc, type) => acc + (STATS[type].supplyCost || 0), 0);
                }
                
                if (state.resources[owner] < cost) {
                    if (owner === Owner.PLAYER) {
                        playSound('error');
                        addNotification(state, 'Not enough minerals');
                    }
                } else if (state.supply[owner].used + queuedSupply + supplyCost > state.supply[owner].max) {
                    if (owner === Owner.PLAYER) {
                        playSound('error');
                        addNotification(state, 'Build more supply depots');
                    }
                } else {
                    if (!building.trainQueue) building.trainQueue = [];
                    building.trainQueue.push(data.type);
                    state.resources[owner] -= cost;
                    if (owner === Owner.PLAYER) playSound('train');
                }
            }
        } else if (action === 'BUILD') {
            const { workerId, type, x, y, entityId } = data;
            const worker = state.entities.get(workerId);
            if (worker && worker.owner === owner) {
                if (worker.state === 'BUILDING') {
                    if (owner === Owner.PLAYER) playSound('error');
                    return;
                }
                const cost = STATS[type as EntityType].cost;
                if (state.resources[owner] >= cost) {
                    let valid = true;
                    if (x < 50 || x > GAME_WIDTH-50 || y < 50 || y > GAME_HEIGHT-50) valid = false;
                    if (valid) {
                        state.resources[owner] -= cost;
                        const b = createEntity(type as EntityType, owner, { x, y }, entityId);
                        b.constructionProgress = 0;
                        state.entities.set(b.id, b);
                        worker.state = 'BUILDING';
                        worker.targetId = b.id;
                        if (owner === Owner.PLAYER) playSound('build');
                    } else {
                        if (owner === Owner.PLAYER) {
                            playSound('error');
                            addNotification(state, 'Invalid building location');
                        }
                    }
                } else {
                    if (owner === Owner.PLAYER) {
                        playSound('error');
                        addNotification(state, 'Not enough minerals');
                    }
                }
            }
        } else if (action === 'RIGHT_CLICK') {
            const { unitIds, targetId, x, y } = data;
            
            if (owner === Owner.PLAYER) {
                state.effects.push({
                    id: `wp_${Math.random()}`,
                    type: 'WAYPOINT',
                    position: { x, y },
                    life: 20,
                    maxLife: 20,
                    scale: 1
                });
            }

            unitIds.forEach((id: string) => {
                const ent = state.entities.get(id);
                if (ent && ent.owner === owner) {
                    if (STATS[ent.type].speed === 0) {
                        ent.rallyPoint = { x, y };
                        ent.rallyTargetId = targetId;
                        if (owner === Owner.PLAYER) playSound('click');
                        return;
                    }

                    if (targetId) {
                        const target = state.entities.get(targetId);
                        if (target) {
                            if (target.owner === Owner.NEUTRAL && target.type === EntityType.MINERAL && ent.type === EntityType.WORKER) {
                                ent.state = 'GATHERING';
                                ent.targetId = target.id;
                                if (owner === Owner.PLAYER) playSound('click');
                            } else if (target.owner !== owner && target.owner !== Owner.NEUTRAL) {
                                ent.state = 'ATTACKING';
                                ent.targetId = target.id;
                                if (owner === Owner.PLAYER) playSound('click');
                            } else if (target.type === EntityType.BUNKER && target.owner === owner && ent.type !== EntityType.WORKER) {
                                ent.state = 'ENTERING';
                                ent.targetId = target.id;
                                if (owner === Owner.PLAYER) playSound('click');
                            } else if (target.type === EntityType.MEDIC && target.owner === owner) {
                                ent.state = 'MOVING';
                                ent.targetPosition = { x, y };
                                if (owner === Owner.PLAYER) playSound('click');
                            } else if (target.owner === owner && target.constructionProgress !== undefined && target.constructionProgress < 100 && ent.type === EntityType.WORKER) {
                                ent.state = 'BUILDING';
                                ent.targetId = target.id;
                                if (owner === Owner.PLAYER) playSound('click');
                            } else {
                                ent.state = 'MOVING';
                                ent.targetPosition = { x, y };
                                ent.targetId = null; 
                                if (owner === Owner.PLAYER) playSound('click');
                            }
                        }
                    } else {
                        ent.state = 'MOVING';
                        ent.targetPosition = { x, y };
                        ent.targetId = null;
                        if (owner === Owner.PLAYER) playSound('click');
                    }
                }
            });
        } else if (action === 'STOP') {
            const { unitIds } = data;
            unitIds.forEach((id: string) => {
                const ent = state.entities.get(id);
                if (ent && ent.owner === owner) {
                    ent.state = 'IDLE';
                    ent.targetId = null;
                    ent.targetPosition = null;
                    ent.rallyPoint = null;
                }
            });
            if (owner === Owner.PLAYER) playSound('click');
        } else if (action === 'MINIMAP_ACTION') {
            const { unitIds, x, y } = data;
            const targetPos = { x, y };

            if (owner === Owner.PLAYER) {
                state.effects.push({
                    id: `wp_${Math.random()}`,
                    type: 'WAYPOINT',
                    position: { x, y },
                    life: 20,
                    maxLife: 20,
                    scale: 1
                });
            }

            unitIds.forEach((id: string) => {
                const ent = state.entities.get(id);
                if (ent && ent.owner === owner) {
                     if (STATS[ent.type].damage > 0) {
                         ent.state = 'ATTACKING';
                         ent.targetPosition = targetPos;
                         ent.targetId = null;
                         ent.rallyPoint = targetPos; 
                         if (owner === Owner.PLAYER) playSound('click');
                     } else {
                         ent.state = 'MOVING';
                         ent.targetPosition = targetPos;
                         ent.rallyPoint = targetPos;
                         if (owner === Owner.PLAYER) playSound('click');
                     }
                }
            });
        } else if (action === 'UNLOAD_ALL') {
            const { id } = data;
            const bunker = state.entities.get(id);
            if (bunker && bunker.owner === owner && bunker.garrison && bunker.garrison.length > 0) {
                 bunker.garrison.forEach((uid, i) => {
                     const unit = state.entities.get(uid);
                     if (unit) {
                         unit.state = 'IDLE';
                         unit.containerId = null;
                         const angle = (i * Math.PI) / 2;
                         unit.position = {
                             x: bunker.position.x + Math.cos(angle) * 50,
                             y: bunker.position.y + Math.sin(angle) * 50
                         };
                     }
                 });
                 bunker.garrison = [];
                 if (owner === Owner.PLAYER) playSound('click');
            }
        } else if (action === 'TOGGLE_PAUSE') {
            state.paused = !state.paused;
        }
    }, []);

    const issueCommand = useCallback((action: string, data: any) => {
        if (action === 'BUILD' && !data.entityId) {
            data.entityId = `bld_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        }
        if (isMultiplayer) {
            network.send({ type: 'GAME_COMMAND', payload: { action, data } });
        }
        applyCommandLocally(action, data, Owner.PLAYER);
    }, [isMultiplayer, applyCommandLocally]);

    useEffect(() => {
        const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Keyboard Listeners
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            keysPressed.current.add(e.code);
            if ((e.target as HTMLElement).tagName === 'INPUT') return;
            const key = e.key.toUpperCase();
            
            if (key === 'A') setCommandMode('ATTACK');
            if (key === 'ESCAPE') setCommandMode(null);
            if (key === 'S') {
                if (stateRef.current && stateRef.current.selection.length > 0) {
                    issueCommand('STOP', { unitIds: stateRef.current.selection });
                }
            }
            if (key === 'P') { 
                if (stateRef.current) {
                    issueCommand('TOGGLE_PAUSE', {});
                    onGameStateUpdate({...stateRef.current}); 
                }
            }

            if (stateRef.current) {
                // 1: Select Worker
                if (key === '1') {
                    const ents = Array.from(stateRef.current.entities.values()) as GameEntity[];
                    const workers = ents.filter(e => e.owner === Owner.PLAYER && e.type === EntityType.WORKER);
                    
                    let target = workers.find(w => w.state === 'IDLE');
                    if (!target) target = workers.find(w => w.state === 'GATHERING');
                    if (!target && workers.length > 0) target = workers[0];
                    
                    if (target) {
                        stateRef.current.selection = [target.id];
                        onSelectionChange([target]);
                        playSound('click');
                    }
                }

                // 2: Select Army
                if (key === '2') {
                    const ents = Array.from(stateRef.current.entities.values()) as GameEntity[];
                    const army = ents.filter(e => e.owner === Owner.PLAYER && (e.type === EntityType.MARINE || e.type === EntityType.MEDIC));
                    if (army.length > 0) {
                        const ids = army.map(u => u.id);
                        stateRef.current.selection = ids;
                        onSelectionChange(army);
                        playSound('click');
                    }
                }

                // Space: Center Camera
                if (key === ' ') {
                    e.preventDefault();
                    if (stateRef.current.selection.length > 0) {
                        const id = stateRef.current.selection[0];
                        const ent = stateRef.current.entities.get(id);
                        if (ent && canvasRef.current) {
                            stateRef.current.camera.x = ent.position.x - window.innerWidth / 2;
                            stateRef.current.camera.y = ent.position.y - window.innerHeight / 2;
                        }
                    } else {
                        const base = Array.from(stateRef.current.entities.values()).find((e: GameEntity) => e.owner === Owner.PLAYER && e.type === EntityType.BASE);
                        if (base && canvasRef.current) {
                            stateRef.current.camera.x = base.position.x - window.innerWidth / 2;
                            stateRef.current.camera.y = base.position.y - window.innerHeight / 2;
                        }
                    }
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
    }, [setCommandMode, onSelectionChange, onGameStateUpdate, issueCommand]);

    // Initialize Game
    useEffect(() => {
        const initialState = initGame(difficulty, isMultiplayer, gameSeed, isHost, noRushSeconds);
        stateRef.current = initialState;
        onGameStateUpdate(initialState);
        
        // Render terrain once
        terrainCanvasRef.current = renderTerrain();

        // Reset
        setCommandMode(null);
        onSelectionChange([] as GameEntity[]);

        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [gameSeed, isMultiplayer, isHost, difficulty, noRushSeconds]);

    // Game Loop
    const loop = useCallback(() => {
        if (!stateRef.current) return;
        
        // 1. Update Game Logic
        if (!stateRef.current.paused && !stateRef.current.victory) {
            stateRef.current = updateGame(stateRef.current);
            
            if (isMultiplayer && isHost) {
                if (stateRef.current.gameTime % 10 === 0) {
                    // Send state to client
                    const stateToSend = {
                        entities: Array.from(stateRef.current.entities.values()),
                        resources: stateRef.current.resources,
                        supply: stateRef.current.supply,
                        victory: stateRef.current.victory,
                        paused: stateRef.current.paused
                    };
                    network.send({ type: 'SYNC_STATE', payload: stateToSend });
                }
            }
            onGameStateUpdate(stateRef.current); // Sync to React state for UI
            
            // Play Sounds
            stateRef.current.soundEvents.forEach(evt => {
                if (['shoot', 'explosion', 'train', 'build', 'error', 'click'].includes(evt)) {
                    playSound(evt as any);
                }
            });
            // Clear sound events after playing
            stateRef.current.soundEvents = [];
        }

        // Camera Logic
        const panSpeed = 15;
        if (keysPressed.current.has('ArrowLeft')) stateRef.current.camera.x -= panSpeed;
        if (keysPressed.current.has('ArrowRight')) stateRef.current.camera.x += panSpeed;
        if (keysPressed.current.has('ArrowUp')) stateRef.current.camera.y -= panSpeed;
        if (keysPressed.current.has('ArrowDown')) stateRef.current.camera.y += panSpeed;

        // Camera Clamping Logic
        const maxCamX = Math.max(0, GAME_WIDTH - windowSize.width);
        const maxCamY = Math.max(0, GAME_HEIGHT - windowSize.height + UI_BOTTOM_OVERLAY_HEIGHT);
        stateRef.current.camera.x = Math.max(0, Math.min(stateRef.current.camera.x, maxCamX));
        stateRef.current.camera.y = Math.max(0, Math.min(stateRef.current.camera.y, maxCamY));

        // 2. Render
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx && stateRef.current) {
            const state = stateRef.current;
            
            // Clear
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Camera Transform
            ctx.save();
            ctx.translate(-state.camera.x, -state.camera.y);

            // Draw Terrain
            if (terrainCanvasRef.current) {
                ctx.drawImage(terrainCanvasRef.current, 0, 0);
            }

            // Draw Entities
            // Fix: Explicitly cast Array.from result to GameEntity[] to ensure type safety on entity properties
            const sortedEntities = (Array.from(state.entities.values()) as GameEntity[]).sort((a: GameEntity, b: GameEntity) => a.position.y - b.position.y);
            const playerUnits = sortedEntities.filter((e: GameEntity) => e.owner === Owner.PLAYER);

            let hoveredEntityId: string | null = null;
            if (mousePos) {
                const worldX = mousePos.x + state.camera.x;
                const worldY = mousePos.y + state.camera.y;
                for (let i = sortedEntities.length - 1; i >= 0; i--) {
                    const ent = sortedEntities[i];
                    if (ent.state === 'GARRISONED') continue;
                    if (!isEntityVisible(ent, playerUnits)) continue;
                    const dist = Math.sqrt(Math.pow(ent.position.x - worldX, 2) + Math.pow(ent.position.y - worldY, 2));
                    if (dist < ent.radius + 5) {
                        hoveredEntityId = ent.id;
                        break;
                    }
                }
            }

            sortedEntities.forEach((entity: GameEntity) => {
                if (entity.state === 'GARRISONED') return;
                if (!isEntityVisible(entity, playerUnits)) return;
                
                const isSelected = state.selection.includes(entity.id);
                const isHovered = entity.id === hoveredEntityId;
                drawUnit(ctx, entity, isSelected, isHovered);
            });

            // Draw Effects
            state.effects.forEach(effect => {
                 ctx.save();
                 const lifePct = effect.life / effect.maxLife;
                 const scale = effect.scale * (1.5 - lifePct * 0.5); 
                 
                 if (effect.type === 'EXPLOSION') {
                     ctx.translate(effect.position.x, effect.position.y);
                     ctx.fillStyle = `rgba(255, 100, 0, ${lifePct})`;
                     ctx.beginPath(); ctx.arc(0, 0, 15 * scale, 0, Math.PI*2); ctx.fill();
                     ctx.fillStyle = `rgba(255, 255, 0, ${lifePct})`;
                     ctx.beginPath(); ctx.arc(0, 0, 8 * scale, 0, Math.PI*2); ctx.fill();
                 } else if (effect.type === 'BUILDING_EXPLOSION') {
                     ctx.translate(effect.position.x, effect.position.y);
                     
                     // Main explosion
                     ctx.fillStyle = `rgba(255, 50, 0, ${lifePct})`;
                     ctx.beginPath(); ctx.arc(0, 0, 25 * scale, 0, Math.PI*2); ctx.fill();
                     ctx.fillStyle = `rgba(255, 150, 0, ${lifePct})`;
                     ctx.beginPath(); ctx.arc(0, 0, 15 * scale, 0, Math.PI*2); ctx.fill();
                     ctx.fillStyle = `rgba(255, 255, 200, ${lifePct})`;
                     ctx.beginPath(); ctx.arc(0, 0, 8 * scale, 0, Math.PI*2); ctx.fill();

                     // Debris
                     for (let i = 0; i < 8; i++) {
                         const angle = (Math.PI * 2 / 8) * i + (1 - lifePct) * 2;
                         const dist = 30 * scale * (1 - lifePct);
                         ctx.fillStyle = `rgba(100, 100, 100, ${lifePct})`;
                         ctx.fillRect(Math.cos(angle) * dist - 3, Math.sin(angle) * dist - 3, 6, 6);
                     }
                 } else if (effect.type === 'BLOOD') {
                     ctx.translate(effect.position.x, effect.position.y);
                     ctx.fillStyle = `rgba(180, 0, 0, ${lifePct})`;
                     ctx.beginPath(); ctx.arc(0, 0, 5 * scale, 0, Math.PI*2); ctx.fill();
                 } else if (effect.type === 'HEAL') {
                     ctx.translate(effect.position.x, effect.position.y);
                     ctx.strokeStyle = `rgba(0, 255, 100, ${lifePct})`;
                     ctx.lineWidth = 2;
                     ctx.beginPath(); ctx.arc(0, 0, 10 + (1-lifePct)*10, 0, Math.PI*2); ctx.stroke();
                 } else if (effect.type === 'BULLET' && effect.targetPosition) {
                     ctx.strokeStyle = `rgba(255, 255, 150, ${lifePct})`;
                     ctx.lineWidth = 1.5;
                     ctx.beginPath();
                     ctx.moveTo(effect.position.x, effect.position.y);
                     ctx.lineTo(effect.targetPosition.x, effect.targetPosition.y);
                     ctx.stroke();
                 } else if (effect.type === 'HEAL_BEAM' && effect.targetPosition) {
                     ctx.strokeStyle = `rgba(100, 255, 100, ${lifePct})`;
                     ctx.lineWidth = 2;
                     ctx.shadowBlur = 10;
                     ctx.shadowColor = 'lime';
                     ctx.beginPath();
                     ctx.moveTo(effect.position.x, effect.position.y);
                     ctx.lineTo(effect.targetPosition.x, effect.targetPosition.y);
                     ctx.stroke();
                     ctx.shadowBlur = 0;
                 } else if (effect.type === 'SPARK') {
                     ctx.translate(effect.position.x, effect.position.y);
                     ctx.fillStyle = `rgba(255, 255, 255, ${lifePct})`;
                     const s = 1 + Math.random() * 2;
                     ctx.fillRect(-s/2, -s/2, s, s);
                 } else if (effect.type === 'WAYPOINT') {
                     ctx.translate(effect.position.x, effect.position.y);
                     ctx.strokeStyle = `rgba(16, 185, 129, ${lifePct})`; // Green pulse
                     ctx.lineWidth = 2;
                     ctx.beginPath();
                     ctx.arc(0, 0, 15 * (1 - lifePct), 0, Math.PI * 2);
                     ctx.stroke();
                     
                     ctx.beginPath();
                     ctx.moveTo(-5, -5); ctx.lineTo(5, 5);
                     ctx.moveTo(5, -5); ctx.lineTo(-5, 5);
                     ctx.stroke();
                 }
                 ctx.restore();
            });

            // Draw Fog of War
            if (!fogCanvasRef.current) {
                fogCanvasRef.current = document.createElement('canvas');
            }
            const fogCanvas = fogCanvasRef.current;
            if (fogCanvas.width !== canvas.width || fogCanvas.height !== canvas.height) {
                fogCanvas.width = canvas.width;
                fogCanvas.height = canvas.height;
            }
            const fogCtx = fogCanvas.getContext('2d');
            if (fogCtx) {
                fogCtx.globalCompositeOperation = 'source-over';
                fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
                fogCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                fogCtx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);
                
                fogCtx.globalCompositeOperation = 'destination-out';
                playerUnits.forEach(pu => {
                    const screenX = pu.position.x - state.camera.x;
                    const screenY = pu.position.y - state.camera.y;
                    
                    if (screenX > -600 && screenX < canvas.width + 600 &&
                        screenY > -600 && screenY < canvas.height + 600) {
                        
                        const gradient = fogCtx.createRadialGradient(screenX, screenY, 250, screenX, screenY, 500);
                        gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
                        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
                        
                        fogCtx.fillStyle = gradient;
                        fogCtx.beginPath();
                        fogCtx.arc(screenX, screenY, 500, 0, Math.PI * 2);
                        fogCtx.fill();
                    }
                });
                
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.drawImage(fogCanvas, 0, 0);
                ctx.restore();
            }

            // Draw Selection Box
            if (dragStart && mousePos) {
                 const wx = mousePos.x + state.camera.x;
                 const wy = mousePos.y + state.camera.y;
                 const dx = dragStart.x + state.camera.x;
                 const dy = dragStart.y + state.camera.y;
                 
                 ctx.strokeStyle = '#00ff00';
                 ctx.lineWidth = 1;
                 ctx.strokeRect(dx, dy, wx - dx, wy - dy);
                 ctx.fillStyle = 'rgba(0, 255, 0, 0.1)';
                 ctx.fillRect(dx, dy, wx - dx, wy - dy);
            }
            
            // Draw Rally Points for selected buildings
            state.selection.forEach(id => {
                const ent = state.entities.get(id);
                if (ent && ent.rallyPoint) {
                    ctx.beginPath();
                    ctx.moveTo(ent.position.x, ent.position.y);
                    ctx.lineTo(ent.rallyPoint.x, ent.rallyPoint.y);
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                    ctx.setLineDash([5, 5]);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    
                    ctx.fillStyle = '#fbbf24';
                    ctx.beginPath(); ctx.arc(ent.rallyPoint.x, ent.rallyPoint.y, 3, 0, Math.PI*2); ctx.fill();
                }
            });

            // Draw Ghost Building
            if (commandMode && commandMode.startsWith('BUILD_') && mousePos) {
                const typeStr = commandMode.replace('BUILD_', '');
                const type = typeStr as EntityType;
                
                const worldX = mousePos.x + state.camera.x;
                const worldY = mousePos.y + state.camera.y;
                
                let valid = true;
                if (worldX < 50 || worldX > GAME_WIDTH-50 || worldY < 50 || worldY > GAME_HEIGHT-50) valid = false;
                
                const ghostEntity: GameEntity = {
                    id: 'ghost',
                    type: type,
                    owner: Owner.PLAYER,
                    position: { x: worldX, y: worldY },
                    radius: STATS[type].radius,
                    hp: 100,
                    maxHp: 100,
                    targetId: null,
                    targetPosition: null,
                    state: 'IDLE',
                    cooldown: 0,
                    constructionProgress: 100,
                };

                ctx.save();
                ctx.globalAlpha = 0.5;
                drawUnit(ctx, ghostEntity, false);
                
                ctx.globalAlpha = 1.0;
                ctx.translate(worldX, worldY);
                ctx.fillStyle = valid ? 'rgba(0, 255, 0, 0.3)' : 'rgba(255, 0, 0, 0.3)';
                ctx.beginPath();
                ctx.arc(0, 0, ghostEntity.radius, 0, Math.PI*2);
                ctx.fill();
                
                ctx.restore();
            }

            ctx.restore();

            // Draw Notifications
            if (state.notifications.length > 0) {
                ctx.save();
                ctx.font = 'bold 24px monospace';
                ctx.textAlign = 'center';
                
                let yOffset = windowSize.height / 2 - 100;
                
                state.notifications.forEach((notif, index) => {
                    const alpha = Math.min(1, notif.life / 30);
                    ctx.fillStyle = `rgba(239, 68, 68, ${alpha})`; // text-rose-500
                    ctx.shadowColor = 'rgba(0,0,0,0.8)';
                    ctx.shadowBlur = 4;
                    ctx.shadowOffsetX = 2;
                    ctx.shadowOffsetY = 2;
                    ctx.fillText(notif.text, windowSize.width / 2, yOffset + index * 30);
                });
                ctx.restore();
            }
        }

        requestRef.current = requestAnimationFrame(loop);
    }, [dragStart, mousePos, onGameStateUpdate, isMultiplayer, gameSeed, windowSize, commandMode]);

    useEffect(() => {
        requestRef.current = requestAnimationFrame(loop);
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [loop]);

    // Handle Network Messages
    useEffect(() => {
        if (!isMultiplayer) return;

        const handleMsg = (msg: NetMessage) => {
             if (msg.type === 'GAME_COMMAND') {
                 applyCommandLocally(msg.payload.action, msg.payload.data, Owner.OPPONENT);
             } else if (msg.type === 'SYNC_STATE' && !isHost && stateRef.current) {
                 const payload = msg.payload;
                 const swapOwner = (owner: Owner) => {
                     if (owner === Owner.PLAYER) return Owner.OPPONENT;
                     if (owner === Owner.OPPONENT) return Owner.PLAYER;
                     return owner;
                 };

                 const newEntities = new Map<string, GameEntity>();
                 payload.entities.forEach((e: GameEntity) => {
                     newEntities.set(e.id, { ...e, owner: swapOwner(e.owner) });
                 });

                 const newResources = {
                     [Owner.PLAYER]: payload.resources[Owner.OPPONENT],
                     [Owner.OPPONENT]: payload.resources[Owner.PLAYER],
                     [Owner.AI]: payload.resources[Owner.AI]
                 };

                 const newSupply = {
                     [Owner.PLAYER]: payload.supply[Owner.OPPONENT],
                     [Owner.OPPONENT]: payload.supply[Owner.PLAYER],
                     [Owner.AI]: payload.supply[Owner.AI]
                 };

                 let newVictory = payload.victory;
                 if (newVictory) newVictory = swapOwner(newVictory);

                 stateRef.current = {
                     ...stateRef.current,
                     entities: newEntities,
                     resources: newResources,
                     supply: newSupply,
                     victory: newVictory,
                     paused: payload.paused
                 };
             }
        };

        const cleanup = network.subscribe(handleMsg);
        return cleanup;
    }, [isMultiplayer, isHost, applyCommandLocally, onGameStateUpdate]);

    // Handle Global Events (UI Commands)
    useEffect(() => {
        const handleCommand = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            const state = stateRef.current;
            if (!state) return;

            if (detail.action === 'TRAIN') {
                issueCommand('TRAIN', { id: detail.id, type: detail.type });
            }
            else if (detail.action === 'MOVE_CAMERA') {
                 const maxCamX = Math.max(0, GAME_WIDTH - windowSize.width);
                 const maxCamY = Math.max(0, GAME_HEIGHT - windowSize.height + 256); 
                 state.camera.x = Math.max(0, Math.min(maxCamX, detail.x));
                 state.camera.y = Math.max(0, Math.min(maxCamY, detail.y)); 
            }
            else if (detail.action === 'UNLOAD_ALL') {
                 issueCommand('UNLOAD_ALL', { id: detail.id });
            }
            else if (detail.action === 'TOGGLE_PAUSE') {
                 issueCommand('TOGGLE_PAUSE', {});
            }
            else if (detail.action === 'RESTART') {
                if (isMultiplayer) return; // Disable restart in MP for now
                stateRef.current = initGame(detail.difficulty || difficulty, isMultiplayer, Math.random(), isHost, noRushSeconds);
                if (terrainCanvasRef.current) terrainCanvasRef.current = renderTerrain();
                onSelectionChange([] as GameEntity[]);
            }
            else if (detail.action === 'MINIMAP_ACTION') {
                issueCommand('MINIMAP_ACTION', { unitIds: state.selection, x: detail.x, y: detail.y });
            }
            else if (detail.action === 'NOTIFY') {
                playSound('error');
                addNotification(state, detail.text);
            }
        };

        window.addEventListener('GAME_COMMAND', handleCommand);
        return () => window.removeEventListener('GAME_COMMAND', handleCommand);
    }, [isMultiplayer, difficulty, isHost, noRushSeconds, windowSize, issueCommand]);

    // Canvas Inputs
    const handleMouseDown = (e: React.MouseEvent) => {
        if (!stateRef.current) return;
        const rect = canvasRef.current!.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const worldX = x + stateRef.current.camera.x;
        const worldY = y + stateRef.current.camera.y;

        if (e.button === 0) {
            // Left Click
            if (commandMode) {
                if (commandMode === 'ATTACK') {
                    let targetId: string | null = null;
                    const entities = Array.from(stateRef.current.entities.values()) as GameEntity[];
                    const playerUnits = entities.filter((e: GameEntity) => e.owner === Owner.PLAYER);
                    for (let i = entities.length - 1; i >= 0; i--) {
                        const ent = entities[i];
                        if (ent.state === 'GARRISONED') continue;
                        if (!isEntityVisible(ent, playerUnits)) continue;
                        const dist = Math.sqrt(Math.pow(ent.position.x - worldX, 2) + Math.pow(ent.position.y - worldY, 2));
                        if (dist < ent.radius + 5) {
                            targetId = ent.id;
                            break;
                        }
                    }
                    if (targetId) {
                        issueCommand('RIGHT_CLICK', {
                            unitIds: stateRef.current.selection,
                            targetId,
                            x: worldX,
                            y: worldY
                        });
                    } else {
                        issueCommand('MINIMAP_ACTION', {
                            unitIds: stateRef.current.selection,
                            x: worldX,
                            y: worldY
                        });
                    }
                    setCommandMode(null);
                } else if (commandMode.startsWith('BUILD_')) {
                    const typeStr = commandMode.replace('BUILD_', '');
                    const type = typeStr as EntityType;
                    const workerId = stateRef.current.selection.find(id => {
                         const ent = stateRef.current!.entities.get(id);
                         return ent && ent.type === EntityType.WORKER && ent.owner === Owner.PLAYER && ent.state !== 'BUILDING';
                    });
                    
                    if (workerId) {
                        const entityId = `bldg_${Math.random()}`;
                        issueCommand('BUILD', { workerId, type, x: worldX, y: worldY, entityId });
                    } else {
                        playSound('error');
                    }
                    setCommandMode(null);
                }
            } else {
                setDragStart({ x, y });
            }
        } else if (e.button === 2) {
            setCommandMode(null);
            e.preventDefault();
            
            let targetId: string | null = null;
            // Fix: Explicitly cast Array.from result to GameEntity[] to ensure ent properties are available
            const entities = Array.from(stateRef.current.entities.values()) as GameEntity[];
            const playerUnits = entities.filter((e: GameEntity) => e.owner === Owner.PLAYER);
            for (let i = entities.length - 1; i >= 0; i--) {
                const ent = entities[i];
                if (ent.state === 'GARRISONED') continue;
                if (!isEntityVisible(ent, playerUnits)) continue;
                const dist = Math.sqrt(Math.pow(ent.position.x - worldX, 2) + Math.pow(ent.position.y - worldY, 2));
                if (dist < ent.radius + 5) {
                    targetId = ent.id;
                    break;
                }
            }

            issueCommand('RIGHT_CLICK', {
                unitIds: stateRef.current.selection,
                targetId,
                x: worldX,
                y: worldY
            });
        }
    };

    const handleMouseUp = (e: React.MouseEvent) => {
        if (!stateRef.current || !dragStart) {
            setDragStart(null);
            return;
        }

        if (e.button === 0 && !commandMode) {
            const rect = canvasRef.current!.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const dx = Math.abs(x - dragStart.x);
            const dy = Math.abs(y - dragStart.y);
            
            const newSelection: string[] = [];
            const isBox = dx > 5 || dy > 5;
            
            const wx1 = Math.min(x, dragStart.x) + stateRef.current.camera.x;
            const wy1 = Math.min(y, dragStart.y) + stateRef.current.camera.y;
            const wx2 = Math.max(x, dragStart.x) + stateRef.current.camera.x;
            const wy2 = Math.max(y, dragStart.y) + stateRef.current.camera.y;

            stateRef.current.entities.forEach((ent: GameEntity) => {
                 if (ent.owner !== Owner.PLAYER) return; 
                 if (ent.state === 'GARRISONED') return;
                 
                 if (isBox) {
                     if (ent.position.x >= wx1 && ent.position.x <= wx2 && ent.position.y >= wy1 && ent.position.y <= wy2) {
                         newSelection.push(ent.id);
                     }
                 } else {
                     const dist = Math.sqrt(Math.pow(ent.position.x - (x + stateRef.current.camera.x), 2) + Math.pow(ent.position.y - (y + stateRef.current.camera.y), 2));
                     if (dist < ent.radius + 10) {
                         newSelection.push(ent.id);
                     }
                 }
            });
            
            if (!isBox && newSelection.length === 0) {
                 const worldX = x + stateRef.current.camera.x;
                 const worldY = y + stateRef.current.camera.y;
                 let found: GameEntity | null = null;
                 // Fix: Explicitly cast Array.from result to GameEntity[] to ensure ent properties (state, position, radius, id) are correctly typed
                 const allEnts = Array.from(stateRef.current.entities.values()) as GameEntity[];
                 const playerUnits = allEnts.filter((e: GameEntity) => e.owner === Owner.PLAYER);
                 allEnts.forEach((ent: GameEntity) => {
                     if (ent.state === 'GARRISONED') return;
                     if (!isEntityVisible(ent, playerUnits)) return;
                     const dist = Math.sqrt(Math.pow(ent.position.x - worldX, 2) + Math.pow(ent.position.y - worldY, 2));
                     if (dist < ent.radius + 10) found = ent;
                 });
                 if (found) newSelection.push((found as GameEntity).id);
            }

            stateRef.current.selection = newSelection;
            onSelectionChange(newSelection.map(id => stateRef.current!.entities.get(id)!).filter(Boolean));
        }
        setDragStart(null);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        const rect = canvasRef.current!.getBoundingClientRect();
        setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    const handleMouseLeave = () => {
        setMousePos(null);
    };

    return (
        <canvas
            ref={canvasRef}
            width={window.innerWidth}
            height={window.innerHeight}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onContextMenu={(e) => e.preventDefault()}
            className={`block cursor-${commandMode ? 'crosshair' : 'default'}`}
        />
    );
};
