from django.urls import path

from .views import (
    AttendancePdfView,
    AttendanceView,
    IceServersView,
    MeetingDetailView,
    MeetingListCreateView,
    MeetingMessagesView,
)

urlpatterns = [
    path("meetings/", MeetingListCreateView.as_view()),
    path("meetings/<str:code>/", MeetingDetailView.as_view()),
    path("meetings/<str:code>/messages/", MeetingMessagesView.as_view()),
    path("meetings/<str:code>/attendance/", AttendanceView.as_view()),
    path("meetings/<str:code>/attendance/pdf/", AttendancePdfView.as_view()),
    path("ice-servers/", IceServersView.as_view()),
]
