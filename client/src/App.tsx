import { OrbitControls, Plane, Stats } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
// Import base types from SDK
import { Identity } from '@clockworklabs/spacetimedb-sdk';

// Import generated types and connection class
import {
  DbConnection,
  Entity,
  EntityTransform,
  ErrorContext,
  // Import generated context types (correctly aliased)
  EventContext,
  ReducerEventContext
} from './generated';

// SpacetimeDB connection details
const SPACETIMEDB_HOST = 'localhost:3000';
const SPACETIMEDB_DB_NAME = 'spacetime';

// Instancing constants
const MAX_INSTANCES = 5000; // Set a max capacity for the instanced mesh

// Define geometry and material outside the component for reuse
const sphereGeometry = new THREE.SphereGeometry(0.2, 16, 16);
const redMaterial = new THREE.MeshStandardMaterial({ color: 'red' });
// Need THREE for geometry - add import
import * as THREE from 'three';

// Define update types for buffer
type PendingUpdate = { type: 'delete' } | { type: 'upsert', transform: EntityTransform };

function App() {
  const [entityTransforms, setEntityTransforms] = useState<Map<number, EntityTransform>>(new Map());
  const connectionRef = useRef<DbConnection | null>(null);
  const identityRef = useRef<Identity | null>(null);

  // Refs for direct instanced mesh manipulation
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const entityIdToIndexRef = useRef<Map<number, number>>(new Map());
  const freeIndicesRef = useRef<number[]>([]);
  const nextAvailableIndexRef = useRef<number>(0);
  // Temp object for matrix calculation
  const tempObject = useMemo(() => new THREE.Object3D(), []);
  const zeroScaleMatrix = useMemo(() => {
      const obj = new THREE.Object3D();
      obj.scale.set(0, 0, 0);
      obj.updateMatrix();
      return obj.matrix.clone();
  }, []);

  // Refs for batching state updates
  const pendingUpdatesRef = useRef<Map<number, PendingUpdate>>(new Map());
  const rafHandleRef = useRef<number | null>(null);

  // Function to apply buffered updates directly to InstancedMesh
  const applyBufferedUpdates = () => {
    if (!instancedMeshRef.current || pendingUpdatesRef.current.size === 0) {
      rafHandleRef.current = null; // No work or mesh not ready
      return;
    }

    const mesh = instancedMeshRef.current;
    let needsUpdate = false;

    // Iterate directly over the ref map
    pendingUpdatesRef.current.forEach((update, entityId) => {
      needsUpdate = true; // Mark matrix as needing update if any change occurs
      if (update.type === 'upsert') {
        const { x, y, z } = update.transform;
        tempObject.position.set(x, y, z);
        // Add rotation/scale here if needed
        tempObject.updateMatrix();

        let index = entityIdToIndexRef.current.get(entityId);
        if (index === undefined) {
          // Assign a new index
          if (freeIndicesRef.current.length > 0) {
            index = freeIndicesRef.current.pop()!;
          } else {
            if (nextAvailableIndexRef.current >= MAX_INSTANCES) {
              console.warn("Max instances reached, cannot add more.");
              return; // Skip this update
            }
            index = nextAvailableIndexRef.current++;
          }
          entityIdToIndexRef.current.set(entityId, index);
        }
        // Check index is valid before setting matrix
        if (index !== undefined && index < MAX_INSTANCES) {
             mesh.setMatrixAt(index, tempObject.matrix);
        }

      } else if (update.type === 'delete') {
        const index = entityIdToIndexRef.current.get(entityId);
        if (index !== undefined && index < MAX_INSTANCES) {
          // Set scale to 0 to hide instance
          mesh.setMatrixAt(index, zeroScaleMatrix);
          entityIdToIndexRef.current.delete(entityId);
          freeIndicesRef.current.push(index); // Make index available again
        }
      }
    });

    // Clear the map *after* iteration
    pendingUpdatesRef.current.clear();

    if (needsUpdate) {
      mesh.instanceMatrix.needsUpdate = true;
    }
    rafHandleRef.current = null; // Allow scheduling new updates
  };

  // Function to schedule a state update using requestAnimationFrame
  const scheduleStateUpdate = () => {
    if (rafHandleRef.current === null) {
        rafHandleRef.current = requestAnimationFrame(applyBufferedUpdates);
    }
  };

  useEffect(() => {
    // Initialize free indices if needed (optional, could just rely on nextAvailableIndexRef)
    // freeIndicesRef.current = Array.from({ length: MAX_INSTANCES }, (_, i) => i);
    // nextAvailableIndexRef.current = 0;

    const connection = DbConnection.builder()
      .withUri(`ws://${SPACETIMEDB_HOST}`)
      .withModuleName(SPACETIMEDB_DB_NAME)
      // .withToken(localStorage.getItem('auth_token') || undefined)
      .onConnect((con: DbConnection, identity: Identity) => {
        connectionRef.current = con;
        identityRef.current = identity;
        // console.log('Connected to SpacetimeDB with Identity:', identity.toHexString(), con);
        // if (token) { localStorage.setItem('auth_token', token); }

        // --- Callbacks buffer updates --- 
        con.db.entity.onInsert((_ctx: EventContext, _entity: Entity) => {
          // console.log('Entity Inserted:', entity);
          // No direct state update needed here anymore
        });
        con.db.entity.onDelete((_ctx: EventContext, entity: Entity) => {
           // console.log('Entity Deleted:', entity);
           // When an entity is deleted, buffer its transform deletion
           pendingUpdatesRef.current.set(entity.id, { type: 'delete' });
           // Also update local state map immediately for consistency checks if needed
           setEntityTransforms(prev => { const m=new Map(prev); m.delete(entity.id); return m;});
           scheduleStateUpdate(); 
        });

        con.db.entityTransform.onInsert((_ctx: EventContext, transform: EntityTransform) => {
          // console.log('EntityTransform Inserted:', transform);
          // Buffer insert/update
          pendingUpdatesRef.current.set(transform.entityId, { type: 'upsert', transform });
          setEntityTransforms(prev => new Map(prev).set(transform.entityId, transform));
          scheduleStateUpdate();
        });
        con.db.entityTransform.onUpdate((_ctx: EventContext, _oldTransform: EntityTransform, newTransform: EntityTransform) => {
          // console.log('EntityTransform Updated:', newTransform);
          // Buffer insert/update
          pendingUpdatesRef.current.set(newTransform.entityId, { type: 'upsert', transform: newTransform });
          setEntityTransforms(prev => new Map(prev).set(newTransform.entityId, newTransform));
          scheduleStateUpdate();
        });
        con.db.entityTransform.onDelete((_ctx: EventContext, transform: EntityTransform) => {
            console.log('EntityTransform Deleted:', transform);
            // Buffer delete
            pendingUpdatesRef.current.set(transform.entityId, { type: 'delete' });
            setEntityTransforms(prev => { const m=new Map(prev); m.delete(transform.entityId); return m;});
            scheduleStateUpdate();
        });

        // --- End Callback Modifications ---

        // Optional: Listen for reducer events
        con.reducers.onSpawn((ctx: ReducerEventContext) => {
           //  console.log('Spawn reducer event:', ctx.event);
         });
         // Add listeners for new reducers if needed for feedback
         con.reducers.onSpawnExplodingSpheres((ctx: ReducerEventContext) => {
            console.log('SpawnExplodingSpheres reducer event:', ctx.event); // Can add UI feedback here
         });
         con.reducers.onResetSimulation((ctx: ReducerEventContext) => {
             console.log('ResetSimulation reducer event:', ctx.event); 
             // Clear any pending updates on reset to avoid stale data
             if(rafHandleRef.current) cancelAnimationFrame(rafHandleRef.current);
             rafHandleRef.current = null;
             pendingUpdatesRef.current.clear();
             entityIdToIndexRef.current.clear();
             freeIndicesRef.current = [];
             nextAvailableIndexRef.current = 0;
             setEntityTransforms(new Map()); // Clear state too
             if (instancedMeshRef.current) {
                 instancedMeshRef.current.count = 0; // Reset mesh count
                 instancedMeshRef.current.instanceMatrix.needsUpdate = true;
             }
         });

        // Subscribe using the subscription builder
        // Subscribe to both tables using a single call
        con.subscriptionBuilder()
           .subscribe([
               'SELECT * FROM entity', // Keep subscribing to entity for onDelete trigger
               'SELECT * FROM entity_transform'
           ]); // Removed incorrect .execute() call
        // console.log('Subscribed to Entity and EntityTransform tables.');
      })
      .onDisconnect(() => {
        console.log('Disconnected from SpacetimeDB.');
        connectionRef.current = null;
        identityRef.current = null;
        setEntityTransforms(new Map());
        // Clear buffer and cancel any pending animation frame on disconnect
        if(rafHandleRef.current) cancelAnimationFrame(rafHandleRef.current);
        rafHandleRef.current = null;
        pendingUpdatesRef.current.clear();
        entityIdToIndexRef.current.clear();
        freeIndicesRef.current = [];
        nextAvailableIndexRef.current = 0;
      })
      .onConnectError((ctx: ErrorContext, err: Error) => {
        console.error('SpacetimeDB Connection Error:', err, 'Context:', ctx);
      })
      .build();

    // Cleanup function for useEffect
    return () => {
      console.log('Disconnecting from SpacetimeDB (cleanup)...');
      connectionRef.current?.disconnect();
      connectionRef.current = null;
      identityRef.current = null;
      // Ensure animation frame is cancelled on component unmount
      if(rafHandleRef.current) cancelAnimationFrame(rafHandleRef.current);
      rafHandleRef.current = null;
    };
  }, []);

  const spawnEntity = () => {
    if (connectionRef.current && connectionRef.current.reducers) {
      // Generate random coordinates
      const x = Math.random() * 20 - 10; // Example range -10 to 10
      const y = 10; // Start higher so it falls (server handles this now)
      const z = Math.random() * 20 - 10; // Example range -10 to 10

      console.log(`Calling spawn reducer (position is indicative, server physics determines final)...`);
      try {
        // Call the generated reducer function, passing the coordinates
        // Note: Server physics now dictates starting Y position and movement
        connectionRef.current.reducers.spawn(x, y, z);
      } catch (err) {
        console.error("Failed to call spawn reducer:", err);
      }
    } else {
      console.warn("SpacetimeDB client not connected or reducers not available, cannot spawn entity.");
    }
  };

  // New function to call the explosion reducer
  const spawnExplosion = () => {
    if (connectionRef.current && connectionRef.current.reducers) {
      console.log(`Calling spawn_exploding_spheres reducer...`);
      try {
        // Call the generated reducer function (no arguments needed)
        connectionRef.current.reducers.spawnExplodingSpheres();
      } catch (err) {
        console.error("Failed to call spawn_exploding_spheres reducer:", err);
      }
    } else {
      console.warn("SpacetimeDB client not connected or reducers not available, cannot spawn explosion.");
    }
  };

  // New function to call the reset reducer
  const resetSimulation = () => {
    if (connectionRef.current && connectionRef.current.reducers) {
      console.log(`Calling reset_simulation reducer...`);
      try {
        // Call the generated reducer function (no arguments needed)
        connectionRef.current.reducers.resetSimulation();
      } catch (err) {
        console.error("Failed to call reset_simulation reducer:", err);
      }
    } else {
      console.warn("SpacetimeDB client not connected or reducers not available, cannot reset simulation.");
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      {/* Group buttons together */}
      <div style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 1, display: 'flex', gap: '10px' }}>
        <button onClick={spawnEntity}>
          Spawn Entity
        </button>
        {/* New button for explosion */}
        <button onClick={spawnExplosion}>
          Spawn Explosion
        </button>
        {/* New button for reset */}
        <button onClick={resetSimulation} style={{ backgroundColor: '#ffaaaa' }}>
          Reset
        </button>
      </div>
      <Canvas camera={{ position: [0, 15, 30], fov: 75 }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[1, 1, 1]} intensity={1} />
        {/* Removed <Physics> wrapper */}

        {/* Ground Plane (visual only) */}
        <Plane args={[200, 200]} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]}> {/* Adjusted Y slightly */}
            <meshStandardMaterial color="grey" />
        </Plane>

        {/* Direct InstancedMesh rendering */}
        <instancedMesh ref={instancedMeshRef} args={[sphereGeometry, redMaterial, MAX_INSTANCES]} frustumCulled={false}> 
            {/* Geometry and Material are now args */} 
        </instancedMesh>

        <OrbitControls />
        <Stats />
      </Canvas>
    </div>
  );
}

export default App;
