# SpacetimeDB Multiplayer Demo

## Overview

This project demonstrates real-time multiplayer synchronization using [SpacetimeDB](https://spacetimedb.com/) (v1.1.1) as the backend and a web client built with React, TypeScript, and [React Three Fiber](https://docs.pmnd.rs/react-three-fiber/). It includes server-side physics simulation using the [Rapier](https://rapier.rs/) engine.

## Current State

- **SpacetimeDB Server (`/server`)**:
  - Written in Rust using SpacetimeDB modules.
  - Integrates the **Rapier 3D physics engine** (`rapier3d` v0.19) for server-side simulation.
  - Defines tables:
    - `Entity (id: u32)`: Basic entity identifier.
    - `EntityPhysics (entity_id, rb_handle_index, ..., co_handle_generation)`: Stores Rapier handle parts for physics bodies.
    - `EntityTransform (entity_id, x, y, z)`: Stores entity position, updated by the physics engine.
    - `PhysicsTickTimer`: Schedules the physics update loop.
  - Physics simulation runs on a fixed interval (currently 16ms) via a scheduled reducer (`process_physics_tick`).
  - Includes a static `Mutex`-guarded `PhysicsState` to hold Rapier world components (`RigidBodySet`, `ColliderSet`, etc.).
  - `id` is manually generated (`max_id + 1`).
  - Exposes reducers:
    - `spawn(x, y, z)`: Creates a single dynamic sphere entity with a Rapier rigid body and collider, initially positioned high up.
    - `spawn_exploding_spheres()`: Creates 100 small sphere entities at the origin with random outward velocities.
    - `reset_simulation()`: Deletes all entities and their corresponding physics objects.
  - Uses `log` crate for server-side logging (viewable via `spacetime logs spacetime | cat` or the `spacetime start` terminal).
  - Uses `rand` crate (via `ctx.rng()`) for deterministic randomness in reducers.

- **Client (`/client`)**:
  - Built with React, TypeScript, and Vite.
  - Uses `@react-three/fiber` and `@react-three/drei` for 3D rendering.
  - Uses **`@react-three/rapier`** to mirror server-side physics for visual representation (gravity, collisions, etc. are simulated client-side based on server state updates).
  - Connects to the SpacetimeDB backend using generated client code (`/client/src/generated`).
  - Subscribes to `Entity` and `EntityTransform` tables.
  - Displays entities based on `EntityTransform` data as red spheres within a `<Physics>` context.
  - Includes buttons to call:
    - `spawn`: Creates one sphere.
    - `spawn_exploding_spheres`: Triggers the 100-sphere explosion.
    - `reset_simulation`: Clears the simulation.
  - Uses `@clockworklabs/spacetimedb-sdk` (v1.1.0).

- **Development Environment**:
  - Includes VS Code tasks (`.vscode/tasks.json`) for common client/server actions.
  - Includes a **`clean_publish.sh` script** for rebuilding the server, deleting the local DB, publishing the module, and regenerating client code.
  - `.gitignore` is configured for Rust and Node projects.
  - SpacetimeDB CLI installed via script to `~/.local/bin/spacetime`.

## Goals

- **Short-term**:
  - Allow client input to influence physics (e.g., applying forces).
  - Refine visual representation and physics parameters.
- **Long-term**:
  - Add more complex interactions (deletion via clicking?).
  - Implement authentication and player representation.
  - Explore deployment options (e.g., SpacetimeDB Cloud).

## Getting Started

**Prerequisites:**

- Rust toolchain (`rustup`, `cargo`).
- Node.js and npm.
- SpacetimeDB CLI (v1.1.1). If not installed, run:
  ```sh
  curl -sSf https://install.spacetimedb.com | sh
  ```
  *Note: The CLI installs to `~/.local/bin/spacetime` by default.*

**Setup & Run Sequence:**

1.  **Install Dependencies:**
    ```sh
    # Server (Rust)
    cd server
    cargo build
    cd ..

    # Client (Node)
    cd client
    npm install
    cd ..
    ```

2.  **Start SpacetimeDB Server (Manual Recommended):**
    *   **IMPORTANT:** Running `spacetime start` via VS Code tasks can be unreliable (see Known Issues). It's recommended to run it manually in a dedicated terminal.
    *   If running from an AppImage environment (like Cursor), you **must** unset the `APPIMAGE` environment variable first.
    ```sh
    # In a separate terminal:
    unset APPIMAGE && /home/ksollner/.local/bin/spacetime start
    ```
    *(Leave this terminal running)*

3.  **Publish & Generate Client Code (Using Script Recommended):**
    *   This needs to be done while the server from Step 2 is running.
    *   The `clean_publish.sh` script handles build, delete, publish, and generate steps.
    ```sh
    # Make sure script is executable: chmod +x clean_publish.sh
    bash ./clean_publish.sh
    ```
    *   Alternatively, run manually (requires `unset APPIMAGE` prefix if in AppImage env):
        ```sh
        # Publish
        /home/ksollner/.local/bin/spacetime publish --project-path ./server spacetime
        # Generate
        cd server
        /home/ksollner/.local/bin/spacetime generate --lang typescript --out-dir ../client/src/generated
        cd ..
        ```

4.  **Run Client Dev Server:**
    ```sh
    cd client
    npm run dev
    ```
    *   Open the URL provided by Vite (usually `http://localhost:5173`) in your browser.

## VS Code Tasks (`.vscode/tasks.json`)

Tasks are provided for convenience but have limitations (see Known Issues).

-   `Client: dev`: Runs `npm run dev` in `/client`.
-   `Client: build`: Runs `npm run build` in `/client`.
-   `Server: start`: Attempts to run `spacetime start`. **(Currently unreliable, use manual start)**.
-   `Server: publish`: Attempts to publish the module. **(Requires manual server start)**.

*Note: Server tasks use the absolute path `/home/ksollner/.local/bin/spacetime` and include the `unset APPIMAGE` workaround.*

## Known Issues / Workarounds

1.  **`spacetime start` via VS Code Tasks:** Running the "Server: start" task often fails silently (`exit code 1`) even with correct paths and workarounds.
    *   **Workaround:** Run `unset ARGV0 && unset APPIMAGE && /home/ksollner/.local/bin/spacetime start` manually in a separate terminal.
2.  **AppImage Environment Conflict (`APPIMAGE`, `ARGV0`):** When running VS Code/Cursor as an AppImage, environment variables set by the AppImage interfere with the `spacetime` CLI and `cargo` (via `rustup` proxy).
    *   `APPIMAGE`: Causes `spacetime` internal command dispatching issues ("multicall binary" error).
    *   `ARGV0`: Causes `cargo build` (and potentially other `rustup` tools) to fail with an "unknown proxy name" error.
    *   **Workaround:** Prefix all relevant commands (`cargo build`, `spacetime start`, `spacetime publish`, `spacetime generate`) with `unset ARGV0 && unset APPIMAGE && ` when running them from within the AppImage environment. The provided tasks in `.vscode/tasks.json` already include this combined workaround. The `clean_publish.sh` script does *not* currently include this, so run it from a standard terminal if using AppImage.
3.  **Client SDK Typing:** Using the `@clockworklabs/spacetimedb-sdk` directly without generated code is difficult due to complex types and builder patterns.
    *   **Solution:** Always run `spacetime generate` (or use `clean_publish.sh`) after publishing the module and use the generated types/classes from `/client/src/generated`.
4.  **Entity ID Generation:** Using `#[auto_inc]` on the primary key caused internal SpacetimeDB errors during `publish`.
    *   **Solution:** The server now uses manual ID generation by querying the max existing ID + 1.
5.  **Wasm Time Limitations:** Standard Rust timing functions like `std::time::Instant` are not available in the Wasm environment used by SpacetimeDB modules. Use `ctx.timestamp` for basic timing information within reducers.

## Contributing

Pull requests and issues are welcome!