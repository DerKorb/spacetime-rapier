import { OrbitControls, Plane, Sphere } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
// Import physics components
import { Physics, RigidBody } from '@react-three/rapier';

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

// Entity Mesh Component with Physics
function EntityMesh({ position, entityId }: { position: [number, number, number], entityId: number }) {
  // Use a ref to potentially access the RigidBody API later if needed
  const rigidBodyRef = useRef<any>(null); // Use any for now, replace with proper type if known

  // When a new entity is created (position changes initially), set its position.
  // We might need a more robust way to handle updates vs. initial spawn.
  useEffect(() => {
    if (rigidBodyRef.current) {
        // Set position directly on initial render or when position fundamentally changes
        // Note: Continuously setting position might fight the physics engine.
        // We rely on Rapier to handle physics updates after initial placement.
        rigidBodyRef.current.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
        // Optional: reset velocity if needed on spawn/teleport
        rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }, [position]); // React dependency on position ensures this runs when position changes

  return (
    <RigidBody
      ref={rigidBodyRef}
      colliders="ball" // Add a ball collider
      position={position} // Initial position set here
      key={entityId} // Use entityId as key for React reconciliation
      restitution={0.7} // Make it bouncy
      friction={0.1}
    >
      <Sphere args={[1, 16, 16]}>
        <meshStandardMaterial color="red" />
      </Sphere>
    </RigidBody>
  );
}

function App() {
  const [entities, setEntities] = useState<Map<number, Entity>>(new Map());
  const [entityTransforms, setEntityTransforms] = useState<Map<number, EntityTransform>>(new Map());
  const connectionRef = useRef<DbConnection | null>(null);
  const identityRef = useRef<Identity | null>(null);

  // Keep track of entity physics state separately from DB state
  // This is a simplification; a more robust solution might store Rapier handles
  const entityPhysicsPositions = useRef<Map<number, { x: number; y: number; z: number }>>(new Map());

  useEffect(() => {
    const connection = DbConnection.builder()
      .withUri(`ws://${SPACETIMEDB_HOST}`)
      .withModuleName(SPACETIMEDB_DB_NAME)
      // .withToken(localStorage.getItem('auth_token') || undefined)
      // Corrected onConnect signature (connection first)
      .onConnect((con: DbConnection, identity: Identity) => {
        connectionRef.current = con;
        identityRef.current = identity;
        console.log('Connected to SpacetimeDB with Identity:', identity.toHexString(), con);
        // if (token) { localStorage.setItem('auth_token', token); }

        // Corrected callback signatures (context first)
        con.db.entity.onInsert((_ctx: EventContext, entity: Entity) => {
          console.log('Entity Inserted:', entity);
          setEntities(prev => new Map(prev).set(entity.id, entity));
        });
        con.db.entity.onDelete((_ctx: EventContext, entity: Entity) => {
          console.log('Entity Deleted:', entity);
          setEntities(prev => {
            const newMap = new Map(prev);
            newMap.delete(entity.id);
            return newMap;
          });
          setEntityTransforms(prev => {
            const newMap = new Map(prev);
            newMap.delete(entity.id);
            return newMap;
          });
        });

        // EntityTransform table callbacks
        con.db.entityTransform.onInsert((_ctx: EventContext, transform: EntityTransform) => {
          console.log('EntityTransform Inserted:', transform);
          setEntityTransforms(prev => new Map(prev).set(transform.entityId, transform));
        });
        con.db.entityTransform.onUpdate((_ctx: EventContext, _oldTransform: EntityTransform, newTransform: EntityTransform) => {
          console.log('EntityTransform Updated:', newTransform);
          // TODO: How should DB updates affect physics?
          // Option 1: Teleport the physics body (might look jarring)
          // Option 2: Apply forces/impulses (more complex)
          // Option 3: Ignore DB updates and let physics run (simplest for now)
          setEntityTransforms(prev => new Map(prev).set(newTransform.entityId, newTransform));
        });

        // Optional: Listen for reducer events
        con.reducers.onSpawn((ctx: ReducerEventContext) => {
           console.log('Spawn reducer event:', ctx.event);
         });

        // Subscribe using the subscription builder
        // Subscribe to both tables using a single call
        con.subscriptionBuilder()
           .subscribe([
               'SELECT * FROM entity',
               'SELECT * FROM entity_transform'
           ]); // Removed incorrect .execute() call
        console.log('Subscribed to Entity and EntityTransform tables.');
      })
      .onDisconnect(() => {
        console.log('Disconnected from SpacetimeDB.');
        connectionRef.current = null;
        identityRef.current = null;
        setEntities(new Map());
        setEntityTransforms(new Map());
      })
      // Corrected onConnectError signature (context first)
      .onConnectError((ctx: ErrorContext, err: Error) => {
        console.error('SpacetimeDB Connection Error:', err, 'Context:', ctx);
      })
      .build();

    return () => {
      console.log('Disconnecting from SpacetimeDB (cleanup)...');
      connectionRef.current?.disconnect();
      connectionRef.current = null;
      identityRef.current = null;
    };
  }, []);

  const spawnEntity = () => {
    if (connectionRef.current && connectionRef.current.reducers) {
      // Generate random coordinates
      const x = Math.random() * 20 - 10; // Example range -10 to 10
      const y = 10; // Start higher so it falls
      const z = Math.random() * 20 - 10; // Example range -10 to 10

      console.log(`Calling spawn reducer with x=${x.toFixed(2)}, y=${y}, z=${z.toFixed(2)}...`);
      try {
        // Call the generated reducer function, passing the coordinates
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
      </div>
      <Canvas camera={{ position: [0, 15, 30], fov: 75 }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[1, 1, 1]} intensity={1} />
        {/* Wrap scene content with Physics */}
        <Physics gravity={[0, -9.81, 0]}>
          {/* Ground Plane with Physics */}
          <RigidBody type="fixed" colliders="cuboid" restitution={0.1} friction={1.0}>
            <Plane args={[200, 200]} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
              <meshStandardMaterial color="grey" />
            </Plane>
          </RigidBody>

          {/* Map over entities and use their ID to find the transform */}
          {Array.from(entities.values()).map((entity) => {
            const transform = entityTransforms.get(entity.id);
            // Render only if transform data exists initially
            if (transform) {
              // Use the initial position from the database
              const initialPosition: [number, number, number] = [transform.x, transform.y, transform.z];
              return (
                <EntityMesh
                  key={entity.id} // Key prop moved to RigidBody
                  entityId={entity.id}
                  position={initialPosition}
                />
              );
            }
            return null; // Don't render if transform isn't found yet
          })}
        </Physics>
        <OrbitControls />
      </Canvas>
    </div>
  );
}

export default App;
