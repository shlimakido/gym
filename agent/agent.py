"""Claude AI agent with Google Calendar tools."""
import json
import os
from datetime import date, datetime

import anthropic
from calendar_service import create_event, delete_event, list_events, update_event

TIMEZONE = os.getenv("TIMEZONE", "Asia/Jerusalem")

# Tool definitions for Claude
TOOLS = [
    {
        "name": "create_calendar_event",
        "description": (
            "Create a new event in Google Calendar. "
            "Use this when the user asks to schedule, add, or create a meeting/appointment/reminder."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Event title"},
                "start_datetime": {
                    "type": "string",
                    "description": "Start date and time in ISO format: YYYY-MM-DDTHH:MM:SS",
                },
                "end_datetime": {
                    "type": "string",
                    "description": "End date and time in ISO format: YYYY-MM-DDTHH:MM:SS",
                },
                "description": {"type": "string", "description": "Optional event description or notes"},
                "location": {"type": "string", "description": "Optional event location"},
                "attendees": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional list of attendee email addresses",
                },
            },
            "required": ["title", "start_datetime", "end_datetime"],
        },
    },
    {
        "name": "list_calendar_events",
        "description": (
            "List upcoming events from Google Calendar. "
            "Use when the user asks what events they have, what's on their schedule, "
            "or wants to see their calendar."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "date_from": {
                    "type": "string",
                    "description": "Start date in ISO format: YYYY-MM-DD",
                },
                "date_to": {
                    "type": "string",
                    "description": "End date in ISO format: YYYY-MM-DD",
                },
            },
            "required": ["date_from", "date_to"],
        },
    },
    {
        "name": "delete_calendar_event",
        "description": "Delete a calendar event by its ID. Ask the user to confirm before deleting.",
        "input_schema": {
            "type": "object",
            "properties": {
                "event_id": {"type": "string", "description": "The Google Calendar event ID"},
            },
            "required": ["event_id"],
        },
    },
    {
        "name": "update_calendar_event",
        "description": "Update an existing calendar event (change time, title, location, etc.).",
        "input_schema": {
            "type": "object",
            "properties": {
                "event_id": {"type": "string", "description": "The Google Calendar event ID to update"},
                "title": {"type": "string", "description": "New title (optional)"},
                "start_datetime": {"type": "string", "description": "New start datetime ISO: YYYY-MM-DDTHH:MM:SS (optional)"},
                "end_datetime": {"type": "string", "description": "New end datetime ISO: YYYY-MM-DDTHH:MM:SS (optional)"},
                "description": {"type": "string", "description": "New description (optional)"},
                "location": {"type": "string", "description": "New location (optional)"},
            },
            "required": ["event_id"],
        },
    },
]

SYSTEM_PROMPT = f"""אתה עוזר אישי חכם לניהול יומן Google Calendar.
המשתמש מתקשר איתך דרך WhatsApp בעברית (ולפעמים באנגלית).

התאריך והשעה הנוכחיים: {{now}}
אזור זמן: {TIMEZONE}

הנחיות:
- הבן בקשות לוח שנה בשפה טבעית (עברית/אנגלית)
- כאשר לא צוינה שנה, הנח שנה נוכחית
- כאשר לא צוין זמן סיום, הנח פגישה של שעה אחת
- הצג אישורים ורשימות בעברית, בצורה קריאה ונוחה
- לתאריכים ושעות בתגובות - השתמש בפורמט ידידותי: "יום שלישי, 10 ביוני 2025 בשעה 14:00"
- לפני מחיקה - תמיד בקש אישור מהמשתמש
- אם חסר מידע (כמו תאריך או שעה) - שאל את המשתמש
"""


def _run_tool(tool_name: str, tool_input: dict) -> str:
    if tool_name == "create_calendar_event":
        result = create_event(**tool_input)
    elif tool_name == "list_calendar_events":
        result = list_events(**tool_input)
    elif tool_name == "delete_calendar_event":
        result = delete_event(**tool_input)
    elif tool_name == "update_calendar_event":
        result = update_event(**tool_input)
    else:
        result = {"error": f"Unknown tool: {tool_name}"}
    return json.dumps(result, ensure_ascii=False)


def process_message(user_message: str, conversation_history: list[dict]) -> tuple[str, list[dict]]:
    """
    Process a user message through the Claude agent with calendar tools.
    Returns (reply_text, updated_conversation_history).
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    now = datetime.now().strftime("%Y-%m-%d %H:%M (%A)")
    system = SYSTEM_PROMPT.format(now=now)

    messages = conversation_history + [{"role": "user", "content": user_message}]

    # Agentic loop
    while True:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            system=system,
            tools=TOOLS,
            messages=messages,
        )

        # Add assistant response to history
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "end_turn":
            # Extract text reply
            text = next(
                (block.text for block in response.content if hasattr(block, "text")),
                "סיימתי.",
            )
            return text, messages

        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    result = _run_tool(block.name, block.input)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    })

            messages.append({"role": "user", "content": tool_results})
            continue

        # Unexpected stop reason
        break

    return "מצטער, לא הצלחתי לעבד את הבקשה.", messages
