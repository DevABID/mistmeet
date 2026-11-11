import mimetypes
import os
from urllib.parse import urlencode

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from django.conf import settings
from django.core import signing
from django.db.models import F, Max
from django.db import transaction
from django.http import HttpResponse
from django.utils.http import content_disposition_header
from django.utils.text import slugify
from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .attendance import build_report, serialize
from .chat import BLOCKED_EXTENSIONS, FILE_LINK_SALT, INLINE_IMAGE_TYPES, chat_payload
from .models import ChatFile, ChatMessage, Meeting, Participant
from .pdf import render_attendance_pdf
from .serializers import MeetingSerializer


class MeetingListCreateView(generics.ListCreateAPIView):
    """GET: your upcoming / open meetings. POST: create a meeting (instant, later, or scheduled)."""

    serializer_class = MeetingSerializer
    pagination_class = None

    def get_queryset(self):
        mine = Meeting.objects.filter(host=self.request.user).select_related("host")
        if self.request.query_params.get("scope") == "past":
            # Meetings someone actually attended: ended ones, plus open links that were used.
            return (
                mine.annotate(last_activity=Max("participants__admitted_at"))
                .filter(last_activity__isnull=False)
                .order_by("-last_activity")[:50]
            )
        return mine.filter(is_active=True).order_by(F("scheduled_for").asc(nulls_last=True), "-created_at")[:50]

    def perform_create(self, serializer):
        serializer.save(host=self.request.user)


class MeetingDetailView(generics.RetrieveDestroyAPIView):
    serializer_class = MeetingSerializer
    lookup_field = "code"
    queryset = Meeting.objects.select_related("host")

    def perform_destroy(self, instance):
        if instance.host_id != self.request.user.id:
            raise PermissionDenied("Only the host can delete this meeting.")
        instance.delete()


class MeetingMessagesView(APIView):
    """Chat history, visible to the host and to anyone who was admitted to the call."""

    def get(self, request, code):
        meeting = get_object_or_404(Meeting, code=code)
        user = request.user
        allowed = meeting.host_id == user.id or meeting.participants.filter(
            user=user, admitted_at__isnull=False
        ).exists()
        if not allowed:
            raise PermissionDenied("Join the meeting to see its messages.")
        return Response([chat_payload(m, meeting.code) for m in meeting.messages.all()])


class ChatUploadView(APIView):
    """Send a file (optionally with a caption) to everyone in the call."""

    parser_classes = [MultiPartParser]

    def post(self, request, code):
        meeting = get_object_or_404(Meeting, code=code, is_active=True)
        participant = Participant.objects.filter(
            meeting=meeting,
            user=request.user,
            peer_id=str(request.data.get("peer_id", "")),
            status=Participant.Status.ADMITTED,
        ).first()
        if participant is None:
            raise PermissionDenied("Join the call to share files.")

        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError({"detail": "Choose a file to send."})
        limit_mb = settings.CHAT_FILE_MAX_MB
        if upload.size > limit_mb * 1024 * 1024:
            raise ValidationError({"detail": f"Files can be up to {limit_mb} MB."})

        name = os.path.basename(upload.name or "").strip()[:255] or "file"
        if os.path.splitext(name)[1].lower() in BLOCKED_EXTENSIONS:
            raise ValidationError({"detail": "Program files (like .exe, .bat or .js) can't be shared. Zip it first if you need to send it."})
        content_type = (upload.content_type or mimetypes.guess_type(name)[0] or "application/octet-stream")[:100]
        text = str(request.data.get("text") or "").strip()[:2000]

        with transaction.atomic():
            message = ChatMessage.objects.create(
                meeting=meeting,
                user=request.user,
                peer_id=participant.peer_id,
                display_name=participant.display_name,
                text=text,
                file_name=name,
                file_type=content_type,
                file_size=upload.size,
            )
            ChatFile.objects.create(message=message, data=upload.read())

        payload = chat_payload(message, meeting.code)
        async_to_sync(get_channel_layer().group_send)(
            f"room_{meeting.code}", {"type": "relay", "payload": payload}
        )
        return Response(payload, status=201)


class ChatFileView(APIView):
    """Serves a shared file. Authorised by the signed `t` link, so <img> tags and downloads work."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, code, message_id):
        try:
            signed_id = signing.loads(request.query_params.get("t", ""), salt=FILE_LINK_SALT)
        except signing.BadSignature:
            return HttpResponse("This file link isn't valid.", status=403, content_type="text/plain")
        if signed_id != message_id:
            return HttpResponse("This file link isn't valid.", status=403, content_type="text/plain")

        message = get_object_or_404(ChatMessage, id=message_id, meeting__code=code, file_size__isnull=False)
        blob = ChatFile.objects.filter(message=message).values_list("data", flat=True).first()
        if blob is None:
            return HttpResponse("This file is no longer available.", status=404, content_type="text/plain")
        data = bytes(blob)

        inline = message.file_type in INLINE_IMAGE_TYPES and request.query_params.get("download") != "1"
        response = HttpResponse(data, content_type=message.file_type or "application/octet-stream")
        response["Content-Disposition"] = content_disposition_header(not inline, message.file_name)
        response["Content-Length"] = str(len(data))
        # Never let a shared file run scripts on this site.
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
        response["Cross-Origin-Resource-Policy"] = "cross-origin"
        response["Cache-Control"] = "private, max-age=86400"
        return response


class IceServersView(APIView):
    def get(self, request):
        return Response({"iceServers": settings.ICE_SERVERS})


def _hosted_meeting(request, code):
    meeting = get_object_or_404(Meeting.objects.select_related("host"), code=code)
    if meeting.host_id != request.user.id:
        raise PermissionDenied("Only the host can see attendance for this meeting.")
    return meeting


class AttendanceView(APIView):
    """Attendance report as JSON (host only)."""

    def get(self, request, code):
        return Response(serialize(build_report(_hosted_meeting(request, code))))


PDF_LINK_SALT = "mistmeet.attendance-pdf"
PDF_LINK_MAX_AGE = 120  # seconds


class AttendancePdfLinkView(APIView):
    """
    Returns a short-lived signed URL for the PDF (host only).

    The browser then downloads the PDF with a normal link instead of a
    JavaScript fetch + blob, so the browser's own downloader, download
    managers like IDM, and mobile browsers all receive the same real file.
    """

    def get(self, request, code):
        meeting = _hosted_meeting(request, code)
        token = signing.dumps({"m": meeting.code, "u": request.user.id}, salt=PDF_LINK_SALT)
        query = urlencode({"t": token, "tz": request.query_params.get("tz", "UTC")})
        return Response({"url": f"/api/meetings/{meeting.code}/attendance/pdf/?{query}"})


class AttendancePdfView(APIView):
    """The PDF itself. Authorised by the signed `t` parameter, not by a header."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, code):
        try:
            data = signing.loads(request.query_params.get("t", ""), salt=PDF_LINK_SALT, max_age=PDF_LINK_MAX_AGE)
        except signing.BadSignature:
            return HttpResponse(
                "This download link has expired. Go back to the attendance page and click Download PDF again.",
                status=403,
                content_type="text/plain; charset=utf-8",
            )
        meeting = get_object_or_404(Meeting.objects.select_related("host"), code=code)
        if data.get("m") != meeting.code or data.get("u") != meeting.host_id:
            return HttpResponse("You don't have access to this report.", status=403, content_type="text/plain")

        pdf = render_attendance_pdf(build_report(meeting), request.query_params.get("tz", "UTC"))
        name = slugify(meeting.title) or meeting.code
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="attendance-{name}.pdf"'
        response["Content-Length"] = str(len(pdf))
        response["Cache-Control"] = "no-store"
        return response
