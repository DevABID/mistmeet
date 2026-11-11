"""Chat message payloads and signed file links, shared by the API and the WebSocket consumer."""

from django.core import signing

FILE_LINK_SALT = "mistmeet.chat-file"

# Only these are shown inline in the browser. Everything else (including SVG and
# HTML, which can carry scripts) is always sent as a download.
INLINE_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}

# Program files are blocked to keep people from passing malware around.
BLOCKED_EXTENSIONS = {
    ".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".pif", ".ps1", ".vbs", ".vbe",
    ".js", ".jse", ".wsf", ".wsh", ".jar", ".reg", ".lnk", ".hta", ".cpl", ".dll", ".sh",
}


def file_path(code, message_id):
    """API path for a message's file. The signature makes it unguessable."""
    token = signing.dumps(message_id, salt=FILE_LINK_SALT)
    return f"/api/meetings/{code}/files/{message_id}/?t={token}"


def chat_payload(message, code):
    payload = {
        "type": "chat",
        "id": message.id,
        "peer_id": message.peer_id,
        "name": message.display_name,
        "text": message.text,
        "created_at": message.created_at.isoformat(),
        "file": None,
    }
    if message.has_file:
        payload["file"] = {
            "name": message.file_name,
            "type": message.file_type,
            "size": message.file_size,
            "is_image": message.file_type in INLINE_IMAGE_TYPES,
            "url": file_path(code, message.id),
        }
    return payload
