use log::info;
use spacetimedb::{reducer, table, ReducerContext, ScheduleAt, Table};
use std::collections::HashMap;
use std::time::Duration;

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

    let ground_collider = ColliderBuilder::cuboid(100.0, 0.1, 100.0).build();
    state.collider_set.insert(ground_collider);

    // Comment out the timer insertion to disable physics ticks for now
    /*
    ctx.db
        .physics_tick_timer()
        .try_insert(PhysicsTickTimer {
            id: 0,
            scheduled_at: ScheduleAt::Interval(Duration::from_millis(16).into()),
        })
        .map_err(|e| e.to_string())?;
    */

    Ok(())
}

#[reducer]
pub fn spawn(ctx: &ReducerContext, x: f64, y: f64, z: f64) -> Result<(), String> {
    info!("Spawn called with coords: x={}, y={}, z={}", x, y, z);
    let entity_id = get_next_entity_id(ctx)?;
    info!("  -> Assigning entity_id: {}", entity_id);
    ctx.db
        .entity()
        .try_insert(Entity { id: entity_id })
        .map_err(|e| e.to_string())?;

    let mut state = PHYSICS_STATE.lock().map_err(|e| e.to_string())?;
    let rigid_body = RigidBodyBuilder::dynamic()
        .translation(Vector3::new(x as f32, y as f32, z as f32))
        .build();
    let collider = ColliderBuilder::ball(1.0).restitution(0.7).build();

    // Insert rigid body
    let rigid_body_handle = state.rigid_body_set.insert(rigid_body);

    // Insert collider separately (no parenting needed for basic simulation)
    let collider_handle = state.collider_set.insert(collider);

    // Associate the body handle with the entity ID for lookups
    state
        .handle_to_entity_id
        .insert(rigid_body_handle, entity_id);

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
    ctx.db
        .entity_transform()
        .try_insert(EntityTransform { entity_id, x, y, z })
        .map_err(|e| e.to_string())?;
    info!("  -> Spawn successful for entity_id: {}", entity_id);
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
        physics_pipeline, // We need this to call step
        island_manager,
        broad_phase,
        narrow_phase,
        impulse_joint_set,
        multibody_joint_set,
        ccd_solver,
        handle_to_entity_id: _, // We don't need handle_to_entity_id *within* this borrow scope
    } = &mut *state; // Dereference the MutexGuard and get a mutable reference to PhysicsState

    // Now call step using the destructured references
    physics_pipeline.step(
        &Vector3::new(0.0, -9.81, 0.0),
        integration_parameters, // Implicitly borrows immutably from the &mut PhysicsState borrow
        island_manager,         // Implicitly borrows mutably
        broad_phase,            // Implicitly borrows mutably
        narrow_phase,           // Implicitly borrows mutably
        rigid_body_set,         // Implicitly borrows mutably
        collider_set,           // Implicitly borrows mutably
        impulse_joint_set,      // Implicitly borrows mutably
        multibody_joint_set,    // Implicitly borrows mutably
        ccd_solver,             // Implicitly borrows mutably
        None,
        &(),
        &(),
    );

    // The borrow from the destructuring above ends here.
    // Now, re-access the state fields needed for the loop via the original MutexGuard `state`.
    // This is safe because the previous mutable borrow from destructuring is finished.
    for (handle, rigid_body) in state.rigid_body_set.iter() {
        if rigid_body.is_dynamic() && state.handle_to_entity_id.contains_key(&handle) {
            let entity_id = state.handle_to_entity_id[&handle];
            let pos = rigid_body.translation();
            // Log the raw f32 position from Rapier
            info!(
                "Physics tick: Entity {}, Raw Position (f32): {:?}",
                entity_id, pos
            );

            // Find the existing transform
            if let Some(mut transform) = ctx.db.entity_transform().entity_id().find(&entity_id) {
                // Update its fields
                transform.x = pos.x as f64;
                transform.y = pos.y as f64;
                transform.z = pos.z as f64;
                // Use try_insert() and explicitly handle the result to avoid panic
                match ctx.db.entity_transform().try_insert(transform) {
                    Ok(_) => { /* Success, do nothing */ }
                    Err(e) => {
                        // Log the specific error if try_insert fails
                        info!(
                            "Physics tick: Failed to update EntityTransform for entity_id {}: {}",
                            entity_id, e
                        );
                    }
                }
            } else {
                // Row not found, log it
                info!(
                    "Physics tick: Transform for entity {} not found, skipping update.",
                    entity_id
                );
            }
        }
    }
    Ok(())
}
