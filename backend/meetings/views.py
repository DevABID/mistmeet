from django.conf import settings
from django.db.models import F, Max
from django.http import HttpResponse
from django.utils.text import slugify
from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.exceptions import PermissionDenied
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


class AttendancePdfView(APIView):
    """Attendance report as a downloadable PDF (host only). ?tz=Asia/Dhaka sets the time zone."""

    def get(self, request, code):
        meeting = _hosted_meeting(request, code)
        report = build_report(meeting)
        pdf = render_attendance_pdf(report, request.query_params.get("tz", "UTC"))
        name = slugify(meeting.title) or meeting.code
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="attendance-{name}.pdf"'
        return response
