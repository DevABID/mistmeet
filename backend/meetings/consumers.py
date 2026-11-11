"""
Real-time layer for MIST Meet.

Each browser tab opens one WebSocket per meeting. The server never touches
audio/video: it only relays WebRTC signaling (SDP offers/answers and ICE
candidates) between peers, and coordinates the waiting room, chat,
reactions, media-state badges and host controls.

Groups used on the channel layer:
  room_<code>   everyone admitted to the call
  hosts_<code>  the host's connections (receive join requests)
  peer_<id>     one connection, for direct messages
"""

import logging
import re
import uuid
from datetime import timedelta

from channels.db import database_sync_to_async
from django.conf import settings
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db import transaction
from django.utils import timezone

from accounts.serializers import display_name_for

from .chat import chat_payload
from .models import ChatMessage, Meeting, Participant, Whiteboard
from .whiteboard import apply_op, initial_state, sanitize_item, sanitize_op

logger = logging.getLogger(__name__)

# A connection that hasn't sent a heartbeat for this long is treated as gone.
# Browsers send one every 20 seconds (background tabs may send less often).
STALE_AFTER = timedelta(seconds=150)

PEER_ID_RE = re.compile(r"^[0-9a-f]{32}$")
REACTIONS = {"💖", "👍", "🎉", "👏", "😂", "😮", "😢", "🤔", "👎"}
STATE_FIELDS = {"audio": "audio_on", "video": "video_on", "hand": "hand_raised", "sharing": "is_sharing"}


class MeetingConsumer(AsyncJsonWebsocketConsumer):
    # ------------------------------------------------------------------ lifecycle

    async def connect(self):
        self.groups_joined = []
        self.participant_id = None
        self.admitted = False

        await self.accept()

        self.user = self.scope.get("user")
        if not self.user or not self.user.is_authenticated:
            await self.fail("unauthorized")
            return

        self.code = self.scope["url_route"]["kwargs"]["code"]
        self.meeting = await self.get_meeting()
        if self.meeting is None:
            await self.fail("not-found")
            return
        if not self.meeting.is_active:
            await self.fail("ended")
            return

        self.peer_id = uuid.uuid4().hex
        self.is_host = self.meeting.host_id == self.user.id
        self.room_group = f"room_{self.code}"
        self.host_group = f"hosts_{self.code}"
        await self.join_group(f"peer_{self.peer_id}")

    async def disconnect(self, close_code):
        if self.participant_id:
            previous = await self.mark_left()
            if previous == Participant.Status.ADMITTED:
                await self.broadcast({"type": "peer-left", "peer_id": self.peer_id}, exclude_self=True)
            elif previous == Participant.Status.WAITING:
                await self.to_group(self.host_group, {"type": "join-request-cancelled", "peer_id": self.peer_id})
        for group in self.groups_joined:
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive_json(self, content, **kwargs):
        handlers = {
            "join": self.handle_join,
            "signal": self.handle_signal,
            "state": self.handle_state,
            "chat": self.handle_chat,
            "reaction": self.handle_reaction,
            "admit": self.handle_admission,
            "deny": self.handle_admission,
            "host-mute": self.handle_host_mute,
            "host-remove": self.handle_host_remove,
            "end-meeting": self.handle_end_meeting,
            "wb-sync": self.handle_wb_sync,
            "wb-op": self.handle_wb_op,
            "wb-draft": self.handle_wb_draft,
            "wb-lock": self.handle_wb_lock,
            "wb-show": self.handle_wb_show,
        }
        handlers["ping"] = self.handle_ping
        kind = content.get("type")
        handler = handlers.get(kind)
        if handler is None or not hasattr(self, "peer_id"):
            return
        if kind not in ("join", "ping") and not self.admitted:
            return
        try:
            await handler(content)
        except Exception:
            # Never drop the call because one action failed: log it and tell the user.
            logger.exception("Error handling %r message in meeting %s", kind, getattr(self, "code", "?"))
            message = "Something went wrong on the server, so that action didn't go through. Try again."
            if kind.startswith("wb-"):
                await self.send_json({"type": "wb-error", "message": message})
            else:
                await self.send_json({"type": "server-error", "message": message})

    # ------------------------------------------------------------------ client messages

    async def handle_join(self, content):
        if self.participant_id:
            return
        name = str(content.get("name") or display_name_for(self.user)).strip()[:80] or self.user.username
        self.display_name = name
        self.participant_id, admitted_before = await self.create_participant(
            name, bool(content.get("audio")), bool(content.get("video"))
        )

        if self.is_host or not self.meeting.require_approval or admitted_before:
            await self.enter_room()
            return

        await self.send_json({"type": "waiting"})
        await self.to_group(self.host_group, {"type": "join-request", "peer_id": self.peer_id, "name": name})

    async def handle_ping(self, content):
        if not self.participant_id:
            return
        await self.update_participant(last_seen=timezone.now())
        now = timezone.now()
        if now - getattr(self, "last_sweep", now - STALE_AFTER) >= timedelta(seconds=30):
            self.last_sweep = now
            await self.sweep_stale()

    async def sweep_stale(self):
        """Remove sessions whose browser stopped responding (closed laptop, crash, lost network)."""
        gone = await self.close_stale_sessions()
        for peer_id, previous in gone:
            if previous == Participant.Status.ADMITTED:
                await self.broadcast({"type": "peer-left", "peer_id": peer_id})
            else:
                await self.to_group(self.host_group, {"type": "join-request-cancelled", "peer_id": peer_id})

    async def handle_signal(self, content):
        target = str(content.get("to") or "")
        if not PEER_ID_RE.match(target) or content.get("data") is None:
            return
        await self.to_group(f"peer_{target}", {"type": "signal", "from": self.peer_id, "data": content["data"]})

    async def handle_state(self, content):
        changes = {key: bool(content[key]) for key in STATE_FIELDS if key in content}
        if not changes:
            return
        await self.update_participant(**{STATE_FIELDS[k]: v for k, v in changes.items()})
        await self.broadcast({"type": "peer-state", "peer_id": self.peer_id, **changes})

    async def handle_chat(self, content):
        text = str(content.get("text") or "").strip()[:2000]
        if not text:
            return
        message = await self.save_message(text)
        await self.broadcast(chat_payload(message, self.code))

    async def handle_reaction(self, content):
        emoji = content.get("emoji")
        if emoji in REACTIONS:
            await self.broadcast({"type": "reaction", "peer_id": self.peer_id, "name": self.display_name, "emoji": emoji})

    async def handle_admission(self, content):
        target = str(content.get("peer_id") or "")
        if not self.is_host or not PEER_ID_RE.match(target):
            return
        admit = content["type"] == "admit"
        updated = await self.resolve_waiting(target, admit)
        if not updated:
            return
        await self.channel_layer.group_send(f"peer_{target}", {"type": "admission", "admitted": admit})
        await self.to_group(self.host_group, {"type": "join-request-resolved", "peer_id": target})

    async def handle_host_mute(self, content):
        target = str(content.get("peer_id") or "")
        if self.is_host and PEER_ID_RE.match(target):
            await self.to_group(f"peer_{target}", {"type": "force-mute", "by": self.display_name})

    async def handle_host_remove(self, content):
        target = str(content.get("peer_id") or "")
        if self.is_host and PEER_ID_RE.match(target) and target != self.peer_id:
            await self.channel_layer.group_send(f"peer_{target}", {"type": "removed"})

    async def handle_end_meeting(self, content):
        if not self.is_host:
            return
        waiting = await self.end_meeting()
        await self.channel_layer.group_send(self.room_group, {"type": "meeting_ended"})
        for peer_id in waiting:
            await self.channel_layer.group_send(f"peer_{peer_id}", {"type": "meeting_ended"})

    # ------------------------------------------------------------------ whiteboard

    async def handle_wb_sync(self, content):
        await self.send_json({"type": "wb-state", **(await self.wb_snapshot())})

    async def handle_wb_op(self, content):
        op = sanitize_op(content.get("op"))
        if op is None:
            return
        error = await self.wb_apply(op)
        if error:
            # Tell the sender why, and resend the true board so their view stays correct.
            await self.send_json({"type": "wb-error", "message": error})
            await self.send_json({"type": "wb-state", **(await self.wb_snapshot())})
            return
        await self.broadcast({"type": "wb-op", "op": op, "by": self.peer_id}, exclude_self=True)

    async def handle_wb_draft(self, content):
        # Live preview of a stroke while it's being drawn. Not saved.
        item = sanitize_item(content.get("item"))
        page = content.get("page")
        if item is None or not isinstance(page, str) or len(page) > 40:
            return
        await self.broadcast({"type": "wb-draft", "page": page, "item": item, "by": self.peer_id}, exclude_self=True)

    async def handle_wb_lock(self, content):
        if not self.is_host:
            return
        locked = bool(content.get("locked"))
        await self.wb_set_locked(locked)
        await self.broadcast({"type": "wb-lock", "locked": locked})

    async def handle_wb_show(self, content):
        if self.is_host:
            await self.broadcast({"type": "wb-show", "by": self.display_name}, exclude_self=True)

    # ------------------------------------------------------------------ channel-layer events

    async def relay(self, event):
        if event.get("exclude") == self.peer_id:
            return
        await self.send_json(event["payload"])

    async def admission(self, event):
        if self.admitted:
            return
        if event["admitted"]:
            await self.enter_room()
        else:
            await self.send_json({"type": "denied"})
            await self.close()

    async def removed(self, event):
        await self.send_json({"type": "removed"})
        await self.close()

    async def meeting_ended(self, event):
        await self.send_json({"type": "meeting-ended"})
        await self.close()

    # ------------------------------------------------------------------ helpers

    async def enter_room(self):
        self.admitted = True
        await self.update_participant(status=Participant.Status.ADMITTED, admitted_at=timezone.now())
        await self.sweep_stale()
        await self.join_group(self.room_group)
        if self.is_host:
            await self.join_group(self.host_group)

        peers, waiting, me = await self.room_snapshot()
        await self.send_json(
            {
                "type": "room-state",
                "self_id": self.peer_id,
                "is_host": self.is_host,
                "peers": peers,
                "waiting": waiting if self.is_host else [],
                "meeting": {"code": self.code, "title": self.meeting.title},
                "limits": {"file_mb": settings.CHAT_FILE_MAX_MB},
            }
        )
        await self.broadcast({"type": "peer-joined", "peer": me}, exclude_self=True)

    async def fail(self, reason):
        await self.send_json({"type": "error", "reason": reason})
        await self.close()

    async def join_group(self, group):
        await self.channel_layer.group_add(group, self.channel_name)
        self.groups_joined.append(group)

    async def to_group(self, group, payload):
        await self.channel_layer.group_send(group, {"type": "relay", "payload": payload})

    async def broadcast(self, payload, exclude_self=False):
        event = {"type": "relay", "payload": payload}
        if exclude_self:
            event["exclude"] = self.peer_id
        await self.channel_layer.group_send(self.room_group, event)

    # ------------------------------------------------------------------ database

    @database_sync_to_async
    def get_meeting(self):
        return Meeting.objects.filter(code=self.code).first()

    @database_sync_to_async
    def create_participant(self, name, audio, video):
        admitted_before = Participant.objects.filter(
            meeting=self.meeting, user=self.user, admitted_at__isnull=False
        ).exists()
        participant = Participant.objects.create(
            meeting=self.meeting,
            user=self.user,
            peer_id=self.peer_id,
            display_name=name,
            audio_on=audio,
            video_on=video,
            last_seen=timezone.now(),
        )
        return participant.id, admitted_before

    @database_sync_to_async
    def update_participant(self, **fields):
        Participant.objects.filter(id=self.participant_id).update(**fields)

    @database_sync_to_async
    def mark_left(self):
        participant = Participant.objects.filter(id=self.participant_id).first()
        if participant is None:
            return None
        previous = participant.status
        if previous in (Participant.Status.WAITING, Participant.Status.ADMITTED):
            participant.status = Participant.Status.LEFT
            participant.left_at = timezone.now()
            participant.save(update_fields=["status", "left_at"])
        return previous

    @database_sync_to_async
    def resolve_waiting(self, peer_id, admit):
        new_status = Participant.Status.ADMITTED if admit else Participant.Status.DENIED
        return Participant.objects.filter(
            meeting=self.meeting, peer_id=peer_id, status=Participant.Status.WAITING
        ).update(status=new_status)

    @database_sync_to_async
    def room_snapshot(self):
        host_id = self.meeting.host_id

        def info(p):
            return {
                "peer_id": p.peer_id,
                "name": p.display_name,
                "audio": p.audio_on,
                "video": p.video_on,
                "hand": p.hand_raised,
                "sharing": p.is_sharing,
                "is_host": p.user_id == host_id,
            }

        admitted = list(Participant.objects.filter(meeting=self.meeting, status=Participant.Status.ADMITTED))
        me = next(info(p) for p in admitted if p.peer_id == self.peer_id)
        peers = [info(p) for p in admitted if p.peer_id != self.peer_id]
        waiting = [
            {"peer_id": p.peer_id, "name": p.display_name}
            for p in Participant.objects.filter(meeting=self.meeting, status=Participant.Status.WAITING)
        ]
        return peers, waiting, me

    @database_sync_to_async
    def save_message(self, text):
        return ChatMessage.objects.create(
            meeting=self.meeting, user=self.user, peer_id=self.peer_id, display_name=self.display_name, text=text
        )

    @database_sync_to_async
    def close_stale_sessions(self):
        cutoff = timezone.now() - STALE_AFTER
        stale = list(
            Participant.objects.filter(
                meeting=self.meeting,
                status__in=[Participant.Status.ADMITTED, Participant.Status.WAITING],
                last_seen__lt=cutoff,
            ).exclude(peer_id=self.peer_id)
        ) + list(
            # Sessions from before heartbeats existed
            Participant.objects.filter(
                meeting=self.meeting,
                status__in=[Participant.Status.ADMITTED, Participant.Status.WAITING],
                last_seen__isnull=True,
                joined_at__lt=cutoff,
            ).exclude(peer_id=self.peer_id)
        )
        gone = []
        for p in stale:
            gone.append((p.peer_id, p.status))
            p.status = Participant.Status.LEFT
            p.left_at = p.last_seen or cutoff
            p.save(update_fields=["status", "left_at"])
        return gone

    @database_sync_to_async
    def wb_snapshot(self):
        board, _ = Whiteboard.objects.get_or_create(meeting=self.meeting)
        is_new = not isinstance(board.state, dict) or not board.state.get("pages")
        state = initial_state(board.state)
        if is_new:
            board.state = state
            board.save(update_fields=["state", "updated_at"])
        return {"pages": state["pages"], "current": state["current"], "locked": board.locked}

    @database_sync_to_async
    def wb_apply(self, op):
        with transaction.atomic():
            board, _ = Whiteboard.objects.select_for_update().get_or_create(meeting=self.meeting)
            if board.locked and not self.is_host:
                return "The host has locked the whiteboard. Only the host can draw right now."
            if op["op"] == "clear" and not self.is_host:
                return "Only the host can clear a page."
            state = initial_state(board.state)
            error = apply_op(state, op)
            if error:
                return error
            board.state = state
            board.save(update_fields=["state", "updated_at"])
        return None

    @database_sync_to_async
    def wb_set_locked(self, locked):
        board, _ = Whiteboard.objects.get_or_create(meeting=self.meeting)
        board.locked = locked
        board.save(update_fields=["locked", "updated_at"])

    @database_sync_to_async
    def end_meeting(self):
        now = timezone.now()
        Meeting.objects.filter(id=self.meeting.id).update(is_active=False, ended_at=now)
        # Close every open session at the moment the host ended the call, so
        # attendance times are exact even if some sockets disconnect late.
        Participant.objects.filter(meeting=self.meeting, status=Participant.Status.ADMITTED).update(
            status=Participant.Status.LEFT, left_at=now
        )
        waiting = list(
            Participant.objects.filter(meeting=self.meeting, status=Participant.Status.WAITING).values_list(
                "peer_id", flat=True
            )
        )
        return waiting
