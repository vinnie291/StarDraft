import { NetMessage } from '../types';
import { Peer, DataConnection } from 'peerjs';

type MessageHandler = (msg: NetMessage) => void;

class NetworkService {
    private peer: Peer | null = null;
    private conn: DataConnection | null = null;
    private listeners: MessageHandler[] = [];
    public id: string = '';
    public name: string = 'Player';

    constructor() {
        // Peer initialized on demand
    }

    public setName(name: string) {
        this.name = name;
    }

    private generateShortId(): string {
        // Exclude I, O, 0, 1, Q to avoid confusion. 
        // This set ensures the code is always 4 characters from this safe list.
        const chars = 'ABCDEFGHJKLMNPRSTUVWXYZ23456789';
        let result = '';
        for (let i = 0; i < 4; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    public async hostGame(customId?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            let attempts = 0;

            const attemptHost = () => {
                if (attempts > 10 && !customId) {
                    reject(new Error("Could not find a free game code. Please try again."));
                    return;
                }
                attempts++;

                if (this.peer) {
                    this.peer.destroy();
                    this.peer = null;
                }

                // Use custom ID if provided, otherwise generate random 4-char ID
                const peerId = customId || this.generateShortId();

                // Initialize Peer with this ID
                this.peer = new Peer(peerId, {
                    debug: 1
                });
                
                const handleOpen = (id: string) => {
                    // Remove initialization listeners to prevent conflict/duplicates
                    this.peer?.off('error', handleInitError);
                    this.peer?.off('open', handleOpen);

                    this.id = id;
                    this.conn = null; // Ensure fresh state
                    
                    // Attach a runtime error handler that ignores expected connectivity errors
                    // effectively suppressing "Could not connect to peer" console spam when handled elsewhere
                    this.peer?.on('error', (err: any) => {
                        if (err.type === 'peer-unavailable') return; // Handled by join logic usually
                        console.error('Runtime Peer error:', err);
                    });

                    resolve(id);
                };

                const handleInitError = (err: any) => {
                    if (err.type === 'unavailable-id') {
                        // Cleanup before retry
                        this.peer?.off('error', handleInitError);
                        this.peer?.off('open', handleOpen);
                        
                        if (customId) {
                            reject(new Error("Room is already taken."));
                        } else {
                            // ID taken, retry with new random
                            console.log(`ID ${peerId} taken, retrying...`);
                            attemptHost();
                        }
                    } else {
                        console.error('Peer init error:', err);
                        reject(err);
                    }
                };

                this.peer.on('open', handleOpen);
                this.peer.on('connection', (conn) => {
                    this.handleConnection(conn);
                });
                this.peer.on('error', handleInitError);
            };

            attemptHost();
        });
    }

    public async joinGame(hostId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            // If we are already a peer (e.g. hosting a private room), we can try to connect from this peer
            // If not, create a new one.
            if (!this.peer || this.peer.disconnected) {
                if (this.peer) this.peer.destroy();
                this.peer = new Peer();
            }

            const cleanup = () => {
                if (this.peer) {
                    this.peer.off('error', handlePeerError);
                }
            };

            const handlePeerError = (err: any) => {
                if (err.type === 'peer-unavailable') {
                    cleanup();
                    reject(new Error("Room not found"));
                }
            };

            const connectToHost = () => {
                // Important: 'peer-unavailable' is emitted on the PEER object, not the connection
                this.peer!.on('error', handlePeerError);

                const conn = this.peer!.connect(hostId, { reliable: true });
                
                if (!conn) {
                    cleanup();
                    reject(new Error("Connection failed immediately."));
                    return;
                }

                // Connection events
                conn.on('open', () => {
                    cleanup();
                    this.handleConnection(conn);
                    resolve();
                });

                conn.on('error', (err) => {
                    console.error('Connection error:', err);
                    cleanup();
                    reject(err);
                });
                
                conn.on('close', () => {
                   if (!this.conn) {
                       cleanup();
                       // Use a generic message or one indicating failure if it wasn't open yet
                       // However, peerjs close might fire on clean close too, so we only reject if we haven't established state
                   }
                });

                // Timeout if connection hangs
                setTimeout(() => {
                    if (!conn.open) {
                        // Don't reject if we already resolved/connected
                        if (!this.conn) {
                            cleanup();
                            conn.close();
                            reject(new Error("Connection timed out. Room might be full or closed."));
                        }
                    }
                }, 5000);
            };

            if (this.peer.open) {
                connectToHost();
            } else {
                this.peer.on('open', () => connectToHost());
                this.peer.once('error', (err) => {
                    cleanup();
                    reject(err);
                });
            }
        });
    }
    
    // Helper to check if a room exists without fully committing to join flow UI
    public checkPublicRoom(roomId: string): Promise<boolean> {
        return new Promise((resolve) => {
             // We need a temp peer to check
             const tempPeer = new Peer();
             let resolved = false;
             
             tempPeer.on('open', () => {
                 const conn = tempPeer.connect(roomId);
                 conn.on('open', () => {
                     if (!resolved) { resolved = true; resolve(true); }
                     conn.close();
                     tempPeer.destroy();
                 });
                 conn.on('error', () => {
                      // Likely unavailable
                 });
                 // Listen for peer-unavailable on the temp peer
                 tempPeer.on('error', (err: any) => {
                     if (err.type === 'peer-unavailable') {
                         if (!resolved) { resolved = true; resolve(false); }
                         tempPeer.destroy();
                     }
                 });

                 setTimeout(() => {
                     if (!resolved) { resolved = true; resolve(false); }
                     tempPeer.destroy();
                 }, 2000);
             });
             tempPeer.on('error', () => {
                 if (!resolved) { resolved = true; resolve(false); }
             });
        });
    }

    private handleConnection(conn: DataConnection) {
        // Enforce 1v1 Limit
        if (this.conn && this.conn.open) {
            console.warn("Rejecting connection: Room full");
            conn.on('open', () => {
                 conn.send({ type: 'ERROR', payload: { message: "Room is full!" } });
                 setTimeout(() => conn.close(), 500);
            });
            return;
        }

        this.conn = conn;

        this.conn.on('data', (data) => {
            this.notify(data as NetMessage);
        });

        this.conn.on('close', () => {
            console.log("Connection closed");
            this.conn = null;
            // Notify listeners of disconnect if needed, or rely on them handling lack of messages
        });
        
        this.conn.on('error', (err) => console.error("Conn Error", err));
    }

    public send(msg: NetMessage) {
        if (this.conn && this.conn.open) {
            this.conn.send(msg);
        } else {
            console.warn("Cannot send, connection not open", msg);
        }
    }

    public subscribe(handler: MessageHandler) {
        this.listeners.push(handler);
        return () => {
            this.listeners = this.listeners.filter(h => h !== handler);
        };
    }

    private notify(msg: NetMessage) {
        this.listeners.forEach(l => l(msg));
    }

    public close() {
        if (this.conn) this.conn.close();
        if (this.peer) this.peer.destroy();
        this.conn = null;
        this.peer = null;
    }
}

export const network = new NetworkService();