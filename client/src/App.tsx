import { OrbitControls, Plane, Sphere } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';

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

// Entity Mesh Component (remains the same)
function EntityMesh({ position }: { position: [number, number, number] }) {
  return (
    <Sphere args={[1, 16, 16]} position={position}>
      <meshStandardMaterial color="red" />
    </Sphere>
  );
}

function App() {
  const [entities, setEntities] = useState<Map<number, Entity>>(new Map());
  const [entityTransforms, setEntityTransforms] = useState<Map<number, EntityTransform>>(new Map());
  const connectionRef = useRef<DbConnection | null>(null);
  const identityRef = useRef<Identity | null>(null);

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
      const y = 1; // Keep y fixed for simplicity
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

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <button
        onClick={spawnEntity}
        style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 1 }}
      >
        Spawn Entity
      </button>
      <Canvas camera={{ position: [0, 5, 10], fov: 75 }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[1, 1, 1]} intensity={1} />
        <Plane args={[200, 200]} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <meshStandardMaterial color="grey" />
        </Plane>
        {/* Map over entities and use their ID to find the transform */} 
        {Array.from(entities.values()).map((entity) => {
          const transform = entityTransforms.get(entity.id);
          // Render only if transform data exists
          if (transform) {
            return (
              <EntityMesh
                key={entity.id}
                position={[transform.x, transform.y, transform.z]}
              />
            );
          }
          return null; // Don't render if transform isn't found yet
        })}
        <OrbitControls />
      </Canvas>
    </div>
  );
}

export default App;
