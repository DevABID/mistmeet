from urllib.parse import urlencode

from django.conf import settings
from django.core import signing
from django.db.models import F, Max
from django.http import HttpResponse
from django.utils.text import slugify
from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .attendance import build_report, serialize
from .models import Meeting, Participant
from .pdf import render_attendance_pdf
from .serializers import ChatMessageSerializer, MeetingSerializer


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


class MeetingMessagesView(generics.ListAPIView):
    """Chat history, visible to the host and to anyone admitted to the call."""

    serializer_class = ChatMessageSerializer
    pagination_class = None

    def get_queryset(self):
        meeting = get_object_or_404(Meeting, code=self.kwargs["code"])
        user = self.request.user
        allowed = meeting.host_id == user.id or meeting.participants.filter(
            user=user, admitted_at__isnull=False
        ).exists()
        if not allowed:
            raise PermissionDenied("Join the meeting to see its messages.")
        return meeting.messages.all()


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
