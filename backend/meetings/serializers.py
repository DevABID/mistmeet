from rest_framework import serializers

from accounts.serializers import display_name_for

from .models import ChatMessage, Meeting, Participant


class MeetingSerializer(serializers.ModelSerializer):
    host_name = serializers.SerializerMethodField()
    is_host = serializers.SerializerMethodField()
    participant_count = serializers.SerializerMethodField()

    class Meta:
        model = Meeting
        fields = [
            "code", "title", "host_name", "is_host", "scheduled_for",
            "require_approval", "is_active", "participant_count", "created_at",
        ]
        read_only_fields = ["code", "is_active", "created_at"]

    def get_host_name(self, obj):
        return display_name_for(obj.host)

    def get_is_host(self, obj):
        request = self.context.get("request")
        return bool(request and request.user.id == obj.host_id)

    def get_participant_count(self, obj):
        return obj.participants.filter(status=Participant.Status.ADMITTED).count()


class ChatMessageSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="display_name")

    class Meta:
        model = ChatMessage
        fields = ["id", "peer_id", "name", "text", "created_at"]
