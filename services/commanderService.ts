import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { GameState, EntityType, Owner, GameEntity } from "../types";
import { STATS, GAME_WIDTH, GAME_HEIGHT } from "../constants";
import { findValidBuildingLocation } from "./gameLogic";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const commanderTool: FunctionDeclaration = {
    name: "executeCommanderAction",
    description: "Execute a strategic action in the game based on the commander's orders.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            action: {
                type: Type.STRING,
                description: "The type of action: 'TRAIN', 'BUILD', 'ATTACK', 'MOVE', 'GATHER', 'STOP'"
            },
            unitType: {
                type: Type.STRING,
                description: "The type of unit to train, or the type of building to build. E.g., 'MARINE', 'MEDIC', 'WORKER', 'BARRACKS', 'SUPPLY_DEPOT', 'BUNKER'"
            },
            quantity: {
                type: Type.NUMBER,
                description: "The number of units to train or select for the action. Defaults to 1 if not specified."
            },
            targetLocation: {
                type: Type.STRING,
                description: "The general direction or target for MOVE, ATTACK, or BUILD. E.g., 'NORTH', 'SOUTH', 'EAST', 'WEST', 'CENTER', 'ENEMY_BASE', 'MY_BASE'"
            }
        },
        required: ["action"]
    }
};

export const processCommanderInput = async (input: string, state: GameState) => {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `You are an AI assistant for a real-time strategy game. The player is the commander.
Interpret their command and call the executeCommanderAction tool.
Player command: "${input}"`,
            config: {
                tools: [{ functionDeclarations: [commanderTool] }],
                temperature: 0.1
            }
        });

        const functionCalls = response.functionCalls;
        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            if (call.name === "executeCommanderAction") {
                const args = call.args as any;
                executeAction(args, state);
                return `Executing: ${args.action} ${args.quantity || ''} ${args.unitType || ''} ${args.targetLocation || ''}`;
            }
        }
        return "Command not understood or no action taken.";
    } catch (error) {
        console.error("Commander Error:", error);
        return "Communication error with high command.";
    }
};

const executeAction = (args: any, state: GameState) => {
    const action = args.action?.toUpperCase();
    const unitType = args.unitType?.toUpperCase();
    const { quantity = 1, targetLocation } = args;
    const playerEntities = Array.from(state.entities.values()).filter(e => e.owner === Owner.PLAYER);
    const enemyEntities = Array.from(state.entities.values()).filter(e => e.owner === Owner.ENEMY);

    const getTargetCoords = (loc: string) => {
        const locUpper = loc?.toUpperCase() || 'CENTER';
        if (locUpper === 'ENEMY_BASE') {
            const enemyBase = enemyEntities.find(e => e.type === EntityType.BASE);
            if (enemyBase) return { x: enemyBase.position.x, y: enemyBase.position.y };
            return { x: GAME_WIDTH - 200, y: 200 }; // Default enemy area
        }
        if (locUpper === 'MY_BASE') {
            const myBase = playerEntities.find(e => e.type === EntityType.BASE);
            if (myBase) return { x: myBase.position.x, y: myBase.position.y };
            return { x: 200, y: GAME_HEIGHT - 200 };
        }
        if (locUpper === 'NORTH') return { x: GAME_WIDTH / 2, y: 100 };
        if (locUpper === 'SOUTH') return { x: GAME_WIDTH / 2, y: GAME_HEIGHT - 100 };
        if (locUpper === 'EAST') return { x: GAME_WIDTH - 100, y: GAME_HEIGHT / 2 };
        if (locUpper === 'WEST') return { x: 100, y: GAME_HEIGHT / 2 };
        return { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 }; // CENTER
    };

    if (action === 'TRAIN' && unitType) {
        let buildingType = EntityType.BASE;
        if (unitType === 'MARINE' || unitType === 'MEDIC') buildingType = EntityType.BARRACKS;
        
        const buildings = playerEntities.filter(e => e.type === buildingType && e.constructionProgress === 100);
        if (buildings.length > 0) {
            window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
                detail: { 
                    action: 'SELECT', 
                    unitIds: [buildings[0].id]
                } 
            }));
            // Distribute training across available buildings
            for (let i = 0; i < quantity; i++) {
                const b = buildings[i % buildings.length];
                window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
                    detail: { action: 'TRAIN', id: b.id, type: unitType } 
                }));
            }
        } else {
            window.dispatchEvent(new CustomEvent('GAME_COMMAND', { detail: { action: 'NOTIFY', text: `Need ${buildingType} to train ${unitType}` } }));
        }
    } 
    else if (action === 'BUILD' && unitType) {
        let workers = playerEntities.filter(e => e.type === EntityType.WORKER && e.state === 'IDLE');
        if (workers.length === 0) {
            const allWorkers = playerEntities.filter(e => e.type === EntityType.WORKER);
            if (allWorkers.length > 0) {
                workers = [allWorkers[Math.floor(Math.random() * allWorkers.length)]];
            }
        }
        
        if (workers.length > 0) {
            const coords = getTargetCoords(targetLocation || 'MY_BASE');
            
            for (let i = 0; i < quantity; i++) {
                const worker = workers[i % workers.length];
                // Offset slightly to avoid building exactly on top of base
                const offsetX = coords.x + (Math.random() * 300 - 150);
                const offsetY = coords.y + (Math.random() * 300 - 150);
                
                const validPos = findValidBuildingLocation(state.entities, unitType as EntityType, { x: offsetX, y: offsetY });
                
                if (validPos) {
                    window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
                        detail: { 
                            action: 'SELECT', 
                            unitIds: [worker.id]
                        } 
                    }));
                    window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
                        detail: { 
                            action: 'BUILD', 
                            workerId: worker.id, 
                            type: unitType, 
                            x: validPos.x, 
                            y: validPos.y,
                            entityId: `ent_${Math.random()}`
                        } 
                    }));
                } else {
                    window.dispatchEvent(new CustomEvent('GAME_COMMAND', { detail: { action: 'NOTIFY', text: `No valid location for ${unitType}` } }));
                }
            }
        } else {
            window.dispatchEvent(new CustomEvent('GAME_COMMAND', { detail: { action: 'NOTIFY', text: `Need a worker to build` } }));
        }
    }
    else if (action === 'ATTACK' || action === 'MOVE') {
        let army = playerEntities.filter(e => e.type === EntityType.MARINE || e.type === EntityType.MEDIC);
        
        if (unitType === 'MARINE') army = army.filter(e => e.type === EntityType.MARINE);
        if (unitType === 'MEDIC') army = army.filter(e => e.type === EntityType.MEDIC);
        
        if (quantity && quantity < army.length) {
            army = army.slice(0, quantity);
        }
        
        const coords = getTargetCoords(targetLocation || (action === 'ATTACK' ? 'ENEMY_BASE' : 'CENTER'));
        
        if (army.length > 0) {
            const unitIds = army.map(u => u.id);
            window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
                detail: { 
                    action: 'SELECT', 
                    unitIds: unitIds
                } 
            }));
            window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
                detail: { 
                    action: action === 'ATTACK' ? 'MINIMAP_ACTION' : 'RIGHT_CLICK', 
                    unitIds: unitIds, 
                    x: coords.x, 
                    y: coords.y 
                } 
            }));
        } else {
            window.dispatchEvent(new CustomEvent('GAME_COMMAND', { detail: { action: 'NOTIFY', text: `No army units available` } }));
        }
    }
    else if (action === 'GATHER') {
        let workers = playerEntities.filter(e => e.type === EntityType.WORKER && e.state === 'IDLE');
        if (workers.length === 0) {
            const allWorkers = playerEntities.filter(e => e.type === EntityType.WORKER);
            if (allWorkers.length > 0) {
                workers = [allWorkers[Math.floor(Math.random() * allWorkers.length)]];
            }
        }
        
        const minerals = Array.from(state.entities.values()).filter(e => e.type === EntityType.MINERAL);
        if (workers.length > 0 && minerals.length > 0) {
            // Pick a random worker if we fell back to all workers, or just the first one
            const worker = workers[Math.floor(Math.random() * workers.length)];
            const mineral = minerals[0]; // Just pick the first one for now
            window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
                detail: { 
                    action: 'SELECT', 
                    unitIds: [worker.id]
                } 
            }));
            window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
                detail: { 
                    action: 'RIGHT_CLICK', 
                    unitIds: [worker.id], 
                    targetId: mineral.id,
                    x: mineral.position.x, 
                    y: mineral.position.y 
                } 
            }));
        } else {
            window.dispatchEvent(new CustomEvent('GAME_COMMAND', { detail: { action: 'NOTIFY', text: `Need a worker to gather` } }));
        }
    }
    else if (action === 'STOP') {
        let army = playerEntities.filter(e => e.type === EntityType.MARINE || e.type === EntityType.MEDIC || e.type === EntityType.WORKER);
        if (unitType === 'MARINE') army = army.filter(e => e.type === EntityType.MARINE);
        if (unitType === 'MEDIC') army = army.filter(e => e.type === EntityType.MEDIC);
        if (unitType === 'WORKER') army = army.filter(e => e.type === EntityType.WORKER);
        
        if (army.length > 0) {
            const unitIds = army.map(u => u.id);
            window.dispatchEvent(new CustomEvent('GAME_COMMAND', { 
                detail: { 
                    action: 'STOP', 
                    unitIds: unitIds
                } 
            }));
        }
    }
};
