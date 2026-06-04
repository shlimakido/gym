"""
Run this script ONCE to authorize access to your Google Calendar.
It will open a browser window, ask you to log in with your Google account,
and save a token.json file that the agent uses automatically from then on.

Usage:
    python setup_oauth.py
"""
import os
from dotenv import load_dotenv
load_dotenv()

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/calendar"]
CREDENTIALS_FILE = os.getenv("GOOGLE_CREDENTIALS_FILE", "credentials.json")
TOKEN_FILE = os.getenv("GOOGLE_TOKEN_FILE", "token.json")

if not os.path.exists(CREDENTIALS_FILE):
    print(f"ERROR: '{CREDENTIALS_FILE}' not found.")
    print("Download it from Google Cloud Console → Credentials → OAuth 2.0 Client → Download JSON")
    exit(1)

flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
creds = flow.run_local_server(port=0)

with open(TOKEN_FILE, "w") as f:
    f.write(creds.to_json())

print(f"\nSuccess! '{TOKEN_FILE}' saved. You can now run the agent.")
