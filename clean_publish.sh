#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Define variables
DB_NAME="spacetime"
SERVER_DIR="server"
CLIENT_BINDINGS_DIR="client/src/module_bindings"
SPACETIME_CMD="/home/ksollner/.local/bin/spacetime"

# --- Script Start --- 
echo "--- IMPORTANT --- Ensure the SpacetimeDB server is running in another terminal before proceeding."
echo "$ spacetime start"
echo "Waiting 5 seconds to allow cancellation if server is not running..."
sleep 5

# Delete the existing local database (Requires running server)
echo "Deleting local database '$DB_NAME'..."
$SPACETIME_CMD delete $DB_NAME --yes

# Publish the server module (Requires running server)
echo "Publishing module from '$SERVER_DIR' to '$DB_NAME'..."
$SPACETIME_CMD publish --project-path $SERVER_DIR $DB_NAME

# Regenerate client bindings
echo "Regenerating TypeScript bindings in '$CLIENT_BINDINGS_DIR'..."
mkdir -p $CLIENT_BINDINGS_DIR
$SPACETIME_CMD generate --lang typescript --out-dir $CLIENT_BINDINGS_DIR --project-path $SERVER_DIR

echo "----------------------------------------------------"
echo "Clean publish and generation complete!"
echo "You may need to restart your client dev server and hard-refresh the browser." 