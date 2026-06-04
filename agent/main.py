"""WhatsApp webhook server for the AI Calendar Agent."""
import os
from collections import defaultdict
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Form, Request, Response
from twilio.request_validator import RequestValidator
from twilio.rest import Client as TwilioClient
from agent import process_message

app = FastAPI(title="WhatsApp AI Calendar Agent")

# Per-user conversation history (in-memory; resets on server restart)
# For production, replace with Redis or a database.
conversations: dict[str, list[dict]] = defaultdict(list)

TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_FROM = os.getenv("TWILIO_WHATSAPP_FROM", "")
MY_NUMBER = os.getenv("MY_WHATSAPP_NUMBER", "")

twilio_client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)


def send_whatsapp(to: str, body: str) -> None:
    twilio_client.messages.create(from_=TWILIO_FROM, to=to, body=body)


def _validate_twilio(request: Request, form_data: dict) -> bool:
    """Validate that the incoming request is genuinely from Twilio."""
    validator = RequestValidator(TWILIO_AUTH_TOKEN)
    signature = request.headers.get("X-Twilio-Signature", "")
    url = str(request.url)
    return validator.validate(url, form_data, signature)


@app.post("/webhook/whatsapp")
async def whatsapp_webhook(
    request: Request,
    From: str = Form(...),
    Body: str = Form(...),
    NumMedia: str = Form(default="0"),
):
    # Security: validate the request came from Twilio
    form_data = dict(await request.form())
    if TWILIO_AUTH_TOKEN and not _validate_twilio(request, form_data):
        return Response(content="Forbidden", status_code=403)

    # Only respond to the owner's number
    if MY_NUMBER and From != MY_NUMBER:
        return Response(content="", media_type="text/xml")

    user_message = Body.strip()
    if not user_message:
        return Response(content="", media_type="text/xml")

    # Keep conversation history per user (last 20 turns to avoid token overflow)
    history = conversations[From][-20:]

    reply, updated_history = process_message(user_message, history)

    # Store updated history (keep last 20 turns)
    conversations[From] = updated_history[-20:]

    send_whatsapp(From, reply)

    # Return empty TwiML (we already sent via API, not TwiML response)
    return Response(content='<?xml version="1.0"?><Response></Response>', media_type="text/xml")


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
