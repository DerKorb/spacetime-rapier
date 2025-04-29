use log::info;
use spacetimedb::{reducer, table, ReducerContext, ScheduleAt, Table};
use std::collections::HashMap;
// Remove Instant import
// use std::time::Instant;

// Use rapier's re-exported nalgebra and specific pipeline types
use rapier3d::na::Vector3;
use rapier3d::prelude::BroadPhaseMultiSap;
use rapier3d::prelude::*;

use once_cell::sync::Lazy;
use std::sync::Mutex;

// Add rand imports
use rand::Rng; // For random number generation
use rand::thread_rng; // For default RNG

// --- Physics State ---

struct PhysicsState {
    rigid_body_set: RigidBodySet,
    collider_set: ColliderSet,
    integration_parameters: IntegrationParameters,
    physics_pipeline: PhysicsPipeline,
    island_manager: IslandManager,
    broad_phase: BroadPhaseMultiSap, // Use concrete type
    narrow_phase: NarrowPhase,
    impulse_joint_set: ImpulseJointSet,
    multibody_joint_set: MultibodyJointSet,
    ccd_solver: CCDSolver,
    handle_to_entity_id: HashMap<RigidBodyHandle, u32>,
}

static PHYSICS_STATE: Lazy<Mutex<PhysicsState>> = Lazy::new(|| {
    Mutex::new(PhysicsState {
        rigid_body_set: RigidBodySet::new(),
        collider_set: ColliderSet::new(),
        integration_parameters: IntegrationParameters::default(),
        physics_pipeline: PhysicsPipeline::new(),
        island_manager: IslandManager::new(),
        broad_phase: BroadPhaseMultiSap::new(), // Initialize concrete type
        narrow_phase: NarrowPhase::new(),
        impulse_joint_set: ImpulseJointSet::new(),
        multibody_joint_set: MultibodyJointSet::new(),
        ccd_solver: CCDSolver::new(),
        handle_to_entity_id: HashMap::new(),
    })
});

// --- SpacetimeDB Tables ---

#[table(name = entity, public)]
#[derive(Default, Clone)]
pub struct Entity {
    #[primary_key]
    pub id: u32,
}

#[table(name = entity_physics)]
#[derive(Clone)]
pub struct EntityPhysics {
    #[primary_key]
    entity_id: u32,
    rb_handle_index: u32,
    rb_handle_generation: u32,
    co_handle_index: u32,
    co_handle_generation: u32,
}

#[table(name = entity_transform, public)]
#[derive(Clone, Default)]
pub struct EntityTransform {
    #[primary_key]
    entity_id: u32,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[table(name = physics_tick_timer, scheduled(process_physics_tick))]
pub struct PhysicsTickTimer {
    #[primary_key]
    id: u64,
    pub scheduled_at: ScheduleAt,
}

// --- Helper Functions ---

fn get_next_entity_id(ctx: &ReducerContext) -> Result<u32, String> {
    let max_id = ctx
        .db
        .entity()
        .iter()
        .map(|entity| entity.id)
        .max()
        .unwrap_or(0);
    Ok(max_id + 1)
}

// --- Reducers ---

#[reducer(init)]
pub fn init_physics(_ctx: &ReducerContext) -> Result<(), String> {
    info!("Initializing physics world and timer.");
    let mut state = PHYSICS_STATE.lock().map_err(|e| e.to_string())?;

    // Explicitly set the integration timestep (dt)
    state.integration_parameters.dt = 16.0 / 1000.0; // 16 milliseconds in seconds
                                                     // Increase solver iterations
    if let Some(iterations) = std::num::NonZeroUsize::new(10) {
        state.integration_parameters.num_solver_iterations = iterations;
    } else {
        // This case should be impossible for a literal 10
        // If it somehow occurs, log it.
        info!("Warning: Failed to create NonZeroUsize for solver iterations");
    }
    // Explicitly set damping_ratio to 0.0
    state.integration_parameters.damping_ratio = 0.0;
    // Removed parameter logging

    let ground_collider = ColliderBuilder::cuboid(100.0, 0.1, 100.0).build();
    state.collider_set.insert(ground_collider);

    // Re-enable the timer insertion
    _ctx.db
        .physics_tick_timer()
        .try_insert(PhysicsTickTimer {
            id: 0,
            scheduled_at: ScheduleAt::Interval(std::time::Duration::from_millis(16).into()),
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[reducer]
pub fn spawn(ctx: &ReducerContext, x: f64, y: f64, z: f64) -> Result<(), String> {
    info!("Spawn called with coords: x={}, y={}, z={}", x, y, z);
    let entity_id = get_next_entity_id(ctx)?;
    // Removed assigning ID log
    ctx.db
        .entity()
        .try_insert(Entity { id: entity_id })
        .map_err(|e| e.to_string())?;

    let mut state = PHYSICS_STATE.lock().map_err(|e| e.to_string())?;

    // Destructure state to borrow fields mutably without conflict
    let PhysicsState {
        rigid_body_set,
        collider_set,
        handle_to_entity_id,
        .. // Ignore other fields for now
    } = &mut *state;

    // Spawn the rigid body higher up (e.g., y=10.0) to allow falling
    let spawn_y = 10.0;
    // Removed spawning height log
    let rigid_body = RigidBodyBuilder::dynamic()
        .translation(Vector3::new(x as f32, spawn_y as f32, z as f32)) // Use spawn_y
        .build();
    // Collider has restitution for bouncing
    let collider = ColliderBuilder::ball(1.0).restitution(0.7).build();

    // Insert rigid body
    let rigid_body_handle = rigid_body_set.insert(rigid_body);

    // Insert collider and attach it to the rigid body using destructured refs
    let collider_handle =
        collider_set.insert_with_parent(collider, rigid_body_handle, rigid_body_set);

    // Associate the body handle with the entity ID for lookups
    handle_to_entity_id.insert(rigid_body_handle, entity_id);

    // Store raw parts (no borrow conflict here)
    let (rb_idx, rb_gen) = rigid_body_handle.into_raw_parts();
    let (co_idx, co_gen) = collider_handle.into_raw_parts();
    ctx.db
        .entity_physics()
        .try_insert(EntityPhysics {
            entity_id,
            rb_handle_index: rb_idx,
            rb_handle_generation: rb_gen,
            co_handle_index: co_idx,
            co_handle_generation: co_gen,
        })
        .map_err(|e| e.to_string())?;
    // Insert transform with the *actual* spawn coordinates used by physics
    ctx.db
        .entity_transform()
        .try_insert(EntityTransform {
            entity_id,
            x,
            y: spawn_y,
            z,
        }) // Use spawn_y here too
        .map_err(|e| e.to_string())?;
    info!("  -> Spawn successful for entity_id: {}", entity_id); // Keep success log
    Ok(())
}

#[reducer]
pub fn spawn_exploding_spheres(ctx: &ReducerContext) -> Result<(), String> {
    info!("Spawn exploding spheres called");
    let mut state = PHYSICS_STATE.lock().map_err(|e| e.to_string())?;
    // Use the deterministic RNG from the ReducerContext
    let mut rng = ctx.rng();
    let explosion_speed = 20.0;

    // Destructure state to borrow fields mutably without conflict
    let PhysicsState {
        rigid_body_set,
        collider_set,
        handle_to_entity_id,
        .. // Ignore other fields for now
    } = &mut *state;

    for i in 0..1000 {
        let entity_id = get_next_entity_id(ctx)?;
        ctx.db
            .entity()
            .try_insert(Entity { id: entity_id })
            .map_err(|e| format!("Failed to insert entity {}: {}", i, e))?;

        // Generate random direction
        let rand_x = rng.gen::<f32>() * 2.0 - 1.0;
        let rand_y = rng.gen::<f32>() * 2.0 - 1.0;
        let rand_z = rng.gen::<f32>() * 2.0 - 1.0;
        // Use fully qualified path and new_normalize
        let direction = rapier3d::na::Unit::new_normalize(Vector3::new(rand_x, rand_y, rand_z));
            // .unwrap_or(Vector3::y_axis()); // new_normalize handles zero vectors

        // Create rigid body at origin with initial velocity
        let rigid_body = RigidBodyBuilder::dynamic()
            .translation(Vector3::new(0.0, 1.0, 0.0)) // Start slightly above origin
            .linvel(direction.into_inner() * explosion_speed)
            .build();

        // Collider with restitution
        let collider = ColliderBuilder::ball(0.2) // Smaller balls for explosion
            .restitution(0.7)
            .density(1.0) // Give them some mass
            .build();

        // Insert rigid body
        let rigid_body_handle = rigid_body_set.insert(rigid_body);

        // Insert collider and attach
        let collider_handle =
            collider_set.insert_with_parent(collider, rigid_body_handle, rigid_body_set);

        // Associate handle with entity ID
        handle_to_entity_id.insert(rigid_body_handle, entity_id);

        // Store raw parts
        let (rb_idx, rb_gen) = rigid_body_handle.into_raw_parts();
        let (co_idx, co_gen) = collider_handle.into_raw_parts();
        ctx.db
            .entity_physics()
            .try_insert(EntityPhysics {
                entity_id,
                rb_handle_index: rb_idx,
                rb_handle_generation: rb_gen,
                co_handle_index: co_idx,
                co_handle_generation: co_gen,
            })
            .map_err(|e| format!("Failed to insert entity_physics for {}: {}", i, e))?;

        // Insert initial transform at origin
        ctx.db
            .entity_transform()
            .try_insert(EntityTransform {
                entity_id,
                x: 0.0,
                y: 1.0, // Start slightly above origin
                z: 0.0,
            })
            .map_err(|e| format!("Failed to insert entity_transform for {}: {}", i, e))?;
    }
    info!("  -> Spawned 100 exploding spheres successfully");
    Ok(())
}

#[reducer]
pub fn reset_simulation(ctx: &ReducerContext) -> Result<(), String> {
    info!("Resetting simulation...");
    let mut state = PHYSICS_STATE.lock().map_err(|e| e.to_string())?;

    // Collect entity IDs and physics handles to avoid borrowing issues
    let mut entities_to_remove: Vec<(u32, RigidBodyHandle, ColliderHandle)> = Vec::new();
    for entity_physics in ctx.db.entity_physics().iter() {
        // Reconstruct handles from raw parts
        let rb_handle = RigidBodyHandle::from_raw_parts(
            entity_physics.rb_handle_index,
            entity_physics.rb_handle_generation,
        );
        let co_handle = ColliderHandle::from_raw_parts(
            entity_physics.co_handle_index,
            entity_physics.co_handle_generation,
        );
        entities_to_remove.push((entity_physics.entity_id, rb_handle, co_handle));
    }

    // Destructure state for mutable access
    let PhysicsState {
        rigid_body_set,
        collider_set,
        island_manager,
        handle_to_entity_id,
        .. // Other fields are not directly modified here but needed for remove
    } = &mut *state;

    info!("Removing {} physics bodies and colliders.", entities_to_remove.len());
    for (entity_id, rb_handle, co_handle) in &entities_to_remove {
        // Remove from physics simulation
        // Note: island_manager is needed for removal
        rigid_body_set.remove(
            *rb_handle,
            island_manager,
            collider_set,
            &mut ImpulseJointSet::new(),
            &mut MultibodyJointSet::new(),
            true, // Wake up bodies touching the removed one
        );
        // Collider removal doesn't require island_manager etc.
        collider_set.remove(*co_handle, island_manager, rigid_body_set, true);

        // Remove from handle mapping
        handle_to_entity_id.remove(rb_handle);

        // Delete from SpacetimeDB tables
        // It's often safer to delete *after* processing physics
        // Use primary key indexes for deletion
        ctx.db.entity().id().delete(entity_id);
        ctx.db.entity_physics().entity_id().delete(entity_id);
        ctx.db.entity_transform().entity_id().delete(entity_id);
    }

    info!("Simulation reset complete. {} entities removed.", entities_to_remove.len());
    Ok(())
}

#[reducer]
pub fn process_physics_tick(ctx: &ReducerContext, _timer: PhysicsTickTimer) -> Result<(), String> {
    // Removed start time logging
    // let start_time = Instant::now();
    // info!("process_physics_tick started at {:?}", start_time);

    // Log invocation using context timestamp (less precise for duration, but available)
    // Access timestamp as a field, not a method
    info!("process_physics_tick invoked. Timestamp: {}", ctx.timestamp);

    let mut state = PHYSICS_STATE.lock().map_err(|e| e.to_string())?;

    // Destructure the state completely for the step call.
    // This provides mutable borrows to the fields required by physics_pipeline.step
    // without violating Rust's borrowing rules (can borrow disjoint fields from a mutable reference).
    let PhysicsState {
        rigid_body_set,
        collider_set,
        integration_parameters,
        ref mut physics_pipeline, // Use `ref mut` to get a mutable reference
        island_manager,
        broad_phase,
        narrow_phase,
        ref mut impulse_joint_set,   // Use `ref mut`
        ref mut multibody_joint_set, // Use `ref mut`
        ref mut ccd_solver,          // Use `ref mut`
        handle_to_entity_id: _,      // We don't need handle_to_entity_id *within* this borrow scope
    } = &mut *state; // Dereference the MutexGuard and get a mutable reference to PhysicsState

    // Now call step using the destructured references (with all arguments)
    physics_pipeline.step(
        &Vector3::new(0.0, -9.81, 0.0),
        integration_parameters,
        island_manager,
        broad_phase,
        narrow_phase,
        rigid_body_set,
        collider_set,
        impulse_joint_set,
        multibody_joint_set,
        ccd_solver,
        None, // query_pipeline
        &(),  // physics_hooks
        &(),  // event_handler
    );

    // Removed post-step logging loop

    // The borrow from the destructuring above ends here.
    // Now, re-access the state fields needed for the loop via the original MutexGuard `state`.
    // This is safe because the previous mutable borrow from destructuring is finished.
    for (handle, rigid_body) in state.rigid_body_set.iter() {
        if rigid_body.is_dynamic() && state.handle_to_entity_id.contains_key(&handle) {
            let entity_id = state.handle_to_entity_id[&handle];
            let pos = rigid_body.translation();
            // Removed physics tick + velocity/sleeping/type logs

            // Construct the struct with the updated data
            let updated_transform = EntityTransform {
                entity_id,
                x: pos.x as f64,
                y: pos.y as f64,
                z: pos.z as f64,
            };

            // Use the .update() method, accessed via the primary key index.
            // Assuming it returns () on success or panics on failure (e.g., row not found).
            ctx.db
                .entity_transform()
                .entity_id()
                .update(updated_transform);

            // Note: We removed the find/delete/insert logic and match statement.
            // The .update() method should handle finding and updating the row based on the primary key.
        }
    }

    // Removed duration logging
    // let duration = start_time.elapsed();
    // info!("process_physics_tick finished. Duration: {:?}", duration);
    info!("process_physics_tick finished."); // Simple finish log

    Ok(())
}
