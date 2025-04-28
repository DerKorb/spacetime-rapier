import { useState, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Sphere, Plane } from '@react-three/drei';
import * as THREE from 'three';

// Import base types from SDK
import { Identity } from '@clockworklabs/spacetimedb-sdk';

// Import generated types and connection class
import {
  DbConnection,
  Entity,
  EntityTableHandle,
  // Import generated context types (correctly aliased)
  EventContext,
  ReducerEventContext,
  SubscriptionEventContext,
  ErrorContext,
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
  const connectionRef = useRef<DbConnection | null>(null);
  const identityRef = useRef<Identity | null>(null);

  useEffect(() => {
    let connection: DbConnection | null = null;

    connection = DbConnection.builder()
      .withUri(`ws://${SPACETIMEDB_HOST}`)
      .withModuleName(SPACETIMEDB_DB_NAME)
      // .withToken(localStorage.getItem('auth_token') || undefined)
      // Corrected onConnect signature (connection first)
      .onConnect((con: DbConnection, identity: Identity, token?: string) => {
        connectionRef.current = con;
        identityRef.current = identity;
        console.log('Connected to SpacetimeDB with Identity:', identity.toHexString());
        // if (token) { localStorage.setItem('auth_token', token); }

        // Corrected callback signatures (context first)
        con.db.entity.onInsert((ctx: EventContext, entity: Entity) => {
          console.log('Entity Inserted:', entity, 'Context:', ctx);
          setEntities(prev => new Map(prev).set(entity.id, entity));
        });
        con.db.entity.onUpdate((ctx: EventContext, oldEntity: Entity, newEntity: Entity) => {
           console.log('Entity Updated:', oldEntity, '->', newEntity, 'Context:', ctx);
          setEntities(prev => new Map(prev).set(newEntity.id, newEntity));
        });
        con.db.entity.onDelete((ctx: EventContext, entity: Entity) => {
          console.log('Entity Deleted:', entity, 'Context:', ctx);
          setEntities(prev => {
            const newMap = new Map(prev);
            newMap.delete(entity.id);
            return newMap;
          });
        });

        // Optional: Listen for reducer events
        con.reducers.onSpawn((ctx: ReducerEventContext) => {
           console.log('Spawn reducer event:', ctx.event);
         });

        // Subscribe using the subscription builder
        con.subscriptionBuilder().subscribe('SELECT * FROM entity');
        console.log('Subscribed to Entity table.');
      })
      .onDisconnect(() => {
        console.log('Disconnected from SpacetimeDB.');
        connectionRef.current = null;
        identityRef.current = null;
        setEntities(new Map());
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
      console.log('Calling spawn reducer...');
      try {
        connectionRef.current.reducers.spawn();
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
        {Array.from(entities.values()).map((entity: Entity) => (
          <EntityMesh key={entity.id} position={[entity.x, entity.y, entity.z]} />
        ))}
        <OrbitControls />
      </Canvas>
    </div>
  );
}

export default App;
