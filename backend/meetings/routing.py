from django.urls import re_path

from .consumers import MeetingConsumer

websocket_urlpatterns = [
    re_path(r"^ws/meet/(?P<code>[a-z]{3}-[a-z]{4}-[a-z]{3})/$", MeetingConsumer.as_asgi()),
]
