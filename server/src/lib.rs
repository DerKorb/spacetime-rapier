use spacetimedb::{reducer, table, ReducerContext, Table};
use std::sync::atomic::{AtomicU32, Ordering};

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

#[table(name = entity, public)]
pub struct Entity {
    #[primary_key]
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[reducer]
pub fn spawn(ctx: &ReducerContext) {
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    ctx.db.entity().insert(Entity {
        id,
        x: 0.0,
        y: 0.0,
        z: 0.0,
    });
}
