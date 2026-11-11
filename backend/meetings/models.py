import secrets
import string

from django.conf import settings
from django.db import models


def _chunk(n):
    return "".join(secrets.choice(string.ascii_lowercase) for _ in range(n))


def generate_meeting_code():
    """Codes look like `abc-defg-hij`."""
    while True:
        code = f"{_chunk(3)}-{_chunk(4)}-{_chunk(3)}"
        if not Meeting.objects.filter(code=code).exists():
            return code


class Meeting(models.Model):
    code = models.CharField(max_length=12, unique=True, default=generate_meeting_code, editable=False)
    title = models.CharField(max_length=200, blank=True)
    host = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="hosted_meetings")
    scheduled_for = models.DateTimeField(null=True, blank=True)
    require_approval = models.BooleanField(
        default=True, help_text="Guests must be admitted by the host before entering."
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.code} ({self.title or 'Untitled'})"


class Participant(models.Model):
    class Status(models.TextChoices):
        WAITING = "waiting"
        ADMITTED = "admitted"
        DENIED = "denied"
        LEFT = "left"

    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="participants")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="participations")
    peer_id = models.CharField(max_length=32, unique=True)
    display_name = models.CharField(max_length=80)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.WAITING)
    audio_on = models.BooleanField(default=True)
    video_on = models.BooleanField(default=True)
    hand_raised = models.BooleanField(default=False)
    is_sharing = models.BooleanField(default=False)
    joined_at = models.DateTimeField(auto_now_add=True, help_text="When the connection asked to join.")
    admitted_at = models.DateTimeField(null=True, blank=True, help_text="When they actually entered the call.")
    left_at = models.DateTimeField(null=True, blank=True)
    last_seen = models.DateTimeField(null=True, blank=True, help_text="Last heartbeat from this connection.")

    class Meta:
        indexes = [models.Index(fields=["meeting", "status"])]

    def __str__(self):
        return f"{self.display_name} in {self.meeting.code} [{self.status}]"


class ChatMessage(models.Model):
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="messages")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    peer_id = models.CharField(max_length=32, blank=True)
    display_name = models.CharField(max_length=80)
    text = models.TextField(max_length=2000, blank=True)
    # Attachment details (the bytes live in ChatFile so listing messages stays fast)
    file_name = models.CharField(max_length=255, blank=True)
    file_type = models.CharField(max_length=100, blank=True)
    file_size = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    @property
    def has_file(self):
        return self.file_size is not None


class ChatFile(models.Model):
    """
    File contents stored in the database. Render's disk is wiped on every
    deploy and whenever a free service sleeps, so files on disk would vanish.
    For heavy use, switch to S3 / Cloudflare R2 with django-storages.
    """

    message = models.OneToOneField(ChatMessage, on_delete=models.CASCADE, related_name="file_data")
    data = models.BinaryField()


class Whiteboard(models.Model):
    """One shared whiteboard per meeting. `state` holds pages and their items (see whiteboard.py)."""

    meeting = models.OneToOneField(Meeting, on_delete=models.CASCADE, related_name="whiteboard")
    state = models.JSONField(default=dict)
    locked = models.BooleanField(default=False, help_text="When on, only the host can draw.")
    updated_at = models.DateTimeField(auto_now=True)
