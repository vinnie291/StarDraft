
import { STATS, GAME_WIDTH, GAME_HEIGHT, GATHER_TIME, RESOURCE_GATHER_AMOUNT, FPS } from '../constants';
import { GameEntity, EntityType, GameState, Owner, Vector2, Effect, Difficulty, AIStrategy } from '../types';
import { SeededRandom } from './random';

let idCounter = 0;
export const generateId = (prefix: string = 'ent') => `${prefix}_${++idCounter}_${Math.floor(Math.random()*1000)}`;

export const addNotification = (state: GameState, text: string) => {
    state.notifications.push({
        id: `n_${Math.random()}`,
        text,
        life: 120
    });
};

export const createEntity = (type: EntityType, owner: Owner, pos: Vector2, id?: string): GameEntity => {
  const stats = STATS[type];
  const startRes = type === EntityType.MINERAL ? 1250 : 0; 

  return {
    id: id || generateId(),
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

const findNearest = (pos: Vector2, entities: Map<string, GameEntity>, type?: EntityType, owner?: Owner) => {
  let nearest: GameEntity | null = null;
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

const getWorkerCountForMineral = (mineralId: string, entities: Map<string, GameEntity>) => {
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

export const initGame = (difficulty: Difficulty = Difficulty.MEDIUM, isMultiplayer = false, seed = Math.random() * 10000, isHost = true, noRushSeconds = 0): GameState => {
  const entities = new Map<string, GameEntity>();
  const effects: Effect[] = [];
  const add = (e: GameEntity) => entities.set(e.id, e);
  const rng = new SeededRandom(seed);

  const corners = [
      { x: 150, y: 150 }, 
      { x: GAME_WIDTH - 150, y: 150 }, 
      { x: 150, y: GAME_HEIGHT - 150 }, 
      { x: GAME_WIDTH - 150, y: GAME_HEIGHT - 150 } 
  ];
  
  for (let i = corners.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [corners[i], corners[j]] = [corners[j], corners[i]];
  }
  
  let myBasePos = corners[0];
  let opBasePos = corners[1];

  if (isMultiplayer && !isHost) {
      myBasePos = corners[1];
      opBasePos = corners[0];
  }

  const jitter = (pt: Vector2) => ({
      x: pt.x + (rng.next() - 0.5) * 50,
      y: pt.y + (rng.next() - 0.5) * 50
  });

  myBasePos = jitter(myBasePos);
  opBasePos = jitter(opBasePos);

  const strategies = [AIStrategy.RUSH, AIStrategy.MACRO, AIStrategy.TURTLE];
  const aiStrategy = strategies[Math.floor(rng.next() * strategies.length)];

  const generateCluster = (type: EntityType, count: number, centerX: number, centerY: number, spread: number) => {
      for(let i=0; i<count; i++) {
          const angle = rng.next() * Math.PI * 2;
          const dist = rng.next() * spread;
          const x = centerX + Math.cos(angle) * dist;
          const y = centerY + Math.sin(angle) * dist;
          if (getDistance({x,y}, myBasePos) < 400) continue;
          if (getDistance({x,y}, opBasePos) < 400) continue;
          if (x < 50 || x > GAME_WIDTH-50 || y < 50 || y > GAME_HEIGHT-50) continue;
          add(createEntity(type, Owner.NEUTRAL, {x, y}));
      }
  };

  for(let i=0; i<15; i++) {
      generateCluster(EntityType.MOUNTAIN, 5, rng.range(0, GAME_WIDTH), rng.range(0, GAME_HEIGHT), 150);
  }
  for(let i=0; i<8; i++) {
      generateCluster(EntityType.WATER, 4, rng.range(0, GAME_WIDTH), rng.range(0, GAME_HEIGHT), 120);
  }

  const possibleExpansions = [2, 4, 6, 8];
  const numExpansions = possibleExpansions[Math.floor(rng.next() * possibleExpansions.length)];
  for(let i=0; i<numExpansions; i++) {
      let exX = rng.range(150, GAME_WIDTH - 300);
      let exY = rng.range(150, GAME_HEIGHT - 300);
      let safe = false;
      let attempts = 0;
      while (!safe && attempts < 10) {
          if (getDistance({x:exX, y:exY}, myBasePos) > 700 && getDistance({x:exX, y:exY}, opBasePos) > 700) safe = true;
          else { exX = rng.range(150, GAME_WIDTH - 300); exY = rng.range(150, GAME_HEIGHT - 300); }
          attempts++;
      }
      generateCluster(EntityType.MINERAL, 7, exX, exY, 70);
  }

  const spawnBase = (pos: Vector2, owner: Owner) => {
      const centerAngle = Math.atan2((GAME_HEIGHT/2) - pos.y, (GAME_WIDTH/2) - pos.x);
      for (let i = 0; i < 8; i++) {
        const angle = centerAngle - (Math.PI/2) + (i / 7) * Math.PI; 
        add(createEntity(EntityType.MINERAL, Owner.NEUTRAL, { x: pos.x + 220 * Math.cos(angle), y: pos.y + 220 * Math.sin(angle) }));
      }
      const base = createEntity(EntityType.BASE, owner, pos);
      add(base);
      for (let i = 0; i < 4; i++) {
        const worker = createEntity(EntityType.WORKER, owner, { x: pos.x + (rng.next()-0.5)*50, y: pos.y + (rng.next()-0.5)*50 });
        add(worker);
        const mineral = findNearest(worker.position, entities, EntityType.MINERAL, Owner.NEUTRAL);
        if (mineral) { worker.state = 'GATHERING'; worker.targetId = mineral.id; }
      }
      const nearestMineral = findNearest(base.position, entities, EntityType.MINERAL, Owner.NEUTRAL);
      if (nearestMineral) { base.rallyPoint = nearestMineral.position; base.rallyTargetId = nearestMineral.id; }
  };

  spawnBase(myBasePos, Owner.PLAYER);
  const opponentOwner = isMultiplayer ? Owner.OPPONENT : Owner.AI;
  spawnBase(opBasePos, opponentOwner);

  const startCameraY = Math.max(0, myBasePos.y - (typeof window !== 'undefined' ? window.innerHeight / 2 : 400));
  const startCameraX = Math.max(0, myBasePos.x - (typeof window !== 'undefined' ? window.innerWidth / 2 : 400));
  
  return {
    entities,
    effects,
    markers: [],
    notifications: [],
    soundEvents: [],
    resources: { [Owner.PLAYER]: 50, [Owner.AI]: 50, [Owner.OPPONENT]: 50 },
    supply: { [Owner.PLAYER]: { used: 4, max: 10 }, [Owner.AI]: { used: 4, max: 10 }, [Owner.OPPONENT]: { used: 4, max: 10 } },
    selection: [],
    camera: { x: startCameraX, y: startCameraY },
    gameTime: 0,
    noRushFrames: noRushSeconds * FPS,
    difficulty,
    aiStrategy,
    victory: undefined,
    paused: false,
    isMultiplayer
  };
};

const resolveCollisions = (entity: GameEntity, entities: Map<string, GameEntity>) => {
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

const acquireTarget = (entity: GameEntity, entities: Map<string, GameEntity>, gameTime: number, noRushFrames: number) => {
    const stats = STATS[entity.type];
    let bestTarget: GameEntity | null = null;
    let bestScore = -Infinity;
    const searchRange = Math.max(stats.vision, stats.range + 400); // Acquisition range
    
    entities.forEach(e => {
        if (e.state === 'GARRISONED' || e.hp <= 0) return;
        
        // No Rush Check
        if (noRushFrames > 0 && gameTime < noRushFrames) {
            if (e.owner !== entity.owner && e.owner !== Owner.NEUTRAL) return;
        }

        if (e.owner !== entity.owner && e.owner !== Owner.NEUTRAL && e.hp > 0 && e.type !== EntityType.MOUNTAIN && e.type !== EntityType.WATER) {
            const d = getDistance(entity.position, e.position);
            if (d < searchRange) {
                let score = 0;
                if (e.targetId === entity.id) score += 5000;
                if (!isBuilding(e.type)) score += 1000;
                else score += 100; 
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

export const updateGame = (state: GameState): GameState => {
  const { entities, resources, supply } = state;
  let newEntities = new Map(entities);
  let newEffects = [...state.effects];
  let newMarkers = [...state.markers];
  let newNotifications = [...state.notifications];
  const soundEvents: string[] = [];
  
  supply[Owner.PLAYER] = { used: 0, max: 0 };
  supply[Owner.AI] = { used: 0, max: 0 };
  supply[Owner.OPPONENT] = { used: 0, max: 0 };

  entities.forEach(ent => {
    if (ent.owner === Owner.NEUTRAL) return;
    if (ent.constructionProgress! >= 100) {
        supply[ent.owner].max += STATS[ent.type].supplyProvided;
    }
    supply[ent.owner].used += STATS[ent.type].supplyCost;
  });

  supply[Owner.PLAYER].max = Math.min(supply[Owner.PLAYER].max, 200);
  supply[Owner.AI].max = Math.min(supply[Owner.AI].max, 200);
  supply[Owner.OPPONENT].max = Math.min(supply[Owner.OPPONENT].max, 200);

  entities.forEach(entity => {
    if (entity.type === EntityType.MOUNTAIN || entity.type === EntityType.WATER) return; 
    if (entity.state === 'GARRISONED') return; 

    // Global Cooldown Decrement
    if (entity.cooldown > 0) entity.cooldown--;

    // Construction
    if (entity.constructionProgress! < 100) {
       entity.constructionProgress! += (100 / STATS[entity.type].buildTime);
       if (entity.constructionProgress! >= 100) entity.constructionProgress = 100;
       return; 
    }

    // Production
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
                     } else if (unitType === EntityType.MARINE) {
                         newUnit.state = 'ATTACKING';
                         newUnit.targetPosition = { ...entity.rallyPoint };
                     }
                 }
             }

             newEntities.set(newUnit.id, newUnit);
             entity.trainQueue.shift();
             entity.trainProgress = 0;
          } else {
             entity.trainProgress = STATS[unitType].buildTime - 1; 
          }
       }
    }

    const stats = STATS[entity.type];

    // Bunker Logic
    if (entity.type === EntityType.BUNKER) {
        if (entity.garrison && entity.garrison.length > 0) {
            let target = entity.targetId ? entities.get(entity.targetId) : null;
            if (!target || target.hp <= 0 || getDistance(entity.position, target.position) > stats.range + 50) {
                target = acquireTarget(entity, entities, state.gameTime, state.noRushFrames);
                entity.targetId = target ? target.id : null;
            }
            if (target) {
                const dist = getDistance(entity.position, target.position);
                if (dist <= stats.range + target.radius) {
                    if (entity.cooldown <= 0) {
                        const marineStats = STATS[EntityType.MARINE];
                        target.hp -= (marineStats.damage * entity.garrison.length);
                        entity.cooldown = stats.attackSpeed;
                        if (target.hp <= 0) entity.targetId = null;
                        soundEvents.push('shoot');
                        // Bullet Effect for Bunker
                        newEffects.push({
                            id: `bullet_${Math.random()}`,
                            type: 'BULLET',
                            position: { ...entity.position },
                            targetPosition: { ...target.position },
                            life: 4, maxLife: 4, scale: 1
                        });
                    }
                }
            }
        }
    }

    // Medic Logic
    if (entity.type === EntityType.MEDIC) {
        if (['IDLE', 'MOVING', 'ATTACKING'].includes(entity.state)) {
            let healTarget: GameEntity | null = null;
            let bestHealDist = stats.vision;
            entities.forEach(e => {
                if (e.owner === entity.owner && isBio(e.type) && e.hp < e.maxHp && e.state !== 'GARRISONED') {
                    const d = getDistance(entity.position, e.position);
                    if (d < bestHealDist) { bestHealDist = d; healTarget = e; }
                }
            });
            if (healTarget) {
                const d = getDistance(entity.position, healTarget.position);
                if (d <= stats.range) {
                    entity.state = 'HEALING';
                    entity.targetId = healTarget.id;
                    entity.targetPosition = null; 
                } else {
                    const angle = Math.atan2(healTarget.position.y - entity.position.y, healTarget.position.x - entity.position.x);
                    entity.position.x += Math.cos(angle) * stats.speed;
                    entity.position.y += Math.sin(angle) * stats.speed;
                }
            }
        }
        if (entity.state === 'HEALING') {
            const target = entity.targetId ? entities.get(entity.targetId) : null;
            if (!target || target.hp >= target.maxHp || getDistance(entity.position, target.position) > stats.range + 30) {
                 entity.state = 'IDLE';
                 entity.targetId = null;
            } else {
                 if (entity.cooldown <= 0) {
                     target.hp = Math.min(target.maxHp, target.hp + (stats.healRate || 5));
                     entity.cooldown = stats.attackSpeed;
                     // Heal Beam Effect
                     newEffects.push({ 
                        id: `beam_${Math.random()}`, 
                        type: 'HEAL_BEAM', 
                        position: { ...entity.position }, 
                        targetPosition: { ...target.position }, 
                        life: 6, maxLife: 6, scale: 1 
                    });
                    newEffects.push({ id: `fx_${Math.random()}`, type: 'HEAL', position: { ...target.position }, life: 20, maxLife: 20, scale: 1 });
                 }
            }
        }
    }

    if (entity.state === 'ENTERING' && entity.targetId) {
        const bunker = entities.get(entity.targetId);
        if (bunker && bunker.type === EntityType.BUNKER && bunker.hp > 0 && bunker.owner === entity.owner && bunker.constructionProgress! >= 100) {
             const dist = getDistance(entity.position, bunker.position);
             if (dist < bunker.radius + entity.radius + 15) {
                 if (!bunker.garrison) bunker.garrison = [];
                 if (bunker.garrison.length < 4) {
                     bunker.garrison.push(entity.id);
                     entity.state = 'GARRISONED';
                     entity.containerId = bunker.id;
                     entity.targetId = null;
                     entity.targetPosition = null;
                     soundEvents.push('click'); 
                 } else { entity.state = 'IDLE'; }
             } else {
                 const angle = Math.atan2(bunker.position.y - entity.position.y, bunker.position.x - entity.position.x);
                 entity.position.x += Math.cos(angle) * stats.speed;
                 entity.position.y += Math.sin(angle) * stats.speed;
             }
        } else { entity.state = 'IDLE'; }
    }

    // Auto-Acquire Targets when IDLE
    if (entity.state === 'IDLE' && entity.type !== EntityType.MEDIC && entity.type !== EntityType.WORKER && stats.damage > 0) {
        const target = acquireTarget(entity, entities, state.gameTime, state.noRushFrames);
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

    // ATTACK Logic
    if (entity.state === 'ATTACKING') {
        let target = entity.targetId ? entities.get(entity.targetId) : null;
        
        // Retaliation Logic
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

        // Target Acquisition
        if (!target || target.hp <= 0 || target.state === 'GARRISONED') {
           entity.targetId = null;
           target = null;
           
           if (stats.damage > 0) {
                const newTarget = acquireTarget(entity, entities, state.gameTime, state.noRushFrames);
                if (newTarget) {
                    entity.targetId = newTarget.id;
                    target = newTarget; 
                }
           }

           if (!target && entity.targetPosition) {
                const dist = getDistance(entity.position, entity.targetPosition);
                if (dist < 10) {
                    entity.state = 'IDLE';
                    entity.targetPosition = null;
                } else {
                    const angle = Math.atan2(entity.targetPosition.y - entity.position.y, entity.targetPosition.x - entity.position.x);
                    entity.position.x += Math.cos(angle) * stats.speed;
                    entity.position.y += Math.sin(angle) * stats.speed;
                }
           } else if (!target) {
             entity.state = 'IDLE';
           }
        } 
        
        // Attack Execution
        if (target) {
           const dist = getDistance(entity.position, target.position);
           const engagementRange = stats.range + target.radius;

           if (dist <= engagementRange) {
              if (entity.cooldown <= 0) {
                  target.hp -= stats.damage;
                  target.lastAttackerId = entity.id; 
                  entity.cooldown = stats.attackSpeed;
                  soundEvents.push('shoot');
                  // Bullet Animation
                  newEffects.push({
                      id: `bullet_${Math.random()}`,
                      type: 'BULLET',
                      position: { ...entity.position },
                      targetPosition: { ...target.position },
                      life: 3, maxLife: 3, scale: 1
                  });
                  
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

    if (entity.state === 'GATHERING') {
         const target = entity.targetId ? entities.get(entity.targetId) : null;
        if (!target || target.resourceAmount! <= 0) {
            let newRes: GameEntity | null = null;
            let minDist = Infinity;
            entities.forEach(e => {
                if (e.type === EntityType.MINERAL && e.resourceAmount! > 0) {
                     const dist = getDistance(entity.position, e.position);
                     if (dist < minDist && getWorkerCountForMineral(e.id, entities) < 3) {
                         minDist = dist;
                         newRes = e;
                     }
                }
            });
            if (newRes) entity.targetId = (newRes as GameEntity).id;
            else entity.state = 'IDLE';
        } else {
            const dist = getDistance(entity.position, target.position);
            const reach = entity.radius + target.radius + 15; 
            if (dist <= reach) {
                // Spark Effect while mining
                if (state.gameTime % 8 === 0) {
                    const angle = Math.atan2(target.position.y - entity.position.y, target.position.x - entity.position.x);
                    newEffects.push({
                        id: `spark_${Math.random()}`,
                        type: 'SPARK',
                        position: { 
                            x: entity.position.x + Math.cos(angle) * 12, 
                            y: entity.position.y + Math.sin(angle) * 12 
                        },
                        life: 10, maxLife: 10, scale: 0.5 + Math.random()
                    });
                }

                // Increment gather timer (re-using cooldown as work timer)
                // Note: cooldown is already decremented at start of loop, but we increment it here
                // To avoid interference with attack cooldowns (even though workers rarely attack), 
                // we treat it carefully.
                entity.cooldown += 2; // Counter-act the global decrement + add speed
                if (entity.cooldown >= GATHER_TIME) {
                    entity.resourceAmount = (entity.resourceAmount || 0) + RESOURCE_GATHER_AMOUNT;
                    target.resourceAmount! -= RESOURCE_GATHER_AMOUNT;
                    if (target.resourceAmount! <= 0) newEntities.delete(target.id);
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

    if (entity.hp <= 0) {
        let effectType: Effect['type'] = 'EXPLOSION';
        let effectScale = entity.radius / 10;
        if (isBio(entity.type)) effectType = 'BLOOD';
        else if (isBuilding(entity.type)) { effectType = 'BUILDING_EXPLOSION'; effectScale = 2.0; }

        newEffects.push({
            id: `fx_${Math.random()}`,
            type: effectType,
            position: { ...entity.position },
            life: effectType === 'BUILDING_EXPLOSION' ? 60 : 30,
            maxLife: effectType === 'BUILDING_EXPLOSION' ? 60 : 30,
            scale: effectScale
        });
        soundEvents.push('explosion');
        if (entity.garrison) {
            entity.garrison.forEach(id => {
                const unit = newEntities.get(id);
                if (unit) {
                    unit.state = 'IDLE';
                    unit.containerId = null;
                    unit.position = { x: entity.position.x + (Math.random() * 40 - 20), y: entity.position.y + (Math.random() * 40 - 20) };
                }
            });
        }
        newEntities.delete(entity.id);
    }
    resolveCollisions(entity, entities);
  });

  newEffects = newEffects.filter(fx => { fx.life--; return fx.life > 0; });
  newMarkers = newMarkers.filter(mk => { mk.life--; return mk.life > 0; });
  newNotifications = newNotifications.filter(n => { n.life--; return n.life > 0; });

  if (!state.isMultiplayer && state.gameTime % 30 === 0) runAI(state, newEntities, resources, supply);

  let playerBuildings = 0;
  let opponentBuildings = 0;
  newEntities.forEach(e => {
      if (e.owner === Owner.PLAYER && isBuilding(e.type)) playerBuildings++;
      if ((e.owner === Owner.AI || e.owner === Owner.OPPONENT) && isBuilding(e.type)) opponentBuildings++;
  });

  let victory = undefined;
  if (playerBuildings === 0 && newEntities.size > 0) victory = state.isMultiplayer ? Owner.OPPONENT : Owner.AI; 
  if (opponentBuildings === 0 && newEntities.size > 0) victory = Owner.PLAYER;

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

const runAI = (state: GameState, entities: Map<string, GameEntity>, resources: any, supply: any) => {
  const aiOwner = Owner.AI;
  const playerOwner = Owner.PLAYER;
  
  const myUnits = Array.from(entities.values()).filter(e => e.owner === aiOwner);
  const workers = myUnits.filter(e => e.type === EntityType.WORKER);
  const bases = myUnits.filter(e => e.type === EntityType.BASE);
  const barracks = myUnits.filter(e => e.type === EntityType.BARRACKS);
  const army = myUnits.filter(e => e.type === EntityType.MARINE || e.type === EntityType.MEDIC);
  const strategy = state.aiStrategy;

  let maxWorkers = 14;
  let attackThreshold = 10;
  
  if (strategy === AIStrategy.RUSH) { maxWorkers = 10; attackThreshold = 6; } 
  else if (strategy === AIStrategy.MACRO) { maxWorkers = 20; attackThreshold = 18; } 
  else if (strategy === AIStrategy.TURTLE) { maxWorkers = 14; attackThreshold = 20; }

  if (state.difficulty === Difficulty.EASY) { maxWorkers = 8; attackThreshold = 15; } 

  // Worker training
  if (workers.length < maxWorkers && bases.length > 0 && resources[aiOwner] >= 50 && supply[aiOwner].used < supply[aiOwner].max) {
      const base = bases[0];
      if (base && (!base.trainQueue || base.trainQueue.length < 1)) {
          if (!base.trainQueue) base.trainQueue = [];
          base.trainQueue.push(EntityType.WORKER);
          resources[aiOwner] -= 50;
      }
  }

  // Supply Depots
  if (supply[aiOwner].max - supply[aiOwner].used <= 3 && resources[aiOwner] >= 100) {
      const builder = workers.find(w => w.state === 'GATHERING' || w.state === 'IDLE');
      if (builder) {
          resources[aiOwner] -= 100;
          const depot = createEntity(EntityType.SUPPLY_DEPOT, aiOwner, { x: builder.position.x + 100, y: builder.position.y });
          entities.set(depot.id, depot);
      }
  }

  // Barracks
  if (barracks.length < 3 && resources[aiOwner] >= 150) {
      const builder = workers.find(w => w.state === 'GATHERING');
      if (builder) {
           resources[aiOwner] -= 150;
           const b = createEntity(EntityType.BARRACKS, aiOwner, { x: builder.position.x - 100, y: builder.position.y });
           entities.set(b.id, b);
      }
  }

  // Marine training
  if (barracks.length > 0 && resources[aiOwner] >= 50 && supply[aiOwner].used < supply[aiOwner].max) {
      const b = barracks.find(ba => !ba.trainQueue || ba.trainQueue.length < 2);
      if (b) {
          if (!b.trainQueue) b.trainQueue = [];
          b.trainQueue.push(EntityType.MARINE);
          resources[aiOwner] -= 50;
      }
  }

  // Combat
  if (army.length >= attackThreshold && state.gameTime > state.noRushFrames) {
      const playerBase = Array.from(entities.values()).find(e => e.owner === playerOwner && e.type === EntityType.BASE);
      const targetPos = playerBase ? playerBase.position : { x: 500, y: 500 };

      army.forEach(unit => {
          if (unit.state === 'IDLE') {
              unit.state = 'ATTACKING';
              unit.targetPosition = targetPos;
          }
      });
  }
};
