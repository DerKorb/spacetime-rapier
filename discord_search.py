import os, requests
from urllib.parse import urlencode
import argparse
from dotenv import load_dotenv
import json # Import json

# --- Constants ---
HISTORY_FILE = "guild_history.json"
# ----------------

# --- Load .env file ---
load_dotenv()
# ---------------------

# --- Guild History Management ---
def load_guild_history():
    if not os.path.exists(HISTORY_FILE):
        return {"guilds": {}, "last_used_id": None}
    try:
        with open(HISTORY_FILE, 'r') as f:
            return json.load(f)
    except json.JSONDecodeError:
        print(f"Warning: Could not decode {HISTORY_FILE}. Starting fresh.")
        return {"guilds": {}, "last_used_id": None}

def save_guild_history(history):
    try:
        with open(HISTORY_FILE, 'w') as f:
            json.dump(history, f, indent=2)
    except IOError as e:
        print(f"Error saving guild history to {HISTORY_FILE}: {e}")

def find_guild_id_by_name(history, name):
    for gid, data in history.get("guilds", {}).items():
        if data.get("name") == name:
            return gid
    return None
# ----------------------------

# --- Argument Parsing ---
parser = argparse.ArgumentParser(description="Search Discord messages in a specific guild.")
parser.add_argument("query", help="The search string to look for in messages.")
parser.add_argument("--guild-id", help="Specify the Guild ID directly.")
parser.add_argument("--guild-name", help="Specify the Guild by its saved name.")
args = parser.parse_args()
# ------------------------

# --- Determine Guild ID ---
history = load_guild_history()
selected_guild_id = None
selected_guild_name = None

if args.guild_id:
    selected_guild_id = args.guild_id
    # Update history with this ID if it's new, or just update last_used
    if selected_guild_id not in history["guilds"]:
        # Maybe prompt for a name here in the future?
        history["guilds"][selected_guild_id] = {"name": f"Unnamed Guild {selected_guild_id}"}
    selected_guild_name = history["guilds"][selected_guild_id]["name"]
elif args.guild_name:
    selected_guild_id = find_guild_id_by_name(history, args.guild_name)
    if not selected_guild_id:
        print(f"Error: Guild name '{args.guild_name}' not found in {HISTORY_FILE}")
        exit(1)
    selected_guild_name = args.guild_name
else:
    # Default to last used ID
    selected_guild_id = history.get("last_used_id")
    if not selected_guild_id or selected_guild_id not in history["guilds"]:
        print(f"Error: No default Guild ID set or found. Please specify one with --guild-id or --guild-name.")
        # Optional: List available guilds here
        if history["guilds"]:
             print("Available guilds:")
             for gid, data in history["guilds"].items():
                 print(f"  ID: {gid}, Name: {data.get('name', 'N/A')}")
        exit(1)
    selected_guild_name = history["guilds"][selected_guild_id]["name"]

# Update last used ID and save history
if selected_guild_id:
    history["last_used_id"] = selected_guild_id
    save_guild_history(history)
# --------------------------

# ── CONFIG ─────────────────────────────────────────────────────────────
TOKEN      = os.getenv("DISCORD_TOKEN")
# GUILD_ID   = "1037340874172014652"              # REMOVED: Now determined dynamically
GUILD_ID   = selected_guild_id                  # USE SELECTED ID
QUERY      = args.query
OUTPUT_TXT = "results.txt"
# ──────────────────────────────────────────────────────────────────────

headers = {
    "Authorization": TOKEN,
    "User-Agent": "Mozilla/5.0"
}

def fetch(offset):
    params = {
        "content": args.query,
        "include_nsfw": True,
        "limit": 25,
        "offset": offset
    }
    # url = f"https://discord.com/api/v9/guilds/{GUILD_ID}/messages/search?{urlencode(params)}" # Use the variable directly
    # Use the selected guild ID for the URL
    url = f"https://discord.com/api/v9/guilds/{selected_guild_id}/messages/search?{urlencode(params)}"
    # Check if token is loaded
    if not TOKEN:
        print("Error: DISCORD_TOKEN environment variable not set.")
        return {"messages": [], "error": "Token not set"}
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status() # Raise an exception for bad status codes (4xx or 5xx)
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error fetching data: {e}")
        # Attempt to parse JSON even on error for more info (e.g., rate limits)
        try:
            error_data = response.json()
            print(f"API Error details: {error_data}")
            return {"messages": [], "error": error_data}
        except ValueError: # Includes JSONDecodeError
             print(f"Non-JSON response content: {response.text}")
             return {"messages": [], "error": "Request failed with non-JSON response"}


with open(OUTPUT_TXT, "w", encoding="utf-8") as out:
    offset = 0
    total_fetched = 0
    # print(f"Searching in guild {GUILD_ID} for '{args.query}'...") # Use the variable directly
    # Use selected guild name and ID in the print statement
    print(f"Searching in guild '{selected_guild_name}' ({selected_guild_id}) for '{args.query}'...")
    while True:
        data = fetch(offset)
        # Handle potential errors from fetch
        if data.get("error"):
            if data["error"] == "Token not set":
                 break # Stop if token isn't set
            # Log other errors but potentially continue/retry depending on error type?
            # For now, just break on any fetch error.
            print("Stopping due to fetch error.")
            break

        messages = data.get("messages", [])
        # messages is a list-of-lists [[msg, channel, guild], …]
        flat = [entry[0] for entry in messages if entry] # Add check for empty entry
        if not flat:
            print(f"No more messages found at offset {offset}.")
            break
        for m in flat:
            # Add checks for potentially missing keys
            author_info = m.get("author", {})
            author_name = author_info.get("username", "UnknownUser")
            discriminator = author_info.get("discriminator", "0000")
            author = f"{author_name}#{discriminator}"

            content = m.get("content", "").replace("\n", " ") # Ensure content exists
            timestamp = m.get("timestamp", "UnknownTimestamp") # Ensure timestamp exists
            out.write(f"[{timestamp}] {author}: {content}\n")
        fetched_count = len(flat)
        total_fetched += fetched_count
        print(f"Fetched {fetched_count} messages (total {total_fetched}). Next offset: {offset + fetched_count}")
        offset += fetched_count # Use actual fetched count for next offset

    print(f"Search complete. Results written to {OUTPUT_TXT}. Total messages fetched: {total_fetched}") 