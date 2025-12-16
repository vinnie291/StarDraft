import { STATS, GAME_WIDTH, GAME_HEIGHT, GATHER_TIME, RESOURCE_GATHER_AMOUNT } from '../constants';
import { Entity, EntityType, GameState, Owner, Vector2, Effect, Difficulty, Notification } from '../types';

let idCounter = 0;
export const generateId = () => `ent_${++idCounter}`;

export const createEntity = (type: EntityType, owner: Owner, pos: Vector2): Entity => {
  const stats = STATS[type];
  // 10,000 minerals total per base. 8 patches per base. 1250 per patch.
  const startRes = type === EntityType.MINERAL ? 1250 : 0; 

  return {
    id: generateId(),
    type,
    owner,
    position: { ...pos },
    radius: Math.max(stats.width, stats.height) / 2,
    hp: stats.hp,
    maxHp: stats.hp,
    targetId: null,
    targetPosition: null,
    state: 'IDLE',
    cooldown: 0,
    resourceAmount: startRes,
    trainQueue: [],
    trainProgress: 0,
    constructionProgress: (type === EntityType.MOUNTAIN || type === EntityType.WATER) ? 100 : 100,
    rallyPoint: null,
    rallyTargetId: null,
    lastAttackerId: null,
    garrison: [],
    containerId: null
  };
};

const getDistance = (p1: Vector2, p2: Vector2) => {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
};

const findNearest = (pos: Vector2, entities: Map<string, Entity>, type?: EntityType, owner?: Owner) => {
  let nearest: Entity | null = null;
  let minDist = Infinity;
  entities.forEach(e => {
    if (e.state === 'GARRISONED') return;
    if (type && e.type !== type) return;
    if (owner && e.owner !== owner) return;
    const dist = getDistance(pos, e.position);
    if (dist < minDist) {
      minDist = dist;
      nearest = e;
    }
  });
  return nearest;
};

// Count how many workers are targeting a specific mineral patch
const getWorkerCountForMineral = (mineralId: string, entities: Map<string, Entity>) => {
    let count = 0;
    entities.forEach(e => {
        if (e.type === EntityType.WORKER && (e.state === 'GATHERING' || e.state === 'RETURNING') && e.targetId === mineralId) {
            count++;
        }
    });
    return count;
};

const isBio = (type: EntityType) => type === EntityType.WORKER || type === EntityType.MARINE || type === EntityType.MEDIC;
const isBuilding = (type: EntityType) => type === EntityType.BASE || type === EntityType.BARRACKS || type === EntityType.SUPPLY_DEPOT || type === EntityType.BUNKER;

export const initGame = (difficulty: Difficulty = Difficulty.MEDIUM): GameState => {
  const entities = new Map<string, Entity>();
  const effects: Effect[] = [];

  const add = (e: Entity) => entities.set(e.id, e);

  // --- MAP GENERATION ---
  // Player Start (Bottom Leftish)
  // Randomize start slightly
  const playerBaseX = 150 + Math.random() * 100;
  const playerBaseY = GAME_HEIGHT - (150 + Math.random() * 100);
  const playerBasePos = { x: playerBaseX, y: playerBaseY };

  // AI Start (Top Rightish)
  const aiBaseX = GAME_WIDTH - (150 + Math.random() * 100);
  const aiBaseY = 150 + Math.random() * 100;
  const aiBasePos = { x: aiBaseX, y: aiBaseY };

  const generateCluster = (type: EntityType, count: number, centerX: number, centerY: number, spread: number) => {
      for(let i=0; i<count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * spread;
          const x = centerX + Math.cos(angle) * dist;
          const y = centerY + Math.sin(angle) * dist;
          
          // Keep away from bases
          if (getDistance({x,y}, playerBasePos) < 500) continue;
          if (getDistance({x,y}, aiBasePos) < 500) continue;
          if (x < 50 || x > GAME_WIDTH-50 || y < 50 || y > GAME_HEIGHT-50) continue;

          add(createEntity(type, Owner.NEUTRAL, {x, y}));
      }
  };

  // Randomized Terrain
  const numMountainClusters = 10 + Math.floor(Math.random() * 15);
  for(let i=0; i<numMountainClusters; i++) {
      generateCluster(
          EntityType.MOUNTAIN, 
          5 + Math.floor(Math.random() * 10), 
          Math.random() * GAME_WIDTH, 
          Math.random() * GAME_HEIGHT, 
          100 + Math.random() * 100
      );
  }

  const numWaterClusters = 5 + Math.floor(Math.random() * 8);
  for(let i=0; i<numWaterClusters; i++) {
      generateCluster(
          EntityType.WATER, 
          5 + Math.floor(Math.random() * 10), 
          Math.random() * GAME_WIDTH, 
          Math.random() * GAME_HEIGHT, 
          100 + Math.random() * 100
      );
  }

  // Expansion Minerals (Randomly placed away from bases)
  const numExpansions = 4 + Math.floor(Math.random() * 4);
  for(let i=0; i<numExpansions; i++) {
      let exX = Math.random() * (GAME_WIDTH - 200) + 100;
      let exY = Math.random() * (GAME_HEIGHT - 200) + 100;
      
      // Ensure not too close to bases
      if (getDistance({x:exX, y:exY}, playerBasePos) > 600 && getDistance({x:exX, y:exY}, aiBasePos) > 600) {
          generateCluster(EntityType.MINERAL, 6, exX, exY, 80);
      }
  }

  // --- PLAYER SETUP ---
  const pCenterAngle = Math.atan2((GAME_HEIGHT/2) - playerBasePos.y, (GAME_WIDTH/2) - playerBasePos.x);
  
  for (let i = 0; i < 8; i++) {
    const angle = pCenterAngle - (Math.PI/2) + (i / 7) * Math.PI; // Semicircle
    add(createEntity(EntityType.MINERAL, Owner.NEUTRAL, { 
      x: playerBasePos.x + 200 * Math.cos(angle), 
      y: playerBasePos.y + 200 * Math.sin(angle) 
    }));
  }
  const pBase = createEntity(EntityType.BASE, Owner.PLAYER, playerBasePos);
  add(pBase);
  for (let i = 0; i < 4; i++) {
    const worker = createEntity(EntityType.WORKER, Owner.PLAYER, { x: playerBasePos.x + 60 + i * 20, y: playerBasePos.y - 80 });
    add(worker);
    const mineral = findNearest(worker.position, entities, EntityType.MINERAL, Owner.NEUTRAL);
    if (mineral) {
        worker.state = 'GATHERING';
        worker.targetId = mineral.id;
    }
  }
  const nearestMineral = findNearest(pBase.position, entities, EntityType.MINERAL, Owner.NEUTRAL);
  if (nearestMineral) {
      pBase.rallyPoint = nearestMineral.position;
      pBase.rallyTargetId = nearestMineral.id;
  }

  // --- AI SETUP ---
  const aiCenterAngle = Math.atan2((GAME_HEIGHT/2) - aiBasePos.y, (GAME_WIDTH/2) - aiBasePos.x);
  for (let i = 0; i < 8; i++) {
    const angle = aiCenterAngle - (Math.PI/2) + (i / 7) * Math.PI; 
    add(createEntity(EntityType.MINERAL, Owner.NEUTRAL, { 
      x: aiBasePos.x + 200 * Math.cos(angle), 
      y: aiBasePos.y + 200 * Math.sin(angle) 
    }));
  }
  add(createEntity(EntityType.BASE, Owner.AI, aiBasePos));
  for (let i = 0; i < 4; i++) {
    const w = createEntity(EntityType.WORKER, Owner.AI, { x: aiBasePos.x - 60 - i * 20, y: aiBasePos.y + 80 });
    add(w);
    const m = findNearest(w.position, entities, EntityType.MINERAL, Owner.NEUTRAL);
    if (m) {
        w.state = 'GATHERING';
        w.targetId = m.id;
    }
  }

  const startCameraY = Math.max(0, playerBasePos.y - (typeof window !== 'undefined' ? window.innerHeight / 2 : 400));
  const startCameraX = Math.max(0, playerBasePos.x - (typeof window !== 'undefined' ? window.innerWidth / 2 : 400));
  
  return {
    entities,
    effects,
    markers: [],
    notifications: [],
    soundEvents: [],
    resources: { [Owner.PLAYER]: 50, [Owner.AI]: 50 },
    supply: { 
      [Owner.PLAYER]: { used: 4, max: 10 }, 
      [Owner.AI]: { used: 4, max: 10 } 
    },
    selection: [],
    camera: { x: startCameraX, y: startCameraY },
    gameTime: 0,
    difficulty,
    paused: false
  };
};

const resolveCollisions = (entity: Entity, entities: Map<string, Entity>) => {
  if (entity.state === 'BUILDING' || entity.state === 'GARRISONED') return; 
  if (STATS[entity.type].speed === 0) return; 

  entities.forEach(other => {
    if (entity.id === other.id) return;
    if (other.state === 'GARRISONED') return;
    
    const isStatic = STATS[other.type].speed === 0;
    
    const dist = getDistance(entity.position, other.position);
    const combinedRadius = entity.radius + other.radius;
    const separationRadius = combinedRadius + 5; 
    
    if (dist < separationRadius && dist > 0) {
      const pushStrength = (separationRadius - dist) / separationRadius;
      const angle = Math.atan2(entity.position.y - other.position.y, entity.position.x - other.position.x);
      
      const force = dist < combinedRadius ? 2.0 : 0.5;
      const staticMult = isStatic ? 2.0 : 1.0; 

      entity.position.x += Math.cos(angle) * pushStrength * force * staticMult; 
      entity.position.y += Math.sin(angle) * pushStrength * force * staticMult;
    }
  });
};

const acquireTarget = (entity: Entity, entities: Map<string, Entity>) => {
    const stats = STATS[entity.type];
    let bestTarget: Entity | null = null;
    let bestScore = -Infinity;
    const searchRange = stats.range + 250; 
    
    entities.forEach(e => {
        if (e.state === 'GARRISONED') return;
        if (e.owner !== entity.owner && e.owner !== Owner.NEUTRAL && e.hp > 0 && e.type !== EntityType.MOUNTAIN && e.type !== EntityType.WATER) {
            const d = getDistance(entity.position, e.position);
            if (d < searchRange) {
                let score = 0;
                
                // Priority 1: Retaliate against someone attacking me
                if (e.targetId === entity.id) score += 5000;
                
                // Priority 3: Units > Buildings
                if (!isBuilding(e.type)) score += 1000;
                else score += 100; // Buildings have positive score so they ARE targeted
                
                // Priority 4: Distance (Close is better)
                score -= d;

                if (score > bestScore) {
                    bestScore = score;
                    bestTarget = e;
                }
            }
        }
    });
    return bestTarget;
};

export const addNotification = (state: GameState, text: string) => {
    if (!state.notifications.some(n => n.text === text && n.life > 60)) {
        state.notifications.push({
            id: `not_${Math.random()}`,
            text,
            life: 120 
        });
    }
};

export const updateGame = (state: GameState): GameState => {
  const { entities, resources, supply } = state;
  let newEntities = new Map(entities);
  let newEffects = [...state.effects];
  let newMarkers = [...state.markers];
  let newNotifications = [...state.notifications];
  const soundEvents: string[] = [];
  
  // Recalculate supply
  supply[Owner.PLAYER] = { used: 0, max: 0 };
  supply[Owner.AI] = { used: 0, max: 0 };

  entities.forEach(ent => {
    if (ent.owner === Owner.NEUTRAL) return;
    // Don't count garrisoned units for collisions but maybe for supply? Yes, they exist.
    if (ent.constructionProgress! >= 100) {
        supply[ent.owner].max += STATS[ent.type].supplyProvided;
    }
    supply[ent.owner].used += STATS[ent.type].supplyCost;
  });

  supply[Owner.PLAYER].max = Math.min(supply[Owner.PLAYER].max, 200);
  supply[Owner.AI].max = Math.min(supply[Owner.AI].max, 200);

  // --- ENTITY UPDATE LOOP ---
  entities.forEach(entity => {
    if (entity.type === EntityType.MOUNTAIN || entity.type === EntityType.WATER) return; 
    if (entity.state === 'GARRISONED') return; // Skip updating units inside bunkers

    // 1. Building Construction
    if (entity.constructionProgress! < 100) {
       entity.constructionProgress! += (100 / STATS[entity.type].buildTime);
       if (entity.constructionProgress! >= 100) entity.constructionProgress = 100;
       return; 
    }

    // 2. Unit Production
    if (entity.trainQueue && entity.trainQueue.length > 0) {
       entity.trainProgress!++;
       const unitType = entity.trainQueue[0];
       if (entity.trainProgress! >= STATS[unitType].buildTime) {
          const stats = STATS[unitType];
          if (supply[entity.owner].used + stats.supplyCost <= supply[entity.owner].max) {
             const spawnDir = entity.owner === Owner.PLAYER ? -1 : 1;
             const offset = 80; 
             
             const newUnit = createEntity(unitType, entity.owner, { 
                x: entity.position.x + (Math.random() * 40 - 20), 
                y: entity.position.y + (offset * spawnDir) + (Math.random() * 10) 
             });
             
             // Rally Logic
             if (entity.rallyPoint) {
                 if (newUnit.type === EntityType.WORKER && entity.rallyTargetId) {
                     const target = entities.get(entity.rallyTargetId);
                     if (target && target.type === EntityType.MINERAL) {
                         newUnit.state = 'GATHERING';
                         newUnit.targetId = target.id;
                         newUnit.targetPosition = null;
                     } else {
                         newUnit.state = 'MOVING';
                         newUnit.targetPosition = { ...entity.rallyPoint };
                     }
                 } else {
                     newUnit.state = 'MOVING'; 
                     newUnit.targetPosition = { ...entity.rallyPoint };
                     if (entity.rallyTargetId) {
                         const target = entities.get(entity.rallyTargetId);
                         if (target && target.owner !== entity.owner) {
                             newUnit.state = 'ATTACKING';
                             newUnit.targetId = target.id;
                         }
                     }
                     if (!entity.rallyTargetId && (unitType === EntityType.MARINE || unitType === EntityType.MEDIC)) {
                         // Attack move for soldiers, just move for medic usually but simpler to generic move
                         newUnit.state = unitType === EntityType.MEDIC ? 'MOVING' : 'ATTACKING'; 
                     }
                 }
             } else if (entity.owner === Owner.AI && (unitType === EntityType.MARINE || unitType === EntityType.MEDIC)) {
                newUnit.targetPosition = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
                newUnit.state = 'ATTACKING';
             }

             newEntities.set(newUnit.id, newUnit);
             entity.trainQueue.shift();
             entity.trainProgress = 0;
          } else {
             entity.trainProgress = STATS[unitType].buildTime - 1; 
             if (entity.owner === Owner.PLAYER && state.gameTime % 60 === 0) {
                 addNotification(state, "Supply Capped!");
             }
          }
       }
    }

    const stats = STATS[entity.type];

    // --- BUNKER LOGIC ---
    if (entity.type === EntityType.BUNKER) {
        if (entity.garrison && entity.garrison.length > 0) {
            // Bunker acts as a turret if manned
            // Find target
            let target = entity.targetId ? entities.get(entity.targetId) : null;
            if (!target || target.hp <= 0 || getDistance(entity.position, target.position) > stats.range) {
                target = acquireTarget(entity, entities);
                entity.targetId = target ? target.id : null;
            }

            if (target) {
                const dist = getDistance(entity.position, target.position);
                if (dist <= stats.range) {
                    if (entity.cooldown <= 0) {
                        // All marines inside shoot? Or just base bunker fire rate boosted?
                        // Simple: Bunker fires periodically based on number of marines
                        const marineStats = STATS[EntityType.MARINE];
                        // Damage = 1 Marine shot. Frequency increases with count.
                        // wait time = 30 / count
                        target.hp -= marineStats.damage;
                        entity.cooldown = Math.max(5, 30 / entity.garrison.length);
                        
                        // FX?
                        if (target.hp <= 0) {
                           entity.targetId = null;
                        }
                    }
                }
            }
        }
    }

    // --- MEDIC LOGIC ---
    if (entity.type === EntityType.MEDIC) {
        if (entity.state === 'IDLE' || entity.state === 'MOVING' || entity.state === 'ATTACKING') {
            // Look for heal target
            let healTarget: Entity | null = null;
            let bestHealDist = stats.vision; // Look within vision

            entities.forEach(e => {
                if (e.owner === entity.owner && isBio(e.type) && e.hp < e.maxHp && e.state !== 'GARRISONED') {
                    const d = getDistance(entity.position, e.position);
                    if (d < bestHealDist) {
                        bestHealDist = d;
                        healTarget = e;
                    }
                }
            });

            if (healTarget) {
                const d = getDistance(entity.position, healTarget.position);
                if (d <= stats.range) {
                    entity.state = 'HEALING';
                    entity.targetId = healTarget.id;
                    entity.targetPosition = null; // Stop moving to heal
                } else {
                    // Move towards wounded
                    const angle = Math.atan2(healTarget.position.y - entity.position.y, healTarget.position.x - entity.position.x);
                    entity.position.x += Math.cos(angle) * stats.speed;
                    entity.position.y += Math.sin(angle) * stats.speed;
                }
            }
        }
        
        if (entity.state === 'HEALING') {
            const target = entity.targetId ? entities.get(entity.targetId) : null;
            if (!target || target.hp >= target.maxHp || getDistance(entity.position, target.position) > stats.range + 20) {
                 entity.state = 'IDLE';
                 entity.targetId = null;
            } else {
                 if (entity.cooldown <= 0) {
                     target.hp = Math.min(target.maxHp, target.hp + (stats.healRate || 5));
                     entity.cooldown = stats.attackSpeed;
                     // Heal Effect
                     newEffects.push({
                        id: `fx_${Math.random()}`,
                        type: 'HEAL',
                        position: { ...target.position },
                        life: 20,
                        maxLife: 20,
                        scale: 1
                     });
                 }
            }
        }
    }

    // --- ENTERING BUNKER LOGIC ---
    if (entity.state === 'ENTERING' && entity.targetId) {
        const bunker = entities.get(entity.targetId);
        if (bunker && bunker.type === EntityType.BUNKER && bunker.hp > 0 && bunker.owner === entity.owner) {
             const dist = getDistance(entity.position, bunker.position);
             if (dist < bunker.radius + entity.radius + 10) {
                 if (!bunker.garrison) bunker.garrison = [];
                 if (bunker.garrison.length < 4) {
                     bunker.garrison.push(entity.id);
                     entity.state = 'GARRISONED';
                     entity.containerId = bunker.id;
                     entity.targetId = null;
                     entity.targetPosition = null;
                     soundEvents.push('click'); // Door sound?
                 } else {
                     entity.state = 'IDLE'; // Bunker full
                 }
             } else {
                 // Move to bunker
                 const angle = Math.atan2(bunker.position.y - entity.position.y, bunker.position.x - entity.position.x);
                 entity.position.x += Math.cos(angle) * stats.speed;
                 entity.position.y += Math.sin(angle) * stats.speed;
             }
        } else {
            entity.state = 'IDLE';
        }
    }

    // --- STANDARD ACTION LOGIC ---
    // (Only for non-garrisoned, non-entering units)
    
    // Auto Target
    if (entity.state === 'IDLE' && entity.type !== EntityType.MEDIC && entity.type !== EntityType.WORKER && stats.damage > 0) {
        const target = acquireTarget(entity, entities);
        if (target) {
            entity.targetId = target.id;
            entity.state = 'ATTACKING';
        }
    }

    if (entity.state === 'MOVING' && entity.targetPosition) {
        const dist = getDistance(entity.position, entity.targetPosition);
        if (dist < 10) {
            entity.state = 'IDLE';
            entity.targetPosition = null;
        } else {
            const angle = Math.atan2(entity.targetPosition.y - entity.position.y, entity.targetPosition.x - entity.position.x);
            entity.position.x += Math.cos(angle) * stats.speed;
            entity.position.y += Math.sin(angle) * stats.speed;
        }
    }

    if (entity.state === 'ATTACKING') {
        let target = entity.targetId ? entities.get(entity.targetId) : null;
        
        if (entity.lastAttackerId) {
            const attacker = entities.get(entity.lastAttackerId);
            if (attacker && attacker.hp > 0 && attacker.owner !== entity.owner && attacker.state !== 'GARRISONED') {
                if (!target || isBuilding(target.type) || target.owner === Owner.NEUTRAL) {
                    entity.targetId = attacker.id;
                    target = attacker;
                    entity.targetPosition = null;
                }
            }
            if (state.gameTime % 20 === 0) entity.lastAttackerId = null;
        }

        if (!target || target.hp <= 0 || target.state === 'GARRISONED') {
           entity.targetId = null;
           target = null;
           
           if (entity.targetPosition) {
                if (stats.damage > 0) {
                    const newTarget = acquireTarget(entity, entities);
                    if (newTarget) {
                        entity.targetId = newTarget.id;
                    } else {
                        const dist = getDistance(entity.position, entity.targetPosition);
                        if (dist < 10) {
                            entity.state = 'IDLE';
                            entity.targetPosition = null;
                        } else {
                            const angle = Math.atan2(entity.targetPosition.y - entity.position.y, entity.targetPosition.x - entity.position.x);
                            entity.position.x += Math.cos(angle) * stats.speed;
                            entity.position.y += Math.sin(angle) * stats.speed;
                        }
                    }
                } else {
                    entity.state = 'MOVING';
                }
           } else {
             entity.state = 'IDLE';
           }
        } 
        
        if (target) {
           const dist = getDistance(entity.position, target.position);
           const rangeBuffer = target.radius; 

           if (dist <= stats.range + rangeBuffer) {
              if (entity.cooldown <= 0) {
                  target.hp -= stats.damage;
                  target.lastAttackerId = entity.id; 
                  entity.cooldown = stats.attackSpeed;
                  
                  if (target.state === 'IDLE' && STATS[target.type].damage > 0 && target.owner !== Owner.NEUTRAL) {
                      target.targetId = entity.id;
                      target.state = 'ATTACKING';
                  }
              }
           } else {
              const angle = Math.atan2(target.position.y - entity.position.y, target.position.x - entity.position.x);
              entity.position.x += Math.cos(angle) * stats.speed;
              entity.position.y += Math.sin(angle) * stats.speed;
           }
        }
    }

    // Gathering logic remains similar...
    if (entity.state === 'GATHERING') {
         const target = entity.targetId ? entities.get(entity.targetId) : null;
        
        // Validate target
        if (!target || target.resourceAmount! <= 0) {
            // Find new mineral
            let newRes: Entity | null = null;
            let minDist = Infinity;
            entities.forEach(e => {
                if (e.type === EntityType.MINERAL && e.resourceAmount! > 0) {
                     const dist = getDistance(entity.position, e.position);
                     // Check if patch is full (max 3 workers)
                     if (dist < minDist && getWorkerCountForMineral(e.id, entities) < 3) {
                         minDist = dist;
                         newRes = e;
                     }
                }
            });

            if (newRes) {
                entity.targetId = (newRes as Entity).id;
            } else {
                entity.state = 'IDLE';
            }
        } else {
            // Check if too many workers on this patch, if so, look for another
            if (state.gameTime % 60 === 0 && getWorkerCountForMineral(target.id, entities) > 3) {
                 // Try to find a better one
                 const better = findNearest(entity.position, entities, EntityType.MINERAL, Owner.NEUTRAL);
                 if (better && better.id !== target.id && getWorkerCountForMineral(better.id, entities) < 3) {
                     entity.targetId = better.id;
                     return;
                 }
            }

            const dist = getDistance(entity.position, target.position);
            const reach = entity.radius + target.radius + 15; 
            if (dist <= reach) {
                entity.cooldown++; 
                if (entity.cooldown >= GATHER_TIME) {
                    entity.resourceAmount = (entity.resourceAmount || 0) + RESOURCE_GATHER_AMOUNT;
                    target.resourceAmount! -= RESOURCE_GATHER_AMOUNT;
                    if (target.resourceAmount! <= 0) {
                        newEntities.delete(target.id); // Mineral Depleted
                    }
                    entity.state = 'RETURNING';
                    entity.cooldown = 0;
                    const base = findNearest(entity.position, entities, EntityType.BASE, entity.owner);
                    if (base) entity.targetId = base.id;
                }
            } else {
                const angle = Math.atan2(target.position.y - entity.position.y, target.position.x - entity.position.x);
                entity.position.x += Math.cos(angle) * stats.speed;
                entity.position.y += Math.sin(angle) * stats.speed;
            }
        }
    }

    if (entity.state === 'RETURNING') {
        const base = entity.targetId ? entities.get(entity.targetId) : null;
        if (!base || base.hp <= 0) {
             const newBase = findNearest(entity.position, entities, EntityType.BASE, entity.owner);
             if (newBase) entity.targetId = newBase.id;
             else entity.state = 'IDLE'; 
        } else {
            const dist = getDistance(entity.position, base.position);
            const reach = base.radius + entity.radius + 15;
            if (dist <= reach) {
                resources[entity.owner] += entity.resourceAmount || 0;
                entity.resourceAmount = 0;
                
                entity.state = 'GATHERING';
                const mineral = findNearest(entity.position, entities, EntityType.MINERAL, Owner.NEUTRAL);
                entity.targetId = mineral ? mineral.id : null;
            } else {
                const angle = Math.atan2(base.position.y - entity.position.y, base.position.x - entity.position.x);
                entity.position.x += Math.cos(angle) * stats.speed;
                entity.position.y += Math.sin(angle) * stats.speed;
            }
        }
    }

    if (entity.cooldown > 0 && entity.state !== 'GATHERING') entity.cooldown--;
    
    // Check death
    if (entity.hp <= 0) {
        let effectType: Effect['type'] = 'EXPLOSION';
        let effectScale = entity.radius / 10;
        
        if (isBio(entity.type)) {
            effectType = 'BLOOD';
        } else if (isBuilding(entity.type)) {
            effectType = 'BUILDING_EXPLOSION';
            effectScale = 2.0;
        }

        newEffects.push({
            id: `fx_${Math.random()}`,
            type: effectType,
            position: { ...entity.position },
            life: effectType === 'BUILDING_EXPLOSION' ? 60 : 30,
            maxLife: effectType === 'BUILDING_EXPLOSION' ? 60 : 30,
            scale: effectScale
        });
        soundEvents.push('explosion');
        
        // Eject Garrison
        if (entity.garrison && entity.garrison.length > 0) {
            entity.garrison.forEach(id => {
                const unit = newEntities.get(id);
                if (unit) {
                    unit.state = 'IDLE';
                    unit.containerId = null;
                    // Scatter slightly
                    unit.position = { 
                        x: entity.position.x + (Math.random() * 40 - 20), 
                        y: entity.position.y + (Math.random() * 40 - 20) 
                    };
                }
            });
        }
        
        newEntities.delete(entity.id);
    }

    resolveCollisions(entity, entities);
  });

  // --- UNLOAD COMMAND HANDLING (Deferred state changes) ---
  // Commands are processed in GameCanvas, but if we need a loop check for unloading, we do it here.
  // Actually, we can handle "UNLOAD_ALL" command by simply iterating garrison in command handler or here.
  // Let's assume GameCanvas sets a flag or we handle it via state updates if needed.
  // But strictly, unit updates above handle movement. "UNLOAD" is an instant state change usually.
  
  // --- EFFECTS UPDATE ---
  newEffects = newEffects.filter(fx => {
      fx.life--;
      return fx.life > 0;
  });

  // --- MARKERS UPDATE ---
  newMarkers = newMarkers.filter(mk => {
      mk.life--;
      return mk.life > 0;
  });

  // --- NOTIFICATIONS UPDATE ---
  newNotifications = newNotifications.filter(n => {
      n.life--;
      return n.life > 0;
  });

  // --- AI LOGIC ---
  if (state.gameTime % 30 === 0) {
    runAI(state, newEntities, resources, supply);
  }

  // Check Victory
  let playerBuildings = 0;
  let aiBuildings = 0;
  newEntities.forEach(e => {
      if (e.owner === Owner.PLAYER && isBuilding(e.type)) playerBuildings++;
      if (e.owner === Owner.AI && isBuilding(e.type)) aiBuildings++;
  });

  let victory = undefined;
  if (playerBuildings === 0 && newEntities.size > 0) victory = Owner.AI; 
  if (aiBuildings === 0 && newEntities.size > 0) victory = Owner.PLAYER;

  return {
    ...state,
    entities: newEntities,
    effects: newEffects,
    markers: newMarkers,
    notifications: newNotifications,
    soundEvents,
    gameTime: state.gameTime + 1,
    victory,
    difficulty: state.difficulty,
    paused: state.paused
  };
};

const runAI = (state: GameState, entities: Map<string, Entity>, resources: any, supply: any) => {
  const myUnits = Array.from(entities.values()).filter(e => e.owner === Owner.AI);
  const workers = myUnits.filter(e => e.type === EntityType.WORKER);
  const bases = myUnits.filter(e => e.type === EntityType.BASE);
  const barracks = myUnits.filter(e => e.type === EntityType.BARRACKS);
  const army = myUnits.filter(e => e.type === EntityType.MARINE || e.type === EntityType.MEDIC);
  
  const myMinerals = resources[Owner.AI];
  const mySupply = supply[Owner.AI];

  let maxWorkers = 12;
  let attackThreshold = 10;

  if (state.difficulty === Difficulty.EASY) {
      maxWorkers = 8;
      attackThreshold = 15;
  } else if (state.difficulty === Difficulty.HARD) {
      maxWorkers = 16;
      attackThreshold = 8;
  }

  // 1. Train Workers
  if (workers.length < maxWorkers && bases.length > 0 && myMinerals >= 50 && mySupply.used < mySupply.max) {
      const base = bases.find(b => !b.trainQueue || b.trainQueue.length < 1);
      if (base) {
          if (!base.trainQueue) base.trainQueue = [];
          base.trainQueue.push(EntityType.WORKER);
          resources[Owner.AI] -= 50;
      }
  }

  // 2. Manage Workers
  workers.forEach(w => {
      if (w.state === 'IDLE') {
          const m = findNearest(w.position, entities, EntityType.MINERAL, Owner.NEUTRAL);
          if (m) {
              w.targetId = m.id;
              w.state = 'GATHERING';
          }
      }
  });

  // 3. Build Supply
  if (mySupply.max - mySupply.used <= 2 && myMinerals >= 100) {
      const builder = workers.find(w => w.state === 'GATHERING' || w.state === 'IDLE');
      if (builder) {
          resources[Owner.AI] -= 100;
          const basePos = bases[0]?.position || builder.position;
          const buildPos = { x: basePos.x + (Math.random() - 0.5) * 200, y: basePos.y + (Math.random() - 0.5) * 200 };
          
          const depot = createEntity(EntityType.SUPPLY_DEPOT, Owner.AI, buildPos);
          depot.constructionProgress = 0;
          entities.set(depot.id, depot);
      }
  }

  // 4. Build Barracks
  if (barracks.length < (state.difficulty === Difficulty.HARD ? 5 : 3) && myMinerals >= 150) {
      const builder = workers.find(w => w.state === 'GATHERING' || w.state === 'IDLE');
      if (builder) {
          resources[Owner.AI] -= 150;
          const basePos = bases[0]?.position || builder.position;
          const buildPos = { x: basePos.x + (Math.random() - 0.5) * 300, y: basePos.y + (Math.random() - 0.5) * 300 };
          
          const b = createEntity(EntityType.BARRACKS, Owner.AI, buildPos);
          b.constructionProgress = 0;
          entities.set(b.id, b);
      }
  }

  // 5. Train Army (Marines and Medics)
  if (barracks.length > 0 && myMinerals >= 50 && mySupply.used < mySupply.max) {
      barracks.forEach(b => {
          if ((!b.trainQueue || b.trainQueue.length < 5) && resources[Owner.AI] >= 50 && b.constructionProgress! >= 100) {
              if (!b.trainQueue) b.trainQueue = [];
              // 1 in 4 chance for medic if Hard, else mostly marines
              const type = (Math.random() < 0.25 && resources[Owner.AI] >= 75) ? EntityType.MEDIC : EntityType.MARINE;
              const cost = STATS[type].cost;
              if (resources[Owner.AI] >= cost) {
                  b.trainQueue.push(type);
                  resources[Owner.AI] -= cost;
              }
          }
      });
  }

  // 6. Attack Logic
  if (army.length > attackThreshold) {
      const enemyBase = Array.from(entities.values()).find(e => e.owner === Owner.PLAYER && e.type === EntityType.BASE);
      const anyEnemy = Array.from(entities.values()).find(e => e.owner === Owner.PLAYER);
      const targetPos = enemyBase ? enemyBase.position : (anyEnemy ? anyEnemy.position : { x: 200, y: 1800 });

      army.forEach(unit => {
          if (unit.state !== 'ATTACKING' && unit.state !== 'HEALING') {
             if (unit.type === EntityType.MEDIC) {
                 // Medics just move with army or idle to heal
                 // Simple AI: Medic follows nearest marine
                 if (unit.state === 'IDLE') {
                     const marine = army.find(a => a.type === EntityType.MARINE);
                     if (marine) {
                         unit.state = 'MOVING';
                         unit.targetPosition = marine.position;
                     }
                 }
             } else {
                 unit.state = 'ATTACKING';
                 unit.targetPosition = targetPos;
             }
          }
      });
  }
};