import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SCOPES = ["https://www.googleapis.com/auth/calendar"]
TIMEZONE = os.getenv("TIMEZONE", "Asia/Jerusalem")
CALENDAR_ID = os.getenv("GOOGLE_CALENDAR_ID", "primary")


def _get_service():
    key_file = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "service_account.json")
    creds = service_account.Credentials.from_service_account_file(key_file, scopes=SCOPES)
    return build("calendar", "v3", credentials=creds)


def create_event(
    title: str,
    start_datetime: str,
    end_datetime: str,
    description: str = "",
    location: str = "",
    attendees: list[str] | None = None,
) -> dict:
    """Create a Google Calendar event. Datetimes must be ISO format: YYYY-MM-DDTHH:MM:SS"""
    service = _get_service()

    tz = ZoneInfo(TIMEZONE)
    start_dt = datetime.fromisoformat(start_datetime).replace(tzinfo=tz)
    end_dt = datetime.fromisoformat(end_datetime).replace(tzinfo=tz)

    event_body: dict = {
        "summary": title,
        "description": description,
        "location": location,
        "start": {"dateTime": start_dt.isoformat(), "timeZone": TIMEZONE},
        "end": {"dateTime": end_dt.isoformat(), "timeZone": TIMEZONE},
    }

    if attendees:
        event_body["attendees"] = [{"email": e} for e in attendees]

    try:
        event = service.events().insert(calendarId=CALENDAR_ID, body=event_body, sendUpdates="all").execute()
        return {
            "success": True,
            "event_id": event["id"],
            "link": event.get("htmlLink", ""),
            "title": event["summary"],
            "start": event["start"]["dateTime"],
            "end": event["end"]["dateTime"],
        }
    except HttpError as e:
        return {"success": False, "error": str(e)}


def list_events(date_from: str, date_to: str) -> dict:
    """List events between two dates (ISO format: YYYY-MM-DD)."""
    service = _get_service()
    tz = ZoneInfo(TIMEZONE)

    time_min = datetime.fromisoformat(date_from).replace(tzinfo=tz).isoformat()
    time_max = (datetime.fromisoformat(date_to) + timedelta(days=1)).replace(tzinfo=tz).isoformat()

    try:
        result = (
            service.events()
            .list(
                calendarId=CALENDAR_ID,
                timeMin=time_min,
                timeMax=time_max,
                singleEvents=True,
                orderBy="startTime",
                maxResults=20,
            )
            .execute()
        )
        events = []
        for e in result.get("items", []):
            start = e["start"].get("dateTime", e["start"].get("date", ""))
            end = e["end"].get("dateTime", e["end"].get("date", ""))
            events.append({
                "event_id": e["id"],
                "title": e.get("summary", "(ללא כותרת)"),
                "start": start,
                "end": end,
                "location": e.get("location", ""),
                "description": e.get("description", ""),
            })
        return {"success": True, "events": events}
    except HttpError as e:
        return {"success": False, "error": str(e)}


def delete_event(event_id: str) -> dict:
    """Delete a calendar event by its ID."""
    service = _get_service()
    try:
        service.events().delete(calendarId=CALENDAR_ID, eventId=event_id).execute()
        return {"success": True}
    except HttpError as e:
        return {"success": False, "error": str(e)}


def update_event(
    event_id: str,
    title: str | None = None,
    start_datetime: str | None = None,
    end_datetime: str | None = None,
    description: str | None = None,
    location: str | None = None,
) -> dict:
    """Update an existing calendar event."""
    service = _get_service()
    tz = ZoneInfo(TIMEZONE)

    try:
        event = service.events().get(calendarId=CALENDAR_ID, eventId=event_id).execute()
    except HttpError as e:
        return {"success": False, "error": str(e)}

    if title:
        event["summary"] = title
    if description is not None:
        event["description"] = description
    if location is not None:
        event["location"] = location
    if start_datetime:
        dt = datetime.fromisoformat(start_datetime).replace(tzinfo=tz)
        event["start"] = {"dateTime": dt.isoformat(), "timeZone": TIMEZONE}
    if end_datetime:
        dt = datetime.fromisoformat(end_datetime).replace(tzinfo=tz)
        event["end"] = {"dateTime": dt.isoformat(), "timeZone": TIMEZONE}

    try:
        updated = service.events().update(calendarId=CALENDAR_ID, eventId=event_id, body=event).execute()
        return {
            "success": True,
            "event_id": updated["id"],
            "title": updated["summary"],
            "start": updated["start"]["dateTime"],
            "end": updated["end"]["dateTime"],
        }
    except HttpError as e:
        return {"success": False, "error": str(e)}
