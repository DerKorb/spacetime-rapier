use log::info;
use spacetimedb::{reducer, table, ReducerContext, ScheduleAt, Table};
use std::collections::HashMap;

// Use rapier's re-exported nalgebra and specific pipeline types
use rapier3d::na::Vector3;
use rapier3d::prelude::BroadPhaseMultiSap;
use rapier3d::prelude::*;

use once_cell::sync::Lazy;
use std::sync::Mutex;

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
pub fn process_physics_tick(ctx: &ReducerContext, _timer: PhysicsTickTimer) -> Result<(), String> {
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
    Ok(())
}
