# SpacetimeDB Multiplayer Demo

## Overview

This project is a multiplayer demo using [SpacetimeDB](https://spacetimedb.com/) as the backend and a web-based client built with [Three.js](https://threejs.org/). The goal is to demonstrate real-time entity synchronization and interaction in a 3D environment, leveraging SpacetimeDB's transactional, in-memory database and Rust-powered server modules.

## Current State

- **SpacetimeDB Server**:  
  - Written in Rust, using SpacetimeDB's module system.
  - Defines an `Entity` table with `id`, `x`, `y`, and `z` fields.
  - Exposes a `spawn` reducer to create new entities in the database.
  - The server is running locally and can be published/queried using the SpacetimeDB CLI.

- **Client**:  
  - Built with JavaScript and Three.js.
  - Connects to the SpacetimeDB backend.
  - Currently displays a 3D scene; integration with entity data is in progress.
  - OrbitControls are being added for interactive camera movement.

- **Repository**:  
  - `.gitignore` is set up to exclude build artifacts, dependencies, and environment files for both Rust and Node.js.
  - Only source and configuration files are tracked in git.

## Goals

- **Short-term**
  - Display entities from SpacetimeDB in the Three.js scene.
  - Allow users to spawn new entities via the client and see them update in real time.
  - Polish the client UI and camera controls (using OrbitControls).

- **Long-term**
  - Implement more complex entity interactions (movement, deletion, etc.).
  - Add authentication and user management.
  - Deploy the project for public multiplayer testing.
  - Document the codebase and setup process for contributors.

## Getting Started

1. **Install dependencies:**
   - For the server:  
     ```sh
     cd server
     cargo build
     ```
   - For the client:  
     ```sh
     cd client
     npm install
     ```

2. **Run SpacetimeDB server:**
   ```sh
   spacetime start
   ```

3. **Publish the Rust module:**
   ```sh
   cd server
   spacetime publish --project-path . spacetime
   ```

4. **Run the client:**
   ```sh
   cd client
   npm start
   ```

## Contributing

Pull requests and issues are welcome! Please see the code and open an issue if you have questions or suggestions. 